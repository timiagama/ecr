/**
 * Bounded Execution
 *
 * Parsing Markdown is where a corpus stops being data and starts being work
 * the command cannot predict. The parser is recursive and, on some inputs,
 * quadratic: four thousand nested bold spans inside a link label -- 16 KB --
 * exhaust the call stack, and four thousand nested images -- 35 KB -- parse
 * for the best part of a minute. Neither is a fault in a document anyone
 * wrote on purpose, and neither can be found by inspecting a document before
 * parsing it, since the cost is the parse.
 *
 * So `lint` and `stats` do their work in a child process this one starts and
 * can stop. The child is this same executable, run once for the whole corpus,
 * with a time limit and a heap limit; whatever it prints is relayed. If it
 * has to be stopped, nothing it printed is relayed, because a report of a
 * corpus that was never finished is worse than no report: half a JSON
 * document still parses as JSON.
 *
 * This bounds the command, not the library. A host calling `lintDocument`
 * directly runs the parser in its own process and must bound it itself.
 */

import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';

/**
 * The environment variable marking the child, so that it does the work
 * rather than starting a child of its own.
 */
export const SUPERVISED_VARIABLE: string = 'ECR_SUPERVISED';

/** The limits a supervised run is given. */
export interface SupervisionLimits {
  /** Milliseconds the child may run for; `0` for no limit. */
  readonly timeoutMs: number;
  /**
   * Mebibytes the child's V8 old-generation heap may grow to; `0` leaves
   * Node's own default. This bounds the heap where a parse accumulates, not
   * the process's total memory: stacks, buffers and the young generation sit
   * outside it, so it is a brake rather than a ceiling.
   */
  readonly memoryMib: number;
  /** Bytes of output the child may produce before it is stopped. */
  readonly maxOutputBytes: number;
}

/** A child that finished by itself: its output and exit code stand. */
export interface CompletedRun {
  /** Distinguishes this from a run that was stopped. */
  readonly kind: 'completed';
  /** Everything the child wrote to standard output. */
  readonly stdout: string;
  /** Everything the child wrote to standard error. */
  readonly stderr: string;
  /** The code the child exited with. */
  readonly exitCode: number;
}

/** A child that was stopped, or never ran; nothing it printed is usable. */
export interface StoppedRun {
  /** Distinguishes this from a run that completed. */
  readonly kind: 'stopped';
  /** Why it did not finish, as a phrase completing "the run did not finish because...". */
  readonly reason: string;
}

/** What a supervised run produced. */
export type SupervisedOutcome = CompletedRun | StoppedRun;

/**
 * Default limits: generous for a real corpus, finite for a hostile one.
 *
 * The heap limit is V8's old-generation size. It bounds where a parse
 * accumulates, not the process: a child can still be stopped for reasons
 * this number does not govern, and a child given too little cannot start at
 * all, which the command reports rather than passing on.
 */
export const DEFAULT_SUPERVISION_LIMITS: SupervisionLimits = {
  timeoutMs: 120_000,
  memoryMib: 2048,
  maxOutputBytes: 64 * 1024 * 1024,
};

/**
 * Runs a command in a child process that can be stopped.
 */
export class Supervisor {
  /** The script the child runs: this package's executable. */
  private readonly entryPoint: string;

  /** The limits placed on the child. */
  private readonly limits: SupervisionLimits;

  /**
   * The directory the child runs in. Relative paths in the arguments, and the
   * project whose `.ecrignore` applies, are resolved against it, so it must be
   * the directory the command was configured with rather than whichever
   * directory this process happens to be in.
   */
  private readonly workingDirectory: string;

  /**
   * Creates a supervisor.
   *
   * @param entryPoint - Path of the script the child runs
   * @param limits - The limits to place on it
   * @param workingDirectory - The directory the child runs in
   */
  public constructor(
    entryPoint: string,
    limits: SupervisionLimits = DEFAULT_SUPERVISION_LIMITS,
    workingDirectory: string = process.cwd(),
  ) {
    this.entryPoint = entryPoint;
    this.limits = limits;
    this.workingDirectory = workingDirectory;
  }

  /**
   * Runs one command in a child process and waits for it.
   *
   * @param argv - The arguments to pass on, exactly as they were given
   * @returns What the child produced, or why it was stopped
   */
  public run(argv: readonly string[]): SupervisedOutcome {
    const nodeOptions: readonly string[] =
      this.limits.memoryMib > 0 ? [`--max-old-space-size=${String(this.limits.memoryMib)}`] : [];

    let child: SpawnSyncReturns<string>;

    try {
      child = spawnSync(process.execPath, [...nodeOptions, this.entryPoint, ...argv], {
        encoding: 'utf8',
        cwd: this.workingDirectory,
        maxBuffer: this.limits.maxOutputBytes,
        ...(this.limits.timeoutMs > 0 ? { timeout: this.limits.timeoutMs } : {}),
        // A child busy in synchronous JavaScript cannot run a handler for a
        // signal, but an idle one can, and a handled SIGTERM would leave this
        // process waiting past the limit it just imposed. Nothing here needs
        // the child's cooperation, so it is not asked for.
        killSignal: 'SIGKILL',
        env: { ...process.env, [SUPERVISED_VARIABLE]: '1' },
      });
    } catch (error: unknown) {
      // Starting a process can fail outright -- a limit node will not accept,
      // a directory that is not there -- and that is a run that did not happen.
      return {
        kind: 'stopped',
        reason: `it could not be started (${error instanceof Error ? error.message : String(error)})`,
      };
    }

    if (child.error !== undefined) {
      return { kind: 'stopped', reason: this.showFailure(child.error) };
    }

    // A child killed by a signal reports no exit code. Whatever reached this
    // process before it died says nothing about the corpus as a whole.
    if (child.status === null) {
      return {
        kind: 'stopped',
        reason: `it was stopped (${child.signal ?? 'unknown signal'}) before it finished`,
      };
    }

    return {
      kind: 'completed',
      stdout: child.stdout,
      stderr: child.stderr,
      exitCode: child.status,
    };
  }

  /**
   * Describes why a child did not finish, in terms of the limit it met.
   *
   * @param error - What `spawnSync` reported
   * @returns The reason, as a phrase completing "the run did not finish because..."
   */
  private showFailure(error: Error): string {
    const code: string | undefined = (error as NodeJS.ErrnoException).code;

    if (code === 'ETIMEDOUT') {
      const seconds: string = (this.limits.timeoutMs / 1000).toFixed(0);

      return (
        `it reached its time limit of ${seconds} second(s). One document can take that long ` +
        `to parse when its Markdown is deeply nested. Raise the limit with --timeout <seconds>, ` +
        `or narrow the corpus`
      );
    }

    if (code === 'ENOBUFS') {
      const mebibytes: string = (this.limits.maxOutputBytes / (1024 * 1024)).toFixed(0);

      return (
        `it produced more than ${mebibytes} MiB of output, which cannot be passed on whole. ` +
        `Part of a report is not a report, so none of it was printed`
      );
    }

    return `it could not be run (${code ?? error.message})`;
  }
}

/**
 * Bounded Execution Tests
 *
 * `lint` and `stats` parse documents in a child process so that a parse which
 * will not finish can be stopped. These tests give the supervisor small
 * scripts that behave the way a runaway parse behaves — spinning, flooding,
 * failing to start — because a real hostile document takes seconds to fail
 * and proves nothing here that a spinning script does not.
 *
 * The forced-termination cases matter on every platform: `SIGTERM` is a real
 * signal on Linux and an emulation on Windows, and a child busy in
 * synchronous JavaScript cannot run a handler for it either way.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { DEFAULT_SUPERVISION_LIMITS, SUPERVISED_VARIABLE, Supervisor } from '../src/cli/supervisor.js';
import type { SupervisedOutcome, SupervisionLimits } from '../src/cli/supervisor.js';

let workspace: string;

/**
 * Writes a script for a child to run.
 *
 * @param name - The script's filename
 * @param source - Its contents
 * @returns The script's path
 */
function writeScript(name: string, source: string): string {
  const path: string = join(workspace, name);
  writeFileSync(path, source, 'utf8');

  return path;
}

/**
 * Supervises a script.
 *
 * @param entryPoint - The script to run
 * @param limits - Limits overriding the defaults
 * @param argv - Arguments to pass on
 * @returns What the run produced
 */
function supervise(
  entryPoint: string,
  limits: Partial<SupervisionLimits> = {},
  argv: readonly string[] = [],
): SupervisedOutcome {
  return new Supervisor(entryPoint, { ...DEFAULT_SUPERVISION_LIMITS, ...limits }).run(argv);
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-supervisor-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Feature: A child that finishes has its work passed on', () => {
  it('passes on what the child printed, and the code it exited with', () => {
    const script: string = writeScript(
      'report.mjs',
      'process.stdout.write("  9 document(s) checked, no errors.\\n");\nprocess.exitCode = 1;\n',
    );

    const outcome: SupervisedOutcome = supervise(script);

    expect(outcome).toEqual({
      kind: 'completed',
      stdout: '  9 document(s) checked, no errors.\n',
      stderr: '',
      exitCode: 1,
    });
  });

  it('passes the arguments on unchanged', () => {
    const script: string = writeScript(
      'echo-args.mjs',
      'process.stdout.write(JSON.stringify(process.argv.slice(2)));\n',
    );

    const outcome: SupervisedOutcome = supervise(script, {}, ['lint', 'docs', '--format', 'json']);

    expect(outcome.kind === 'completed' && JSON.parse(outcome.stdout)).toEqual([
      'lint',
      'docs',
      '--format',
      'json',
    ]);
  });

  it('tells the child it is the child, so that it does the work itself', () => {
    const script: string = writeScript(
      'echo-flag.mjs',
      `process.stdout.write(process.env['${SUPERVISED_VARIABLE}'] ?? 'unset');\n`,
    );

    const outcome: SupervisedOutcome = supervise(script);

    expect(outcome.kind === 'completed' && outcome.stdout).toBe('1');
  });

  it('gives the child the heap limit it was asked for', () => {
    const script: string = writeScript(
      'echo-exec-argv.mjs',
      'process.stdout.write(JSON.stringify(process.execArgv));\n',
    );

    /**
     * Runs the script and reads back the options node itself was given.
     *
     * @param memoryMib - The heap limit to ask for
     * @returns The child's own node options
     */
    function showNodeOptions(memoryMib: number): readonly string[] {
      const outcome: SupervisedOutcome = supervise(script, { memoryMib });

      return JSON.parse(outcome.kind === 'completed' ? outcome.stdout : '[]') as readonly string[];
    }

    expect(showNodeOptions(512)).toEqual(['--max-old-space-size=512']);
    // Zero leaves node's own default in place rather than setting a limit.
    expect(showNodeOptions(0)).toEqual([]);
  });
});

describe('Feature: A child that will not finish is stopped, and nothing it printed is used', () => {
  /** A script that prints, then spins in synchronous JavaScript, as a runaway parse does. */
  const SPINNING_SOURCE: string =
    'process.stdout.write("partial report\\n");\n' +
    'const until = Date.now() + 60000;\n' +
    'while (Date.now() < until) { /* as a parse does */ }\n' +
    'process.stdout.write("finished\\n");\n';

  it('stops a child that runs past its time limit', () => {
    const script: string = writeScript('spin.mjs', SPINNING_SOURCE);
    const started: number = Date.now();

    const outcome: SupervisedOutcome = supervise(script, { timeoutMs: 1000 });

    expect(outcome.kind).toBe('stopped');
    expect(outcome.kind === 'stopped' && outcome.reason).toContain('time limit of 1 second(s)');
    // Stopped, not waited out: the script would have run for a minute.
    expect(Date.now() - started).toBeLessThan(20000);
  }, 30000);

  it('keeps the part of a report that reached it out of the result', () => {
    const script: string = writeScript('spin-partial.mjs', SPINNING_SOURCE);

    const outcome: SupervisedOutcome = supervise(script, { timeoutMs: 1000 });

    expect(JSON.stringify(outcome)).not.toContain('partial report');
  }, 30000);

  it('stops a child that produces more output than can be passed on', () => {
    const script: string = writeScript(
      'flood.mjs',
      'process.stdout.write("{".repeat(2 * 1024 * 1024));\n',
    );

    const outcome: SupervisedOutcome = supervise(script, { maxOutputBytes: 1024 });

    expect(outcome.kind).toBe('stopped');
    expect(outcome.kind === 'stopped' && outcome.reason).toContain('output');
    // Half a JSON report still parses as JSON, so none of it is passed on.
    expect(JSON.stringify(outcome)).not.toContain('{{{');
  });

  it('gives back a failure, and no report, when the script is not there', () => {
    const outcome: SupervisedOutcome = supervise(join(workspace, 'no-such-script.mjs'));

    // Node starts and then fails, so this arrives as a child that exited
    // non-zero having printed nothing. The command turns that into a failed
    // run rather than a corpus verdict; see the CLI tests.
    expect(outcome.kind === 'completed' && outcome.exitCode).not.toBe(0);
    expect(outcome.kind === 'completed' && outcome.stdout).toBe('');
  });

  // A child busy in synchronous JavaScript, which is what a runaway parse is,
  // cannot run a signal handler. An idle one can, and on Linux a handled
  // SIGTERM would leave the supervisor waiting past the limit it imposed, so
  // the child is not asked to co-operate. On Windows the signal is an
  // emulation the child cannot refuse, and this passes for that reason.
  it('stops a child that refuses to stop when asked politely', () => {
    const script: string = writeScript(
      'stubborn.mjs',
      [
        'process.on("SIGTERM", () => { /* refuses to exit */ });',
        'process.stdout.write("ignoring signals");',
        'setInterval(() => { /* stays alive and idle */ }, 10);',
      ].join('\n'),
    );
    const started: number = Date.now();

    const outcome: SupervisedOutcome = supervise(script, { timeoutMs: 1000 });

    expect(outcome.kind).toBe('stopped');
    expect(Date.now() - started).toBeLessThan(20000);
  }, 30000);

  it('gives back a failure when the limits themselves cannot be applied', () => {
    const script: string = writeScript('unused.mjs', 'process.stdout.write("never runs");');

    // Starting the child throws rather than failing: the run did not happen,
    // and says so, instead of the error escaping as a crash.
    const outcome: SupervisedOutcome = supervise(script, { maxOutputBytes: -1 });

    expect(outcome.kind).toBe('stopped');
    expect(outcome.kind === 'stopped' && outcome.reason).toContain('could not be started');
  });

  it('runs the child in the directory it was given, not the one this process is in', () => {
    const script: string = writeScript('echo-cwd.mjs', 'process.stdout.write(process.cwd());');
    const elsewhere: string = mkdtempSync(join(tmpdir(), 'ecr-elsewhere-'));

    try {
      const outcome: SupervisedOutcome = new Supervisor(
        script,
        DEFAULT_SUPERVISION_LIMITS,
        elsewhere,
      ).run([]);

      expect(outcome.kind === 'completed' && realpathSync(outcome.stdout)).toBe(
        realpathSync(elsewhere),
      );
    } finally {
      rmSync(elsewhere, { recursive: true, force: true });
    }
  });

  it('runs without a time limit when asked to, rather than treating zero as immediate', () => {
    const script: string = writeScript('quick.mjs', 'process.stdout.write("done");\n');

    const outcome: SupervisedOutcome = supervise(script, { timeoutMs: 0 });

    expect(outcome.kind === 'completed' && outcome.stdout).toBe('done');
  });
});

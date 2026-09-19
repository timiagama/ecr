/**
 * ECR Command Line
 *
 * The executable entry point is `bin.ts`; this module only defines the
 * commands, so that tests can drive them without spawning a process.
 *
 * Three commands, and deliberately no more:
 *
 * - `lint`  validates a corpus against the ECR structural rules
 * - `stats` measures the explicit structure a corpus already carries
 * - `init`  writes the agent navigation protocol into a corpus
 *
 * There is no `backlinks` command, and there should never be one. ECR's claim
 * is that a corpus is navigable with `grep` alone; a navigation command here
 * would quietly make the tool a dependency of the thing it exists to prove
 * unnecessary. Navigation belongs in the protocol `init` writes, not in this
 * binary.
 */

import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ecr } from './ecr.js';
import { ECR_SPEC_VERSION } from './spec-version.js';
import type { CorpusResult } from './types.js';
import { CorpusLoader } from './cli/corpus-loader.js';
import type { LoadedCorpus } from './cli/corpus-loader.js';
import { CorpusStatistics } from './cli/corpus-statistics.js';
import { DiagnosticReporter } from './cli/diagnostic-reporter.js';
import type { ReportFormat } from './cli/diagnostic-reporter.js';

/** Commands the CLI accepts. */
export type CommandName = 'lint' | 'stats' | 'init';

/**
 * The stream a command's output belongs on.
 *
 * Results go to stdout; problems with the invocation itself go to stderr, so
 * that `--format json` output piped into another tool is never interleaved
 * with, or replaced by, an error message.
 */
export type OutputStream = 'stdout' | 'stderr';

/**
 * The result of running one command: what to print, where, and how to exit.
 */
export interface CommandOutcome {
  /** Text to write. */
  readonly output: string;
  /** The stream to write it to. */
  readonly stream: OutputStream;
  /** Process exit code. */
  readonly exitCode: number;
}

/**
 * A parsed command line.
 */
export interface ParsedArguments {
  /** The command to run. */
  readonly command: CommandName;
  /** Directory the command operates on. */
  readonly corpusRoot: string;
  /** Whether to run against the example corpus bundled with the package. */
  readonly useExample: boolean;
  /** Output format for `lint` and `stats`. */
  readonly format: ReportFormat;
  /** Glob patterns excluding project-specific meta-documents. */
  readonly ignorePatterns: readonly string[];
}

/**
 * The fields of `package.json` the CLI reads.
 */
interface PackageManifest {
  /** The published package version. */
  readonly version: string;
}

/** Process exit code signalling success. */
const EXIT_SUCCESS: number = 0;

/** Process exit code signalling that the corpus contains errors. */
const EXIT_VALIDATION_FAILED: number = 1;

/** Process exit code signalling that the command line could not be understood. */
const EXIT_USAGE_ERROR: number = 2;

/** Filename the navigation protocol is written as by `init`. */
const PROTOCOL_FILENAME: string = 'ECR-NAVIGATION-PROTOCOL.md';

/** Usage text shown for `--help` and on a usage error. */
const USAGE_TEXT: string = `
  ecr - Explicit Constraint Referencing

  Usage
    ecr lint  [directory] [options]   validate a corpus
    ecr stats [directory] [options]   measure a corpus
    ecr init  [directory]             write the agent navigation protocol

  Options
    --format <pretty|json>   output format (default: pretty)
    --ignore <glob>          exclude paths; repeatable
    --example                lint or measure the example corpus bundled
                             with this package, instead of a directory
    --version                show the linter and spec versions
    --help                   show this message

  The directory defaults to ./docs.

  Exit codes
    0  no errors
    1  the corpus contains errors
    2  the command line could not be understood
`;

/**
 * Parses command-line arguments.
 *
 * Throws on anything it cannot understand rather than guessing, because a
 * silently misread `--ignore` would quietly exclude documents from validation.
 */
export class ArgumentParser {
  /**
   * Parses an argument list.
   *
   * @param argv - Arguments, excluding the node executable and script path
   * @returns The parsed command line
   * @throws Error when the arguments cannot be understood
   */
  public parse(argv: readonly string[]): ParsedArguments {
    const [commandCandidate, ...rest] = argv;

    if (commandCandidate === undefined) {
      throw new Error('No command given.');
    }

    if (!this.isCommandName(commandCandidate)) {
      throw new Error(`Unknown command "${commandCandidate}".`);
    }

    let corpusRoot: string | undefined = undefined;
    let useExample: boolean = false;
    let format: ReportFormat = 'pretty';
    const ignorePatterns: string[] = [];

    for (let index: number = 0; index < rest.length; index += 1) {
      const argument: string = rest[index] ?? '';

      if (argument === '--example') {
        useExample = true;
        continue;
      }

      if (argument === '--format') {
        const value: string | undefined = rest[index + 1];

        if (value !== 'pretty' && value !== 'json') {
          throw new Error('--format expects "pretty" or "json".');
        }

        format = value;
        index += 1;
        continue;
      }

      if (argument === '--ignore') {
        const value: string | undefined = rest[index + 1];

        if (value === undefined || value.startsWith('--')) {
          throw new Error('--ignore expects a glob pattern.');
        }

        ignorePatterns.push(value);
        index += 1;
        continue;
      }

      if (argument.startsWith('--')) {
        throw new Error(`Unknown option "${argument}".`);
      }

      if (corpusRoot !== undefined) {
        throw new Error('More than one directory given.');
      }

      corpusRoot = argument;
    }

    if (useExample && commandCandidate === 'init') {
      throw new Error('--example works with lint and stats; init writes into your own corpus.');
    }

    if (useExample && corpusRoot !== undefined) {
      throw new Error('Give a directory or --example, not both.');
    }

    return {
      command: commandCandidate,
      corpusRoot: corpusRoot ?? 'docs',
      useExample,
      format,
      ignorePatterns,
    };
  }

  /**
   * Determines whether a string names a supported command.
   *
   * @param candidate - The string to test
   * @returns `true` when the string is a command name
   */
  private isCommandName(candidate: string): candidate is CommandName {
    return candidate === 'lint' || candidate === 'stats' || candidate === 'init';
  }
}

/**
 * Runs the CLI commands.
 *
 * Output is returned rather than printed so that the commands can be exercised
 * directly by tests without capturing a stream.
 */
export class EcrCommandLine {
  /** Parses the command line. */
  private readonly argumentParser: ArgumentParser;

  /**
   * Creates a command-line runner.
   */
  public constructor() {
    this.argumentParser = new ArgumentParser();
  }

  /**
   * Runs one invocation.
   *
   * @param argv - Arguments, excluding the node executable and script path
   * @returns The text to print and the process exit code
   */
  public run(argv: readonly string[]): CommandOutcome {
    if (argv.length === 0) {
      return this.fail(USAGE_TEXT);
    }

    if (argv.includes('--help')) {
      return this.succeed(USAGE_TEXT);
    }

    if (argv.includes('--version')) {
      return this.succeed(`ecr ${this.showPackageVersion()} (ECR spec ${ECR_SPEC_VERSION})\n`);
    }

    let parsed: ParsedArguments;

    try {
      parsed = this.argumentParser.parse(argv);
    } catch (error: unknown) {
      const message: string = error instanceof Error ? error.message : String(error);
      return this.fail(`  ${message}\n${USAGE_TEXT}`);
    }

    const corpusRoot: string = resolve(parsed.corpusRoot);

    // `init` sets a corpus up, so it may create the directory; the other
    // commands read a corpus that must already exist.
    if (parsed.command === 'init') {
      return this.runInit(corpusRoot, parsed.corpusRoot);
    }

    if (parsed.useExample) {
      return this.runValidation(
        parsed,
        join(this.showPackageRoot(), 'examples', 'docs'),
        'the bundled example corpus',
      );
    }

    return this.runValidation(parsed, corpusRoot, parsed.corpusRoot);
  }

  /**
   * Runs `lint` or `stats` against a corpus.
   *
   * @param parsed - The parsed command line
   * @param corpusRoot - Resolved corpus directory
   * @param displayedRoot - How to name the corpus in messages
   * @returns The text to print and the process exit code
   */
  private runValidation(
    parsed: ParsedArguments,
    corpusRoot: string,
    displayedRoot: string,
  ): CommandOutcome {
    if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
      return this.fail(`  Directory not found: ${displayedRoot}\n`);
    }

    const loader: CorpusLoader = new CorpusLoader(corpusRoot, parsed.ignorePatterns);
    const loaded: LoadedCorpus = loader.load();

    if (loaded.documents.length === 0) {
      return this.fail(`  No Markdown documents found in ${displayedRoot}\n`);
    }

    const corpusResult: CorpusResult = new Ecr().validateCorpus(loaded.documents);
    const reporter: DiagnosticReporter = new DiagnosticReporter(parsed.format);

    if (parsed.command === 'stats') {
      const statistics: CorpusStatistics = new CorpusStatistics(corpusResult);
      return this.succeed(reporter.reportStatistics(statistics.summarise()));
    }

    const output: string = reporter.reportValidation(corpusResult, loaded.excludedPaths);
    const hasErrors: boolean = this.tellCorpusHasErrors(corpusResult);

    // A report of a failing corpus is still the command's result, so it goes
    // to stdout; only the exit code signals the failure.
    return {
      output,
      stream: 'stdout',
      exitCode: hasErrors ? EXIT_VALIDATION_FAILED : EXIT_SUCCESS,
    };
  }

  /**
   * Writes the agent navigation protocol into a corpus directory, creating
   * the directory if it does not exist yet.
   *
   * @param corpusRoot - Resolved corpus directory
   * @param displayedRoot - The directory as the user typed it, for messages
   * @returns The text to print and the process exit code
   */
  private runInit(corpusRoot: string, displayedRoot: string): CommandOutcome {
    const source: string = join(this.showPackageRoot(), 'protocol', 'navigation-protocol.md');

    if (!existsSync(source)) {
      return this.fail('  The packaged navigation protocol could not be found.\n');
    }

    if (existsSync(corpusRoot) && !statSync(corpusRoot).isDirectory()) {
      return this.fail(`  ${displayedRoot} exists but is not a directory.\n`);
    }

    const destination: string = join(corpusRoot, PROTOCOL_FILENAME);

    if (existsSync(destination)) {
      return this.fail(
        `  ${PROTOCOL_FILENAME} already exists in that directory.\n` +
        '  Delete it first if you want the packaged version.\n',
      );
    }

    mkdirSync(corpusRoot, { recursive: true });
    copyFileSync(source, destination);

    return this.succeed(
      `\n  Wrote ${join(displayedRoot, PROTOCOL_FILENAME)}\n\n` +
      '  Point your coding agent at that file before it works on this corpus.\n' +
      '  It is the half that does the navigating; the linter only checks structure.\n\n',
    );
  }

  /**
   * Builds a successful outcome, written to stdout.
   *
   * @param output - The text to print
   * @returns The outcome
   */
  private succeed(output: string): CommandOutcome {
    return { output, stream: 'stdout', exitCode: EXIT_SUCCESS };
  }

  /**
   * Builds the outcome of an invocation that could not run, written to stderr.
   *
   * @param output - The message to print
   * @returns The outcome
   */
  private fail(output: string): CommandOutcome {
    return { output, stream: 'stderr', exitCode: EXIT_USAGE_ERROR };
  }

  /**
   * Locates the package root: the directory holding `package.json`.
   *
   * Resolved relative to this module, so it is correct whether the CLI runs
   * from source, from `dist/`, or from an installed package.
   *
   * @returns Absolute path to the package root
   */
  private showPackageRoot(): string {
    return resolve(dirname(fileURLToPath(import.meta.url)), '..');
  }

  /**
   * Reads the published package version from `package.json`.
   *
   * @returns The package version
   */
  private showPackageVersion(): string {
    const manifestText: string = readFileSync(
      join(this.showPackageRoot(), 'package.json'),
      'utf8',
    );
    const manifest: PackageManifest = JSON.parse(manifestText) as PackageManifest;
    return manifest.version;
  }

  /**
   * Determines whether a corpus result contains any error-severity diagnostic.
   *
   * @param corpusResult - The result to inspect
   * @returns `true` when at least one error was reported
   */
  private tellCorpusHasErrors(corpusResult: CorpusResult): boolean {
    for (const entry of corpusResult.documents) {
      for (const diagnostic of entry.result.diagnostics) {
        if (diagnostic.severity === 'error') {
          return true;
        }
      }
    }

    return corpusResult.diagnostics.some(
      (diagnostic) => diagnostic.severity === 'error',
    );
  }
}

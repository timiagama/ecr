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
 * - `init`  installs the ECR documentation, including the agent navigation
 *           protocol, beside a corpus
 *
 * There is no `backlinks` command, and there should never be one. ECR's claim
 * is that a corpus is navigable with `grep` alone; a navigation command here
 * would quietly make the tool a dependency of the thing it exists to prove
 * unnecessary. Navigation belongs in the protocol `init` installs, not in this
 * binary.
 */

import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { Ecr } from './ecr.js';
import { ECR_SPEC_VERSION } from './spec-version.js';
import type { CorpusResult } from './types.js';
import { CorpusLoader } from './cli/corpus-loader.js';
import type { LoadedCorpus, ProjectIgnore, UnreadablePath } from './cli/corpus-loader.js';
import { PROJECT_IGNORE_FILENAME, ProjectIgnoreFile } from './cli/project-ignore.js';
import type { InstallExclusion, ProjectIgnoreRead } from './cli/project-ignore.js';
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
 * Where a command-line runner works. Both default to the real ones; tests
 * supply their own so that nothing is written into this repository.
 */
export interface EcrCommandLineOptions {
  /** The directory the command runs from, and the project root for `.ecrignore`. */
  readonly workingDirectory?: string;
  /** The package's own root: where `init` copies from and `--example` reads. */
  readonly packageRoot?: string;
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

/**
 * Process exit code signalling that the command could not run: arguments it
 * could not understand, or a corpus it could not find or fully read.
 */
const EXIT_USAGE_ERROR: number = 2;

/**
 * What `init` installs, from the package root, keeping each path as it is in
 * the repository so the README's relative links work in the installed copy.
 */
const INSTALLED_DOCUMENTATION: readonly string[] = [
  'README.md',
  'LICENSE',
  'NOTICE',
  'protocol',
  'spec',
  'examples',
];

/** Where `lint` and `stats` look when no directory is given. */
const DEFAULT_CORPUS_DIRECTORY: string = 'docs';

/**
 * Where `init` installs when no directory is given: beside the corpus, never
 * in it, because the specification's own DocIDs would collide with the
 * user's.
 */
const DEFAULT_INSTALL_DIRECTORY: string = 'ecr';

/** Usage text shown for `--help` and on a usage error. */
const USAGE_TEXT: string = `
  ecr - Explicit Constraint Referencing

  Usage
    ecr lint  [directory] [options]   validate a corpus
    ecr stats [directory] [options]   measure a corpus
    ecr init  [directory]             install the ECR documentation

  Options
    --format <pretty|json>   output format (default: pretty)
    --ignore <glob>          exclude paths; repeatable
    --example                lint or measure the example corpus bundled
                             with this package, instead of a directory
    --version                show the linter and spec versions
    --help                   show this message

  The directory defaults to ./docs, or to ./ecr for init.

  Patterns in .ecrignore, in the directory the command runs from, are
  excluded too. They are relative to that directory; --ignore patterns are
  relative to the directory being linted.

  Exit codes
    0  no errors
    1  the corpus contains errors
    2  the command could not run
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
      throw new Error('--example works with lint and stats; init installs into your own project.');
    }

    if (useExample && corpusRoot !== undefined) {
      throw new Error('Give a directory or --example, not both.');
    }

    return {
      command: commandCandidate,
      corpusRoot: corpusRoot ?? (commandCandidate === 'init' ? DEFAULT_INSTALL_DIRECTORY : DEFAULT_CORPUS_DIRECTORY),
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
   * The directory the command runs from: relative directories resolve against
   * it, and it is the project root whose `.ecrignore` applies.
   */
  private readonly workingDirectory: string;

  /** The package's own root, holding `package.json` and what `init` installs. */
  private readonly packageRoot: string;

  /**
   * Creates a command-line runner.
   *
   * @param options - Where the command runs from and where the package lives; both default to the real ones
   */
  public constructor(options: EcrCommandLineOptions = {}) {
    this.argumentParser = new ArgumentParser();
    this.workingDirectory = options.workingDirectory ?? process.cwd();
    // Resolved relative to this module, so it is correct whether the CLI runs
    // from source, from `dist/`, or from an installed package.
    this.packageRoot = options.packageRoot ?? resolve(dirname(fileURLToPath(import.meta.url)), '..');
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

    const corpusRoot: string = resolve(this.workingDirectory, parsed.corpusRoot);

    // `init` installs the documentation, so it may create the directory; the
    // other commands read a corpus that must already exist.
    if (parsed.command === 'init') {
      return this.runInit(corpusRoot, parsed.corpusRoot);
    }

    // The bundled example belongs to the package, not the project, so the
    // project's .ecrignore does not apply to it; --ignore still does.
    if (parsed.useExample) {
      return this.runValidation(
        parsed,
        join(this.packageRoot, 'examples', 'docs'),
        'the bundled example corpus',
        false,
      );
    }

    return this.runValidation(parsed, corpusRoot, parsed.corpusRoot, true);
  }

  /**
   * Runs `lint` or `stats` against a corpus.
   *
   * @param parsed - The parsed command line
   * @param corpusRoot - Resolved corpus directory
   * @param displayedRoot - How to name the corpus in messages
   * @param applyProjectIgnore - Whether the project's `.ecrignore` applies
   * @returns The text to print and the process exit code
   */
  private runValidation(
    parsed: ParsedArguments,
    corpusRoot: string,
    displayedRoot: string,
    applyProjectIgnore: boolean,
  ): CommandOutcome {
    if (!existsSync(corpusRoot) || !statSync(corpusRoot).isDirectory()) {
      return this.fail(`  Directory not found: ${displayedRoot}\n`);
    }

    let projectIgnore: ProjectIgnore | undefined = undefined;

    if (applyProjectIgnore) {
      const read: ProjectIgnoreRead = new ProjectIgnoreFile(this.workingDirectory).read();

      if (read.kind === 'unreadable') {
        return this.fail(`  Could not read ${PROJECT_IGNORE_FILENAME} (${read.reason}).\n`);
      }

      if (read.kind === 'patterns') {
        projectIgnore = { workingDirectory: this.workingDirectory, patterns: read.patterns };
      }
    }

    const loader: CorpusLoader = new CorpusLoader(corpusRoot, parsed.ignorePatterns, projectIgnore);
    const loaded: LoadedCorpus = loader.load();

    if (loaded.rootExcluded) {
      return this.fail(`  ${displayedRoot} is excluded by ${PROJECT_IGNORE_FILENAME}, so there is nothing to check.\n`);
    }

    // A corpus that was not fully read cannot pass or be summarised, so the
    // command cannot run; the walk still finished, so every such path is named.
    if (loaded.unreadablePaths.length > 0) {
      return this.fail(
        '  Could not read:\n' +
        loaded.unreadablePaths.map((unreadable: UnreadablePath): string =>
          `    ${unreadable.path} (${unreadable.reason})\n`,
        ).join('') +
        '  Fix these paths, or exclude them with --ignore.\n',
      );
    }

    if (loaded.documents.length === 0) {
      // Links are the likeliest reason a directory of documents yields none.
      const links: readonly string[] = DiagnosticReporter.listNotFollowed(loaded.notFollowedPaths);

      return this.fail(
        `  No Markdown documents found in ${displayedRoot}\n` +
        links.map((line: string): string => `${line}\n`).join('') +
        (links.length > 0 ? '  Links are not followed, because `rg` and `grep -r` do not follow them either.\n' : ''),
      );
    }

    const corpusResult: CorpusResult = new Ecr().validateCorpus(loaded.documents);
    const reporter: DiagnosticReporter = new DiagnosticReporter(parsed.format);

    if (parsed.command === 'stats') {
      const statistics: CorpusStatistics = new CorpusStatistics(corpusResult);
      return this.succeed(reporter.reportStatistics(statistics.summarise(), loaded.notFollowedPaths));
    }

    const output: string = reporter.reportValidation(
      corpusResult,
      loaded.excludedPaths,
      loaded.notFollowedPaths,
    );
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
   * Installs the ECR documentation into a new or empty directory, keeping the
   * repository's layout, and adds that directory to the project's
   * `.ecrignore` so that linting the project does not validate it.
   *
   * Everything that could stop the installation is checked before anything is
   * written, and a failure part-way removes what was copied.
   *
   * @param destination - Resolved installation directory
   * @param displayedDestination - The directory as the user typed it, for messages
   * @returns The text to print and the process exit code
   */
  private runInit(destination: string, displayedDestination: string): CommandOutcome {
    const packageRoot: string = this.packageRoot;
    const missing: readonly string[] = INSTALLED_DOCUMENTATION.filter(
      (path: string): boolean => !existsSync(join(packageRoot, path)),
    );

    if (missing.length > 0) {
      return this.fail(`  The packaged documentation is incomplete; missing: ${missing.join(', ')}\n`);
    }

    const existed: boolean = existsSync(destination);
    let isDirectory: boolean = false;
    let isEmpty: boolean = true;

    try {
      isDirectory = existed && statSync(destination).isDirectory();
      isEmpty = !isDirectory || readdirSync(destination).length === 0;
    } catch (error: unknown) {
      return this.fail(
        `  Could not examine ${displayedDestination} (${ProjectIgnoreFile.showReason(error)}), so nothing was installed.\n`,
      );
    }

    if (existed && !isDirectory) {
      return this.fail(`  ${displayedDestination} exists but is not a directory.\n`);
    }

    // It may hold the user's own documents, so the advice is to choose
    // another directory; deleting is only right for an earlier installation.
    if (!isEmpty) {
      return this.fail(
        `  ${displayedDestination} already exists and is not empty.\n` +
        '  init installs into a new or empty directory, so choose another one.\n' +
        '  If this is an earlier ECR installation, delete it and run init again\n' +
        '  to install this version.\n',
      );
    }

    const exclusion: InstallExclusion = ProjectIgnoreFile.readInstallExclusion(this.workingDirectory, destination);

    if (exclusion.kind === 'invalid') {
      return this.fail(`  Cannot install into ${displayedDestination}: ${exclusion.reason}.\n`);
    }

    const ignoreFile: ProjectIgnoreFile = new ProjectIgnoreFile(this.workingDirectory);
    const currentIgnore: ProjectIgnoreRead = ignoreFile.read();

    if (exclusion.kind === 'pattern' && currentIgnore.kind === 'unreadable') {
      return this.fail(
        `  Could not read ${PROJECT_IGNORE_FILENAME} (${currentIgnore.reason}), so nothing was installed.\n`,
      );
    }

    try {
      mkdirSync(destination, { recursive: true });

      for (const path of INSTALLED_DOCUMENTATION) {
        cpSync(join(packageRoot, path), join(destination, path), { recursive: true, errorOnExist: true, force: false });
      }
    } catch (error: unknown) {
      const reason: string = ProjectIgnoreFile.showReason(error);
      const cleanupFailure: string | undefined = this.removePartialInstallation(destination, existed);

      if (cleanupFailure !== undefined) {
        return this.fail(
          `  Could not install the documentation (${reason}), and could not remove\n` +
          `  what was copied (${cleanupFailure}). Delete ${displayedDestination} before running init again.\n`,
        );
      }

      return this.fail(`  Could not install the documentation (${reason}), so nothing was installed.\n`);
    }

    let ignoreNote: string = `  ${displayedDestination} is outside this directory, so ${PROJECT_IGNORE_FILENAME} was not changed.\n`;

    if (exclusion.kind === 'pattern') {
      try {
        ignoreNote = ignoreFile.addPattern(exclusion.pattern) === 'added'
          ? `  Added ${exclusion.pattern} to ${PROJECT_IGNORE_FILENAME}, so linting this project skips it.\n`
          : `  ${PROJECT_IGNORE_FILENAME} already excludes it (${exclusion.pattern}).\n`;
      } catch (error: unknown) {
        return this.fail(
          `  Installed the documentation in ${displayedDestination}, but could not update ` +
          `${PROJECT_IGNORE_FILENAME} (${ProjectIgnoreFile.showReason(error)}).\n` +
          `  Add this line to ${PROJECT_IGNORE_FILENAME} yourself: ${exclusion.pattern}\n`,
        );
      }
    }

    return this.succeed(
      `\n  Installed the ECR documentation in ${displayedDestination}\n\n` +
      `  Start with ${join(displayedDestination, 'README.md')}\n` +
      `  Point your coding agent at ${join(displayedDestination, 'protocol', 'navigation-protocol.md')}\n` +
      '  It is the half that does the navigating; the linter only checks structure.\n\n' +
      `${ignoreNote}\n`,
    );
  }

  /**
   * Removes what a failed installation copied. The destination was new or
   * empty, so nothing of the user's is inside it.
   *
   * @param destination - The installation directory
   * @param existed - Whether it existed, empty, before installation began
   * @returns Why removal failed, or `undefined` when everything copied was removed
   */
  private removePartialInstallation(destination: string, existed: boolean): string | undefined {
    try {
      if (!existed) {
        rmSync(destination, { recursive: true, force: true });
        return undefined;
      }

      for (const path of INSTALLED_DOCUMENTATION) {
        rmSync(join(destination, path), { recursive: true, force: true });
      }

      return undefined;
    } catch (error: unknown) {
      return ProjectIgnoreFile.showReason(error);
    }
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
   * Reads the published package version from `package.json`.
   *
   * @returns The package version
   */
  private showPackageVersion(): string {
    const manifestText: string = readFileSync(
      join(this.packageRoot, 'package.json'),
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

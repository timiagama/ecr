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
import { showControlCharacters } from './cli/safe-text.js';
import { DEFAULT_SUPERVISION_LIMITS, SUPERVISED_VARIABLE, Supervisor } from './cli/supervisor.js';
import type { CompletedRun, SupervisedOutcome, SupervisionLimits } from './cli/supervisor.js';

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
  /**
   * Seconds a `lint` or `stats` run may take, when the command line said so;
   * `0` for no limit, and absent when it did not say, which leaves whatever
   * limit the run was configured with.
   */
  readonly timeoutSeconds?: number;
  /** Mebibytes the run's heap may grow to, on the same terms. */
  readonly maxMemoryMib?: number;
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
  /**
   * How to run `lint` and `stats` in a child process that can be stopped.
   * Absent, they run in this process: the executable asks for supervision,
   * because only it knows the script a child would have to run, and a host
   * embedding the library bounds its own work.
   */
  readonly supervision?: SupervisionSettings;
}

/** How a supervised run is started and bounded. */
export interface SupervisionSettings {
  /** Path of the script the child runs: this package's executable. */
  readonly entryPoint: string;
  /** Limits overriding {@link DEFAULT_SUPERVISION_LIMITS}. */
  readonly limits?: Partial<SupervisionLimits>;
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

/** Every exit code this command itself produces. */
const EXIT_CODES: readonly number[] = [EXIT_SUCCESS, EXIT_VALIDATION_FAILED, EXIT_USAGE_ERROR];

/**
 * How V8 says it has run out of heap. It says so differently depending on
 * when it happens: "Reached heap limit" once running, "JavaScript heap out of
 * memory" on an allocation, and "Fatal JavaScript out of memory" while it is
 * still starting, which is what a limit of a megabyte or two produces.
 */
const HEAP_EXHAUSTED: RegExp = /Reached heap limit|out of memory/i;

/**
 * The longest time limit that can be applied: `spawnSync` takes milliseconds
 * as a 32-bit count, which is about twenty-five days.
 */
const MAXIMUM_TIMEOUT_SECONDS: number = 2_147_483;

/** The largest heap limit that can be applied, in mebibytes: a tebibyte. */
const MAXIMUM_MEMORY_MIB: number = 1_048_576;

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
    --timeout <seconds>      stop lint or stats if it takes longer
                             (default: 120; 0 for no limit)
    --max-memory <MiB>       cap the heap lint or stats may use
                             (default: 2048; 0 for node's own default)
    --version                show the linter and spec versions
    --help                   show this message

  The directory defaults to ./docs, or to ./ecr for init.

  lint and stats parse your documents in a separate process, so that a
  document which takes unreasonably long to parse stops rather than hanging
  the command. A run that has to be stopped prints nothing and exits 2,
  because a report of a corpus that was never finished is not a report.

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
    let timeoutSeconds: number | undefined = undefined;
    let maxMemoryMib: number | undefined = undefined;
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

      if (argument === '--timeout') {
        timeoutSeconds = ArgumentParser.readWholeNumber(
          rest[index + 1], '--timeout', 'seconds', MAXIMUM_TIMEOUT_SECONDS,
        );
        index += 1;
        continue;
      }

      if (argument === '--max-memory') {
        maxMemoryMib = ArgumentParser.readWholeNumber(
          rest[index + 1], '--max-memory', 'mebibytes', MAXIMUM_MEMORY_MIB,
        );
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
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(maxMemoryMib !== undefined ? { maxMemoryMib } : {}),
    };
  }

  /**
   * Reads an option's value as a whole number of some unit, where zero means
   * no limit.
   *
   * @param value - The argument following the option
   * @param option - The option's name, for the message
   * @param unit - What the number counts, for the message
   * @param maximum - The largest value the limit can be applied as
   * @returns The number
   * @throws When the value is missing, is not a whole number, or is beyond what can be applied
   */
  private static readWholeNumber(
    value: string | undefined,
    option: string,
    unit: string,
    maximum: number,
  ): number {
    const parsed: number = value === undefined ? Number.NaN : Number(value);

    if (!Number.isInteger(parsed) || parsed < 0) {
      throw new Error(`${option} expects a whole number of ${unit}, or 0 for no limit.`);
    }

    // A limit too large to apply is not the same as no limit: passed on, it
    // would fail inside the machinery that imposes it rather than here.
    if (parsed > maximum) {
      throw new Error(`${option} expects at most ${String(maximum)} ${unit}, or 0 for no limit.`);
    }

    return parsed;
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

  /** How to run the parsing commands in a child process, when asked to. */
  private readonly supervision: SupervisionSettings | undefined;

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
    this.supervision = options.supervision;
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

    // Everything past this point parses documents, which is the work that
    // cannot be bounded from the inside.
    const supervision: SupervisionSettings | undefined = this.readSupervision();

    if (supervision !== undefined) {
      return this.runSupervised(supervision, argv, parsed);
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

    // Success says where the documentation went, in a name the user gave,
    // so it is made safe to print for the same reason a failure is.
    return this.succeed(
      showControlCharacters(
        `\n  Installed the ECR documentation in ${displayedDestination}\n\n` +
        `  Start with ${join(displayedDestination, 'README.md')}\n` +
        `  Point your coding agent at ${join(displayedDestination, 'protocol', 'navigation-protocol.md')}\n` +
        '  It is the half that does the navigating; the linter only checks structure.\n\n' +
        `${ignoreNote}\n`,
      ),
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
   * Reads how this invocation should bound its parsing, if at all.
   *
   * @returns The supervision settings, or `undefined` when this invocation does the work itself
   */
  private readSupervision(): SupervisionSettings | undefined {
    // The child is this same executable, and must do the work rather than
    // start a child of its own.
    return process.env[SUPERVISED_VARIABLE] === '1' ? undefined : this.supervision;
  }

  /**
   * Runs `lint` or `stats` in a child process with a time limit and a heap
   * limit, and passes on what it produced.
   *
   * A child that had to be stopped produced no usable report, however much of
   * one reached this process, so none of it is passed on: the invocation
   * failed, and says why.
   *
   * @param settings - Where the child's script is, and any limits overriding the defaults
   * @param argv - The arguments to pass on, exactly as they were given
   * @param parsed - The same arguments, for the limits they carry
   * @returns The child's output and exit code, or the reason it was stopped
   */
  private runSupervised(
    settings: SupervisionSettings,
    argv: readonly string[],
    parsed: ParsedArguments,
  ): CommandOutcome {
    // What the command line asked for wins; what the run was configured with
    // stands where the command line said nothing; the defaults are the rest.
    const limits: SupervisionLimits = {
      ...DEFAULT_SUPERVISION_LIMITS,
      ...settings.limits,
      ...(parsed.timeoutSeconds !== undefined ? { timeoutMs: parsed.timeoutSeconds * 1000 } : {}),
      ...(parsed.maxMemoryMib !== undefined ? { memoryMib: parsed.maxMemoryMib } : {}),
    };

    const outcome: SupervisedOutcome = new Supervisor(
      settings.entryPoint,
      limits,
      this.workingDirectory,
    ).run(argv);

    if (outcome.kind === 'stopped') {
      return this.fail(`  ecr did not finish: ${outcome.reason}.\n`);
    }

    // Every code this command exits with means something. A child that ended
    // with any other did not end as this command ends: it ran out of heap, or
    // the runtime beneath it stopped. Passing such a code on would offer it
    // as a verdict on the corpus, and on Windows as a number no caller could
    // read.
    if (!EXIT_CODES.includes(outcome.exitCode)) {
      return this.fail(`  ecr did not finish: ${this.showAbnormalExit(outcome, limits)}.\n`);
    }

    // A verdict on a corpus comes with the report it is a verdict on. A child
    // that exited 1 having printed nothing never got as far as validating,
    // and passing that code on would read as a corpus full of errors.
    if (outcome.stdout === '' && outcome.exitCode === EXIT_VALIDATION_FAILED) {
      return this.fail(
        `  ecr did not finish: the run failed without producing a report.\n${outcome.stderr}`,
      );
    }

    // A command writes to one stream per invocation, so whichever the child
    // used is the one this process writes to.
    return outcome.stdout === ''
      ? { output: outcome.stderr, stream: 'stderr', exitCode: outcome.exitCode }
      : { output: outcome.stdout, stream: 'stdout', exitCode: outcome.exitCode };
  }

  /**
   * Describes a child that ended in a way this command never ends.
   *
   * Running out of heap is worth naming, because it is the one such ending a
   * user can do anything about, and the limit that caused it is one they set.
   *
   * @param outcome - What the child produced before it ended
   * @param limits - The limits it was given
   * @returns The reason, as a phrase completing "ecr did not finish..."
   */
  private showAbnormalExit(outcome: CompletedRun, limits: SupervisionLimits): string {
    if (HEAP_EXHAUSTED.test(outcome.stderr)) {
      return (
        `it ran out of heap, limited to ${String(limits.memoryMib)} MiB. ` +
        `Raise the limit with --max-memory <MiB>, or 0 for node's own default`
      );
    }

    return `the run ended unexpectedly (exit ${String(outcome.exitCode)})`;
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
    // A message names paths that came from the disk, so it is made safe to
    // print for the same reason a report of a document's text is.
    return { output: showControlCharacters(output), stream: 'stderr', exitCode: EXIT_USAGE_ERROR };
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

/**
 * Search Engine Harness
 *
 * The navigation protocol names two engines: ripgrep, and `grep -E` as the
 * fallback for machines without it. This module runs both, for real. Testing
 * the patterns with JavaScript's `RegExp` instead would prove nothing about
 * either, because all three engines disagree:
 *
 *     ésee 8.1#3        JavaScript: match   ripgrep: no match   grep: it depends
 *
 * Ripgrep's word boundary is Unicode-aware, so `é` is a word character and no
 * boundary precedes `see`. JavaScript's is ASCII-only, so one does. GNU grep
 * sits on either side of that depending on locale -- `LC_ALL=C` agrees with
 * JavaScript, `LC_ALL=C.UTF-8` agrees with ripgrep -- which is why the locale
 * is pinned here rather than inherited.
 *
 * Ripgrep comes from the `@vscode/ripgrep` devDependency, so its version is
 * fixed by the lockfile. A system ripgrep could change Unicode behaviour
 * between releases and silently alter what this suite proves.
 *
 * A missing or failing executable is an error, never "no match". A gate that
 * quietly degrades to zero results would report success for a corpus it never
 * searched.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import type { SpawnSyncReturns } from 'node:child_process';
import { rgPath } from '@vscode/ripgrep';

/** Engines the protocol names, and this harness runs. */
export type EngineName = 'ripgrep' | 'grep -E';

/**
 * Locale pinned for GNU grep.
 *
 * UTF-8 aware, so grep's word boundaries agree with ripgrep's. Left to the
 * inherited environment, the same pattern gives different answers on the same
 * machine.
 */
const GREP_LOCALE: string = 'C.UTF-8';

/**
 * Where Git for Windows installs GNU grep when it is not on PATH.
 *
 * Windows has no system grep; the one used here ships with Git, which is
 * present on developer machines and on GitHub's Windows runners, but is not
 * always exported to a non-Bash shell.
 */
const WINDOWS_GREP_FALLBACKS: readonly string[] = [
  'C:\\Program Files\\Git\\usr\\bin\\grep.exe',
  'C:\\Program Files (x86)\\Git\\usr\\bin\\grep.exe',
];

/**
 * Resolves the GNU grep executable.
 *
 * @returns An absolute path, or the bare name when PATH already resolves it
 * @throws When no grep can be found, naming what was tried
 */
function resolveGrep(): string {
  const onPath: SpawnSyncReturns<string> = spawnSync('grep', ['--version'], { encoding: 'utf8' });

  if (onPath.error === undefined && onPath.status === 0) {
    return 'grep';
  }

  const fallback: string | undefined = WINDOWS_GREP_FALLBACKS.find((candidate) =>
    existsSync(candidate),
  );

  if (fallback !== undefined) {
    return fallback;
  }

  throw new Error(
    'GNU grep was not found. The navigation protocol advertises `grep -E` as ' +
      'its fallback engine, so the suite tests it for real.\n' +
      `Tried: PATH, ${WINDOWS_GREP_FALLBACKS.join(', ')}`,
  );
}

/**
 * Writes a pattern to a file, so it never crosses a command line.
 *
 * Git for Windows ships an MSYS build of grep, and MSYS re-parses the Windows
 * command line with its own backslash rules. A pattern passed as an argument
 * therefore arrives mangled: `\s` loses its backslash and silently stops
 * matching, while a pattern with no backslashes is unaffected. The difference
 * is invisible -- grep exits 1, "no match", exactly as it would for a pattern
 * that simply found nothing.
 *
 * Both engines accept `-f`, which reads patterns from a file verbatim. The file
 * carries no trailing newline: in a pattern file an empty line is a pattern
 * that matches everything.
 *
 * @param pattern - Regular expression source, exactly as published
 * @returns Path to a file containing that one pattern
 */
function patternFile(pattern: string): string {
  PATTERN_DIRECTORY ??= mkdtempSync(join(tmpdir(), 'ecr-pattern-'));

  const path: string = join(PATTERN_DIRECTORY, 'pattern.txt');
  writeFileSync(path, pattern, { encoding: 'utf8' });

  return path;
}

/**
 * One directory per process, created on first use and removed at exit.
 *
 * Searches run through `spawnSync`, so within a worker they never overlap and
 * a single file can be rewritten for each pattern. Creating a directory per
 * search instead leaves one behind for every assertion -- a few hundred per
 * run -- in the user's temp directory.
 */
let PATTERN_DIRECTORY: string | undefined;

/**
 * Removes the pattern directory, if one was created.
 *
 * Called from the suite's `afterAll`. A `process.on('exit')` hook is not
 * enough: Vitest workers do not reliably reach it, and each run then leaves a
 * directory behind in the user's temp folder -- one per worker, forever.
 */
export function cleanupSearchEngines(): void {
  if (PATTERN_DIRECTORY !== undefined) {
    rmSync(PATTERN_DIRECTORY, { recursive: true, force: true });
    PATTERN_DIRECTORY = undefined;
  }
}

/** Resolved once; a missing engine should fail loudly and immediately. */
const GREP_COMMAND: string = resolveGrep();

/**
 * Interprets a search process's result.
 *
 * Both engines use the same convention: 0 found matches, 1 found none, and
 * anything else is a failure of the search itself.
 *
 * @param engine - Engine that ran, for the error message
 * @param pattern - Pattern that was run, for the error message
 * @param outcome - The spawn result
 * @returns 1-indexed line numbers that matched
 * @throws When the executable is missing or the engine reported an error
 */
function interpret(
  engine: EngineName,
  pattern: string,
  outcome: SpawnSyncReturns<string>,
): readonly number[] {
  if (outcome.error !== undefined) {
    throw new Error(`${engine} could not be run for pattern ${pattern}: ${outcome.error.message}`);
  }

  if (outcome.status === 1) {
    return [];
  }

  if (outcome.status !== 0) {
    throw new Error(
      `${engine} failed (exit ${String(outcome.status)}) for pattern ${pattern}: ` +
        outcome.stderr.trim(),
    );
  }

  return outcome.stdout
    .split(/\r?\n/)
    .filter((line: string): boolean => line.length > 0)
    .map((line: string): number => Number.parseInt(line.split(':')[0] ?? '0', 10))
    .filter((lineNumber: number): boolean => Number.isFinite(lineNumber) && lineNumber > 0);
}

/**
 * Runs a pattern through ripgrep.
 *
 * @param pattern - Regular expression source, exactly as published
 * @param filePath - Absolute path of the file to search
 * @returns 1-indexed line numbers that matched
 */
export function runRipgrep(pattern: string, filePath: string): readonly number[] {
  return interpret(
    'ripgrep',
    pattern,
    spawnSync(rgPath, ['--no-config', '--color=never', '-n', '-f', patternFile(pattern), filePath], {
      encoding: 'utf8',
    }),
  );
}

/**
 * Runs a pattern through GNU grep in extended-regexp mode, at a pinned locale.
 *
 * @param pattern - Regular expression source, exactly as published
 * @param filePath - Absolute path of the file to search
 * @returns 1-indexed line numbers that matched
 */
export function runGrep(pattern: string, filePath: string): readonly number[] {
  return interpret(
    'grep -E',
    pattern,
    spawnSync(GREP_COMMAND, ['-nE', '-f', patternFile(pattern), filePath], {
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: GREP_LOCALE, LANG: GREP_LOCALE },
    }),
  );
}

/**
 * Interprets a recursive listing's result.
 *
 * @param engine - Engine that ran, for the error message
 * @param pattern - Pattern that was run, for the error message
 * @param outcome - The spawn result
 * @param searchedName - The directory argument the engine was given, which prefixes each path it prints
 * @returns Paths that matched, relative to the searched directory, with forward slashes, sorted
 * @throws When the executable is missing or the engine reported an error
 */
function interpretListing(
  engine: EngineName,
  pattern: string,
  outcome: SpawnSyncReturns<string>,
  searchedName: string,
): readonly string[] {
  if (outcome.error !== undefined) {
    throw new Error(`${engine} could not be run for pattern ${pattern}: ${outcome.error.message}`);
  }

  if (outcome.status === 1) {
    return [];
  }

  if (outcome.status !== 0) {
    throw new Error(
      `${engine} failed (exit ${String(outcome.status)}) for pattern ${pattern}: ` +
        outcome.stderr.trim(),
    );
  }

  return outcome.stdout
    .split(/\r?\n/)
    .filter((line: string): boolean => line.length > 0)
    .map((line: string): string => line.split('\\').join('/'))
    .map((line: string): string =>
      line.startsWith(`${searchedName}/`) ? line.slice(searchedName.length + 1) : line,
    )
    .sort();
}

/**
 * Lists, recursively, the files beneath a directory that ripgrep finds a
 * pattern in, as a published command does: the directory is searched, not
 * named files, so ripgrep's own discovery rules apply.
 *
 * The search runs from the directory's parent and names the directory as its
 * argument, as `rg ... docs` does. Running inside it instead would hide how
 * the engine treats that argument -- whether it follows it when it is a link.
 *
 * @param pattern - Regular expression source, exactly as published
 * @param directory - Directory to search, the published command's last argument
 * @param flags - The published command's flags, such as `--no-ignore`, other than `-l`
 * @returns Paths that matched, relative to the directory, sorted
 */
export function listRipgrepMatches(
  pattern: string,
  directory: string,
  flags: readonly string[],
): readonly string[] {
  const searchedName: string = basename(directory);

  return interpretListing(
    'ripgrep',
    pattern,
    spawnSync(rgPath, ['--no-config', '--color=never', ...flags, '-l', '-f', patternFile(pattern), searchedName], {
      cwd: dirname(directory),
      encoding: 'utf8',
    }),
    searchedName,
  );
}

/**
 * Lists, recursively, the files beneath a directory that GNU grep finds a
 * pattern in, as the published fallback `grep -rlE` does. Like
 * {@link listRipgrepMatches}, it names the directory from its parent.
 *
 * @param pattern - Regular expression source, exactly as published
 * @param directory - Directory to search
 * @returns Paths that matched, relative to the directory, sorted
 */
export function listGrepMatches(pattern: string, directory: string): readonly string[] {
  const searchedName: string = basename(directory);

  return interpretListing(
    'grep -E',
    pattern,
    spawnSync(GREP_COMMAND, ['-rlE', '-f', patternFile(pattern), searchedName], {
      cwd: dirname(directory),
      encoding: 'utf8',
      env: { ...process.env, LC_ALL: GREP_LOCALE, LANG: GREP_LOCALE },
    }),
    searchedName,
  );
}

/** Both engines, so a test can assert they agree with the declaration and each other. */
export const ENGINES: readonly {
  readonly name: EngineName;
  readonly run: (pattern: string, filePath: string) => readonly number[];
}[] = [
  { name: 'ripgrep', run: runRipgrep },
  { name: 'grep -E', run: runGrep },
];

/**
 * Reports the engine versions, for a diagnostic line in test output.
 *
 * @returns A short description of each engine actually invoked
 */
export function describeEngines(): string {
  const rgVersion: SpawnSyncReturns<string> = spawnSync(rgPath, ['--version'], {
    encoding: 'utf8',
  });
  const grepVersion: SpawnSyncReturns<string> = spawnSync(GREP_COMMAND, ['--version'], {
    encoding: 'utf8',
  });

  return [
    (rgVersion.stdout.split('\n')[0] ?? 'ripgrep unknown').trim(),
    `${(grepVersion.stdout.split('\n')[0] ?? 'grep unknown').trim()} (LC_ALL=${GREP_LOCALE})`,
  ].join(' | ');
}

/**
 * Project Ignore File
 *
 * `.ecrignore` holds a project's ignore patterns, so they need not be repeated
 * with `--ignore` on every command. Like `.gitignore` it lives at the project
 * root, which the CLI takes to be the working directory, as Prettier and
 * ESLint do; it does not search upwards.
 *
 * Patterns use the same glob rules as `--ignore`, one per line, with blank
 * lines and `#` comments allowed. They are relative to the working directory,
 * whereas `--ignore` patterns are relative to the directory being linted.
 */

import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

/** The file's name, at the project root. */
export const PROJECT_IGNORE_FILENAME: string = '.ecrignore';

/** What reading the project ignore file found. */
export type ProjectIgnoreRead =
  | { readonly kind: 'patterns'; readonly patterns: readonly string[] }
  | { readonly kind: 'missing' }
  | { readonly kind: 'unreadable'; readonly reason: string };

/** The `.ecrignore` entry an installation needs, or why none can be made. */
export type InstallExclusion =
  | { readonly kind: 'pattern'; readonly pattern: string }
  | { readonly kind: 'outside' }
  | { readonly kind: 'invalid'; readonly reason: string };

/**
 * Characters that would change a destination's meaning if written into
 * `.ecrignore` as a literal path: glob wildcards, and line breaks.
 */
const UNSAFE_PATH_CHARACTERS: RegExp = /[*?\r\n]/;

/** A relative path that leaves the directory it is relative to. */
const PARENT_PREFIX: RegExp = /^\.\.(?:[\\/]|$)/;

/**
 * Reads, parses and updates a project's `.ecrignore`.
 */
export class ProjectIgnoreFile {
  /** Path of the `.ecrignore` file. */
  private readonly path: string;

  /**
   * Creates a handle on the ignore file of a project.
   *
   * @param workingDirectory - The project root: the directory the command runs from
   */
  public constructor(workingDirectory: string) {
    this.path = join(workingDirectory, PROJECT_IGNORE_FILENAME);
  }

  /**
   * Reads the ignore file's patterns. A missing file is normal; one that
   * exists but cannot be read is reported, not treated as empty.
   *
   * @returns The patterns, or that there is no file, or why it could not be read
   */
  public read(): ProjectIgnoreRead {
    if (!existsSync(this.path)) {
      return { kind: 'missing' };
    }

    try {
      return { kind: 'patterns', patterns: ProjectIgnoreFile.parse(readFileSync(this.path, 'utf8')) };
    } catch (error: unknown) {
      return { kind: 'unreadable', reason: ProjectIgnoreFile.showReason(error) };
    }
  }

  /**
   * Adds a pattern unless the file already holds it, keeping everything else
   * in the file exactly as it was. Creates the file if it does not exist.
   *
   * The new contents are written to a temporary file beside it, which then
   * replaces it, so a write that fails part-way leaves the existing patterns
   * untouched rather than truncated.
   *
   * @param pattern - The pattern to add
   * @returns Whether the pattern was added or was already there
   * @throws When the file cannot be read or replaced; it is then unchanged
   */
  public addPattern(pattern: string): 'added' | 'present' {
    const existing: string = existsSync(this.path) ? readFileSync(this.path, 'utf8') : '';

    if (ProjectIgnoreFile.parse(existing).includes(pattern)) {
      return 'present';
    }

    const separator: string = existing === '' || existing.endsWith('\n') ? '' : '\n';
    const temporaryPath: string = `${this.path}.${String(process.pid)}.tmp`;

    try {
      writeFileSync(temporaryPath, `${existing}${separator}${pattern}\n`, 'utf8');
      renameSync(temporaryPath, this.path);
    } catch (error: unknown) {
      try {
        rmSync(temporaryPath, { force: true });
      } catch {
        // The failure being reported is the write; a leftover temporary file
        // does not change what the user must do.
      }

      throw error;
    }

    return 'added';
  }

  /**
   * Splits an ignore file into its patterns.
   *
   * @param text - The file's contents
   * @returns Each pattern, trimmed, without blank lines or `#` comments
   */
  public static parse(text: string): readonly string[] {
    return text
      .split(/\r?\n/)
      .map((line: string): string => line.trim())
      .filter((line: string): boolean => line !== '' && !line.startsWith('#'));
  }

  /**
   * Works out the exact `.ecrignore` pattern that excludes an installation
   * directory, and nothing else.
   *
   * @param workingDirectory - The project root
   * @param destination - The directory being installed into
   * @returns The pattern; or that the destination lies outside the project and needs none; or why no safe pattern exists
   */
  public static readInstallExclusion(workingDirectory: string, destination: string): InstallExclusion {
    const relativePath: string = relative(workingDirectory, destination);

    if (relativePath === '') {
      return {
        kind: 'invalid',
        reason: 'it is the working directory itself, and excluding it would exclude the whole project',
      };
    }

    // Another drive on Windows gives an absolute path; a parent gives `..`.
    if (isAbsolute(relativePath) || PARENT_PREFIX.test(relativePath)) {
      return { kind: 'outside' };
    }

    const path: string = relativePath.replaceAll('\\', '/');

    if (UNSAFE_PATH_CHARACTERS.test(path)) {
      return { kind: 'invalid', reason: 'its name contains `*`, `?` or a line break, which .ecrignore would read as a pattern' };
    }

    if (path.startsWith('#')) {
      return { kind: 'invalid', reason: 'its name starts with `#`, which .ecrignore would read as a comment' };
    }

    if (path !== path.trim()) {
      return { kind: 'invalid', reason: 'its name starts or ends with a space, which .ecrignore would drop' };
    }

    return { kind: 'pattern', pattern: `${path}/**` };
  }

  /**
   * Describes a file-system error briefly.
   *
   * @param error - What was thrown
   * @returns The error's code, such as `EACCES`, or its message
   */
  public static showReason(error: unknown): string {
    if (error instanceof Error) {
      const code: unknown = (error as NodeJS.ErrnoException).code;
      return typeof code === 'string' ? code : error.message;
    }

    return String(error);
  }
}

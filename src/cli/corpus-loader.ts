/**
 * Corpus Loading
 *
 * File discovery is the host's responsibility, not the linter's. This module
 * is the CLI's implementation of that responsibility: it walks a directory,
 * excludes meta-documents, and produces the inputs the linter consumes.
 */

import { lstatSync, readFileSync, readdirSync, statSync } from 'node:fs';
import type { Stats } from 'node:fs';
import { isAbsolute, join, relative } from 'node:path';

import { MetaDocumentFilter } from '../meta-documents.js';
import type { CorpusDocumentInput } from '../ecr.js';

/**
 * A path the walk reached but could not read.
 */
export interface UnreadablePath {
  /** Corpus-relative path, with forward slashes. */
  readonly path: string;
  /** Why it could not be read: the file system's error code, or its message. */
  readonly reason: string;
}

/**
 * The outcome of walking a corpus directory.
 */
export interface LoadedCorpus {
  /** Documents to validate, in path order. */
  readonly documents: readonly CorpusDocumentInput[];
  /**
   * Corpus-relative paths excluded as meta-documents or by ignore pattern. A
   * directory excluded whole by a pattern is listed once, with a trailing
   * slash, and is not walked.
   */
  readonly excludedPaths: readonly string[];
  /**
   * Links beneath the corpus root that were not followed: every link to a
   * directory, every link named like a document, and every link whose target
   * is missing.
   */
  readonly notFollowedPaths: readonly string[];
  /**
   * Paths that could not be read. A corpus with any of these was not fully
   * read, so its validation result cannot stand for the whole corpus.
   */
  readonly unreadablePaths: readonly UnreadablePath[];
  /**
   * Whether the project's `.ecrignore` excludes the corpus root itself, in
   * which case nothing beneath it was walked.
   */
  readonly rootExcluded: boolean;
}

/**
 * A project's own ignore patterns, from its `.ecrignore`, and the directory
 * they are relative to.
 */
export interface ProjectIgnore {
  /** The project root: the directory the command runs from. */
  readonly workingDirectory: string;
  /** Patterns relative to the working directory. */
  readonly patterns: readonly string[];
}

/**
 * Directory-walking characters that mark a path as hidden on every platform
 * this runs on. Hidden directories are skipped so that `.git`, `.obsidian` and
 * similar never reach the linter.
 */
const HIDDEN_PREFIX: string = '.';

/**
 * The directory package managers install dependencies into. It is skipped
 * wherever the walk meets it: an installed copy of this package carries the
 * specification, whose DocIDs would collide with a project's own, and any
 * other package's Markdown is not the project's documentation. A corpus root
 * named explicitly is still walked, even inside one.
 */
const DEPENDENCY_DIRECTORY: string = 'node_modules';

/**
 * Extension identifying a Markdown document.
 */
const MARKDOWN_EXTENSION: string = '.md';

/**
 * Discovers and reads the Markdown documents of a corpus.
 *
 * Paths are reported relative to the corpus root and normalised to forward
 * slashes, so that ignore patterns and diagnostics read the same on every
 * platform.
 *
 * Symbolic links and junctions beneath the root are not followed, because the
 * published recursive searches (`rg`, `grep -r`) do not follow them: a
 * document reached only through a link would be validated but could not be
 * found (1#9.11). A root that is itself a link is followed, as both search
 * engines follow a link named on their command line.
 */
export class CorpusLoader {
  /** Absolute or relative path to the corpus root directory. */
  private readonly corpusRoot: string;

  /** Decides which discovered documents are excluded from validation. */
  private readonly metaDocumentFilter: MetaDocumentFilter;

  /**
   * Applies the project's `.ecrignore` patterns, which are relative to the
   * working directory rather than the corpus root; absent when there are none.
   */
  private readonly projectFilter: MetaDocumentFilter | undefined;

  /** The directory the project's patterns are relative to. */
  private readonly workingDirectory: string | undefined;

  /**
   * Creates a loader for one corpus directory.
   *
   * @param corpusRoot - Path to the directory to walk
   * @param ignorePatterns - Glob patterns relative to the corpus root, from `--ignore`
   * @param projectIgnore - The project's `.ecrignore` patterns, relative to the working directory
   */
  public constructor(
    corpusRoot: string,
    ignorePatterns: readonly string[] = [],
    projectIgnore?: ProjectIgnore,
  ) {
    this.corpusRoot = corpusRoot;
    this.metaDocumentFilter = new MetaDocumentFilter(ignorePatterns);
    // No meta-document names: those are already applied by the corpus filter.
    this.projectFilter =
      projectIgnore === undefined ? undefined : new MetaDocumentFilter(projectIgnore.patterns, []);
    this.workingDirectory = projectIgnore?.workingDirectory;
  }

  /**
   * Walks the corpus root and reads every Markdown document that is not
   * excluded.
   *
   * A path that cannot be read is recorded and the walk continues, so that
   * every such path is reported at once.
   *
   * @returns The documents to validate, and the paths excluded, not followed, or not readable
   */
  public load(): LoadedCorpus {
    const walk: CorpusWalk = new CorpusWalk();
    const rootExcluded: boolean = this.tellProjectExcludesRoot();

    if (!rootExcluded) {
      this.walkDirectory(this.corpusRoot, walk);
    }

    // Sorted by corpus-relative path, so the order is the same on every
    // platform whatever the path separator.
    walk.documents.sort((left: CorpusDocumentInput, right: CorpusDocumentInput): number =>
      CorpusLoader.comparePaths(left.uri, right.uri),
    );
    walk.excludedPaths.sort((left: string, right: string): number =>
      CorpusLoader.comparePaths(left, right),
    );
    walk.notFollowedPaths.sort((left: string, right: string): number =>
      CorpusLoader.comparePaths(left, right),
    );
    walk.unreadablePaths.sort((left: UnreadablePath, right: UnreadablePath): number =>
      CorpusLoader.comparePaths(left.path, right.path),
    );

    return {
      documents: walk.documents,
      excludedPaths: walk.excludedPaths,
      notFollowedPaths: walk.notFollowedPaths,
      unreadablePaths: walk.unreadablePaths,
      rootExcluded,
    };
  }

  /**
   * Orders two corpus-relative paths by their UTF-16 code units, as
   * `Array.prototype.sort` does by default.
   *
   * @param left - A path
   * @param right - Another path
   * @returns Negative, zero or positive, as for a sort comparator
   */
  private static comparePaths(left: string, right: string): number {
    if (left === right) {
      return 0;
    }

    return left < right ? -1 : 1;
  }

  /**
   * Walks one directory, in name order.
   *
   * @param directory - Directory to walk
   * @param walk - What the walk has found so far
   */
  private walkDirectory(directory: string, walk: CorpusWalk): void {
    let entryNames: string[];

    try {
      entryNames = readdirSync(directory).sort((left: string, right: string): number =>
        CorpusLoader.comparePaths(left, right),
      );
    } catch (error: unknown) {
      walk.recordUnreadable(this.toCorpusRelativePath(directory), error);
      return;
    }

    for (const entryName of entryNames) {
      if (entryName.startsWith(HIDDEN_PREFIX)) {
        continue;
      }

      this.walkEntry(join(directory, entryName), entryName, walk);
    }
  }

  /**
   * Walks one directory entry: a link is recorded and not followed, a
   * directory is descended into unless an ignore pattern excludes it whole,
   * and a Markdown file is read unless it is excluded.
   *
   * @param entryPath - Path of the entry
   * @param entryName - The entry's own name
   * @param walk - What the walk has found so far
   */
  private walkEntry(entryPath: string, entryName: string, walk: CorpusWalk): void {
    const relativePath: string = this.toCorpusRelativePath(entryPath);
    let entryStats: Stats;

    try {
      entryStats = lstatSync(entryPath);
    } catch (error: unknown) {
      if (this.tellExcludedWhateverItIs(relativePath, entryPath)) {
        walk.excludedPaths.push(relativePath);
        return;
      }

      walk.recordUnreadable(relativePath, error);
      return;
    }

    if (entryStats.isSymbolicLink()) {
      this.recordLink(entryPath, entryName, relativePath, walk);
      return;
    }

    if (entryStats.isDirectory()) {
      if (
        entryName === DEPENDENCY_DIRECTORY ||
        this.metaDocumentFilter.excludesDirectory(relativePath) ||
        this.tellProjectExcludesDirectory(entryPath)
      ) {
        walk.excludedPaths.push(`${relativePath}/`);
        return;
      }

      this.walkDirectory(entryPath, walk);
      return;
    }

    if (!CorpusLoader.tellMarkdownName(entryName)) {
      return;
    }

    if (
      this.metaDocumentFilter.shouldExclude(relativePath) ||
      this.tellProjectExcludesFile(entryPath)
    ) {
      walk.excludedPaths.push(relativePath);
      return;
    }

    try {
      walk.documents.push({
        uri: relativePath,
        markdownText: readFileSync(entryPath, 'utf8'),
      });
    } catch (error: unknown) {
      walk.recordUnreadable(relativePath, error);
    }
  }

  /**
   * Records a link without following it. An ignore pattern covering it
   * excludes it instead; a link to a file that is not Markdown is of no
   * interest, as it could never be a document.
   *
   * @param entryPath - Path of the link
   * @param entryName - The link's own name
   * @param relativePath - The link's corpus-relative path
   * @param walk - What the walk has found so far
   */
  private recordLink(
    entryPath: string,
    entryName: string,
    relativePath: string,
    walk: CorpusWalk,
  ): void {
    if (this.tellExcludedWhateverItIs(relativePath, entryPath)) {
      walk.excludedPaths.push(relativePath);
      return;
    }

    if (!CorpusLoader.tellMarkdownName(entryName) && CorpusLoader.tellLinksToFile(entryPath)) {
      return;
    }

    walk.notFollowedPaths.push(relativePath);
  }

  /**
   * Determines whether an ignore pattern of either kind covers a path whose
   * kind cannot or need not be known, such as a link or a vanished entry.
   *
   * @param relativePath - Corpus-relative path
   * @param entryPath - Path of the entry, for the project's patterns
   * @returns `true` when a file pattern or a whole-directory pattern covers it
   */
  private tellExcludedWhateverItIs(relativePath: string, entryPath: string): boolean {
    return (
      this.metaDocumentFilter.excludesDirectory(relativePath) ||
      this.metaDocumentFilter.matchesIgnorePattern(relativePath) ||
      this.tellProjectExcludesDirectory(entryPath) ||
      this.tellProjectExcludesFile(entryPath)
    );
  }

  /**
   * Determines whether a `.ecrignore` pattern excludes the corpus root, either
   * itself or through a directory above it: with `ecr/**` ignored, a root of
   * `ecr/sub` is excluded as surely as `ecr`.
   *
   * @returns `true` when the root, or any directory between it and the project root, is excluded whole
   */
  private tellProjectExcludesRoot(): boolean {
    const projectPath: string | undefined = this.toProjectRelativePath(this.corpusRoot);

    if (projectPath === undefined || projectPath === '') {
      return false;
    }

    const segments: readonly string[] = projectPath.split('/');

    return segments.some((_segment: string, index: number): boolean =>
      this.projectFilter?.excludesDirectory(segments.slice(0, index + 1).join('/')) === true,
    );
  }

  /**
   * Determines whether a `.ecrignore` pattern excludes a whole directory.
   *
   * @param directoryPath - Path of the directory
   * @returns `true` when the project's patterns cover everything beneath it
   */
  private tellProjectExcludesDirectory(directoryPath: string): boolean {
    const projectPath: string | undefined = this.toProjectRelativePath(directoryPath);

    return projectPath !== undefined && projectPath !== '' &&
      this.projectFilter?.excludesDirectory(projectPath) === true;
  }

  /**
   * Determines whether a `.ecrignore` pattern excludes a file.
   *
   * @param filePath - Path of the file
   * @returns `true` when one of the project's patterns matches it
   */
  private tellProjectExcludesFile(filePath: string): boolean {
    const projectPath: string | undefined = this.toProjectRelativePath(filePath);

    return projectPath !== undefined && this.projectFilter?.matchesIgnorePattern(projectPath) === true;
  }

  /**
   * Converts a path into one relative to the working directory, with forward
   * slashes, which is what `.ecrignore` patterns are matched against.
   *
   * @param path - A path
   * @returns The path relative to the working directory, or `undefined` when there are no project patterns or the path lies outside the project
   */
  private toProjectRelativePath(path: string): string | undefined {
    if (this.workingDirectory === undefined) {
      return undefined;
    }

    const projectPath: string = relative(this.workingDirectory, path);

    // The project's patterns say nothing about paths outside the project.
    if (isAbsolute(projectPath) || /^\.\.(?:[\\/]|$)/.test(projectPath)) {
      return undefined;
    }

    return projectPath.replaceAll('\\', '/');
  }

  /**
   * Determines whether a name is a Markdown document's.
   *
   * @param entryName - A file or link name
   * @returns `true` for a `.md` name, in any case
   */
  private static tellMarkdownName(entryName: string): boolean {
    return entryName.toLowerCase().endsWith(MARKDOWN_EXTENSION);
  }

  /**
   * Determines whether a link resolves to something other than a directory.
   *
   * @param linkPath - Path of the link
   * @returns `true` when the target exists and is not a directory
   */
  private static tellLinksToFile(linkPath: string): boolean {
    try {
      return !statSync(linkPath).isDirectory();
    } catch {
      return false;
    }
  }

  /**
   * Converts an absolute path into a corpus-relative path with forward slashes.
   *
   * @param absolutePath - A path beneath the corpus root
   * @returns The path relative to the corpus root
   */
  private toCorpusRelativePath(absolutePath: string): string {
    const withoutRoot: string = absolutePath.startsWith(this.corpusRoot)
      ? absolutePath.slice(this.corpusRoot.length)
      : absolutePath;

    return withoutRoot
      .split('\\')
      .join('/')
      .replace(/^\/+/, '');
  }
}

/**
 * What one walk of a corpus has found so far.
 */
class CorpusWalk {
  /** Documents read, in the order reached. */
  public readonly documents: CorpusDocumentInput[] = [];

  /** Paths excluded as meta-documents or by ignore pattern. */
  public readonly excludedPaths: string[] = [];

  /** Links recorded and not followed. */
  public readonly notFollowedPaths: string[] = [];

  /** Paths reached but not readable. */
  public readonly unreadablePaths: UnreadablePath[] = [];

  /**
   * Records a path that could not be read.
   *
   * @param path - The corpus-relative path; empty for the corpus root itself
   * @param error - What reading it threw
   */
  public recordUnreadable(path: string, error: unknown): void {
    this.unreadablePaths.push({ path: path === '' ? '.' : path, reason: CorpusWalk.showReason(error) });
  }

  /**
   * Describes a file-system error briefly.
   *
   * @param error - What was thrown
   * @returns The error's code, such as `ENOENT`, or its message
   */
  private static showReason(error: unknown): string {
    if (error instanceof Error) {
      const code: unknown = (error as NodeJS.ErrnoException).code;
      return typeof code === 'string' ? code : error.message;
    }

    return String(error);
  }
}

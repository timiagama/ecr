/**
 * Meta-Document Filtering
 *
 * ECR governs *architectural* documents — those that carry a DocID and
 * participate in the reference graph. A corpus also contains documents that
 * deliberately sit outside that graph: READMEs, agent instruction files,
 * contributing guides, changelogs and licences. These have no DocID by design
 * and must not be reported as structurally invalid.
 *
 * File discovery is the host's responsibility (spec 1#3.2), so this module is
 * offered for hosts to apply when assembling a corpus rather than being
 * enforced inside the rules themselves.
 */

import { GlobPattern } from './glob-pattern.js';

/**
 * Filenames that are conventionally outside the ECR reference graph.
 *
 * Matching is case-insensitive and ignores the file extension, so `README.md`,
 * `readme.MD` and `Readme` are all treated alike.
 */
export const DEFAULT_META_DOCUMENT_NAMES: readonly string[] = [
  // The name `ecr init` once gave the navigation protocol when it wrote it into
  // a corpus. The protocol carries no DocID by design, so a copy kept in a
  // corpus under that name must not be reported as an invalid document.
  'ecr-navigation-protocol',
  'readme',
  'claude',
  'agents',
  'contributing',
  'changelog',
  'license',
  'licence',
  'code_of_conduct',
  'security',
  'authors',
  'notice',
];

/**
 * Decides which documents in a corpus are meta-documents and therefore exempt
 * from ECR structural validation.
 *
 * A document is exempt when its filename matches a known meta-document name, or
 * when its path matches one of the caller-supplied ignore patterns.
 *
 * Ignore patterns use a minimal glob syntax: `*` matches any run of characters
 * except `/`, and `**` matches any run of characters including `/`. Patterns are
 * matched against the document's corpus-relative path using forward slashes.
 */
export class MetaDocumentFilter {
  /** Lower-cased filenames treated as meta-documents. */
  private readonly metaDocumentNames: ReadonlySet<string>;

  /** Compiled ignore patterns supplied by the caller. */
  private readonly ignorePatterns: readonly GlobPattern[];

  /**
   * Compiled directory parts of the ignore patterns that exclude everything
   * beneath a directory: those ending in slash-double-star, and `**` itself.
   */
  private readonly ignoredDirectoryPatterns: readonly GlobPattern[];

  /**
   * Creates a filter.
   *
   * @param ignorePatterns - Additional glob patterns to exclude, matched against the corpus-relative path
   * @param metaDocumentNames - Filenames treated as meta-documents; defaults to {@link DEFAULT_META_DOCUMENT_NAMES}
   */
  public constructor(
    ignorePatterns: readonly string[] = [],
    metaDocumentNames: readonly string[] = DEFAULT_META_DOCUMENT_NAMES,
  ) {
    this.metaDocumentNames = new Set(
      metaDocumentNames.map((name: string): string => name.toLowerCase()),
    );
    this.ignorePatterns = ignorePatterns.map(
      (pattern: string): GlobPattern => new GlobPattern(pattern),
    );
    this.ignoredDirectoryPatterns = ignorePatterns
      .map((pattern: string): string | undefined => MetaDocumentFilter.readIgnoredDirectory(pattern))
      .filter((directory: string | undefined): directory is string => directory !== undefined)
      .map((directory: string): GlobPattern => new GlobPattern(directory));
  }

  /**
   * Determines whether a document should be excluded from ECR validation.
   *
   * @param corpusRelativePath - The document's path relative to the corpus root, using forward slashes
   * @returns `true` when the document is a meta-document or matches an ignore pattern
   */
  public shouldExclude(corpusRelativePath: string): boolean {
    return (
      this.isMetaDocument(corpusRelativePath) ||
      this.matchesIgnorePattern(corpusRelativePath)
    );
  }

  /**
   * Determines whether a path names a conventional meta-document.
   *
   * @param corpusRelativePath - The document's path relative to the corpus root
   * @returns `true` when the filename, without extension, is a known meta-document name
   */
  public isMetaDocument(corpusRelativePath: string): boolean {
    const lastSlashIndex: number = corpusRelativePath.lastIndexOf('/');
    const fileName: string = corpusRelativePath.substring(lastSlashIndex + 1);
    const lastDotIndex: number = fileName.lastIndexOf('.');
    const baseName: string =
      lastDotIndex > 0 ? fileName.substring(0, lastDotIndex) : fileName;

    return this.metaDocumentNames.has(baseName.toLowerCase());
  }

  /**
   * Determines whether a path matches any caller-supplied ignore pattern.
   *
   * @param corpusRelativePath - The document's path relative to the corpus root
   * @returns `true` when at least one ignore pattern matches
   */
  public matchesIgnorePattern(corpusRelativePath: string): boolean {
    return this.ignorePatterns.some((pattern: GlobPattern): boolean =>
      pattern.matches(corpusRelativePath),
    );
  }

  /**
   * Determines whether an ignore pattern excludes every path beneath a
   * directory, so that the directory need not be walked at all.
   *
   * Only a pattern ending in slash-double-star (or `**` alone) says so: `vendor/**`
   * excludes all of `vendor`, but `vendor/*` excludes only the files directly
   * inside it, so `vendor` must still be walked for `vendor/a/b.md`.
   *
   * @param corpusRelativeDirectory - The directory's path relative to the corpus root, using forward slashes, without a trailing slash
   * @returns `true` when no path beneath the directory could be included
   */
  public excludesDirectory(corpusRelativeDirectory: string): boolean {
    return this.ignoredDirectoryPatterns.some((pattern: GlobPattern): boolean =>
      pattern.matches(corpusRelativeDirectory),
    );
  }

  /**
   * Reads the directory part of an ignore pattern that excludes a whole
   * directory.
   *
   * @param pattern - An ignore pattern
   * @returns The pattern for the excluded directories, or `undefined` when the pattern does not exclude whole directories
   */
  private static readIgnoredDirectory(pattern: string): string | undefined {
    if (pattern === '**') {
      return pattern;
    }

    return pattern.endsWith('/**') ? pattern.slice(0, -'/**'.length) : undefined;
  }
}

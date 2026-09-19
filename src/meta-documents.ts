/**
 * Meta-Document Filtering
 *
 * ECR governs *architectural* documents — those that carry a DocID and
 * participate in the reference graph. A corpus also contains documents that
 * deliberately sit outside that graph: READMEs, agent instruction files,
 * contributing guides, changelogs and licences. These have no DocID by design
 * and must not be reported as structurally invalid.
 *
 * File discovery is the host's responsibility (see 0.1), so this module is
 * offered for hosts to apply when assembling a corpus rather than being
 * enforced inside the rules themselves.
 */

/**
 * Filenames that are conventionally outside the ECR reference graph.
 *
 * Matching is case-insensitive and ignores the file extension, so `README.md`,
 * `readme.MD` and `Readme` are all treated alike.
 */
export const DEFAULT_META_DOCUMENT_NAMES: readonly string[] = [
  // Written into a corpus by `ecr init`. It instructs an agent how to walk the
  // corpus and carries no DocID by design, so without this entry `ecr init`
  // would leave `ecr lint` failing on the file it had just created.
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
  private readonly ignorePatterns: readonly RegExp[];

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
    this.ignorePatterns = ignorePatterns.map((pattern: string): RegExp =>
      MetaDocumentFilter.compileGlob(pattern),
    );
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
    return this.ignorePatterns.some((pattern: RegExp): boolean =>
      pattern.test(corpusRelativePath),
    );
  }

  /**
   * Compiles a minimal glob pattern into an anchored regular expression.
   *
   * `**` matches across path separators; `*` matches within a single segment;
   * `?` matches one character other than a separator. All other characters are
   * matched literally.
   *
   * @param pattern - The glob pattern to compile
   * @returns An anchored regular expression equivalent to the pattern
   */
  private static compileGlob(pattern: string): RegExp {
    let expression: string = '';

    for (let index: number = 0; index < pattern.length; index += 1) {
      const character: string = pattern[index] ?? '';

      if (character === '*') {
        if (pattern[index + 1] === '*') {
          expression += '.*';
          index += 1;
        } else {
          expression += '[^/]*';
        }
        continue;
      }

      if (character === '?') {
        expression += '[^/]';
        continue;
      }

      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    return new RegExp(`^${expression}$`);
  }
}

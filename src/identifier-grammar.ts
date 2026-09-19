/**
 * DocID and SectionID Grammar Parsing & Validation
 *
 * Implements the identifier grammar defined in the ECR specification (1#9.2).
 *
 * Grammar:
 *   DocID       ::= Digit+ ("." Digit+)*
 *   SectionPath ::= Digit+ ("." Digit+)*
 *   SectionID   ::= DocID "#" SectionPath
 *
 * All operations are deterministic and side-effect-free.
 */

import type { DocID, SectionID } from './types.js';

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Represents the outcome of parsing a string as a DocID.
 *
 * When parsing succeeds, `valid` is `true` and `docId` holds the parsed value.
 * When parsing fails, `valid` is `false`.
 */
export type DocIdParseResult =
  | { readonly valid: true; readonly docId: DocID }
  | { readonly valid: false };

/**
 * Represents the outcome of parsing a string as a SectionID.
 *
 * When parsing succeeds, `valid` is `true`, `sectionId` holds the parsed value,
 * and `docId` holds the DocID prefix that the SectionID extends.
 * When parsing fails, `valid` is `false`.
 */
export type SectionIdParseResult =
  | {
      readonly valid: true;
      readonly sectionId: SectionID;
      readonly docId: DocID;
      /** The section path following the `#` separator, e.g. `3.1` in `8.1#3.1`. */
      readonly sectionPath: string;
    }
  | { readonly valid: false };

/**
 * Represents the outcome of extracting a SectionID and title from a sub-heading.
 *
 * When extraction succeeds, `valid` is `true` and both `sectionId` and `title`
 * are present. When it fails, `valid` is `false`.
 */
export type SectionHeadingParseResult =
  | { readonly valid: true; readonly sectionId: SectionID; readonly title: string }
  | { readonly valid: false };

/**
 * Represents the outcome of extracting a DocID and title from an H1 heading string.
 *
 * When extraction succeeds, `valid` is `true` and both `docId` and `title` are
 * present. When extraction fails, `valid` is `false`.
 */
export type HeadingParseResult =
  | { readonly valid: true; readonly docId: DocID; readonly title: string }
  | { readonly valid: false };

/**
 * Represents the outcome of validating a heading separator.
 *
 * `valid` is `true` when the heading carries a recognisable separator: a
 * hyphen-minus, en dash or em dash after the identifier. When none is found,
 * `valid` is `false` and `detectedSeparator` holds the canonical separator
 * for use in the diagnostic message.
 */
export type SeparatorValidationResult =
  | { readonly valid: true }
  | { readonly valid: false; readonly detectedSeparator: string };

// ---------------------------------------------------------------------------
// Internal constants
// ---------------------------------------------------------------------------

/**
 * Regular expression matching the DocID grammar: one or more numeric segments
 * separated by dots. Each segment is one or more digits.
 *
 * Anchored to match the entire string.
 */
const DOC_ID_PATTERN: RegExp = /^\d+(\.\d+)*$/;

/**
 * Regular expression matching the SectionID grammar: a DocID, the
 * separator `#`, and a section path of one or more dot-separated numeric
 * segments.
 *
 * The separator is what makes an identifier unambiguous. Without it, `0.0.2.1`
 * could denote section 1 of document `0.0.2` or section 2.1 of document `0.0`,
 * and a corpus numbering its documents hierarchically will contain both.
 *
 * Group 1: the DocID. Group 2: the section path.
 */
const SECTION_ID_PATTERN: RegExp = /^(\d+(?:\.\d+)*)#(\d+(?:\.\d+)*)$/;

/**
 * Canonical separator, used when a separator must be rendered in a message.
 */
const HYPHEN_MINUS_SEPARATOR: string = ' - ';

/**
 * Regular expression matching a heading of the form `DocID <dash> Title`.
 *
 * The separator may be a hyphen-minus (U+002D), an en dash (U+2013) or an
 * em dash (U+2014), with any amount of surrounding whitespace including none.
 *
 * Real-world corpora mix all three interchangeably, often within one document,
 * and the separator carries no structural meaning: identity is carried entirely
 * by the numeric identifier. Rejecting a dash variant would fail documents that
 * are perfectly navigable, so all three are accepted.
 *
 * Group 1: the candidate DocID. Group 2: the title.
 */
const HEADING_PATTERN: RegExp = /^(\d+(?:\.\d+)*)\s*[-–—]\s*(.+)$/;

/**
 * Detects whether a heading carries any recognised separator, irrespective of
 * which dash variant is used.
 */
const ANY_SEPARATOR_PATTERN: RegExp = /\d\s*[-–—]\s*\S/;

/**
 * Regular expression matching a sub-heading of the form `SectionID <dash> Title`.
 *
 * Group 1: the SectionID. Group 2: the title.
 */
const SECTION_HEADING_PATTERN: RegExp =
  /^(\d+(?:\.\d+)*#\d+(?:\.\d+)*)\s*[-\u2013\u2014]\s*(.+)$/;


// ---------------------------------------------------------------------------
// Identifier grammar parser
// ---------------------------------------------------------------------------

/**
 * Provides parsing and validation for DocID and SectionID identifiers
 * as defined in the ECR specification (1#9.2).
 *
 * Grammar:
 *   DocID       ::= Digit+ ("." Digit+)*
 *   SectionPath ::= Digit+ ("." Digit+)*
 *   SectionID   ::= DocID "#" SectionPath
 *
 * This class encapsulates all identifier-level grammar operations
 * required by the ECR structural specification.
 *
 * @example
 * ```ts
 * const grammar = new IdentifierGrammar();
 * const result = grammar.parseDocId('3.1');
 * // { valid: true, docId: '3.1' }
 * ```
 */
export class IdentifierGrammar {
  /**
   * Parses a string and determines whether it conforms to the DocID grammar.
   *
   * A valid DocID consists of one or more numeric segments separated by dots,
   * where each segment contains one or more digits.
   *
   * @param input - The string to parse
   * @returns A parse result indicating validity and, on success, the parsed DocID
   */
  public parseDocId(input: string): DocIdParseResult {
    const isValid: boolean = this.matchesDocIdGrammar(input);

    if (isValid) {
      return { valid: true, docId: input };
    }

    return { valid: false };
  }

  /**
   * Parses a string and determines whether it conforms to the SectionID grammar.
   *
   * A SectionID is a DocID, the separator `#`, and a section path
   * of one or more dot-separated numeric segments. The separator is mandatory:
   * a dotted identifier with no `#` is a DocID, never a SectionID.
   *
   * @param input - The string to parse
   * @returns A parse result indicating validity and, on success, the SectionID,
   *          the DocID it belongs to, and the section path within that document
   */
  public parseSectionId(input: string): SectionIdParseResult {
    const match: RegExpExecArray | null = SECTION_ID_PATTERN.exec(input);

    if (match === null) {
      return { valid: false };
    }

    const docIdValue: string = match[1] ?? '';
    const sectionPathValue: string = match[2] ?? '';

    return {
      valid: true,
      sectionId: input,
      docId: docIdValue,
      sectionPath: sectionPathValue,
    };
  }

  /**
   * Determines whether a SectionID belongs to a given DocID.
   *
   * This is an exact comparison of the SectionID's document
   * part against the supplied DocID. No prefix matching is involved, so a
   * SectionID of document `8.1.3` does not belong to document `8.1`, and a
   * SectionID of `8.10` does not belong to `8.1`.
   *
   * @param sectionId - The SectionID to check
   * @param docId - The DocID the SectionID should belong to
   * @returns `true` if the SectionID names a section of that document
   */
  public tellSectionIdExtendsDocId(sectionId: SectionID, docId: DocID): boolean {
    const parseResult: SectionIdParseResult = this.parseSectionId(sectionId);

    if (!parseResult.valid) {
      return false;
    }

    return parseResult.docId === docId;
  }

  /**
   * Counts the number of numeric segments in an identifier string.
   *
   * Segments are the numeric components separated by `"."`.
   * For example, `"3.1.2"` has three segments.
   *
   * @param identifier - A DocID or SectionID string
   * @returns The number of numeric segments
   */
  public showSegmentCount(identifier: string): number {
    if (identifier === '') {
      return 0;
    }

    const segments: readonly string[] = identifier.split('.');
    return segments.length;
  }

  /**
   * Counts the segments in a SectionID's section path.
   *
   * For `8.1#3.1` the section path is `3.1`, so the length is 2. The DocID's
   * own depth does not contribute.
   *
   * @param sectionId - The SectionID to measure
   * @returns The number of section-path segments, or 0 if the input is not a SectionID
   */
  public showSectionPathLength(sectionId: SectionID): number {
    const parseResult: SectionIdParseResult = this.parseSectionId(sectionId);

    if (!parseResult.valid) {
      return 0;
    }

    return this.showSegmentCount(parseResult.sectionPath);
  }

  /**
   * Computes the section-path length required of a heading at a given depth.
   *
   * A heading at Markdown depth *d* carries exactly *d - 1*
   * section-path segments, independent of how deep its document's DocID is.
   * An H2 carries one segment, an H3 two, and so on.
   *
   * @param headingDepth - The Markdown heading depth (2 for H2, 3 for H3, etc.)
   * @returns The required number of section-path segments
   */
  public showExpectedSectionPathLength(headingDepth: number): number {
    return headingDepth - 1;
  }

  /**
   * Extracts the DocID and title from an H1 heading string.
   *
   * The heading must match the pattern: DocID <dash> Title, where the dash
   * is a hyphen-minus, en dash or em dash with any surrounding whitespace.
   * The title must be non-empty after trimming leading and trailing
   * whitespace.
   *
   * @param headingText - The plain text content of the H1 heading node
   * @returns A parse result indicating validity and, on success, the extracted DocID and title
   */
  public parseHeading(headingText: string): HeadingParseResult {
    const match: RegExpExecArray | null = HEADING_PATTERN.exec(headingText.trim());

    if (match === null) {
      return { valid: false };
    }

    const candidateDocId: string = match[1] ?? '';
    const title: string = match[2] ?? '';

    const docIdResult: DocIdParseResult = this.parseDocId(candidateDocId);

    if (!docIdResult.valid) {
      return { valid: false };
    }

    const trimmedTitle: string = title.trim();

    if (trimmedTitle.length === 0) {
      return { valid: false };
    }

    return { valid: true, docId: docIdResult.docId, title };
  }

  /**
   * Extracts the SectionID and title from a sub-heading string.
   *
   * A sub-heading carries a SectionID, so it must contain the `#` separator.
   * An H1 carries a DocID and is parsed by {@link IdentifierGrammar.parseHeading}
   * instead.
   *
   * @param headingText - The plain text content of a heading node at depth \>= 2
   * @returns A parse result indicating validity and, on success, the SectionID and title
   */
  public parseSectionHeading(headingText: string): SectionHeadingParseResult {
    const match: RegExpExecArray | null = SECTION_HEADING_PATTERN.exec(headingText.trim());

    if (match === null) {
      return { valid: false };
    }

    const sectionId: string = match[1] ?? '';
    const title: string = match[2] ?? '';

    if (title.trim().length === 0) {
      return { valid: false };
    }

    return { valid: true, sectionId, title };
  }

  /**
   * Validates that a heading string carries a separator between its
   * identifier and its title.
   *
   * Per the ECR specification (1#9.3, 1#9.4), the separator may be a
   * hyphen-minus (U+002D), an en dash (U+2013) or an em dash (U+2014), with
   * any surrounding whitespace. Only a heading with no separator at all is
   * invalid.
   *
   * @param headingText - The plain text content of a heading node
   * @returns A validation result indicating whether the separator is valid
   */
  public validateSeparator(headingText: string): SeparatorValidationResult {
    if (ANY_SEPARATOR_PATTERN.test(headingText)) {
      return { valid: true };
    }

    return { valid: false, detectedSeparator: HYPHEN_MINUS_SEPARATOR };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Tests whether a string matches the DocID grammar: `Digit+ ("." Digit+)*`.
   *
   * @param input - The string to test
   * @returns `true` if the input matches the DocID grammar, `false` otherwise
   */
  private matchesDocIdGrammar(input: string): boolean {
    return DOC_ID_PATTERN.test(input);
  }
}

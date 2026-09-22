/**
 * References Section Rule (ECR103)
 *
 * Validates the mandatory References section defined in the ECR specification:
 *   - 1#9.6 -- References Section Rules (Mandatory)
 *   - 1#9.7 -- Direction Label Semantics
 *   - 1#9.8 -- Per-Document Structural Invariants ("References section present exactly once",
 *                 "No duplicate TargetDocID entries in References")
 *
 * This rule operates on heading node data to detect the `## References` heading,
 * and on list item text content to parse and validate individual reference entries.
 * It delegates identifier parsing to {@link IdentifierGrammar} and emits
 * {@link Diagnostic} objects for any violations.
 *
 * Extracted artefacts:
 *   - {@link ReferenceEdge} for each valid list item in the References section
 */

import type {
  DocID,
  Diagnostic,
  DiagnosticSeverity,
  PositionRange,
  ReferenceEdge,
  ReferenceDirection,
} from './types.js';
import { IdentifierGrammar } from './identifier-grammar.js';
import type { DocIdParseResult, SeparatorValidationResult } from './identifier-grammar.js';
import type { HeadingNodeData } from './document-identity-rule.js';
import type { HeadingObstruction } from './heading-source-form.js';
import { SourceLines } from './source-lines.js';
import { alignParsedToSource } from './source-alignment.js';

// ---------------------------------------------------------------------------
// Rule identifier constant
// ---------------------------------------------------------------------------

/**
 * Canonical rule identifier for the References Section Rule.
 *
 * Referenced as [ECR103] in the ECR specification (1#9.6).
 */
export const REFERENCES_SECTION_RULE_ID: string = 'ECR103';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Data extracted from a single list item AST node within the References
 * section, provided by the document traversal layer.
 *
 * The rule does not parse Markdown itself; it operates on list item
 * data supplied by the visitor/traversal infrastructure.
 */
export interface ListItemNodeData {
  /**
   * Plain text content of the list item node.
   *
   * Expected to match the pattern:
   * `TargetDocID <dash> Title " (" Direction <dash> Explanation ")"`
   *
   * @example "3.1 - Scenario Authoring (authority - defines guardrail logic)"
   */
  readonly text: string;

  /**
   * Positional range of the list item node within the source document.
   * Optional; depends on whether the Markdown parser provides positional metadata.
   */
  readonly range?: PositionRange;

  /**
   * The parsed nodes that make up {@link text}, in order, joined to form it.
   *
   * Needed to locate the relationship parenthetical in the source. It is
   * found in the parsed text, and only the parsed text knows which `(` it
   * is: raw Markdown gains and loses parentheses through character
   * references, formatting and link destinations, so balancing the source
   * separately picked a different `(` and judged the wrong one. The segment
   * holding the parsed `(` says where to look. When absent, as in unit tests
   * that supply only text, the label's source position is not checked.
   */
  readonly segments?: readonly ListItemSegment[];
}

/**
 * One parsed node's contribution to a References entry's text.
 */
export interface ListItemSegment {
  /**
   * How the segment's characters map back to the source: `text` for a parsed
   * text node, through escapes and character references; `code` for inline
   * code, whose content is the source between its backtick fences; `other`
   * for anything else that contributes text, such as the text of HTML, which
   * is not traced.
   */
  readonly kind: 'text' | 'code' | 'other';

  /** The characters the node contributes. */
  readonly text: string;

  /** The node's position in the source. */
  readonly range?: PositionRange;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * The complete result produced by finalising the References Section Rule
 * after all headings and list items have been evaluated.
 *
 * Contains zero or more diagnostics and the list of successfully extracted
 * reference edges.
 */
export interface ReferencesSectionRuleResult {
  /** Diagnostics emitted during evaluation (errors for violations). */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Reference edges extracted from valid list items, in document traversal order.
   *
   * Each edge represents a document-level typed relationship from the current
   * document to a referenced document.
   */
  readonly references: readonly ReferenceEdge[];
}

// ---------------------------------------------------------------------------
// Parsed reference entry (intermediate type)
// ---------------------------------------------------------------------------

/**
 * Represents the successfully parsed components of a single References
 * section list item.
 *
 * This is an intermediate type used internally during evaluation. It holds
 * the parsed fields before they are assembled into a {@link ReferenceEdge}.
 */
export interface ParsedReferenceEntry {
  /** The target DocID extracted from the list item. */
  readonly targetDocId: DocID;

  /** The title text extracted from the list item. */
  readonly title: string;

  /** The direction label extracted from the parenthetical. */
  readonly direction: ReferenceDirection;

  /** The explanation text extracted from the parenthetical. */
  readonly explanation: string;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Configuration options for constructing a {@link ReferencesSectionRule} instance.
 */
export interface ReferencesSectionRuleOptions {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   * Attached to all emitted diagnostics.
   */
  readonly uri: string;

  /**
   * The DocID established by the {@link DocumentIdentityRule} for this document.
   * Used as the `fromDocId` field in all extracted {@link ReferenceEdge} objects.
   */
  readonly docId: DocID;

  /**
   * The {@link IdentifierGrammar} instance used for DocID parsing
   * and separator validation.
   */
  readonly grammar: IdentifierGrammar;

  /**
   * The document's raw Markdown, for the References source-form checks of
   * 1#9.11 rule 4. When absent, as in unit tests that supply only parsed
   * text, those checks are skipped.
   */
  readonly sourceText?: string;
}

// ---------------------------------------------------------------------------
// Diagnostic causes (1#9.11 rules 3 and 4, 1#9.6)
// ---------------------------------------------------------------------------

/** The `data.cause` of a `## References` heading no recipe can find. */
export const REFERENCES_HEADING_SOURCE_FORM_CAUSE: string = 'references-heading-source-form';

/** The `data.cause` of a References section that is not at the document root. */
export const REFERENCES_PLACEMENT_CAUSE: string = 'references-placement';

/** The `data.cause` of a References entry the entry recipes cannot find. */
export const REFERENCES_ENTRY_SOURCE_FORM_CAUSE: string = 'references-entry-source-form';

/** The `data.cause` of an entry whose relationship parenthetical never closes. */
export const REFERENCES_ENTRY_UNBALANCED_CAUSE: string = 'references-entry-unbalanced';

/**
 * Where a References entry's relationship parenthetical begins, or why it
 * cannot be located.
 */
type ParentheticalLocation = { readonly open: number } | 'missing' | 'unbalanced';

/**
 * The start of a References entry as the entry recipe reads it: optional
 * indentation, a list marker, optional whitespace and an optional `[`. The
 * target DocID must follow immediately.
 */
const ENTRY_LINE_PREFIX: RegExp = /^\s*(?:[-*+]|[0-9]+[.)])\s*\[?/;

/**
 * What may follow the target DocID on its line, per the entry recipe
 * `^\s*([-*+]|[0-9]+[.)])\s*\[?8\.1[^0-9.#]`.
 */
const AFTER_ENTRY_DOC_ID: RegExp = /^[^0-9.#]/;

// ---------------------------------------------------------------------------
// Diagnostic severity constant (module-level, non-exported)
// ---------------------------------------------------------------------------

/**
 * The severity used for all References Section Rule diagnostics.
 *
 * Per 1#9.8, violation of any per-document structural invariant is an ERROR.
 */
const REFERENCES_SECTION_DIAGNOSTIC_SEVERITY: DiagnosticSeverity = 'error';

// ---------------------------------------------------------------------------
// Valid reference direction values (module-level, non-exported)
// ---------------------------------------------------------------------------

/**
 * The set of valid direction labels for References section entries.
 *
 * Per 1#9.6, Direction must be one of: authority, dependency, constraint, contract.
 */
const VALID_REFERENCE_DIRECTIONS: ReadonlySet<ReferenceDirection> = new Set([
  'authority',
  'dependency',
  'constraint',
  'contract',
] as const);

// ---------------------------------------------------------------------------
// References heading text constant (module-level, non-exported)
// ---------------------------------------------------------------------------

/**
 * The exact heading text that identifies the References section.
 *
 * Per 1#9.6, the heading must be exactly "References" at depth 2.
 */
const REFERENCES_HEADING_TEXT: string = 'References';

// ---------------------------------------------------------------------------
// References heading depth constant (module-level, non-exported)
// ---------------------------------------------------------------------------

/**
 * The required heading depth for the References section heading.
 *
 * Per 1#9.6, the References heading must be an H2 (depth 2).
 */
const REFERENCES_HEADING_DEPTH: number = 2;

/**
 * The References heading's whole source line, exactly (1#9.11 rule 4).
 */
const REFERENCES_HEADING_LINE: string = `${'#'.repeat(REFERENCES_HEADING_DEPTH)} ${REFERENCES_HEADING_TEXT}`;

// ---------------------------------------------------------------------------
// Separator constants
// ---------------------------------------------------------------------------

/**
 * Matches the separator in a References entry: a dash delimited by a single
 * space on each side.
 *
 * The dash may be a hyphen-minus (U+002D), an en dash (U+2013) or an em dash
 * (U+2014). Real-world corpora mix all three, and the variant carries no
 * structural meaning, so all are accepted.
 */
const SEPARATOR_PATTERN: RegExp = / [-–—] /;

// ---------------------------------------------------------------------------
// Rule class
// ---------------------------------------------------------------------------

/**
 * Validates the References Section Rule as defined in the ECR specification (1#9.6, 1#9.7, 1#9.8).
 *
 * The rule enforces that:
 * - Exactly one `## References` heading exists in the document
 * - A list node immediately follows the References heading
 * - Each list item matches the required format:
 *   `TargetDocID <dash> Title " (" Direction <dash> Explanation ")"`
 * - TargetDocID is a valid DocID per the identifier grammar
 * - Direction is one of: authority, dependency, constraint, contract
 * - Title and Explanation are non-empty
 * - Each separator is a dash: hyphen-minus, en dash or em dash
 * - No duplicate TargetDocID entries exist
 *
 * For each valid list item, the rule extracts a {@link ReferenceEdge} with
 * `fromDocId` set to the document's established DocID.
 *
 * Usage:
 * 1. Construct a rule instance with the document URI, established DocID,
 *    and an {@link IdentifierGrammar}.
 * 2. Call {@link evaluateHeading} for every heading node encountered during
 *    AST traversal. The rule uses this to detect `## References` headings.
 * 3. Call {@link evaluateListItem} for every list item node encountered
 *    within the References section during AST traversal.
 * 4. Call {@link finalise} after all nodes have been evaluated to obtain
 *    the complete result including any "missing References" diagnostics.
 *
 * @example
 * ```ts
 * const grammar = new IdentifierGrammar();
 * const rule = new ReferencesSectionRule({
 *   uri: 'file:///doc.md',
 *   docId: '5.1',
 *   grammar,
 * });
 *
 * rule.evaluateHeading({ depth: 1, text: '5.1 - My Document' });
 * rule.evaluateHeading({ depth: 2, text: '5.1#1 - Section' });
 * rule.evaluateHeading({ depth: 2, text: 'References' });
 *
 * rule.evaluateListItem({
 *   text: '3.1 - Scenario Authoring (authority - defines guardrail logic)',
 * });
 * rule.evaluateListItem({
 *   text: '8.1 - Orchestration Contract (constraint - retry semantics)',
 * });
 *
 * const result: ReferencesSectionRuleResult = rule.finalise();
 * ```
 */
export class ReferencesSectionRule {
  /** The opaque, host-provided URI identifying the document being validated. */
  private readonly uri: string;

  /** The established DocID for this document, used as `fromDocId` in extracted edges. */
  private readonly docId: DocID;

  /** The grammar instance used for DocID parsing and separator validation. */
  private readonly grammar: IdentifierGrammar;

  /** Diagnostics accumulated during evaluation. */
  private readonly collectedDiagnostics: Diagnostic[];

  /** Reference edges extracted from valid list items, in traversal order. */
  private readonly collectedReferences: ReferenceEdge[];

  /**
   * Number of `## References` headings encountered during evaluation.
   * Used to detect missing or duplicate References sections.
   */
  private referencesHeadingCount: number;

  /**
   * Set of TargetDocIDs already encountered in the References section,
   * for duplicate detection.
   */
  private readonly encounteredTargetDocIds: Set<DocID>;

  /** The document's source by line; absent when none was supplied. */
  private readonly sourceLines: SourceLines | undefined;

  /**
   * Whether the section was found somewhere other than the document root.
   * Its placement is then the one thing reported: every line of a nested
   * section starts with its container's prefix, so checking each entry's
   * source form as well would report the same mistake once per entry.
   */
  private sectionMisplaced: boolean;

  /**
   * Constructs a new References Section Rule evaluator.
   *
   * @param options - Configuration including the document URI, established DocID,
   *                  and grammar instance
   */
  public constructor(options: ReferencesSectionRuleOptions) {
    this.uri = options.uri;
    this.docId = options.docId;
    this.grammar = options.grammar;
    this.collectedDiagnostics = [];
    this.collectedReferences = [];
    this.referencesHeadingCount = 0;
    this.encounteredTargetDocIds = new Set<DocID>();
    this.sourceLines =
      options.sourceText === undefined ? undefined : new SourceLines(options.sourceText);
    this.sectionMisplaced = false;
  }

  /**
   * Records where the References section sits, and checks its heading's
   * source form (1#9.11 rules 3 and 4).
   *
   * Called once, by the traversal layer, for the section whose list it then
   * feeds. A section nested in a blockquote, a list item or any other
   * container is reported once as misplaced. One at the root has its heading
   * line checked: it must be `## References` at the start of a line a search
   * sees, because the recipe that reads a document's references is
   * `^## References`.
   *
   * @param headingRange - Position of the `## References` heading
   * @param nested - Whether the heading, or the list after it, is not a root child
   */
  public evaluateSectionPlacement(headingRange: PositionRange | undefined, nested: boolean): void {
    if (nested) {
      this.sectionMisplaced = true;
      this.collectedDiagnostics.push(
        this.createDiagnostic(
          `The References section is nested inside another element. The heading and its ` +
          `list must both be at the top level of the document, where the recipe ` +
          `"^## References" finds them; move the section out of its container.`,
          headingRange,
          { cause: REFERENCES_PLACEMENT_CAUSE },
        ),
      );
      return;
    }

    const obstruction: HeadingObstruction | undefined = this.findHeadingObstruction(headingRange);

    if (obstruction !== undefined) {
      this.collectedDiagnostics.push(
        this.createDiagnostic(
          obstruction === 'lone-carriage-return'
            ? `The References heading follows a lone carriage return (CR) line ending, so ` +
              `to a search it is the middle of the line before, and "^## References" does ` +
              `not find it. Save the file with LF or CRLF line endings.`
            : `The References heading's line is not exactly "## References", so the ` +
              `recipe "^## References" is not guaranteed to find it. Write two # ` +
              `characters at the start of the line, one space and the word References, ` +
              `with nothing else on the line: no formatting, closing hashes or trailing spaces.`,
          headingRange,
          { cause: REFERENCES_HEADING_SOURCE_FORM_CAUSE, obstruction },
        ),
      );
    }
  }

  /**
   * Evaluates a single heading node to detect `## References` headings.
   *
   * A heading is considered a References heading when its depth is exactly 2
   * and its text content is exactly "References". The rule tracks how many
   * such headings are encountered to enforce the "exactly one" constraint.
   *
   * Headings that do not match are ignored by this rule.
   *
   * @param headingNodeData - Data extracted from a heading AST node
   */
  public evaluateHeading(headingNodeData: HeadingNodeData): void {
    if (headingNodeData.depth !== REFERENCES_HEADING_DEPTH) {
      return;
    }

    if (headingNodeData.text !== REFERENCES_HEADING_TEXT) {
      return;
    }

    this.referencesHeadingCount = this.referencesHeadingCount + 1;
  }

  /**
   * Evaluates a single list item node from within the References section.
   *
   * For each list item, the method validates:
   * 1. The entry carries its separators (any dash variant is accepted)
   * 2. The overall format matches:
   *    `TargetDocID <dash> Title " (" Direction <dash> Explanation ")"`
   * 3. TargetDocID parses as a valid DocID per the identifier grammar
   * 4. Direction is one of the allowed enumeration values
   * 5. Title is non-empty (after trimming)
   * 6. Explanation is non-empty (after trimming)
   * 7. TargetDocID has not been seen before in this References section
   *
   * When all validations pass, a {@link ReferenceEdge} is extracted with
   * `fromDocId` set to the document's DocID.
   *
   * When any validation fails, an error diagnostic is emitted and no
   * edge is extracted for that list item.
   *
   * @param listItemNodeData - Data extracted from a list item AST node
   *                           within the References section
   */
  public evaluateListItem(listItemNodeData: ListItemNodeData): void {
    if (this.referencesHeadingCount === 0) {
      return;
    }

    const text: string = listItemNodeData.text;
    const range: PositionRange | undefined = listItemNodeData.range;

    // 1. Validate that the separators are present
    const separatorDiagnostic: Diagnostic | undefined =
      this.validateListItemSeparators(text, range);

    if (separatorDiagnostic !== undefined) {
      this.collectedDiagnostics.push(separatorDiagnostic);
      return;
    }

    // 2. Parse the list item text into components
    const parsedEntry: ParsedReferenceEntry | 'unbalanced' | undefined =
      this.parseListItemText(text);

    if (parsedEntry === 'unbalanced') {
      this.collectedDiagnostics.push(
        this.createDiagnostic(
          `References entry is malformed: its relationship parenthetical is not balanced. ` +
          `Matching its final ")" back to an opening "(" never closes, so the direction ` +
          `and explanation cannot be located. Parentheses must be balanced within ` +
          `"(direction - explanation)".`,
          range,
          { cause: REFERENCES_ENTRY_UNBALANCED_CAUSE },
        ),
      );
      return;
    }

    if (parsedEntry === undefined) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry does not match the required format: ` +
        `DocID - Title (direction - explanation). ` +
        `A hyphen, en dash or em dash may be used as each separator.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 3. Validate TargetDocID is a valid DocID
    const docIdParseResult: DocIdParseResult = this.grammar.parseDocId(parsedEntry.targetDocId);

    if (!docIdParseResult.valid) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry target "${parsedEntry.targetDocId}" is not a valid DocID.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 4. Validate direction
    if (!this.tellValidDirection(parsedEntry.direction)) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry direction "${String(parsedEntry.direction)}" is not valid. ` +
        `Allowed values: authority, dependency, constraint, contract.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 5. Validate title is non-empty
    const trimmedTitle: string = parsedEntry.title.trim();

    if (trimmedTitle.length === 0) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry title must be non-empty.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 6. Validate explanation is non-empty
    const trimmedExplanation: string = parsedEntry.explanation.trim();

    if (trimmedExplanation.length === 0) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry explanation must be non-empty.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 7. Check for duplicate TargetDocID
    if (this.encounteredTargetDocIds.has(parsedEntry.targetDocId)) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `Duplicate TargetDocID "${parsedEntry.targetDocId}" in References section. ` +
        `Each TargetDocID must appear only once.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    // 8. Check the entry is where its recipes look (1#9.11 rule 4). Reported,
    // but the edge is still extracted: withholding it would make every inline
    // citation of the target undeclared, reporting one mistake many times.
    const sourceFormDiagnostic: Diagnostic | undefined = this.validateEntrySourceForm(
      parsedEntry,
      listItemNodeData,
    );

    if (sourceFormDiagnostic !== undefined) {
      this.collectedDiagnostics.push(sourceFormDiagnostic);
    }

    // All validations passed -- extract ReferenceEdge
    this.encounteredTargetDocIds.add(parsedEntry.targetDocId);

    const referenceEdge: ReferenceEdge = {
      fromDocId: this.docId,
      toDocId: parsedEntry.targetDocId,
      direction: parsedEntry.direction,
      explanation: parsedEntry.explanation,
      title: parsedEntry.title,
    };

    this.collectedReferences.push(referenceEdge);
  }

  /**
   * Indicates whether the References section heading has been detected.
   *
   * This is used by the traversal layer to determine when list items
   * should be fed to this rule. Only list items immediately following
   * the `## References` heading should be evaluated.
   *
   * @returns `true` if at least one `## References` heading has been encountered
   */
  public tellReferencesHeadingDetected(): boolean {
    return this.referencesHeadingCount > 0;
  }

  /**
   * Finalises the rule evaluation and produces the complete result.
   *
   * This method must be called after all heading and list item nodes
   * have been supplied via {@link evaluateHeading} and {@link evaluateListItem}.
   * It analyses the count of References headings encountered and emits
   * appropriate diagnostics:
   *
   * - Zero References headings: emits a "missing References section" error diagnostic
   * - Multiple References headings: emits a "multiple References sections" error diagnostic
   * - Exactly one References heading with no list items: emits a "missing list" error diagnostic
   *   (indicating no list node immediately follows the heading)
   *
   * @returns The complete rule result including all diagnostics and extracted reference edges
   */
  public finalise(): ReferencesSectionRuleResult {
    if (this.referencesHeadingCount === 0) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        'Document is missing a ## References section.',
      );
      this.collectedDiagnostics.push(diagnostic);
    } else if (this.referencesHeadingCount > 1) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `Document contains multiple References sections (found ${String(this.referencesHeadingCount)}), ` +
        `but exactly one is required.`,
      );
      this.collectedDiagnostics.push(diagnostic);
    } else if (
      this.referencesHeadingCount === 1 &&
      this.collectedReferences.length === 0 &&
      !this.tellHasListItemDiagnostics()
    ) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        'References section has no list items. ' +
        'A list node must immediately follow the ## References heading.',
      );
      this.collectedDiagnostics.push(diagnostic);
    }

    return {
      diagnostics: this.collectedDiagnostics,
      references: this.collectedReferences,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Parses a list item text string into its component parts.
   *
   * Attempts to match the pattern:
   * `TargetDocID <dash> Title " (" Direction <dash> Explanation ")"`
   *
   * The relationship parenthetical is located first, by matching the entry's
   * final `)` to its opening `(` (1#9.6). Taking the last `" ("` instead read
   * `defines retries (contract - policy)` as a `contract` edge, and failed
   * outright on `defines retries (including backoff)`. Within the
   * parenthetical, the first separator splits Direction from Explanation;
   * before it, the first separator splits TargetDocID from Title, which may
   * itself contain separators.
   *
   * @param text - The plain text content of a list item node
   * @returns The parsed entry, `'unbalanced'` when the parenthetical never
   *          closes, or `undefined` when the entry is otherwise malformed
   */
  private parseListItemText(text: string): ParsedReferenceEntry | 'unbalanced' | undefined {
    const entry: string = text.trimEnd();
    const location: ParentheticalLocation =
      ReferencesSectionRule.locateRelationshipParenthetical(entry);

    if (location === 'unbalanced') {
      return 'unbalanced';
    }

    if (location === 'missing') {
      return undefined;
    }

    // Markdown renders any whitespace before the "(" as a space, including a
    // line break; whether the label shares the marker's source line is the
    // source-form check's question, not the parser's.
    const prefixWithGap: string = entry.substring(0, location.open);

    if (!/\s$/.test(prefixWithGap)) {
      return undefined;
    }

    const lastParenOpenIndex: number = prefixWithGap.trimEnd().length;

    // Extract the parenthetical content (between "(" and the final ")")
    const parentheticalContent: string = entry.substring(
      location.open + 1,
      entry.length - 1,
    );

    // Step 3: Split the parenthetical on " - " to get Direction and Explanation
    const parentheticalMatch: RegExpExecArray | null =
      SEPARATOR_PATTERN.exec(parentheticalContent);

    if (parentheticalMatch === null) {
      return undefined;
    }

    const parentheticalSeparatorIndex: number = parentheticalMatch.index;
    const parentheticalSeparatorLength: number = parentheticalMatch[0].length;

    const directionCandidate: string = parentheticalContent.substring(
      0,
      parentheticalSeparatorIndex,
    );
    const explanationCandidate: string = parentheticalContent.substring(
      parentheticalSeparatorIndex + parentheticalSeparatorLength,
    );

    // Step 4: Extract the prefix portion (before the parenthetical)
    const prefixPortion: string = entry.substring(0, lastParenOpenIndex);

    // Step 5: Find the first " - " in the prefix to split DocID from Title
    const prefixMatch: RegExpExecArray | null = SEPARATOR_PATTERN.exec(prefixPortion);

    if (prefixMatch === null) {
      return undefined;
    }

    const firstSeparatorIndex: number = prefixMatch.index;

    const targetDocIdCandidate: string = prefixPortion.substring(
      0,
      firstSeparatorIndex,
    );
    const titleCandidate: string = prefixPortion.substring(
      firstSeparatorIndex + prefixMatch[0].length,
    );

    return {
      targetDocId: targetDocIdCandidate,
      title: titleCandidate,
      direction: directionCandidate as ReferenceDirection,
      explanation: explanationCandidate,
    };
  }

  /**
   * Maps an offset in a segment's parsed text to its offset in the segment's
   * source, by the rule for the segment's kind.
   *
   * @param segment - A `text` or `code` segment
   * @param source - The segment's source
   * @param offset - An offset within its parsed text
   * @returns The corresponding source offset, or `undefined` when a text
   *          segment could not be aligned
   */
  private static locateInSegmentSource(
    segment: ListItemSegment,
    source: string,
    offset: number,
  ): number | undefined {
    if (segment.kind === 'code') {
      return ReferencesSectionRule.locateInCodeSource(source, offset);
    }

    return alignParsedToSource(source, segment.text)?.[offset];
  }

  /**
   * Maps an offset in an inline code span's content to its source.
   *
   * Code content takes no escapes or character references, so it is the
   * source between the backtick fences, with one exception: when it both
   * begins and ends with a space, one space is stripped from each side.
   *
   * @param source - The code span's source, fences included
   * @param offset - An offset within its parsed content
   * @returns The corresponding source offset
   */
  private static locateInCodeSource(source: string, offset: number): number {
    const fence: number = /^`+/.exec(source)?.[0].length ?? 0;
    const inner: string = source.slice(fence, source.length - fence);
    const stripped: boolean =
      inner.length >= 2 && /^[ \r\n]/.test(inner) && /[ \r\n]$/.test(inner) && inner.trim() !== '';

    return fence + (stripped ? 1 : 0) + offset;
  }

  /**
   * Finds what, if anything, keeps `^## References` from finding the heading.
   *
   * The line must be `## References` exactly (1#9.11 rule 4). The check that
   * numbered headings share allows anything after the identifier, since a
   * title follows it; that let `## References ##` and trailing spaces pass
   * here, where the specification allows nothing.
   *
   * @param headingRange - Position of the `## References` heading
   * @returns The obstruction, or `undefined` when the heading is findable
   */
  private findHeadingObstruction(
    headingRange: PositionRange | undefined,
  ): HeadingObstruction | undefined {
    if (this.sourceLines === undefined || headingRange === undefined) {
      return undefined;
    }

    const lineNumber: number = headingRange.start.line;

    if (this.sourceLines.readLine(lineNumber) !== REFERENCES_HEADING_LINE) {
      return 'form';
    }

    return this.sourceLines.tellStartsSearchLine(lineNumber) ? undefined : 'lone-carriage-return';
  }

  /**
   * Locates an entry's relationship parenthetical by matching its final `)`
   * to the `(` that opens it, scanning right to left and counting depth
   * (1#9.6). The explanation may then hold parentheses of its own, and the
   * title may hold unmatched ones, without either being mistaken for it.
   *
   * @param entry - The entry's text, without trailing whitespace
   * @returns The opening `(`'s index; `'missing'` when the entry does not end
   *          with `)`; `'unbalanced'` when the final `)` is never matched
   */
  private static locateRelationshipParenthetical(entry: string): ParentheticalLocation {
    if (!entry.endsWith(')')) {
      return 'missing';
    }

    let depth: number = 0;

    for (let index: number = entry.length - 1; index >= 0; index -= 1) {
      const character: string = entry.charAt(index);

      if (character === ')') {
        depth += 1;
      } else if (character === '(') {
        depth -= 1;

        if (depth === 0) {
          return { open: index };
        }
      }
    }

    return 'unbalanced';
  }

  /**
   * Checks that an entry is where the References recipes look (1#9.11 rule 4).
   *
   * The entry recipe `^\s*([-*+]|[0-9]+[.)])\s*\[?8\.1[^0-9.#]` and the
   * direction recipe, which adds `.*\(authority`, each read one line. So the
   * list marker, the target DocID in literal characters and the direction
   * label must all be on the entry's first line, and that line must be a
   * line to a search engine. The explanation may wrap freely after the label.
   *
   * @param entry - The parsed entry
   * @param item - The list item the entry was parsed from
   * @returns A diagnostic when a recipe cannot find the entry, or `undefined`
   */
  private validateEntrySourceForm(
    entry: ParsedReferenceEntry,
    item: ListItemNodeData,
  ): Diagnostic | undefined {
    const range: PositionRange | undefined = item.range;

    if (this.sourceLines === undefined || range === undefined || this.sectionMisplaced) {
      return undefined;
    }

    const lineNumber: number = range.start.line;
    const line: string = this.sourceLines.readLine(lineNumber) ?? '';
    const data: Readonly<Record<string, unknown>> = {
      cause: REFERENCES_ENTRY_SOURCE_FORM_CAUSE,
      targetDocId: entry.targetDocId,
    };

    if (
      !ReferencesSectionRule.tellEntryLineMatches(line, entry) ||
      !this.tellLabelOpensFirstLineParenthetical(item, line, entry)
    ) {
      return this.createDiagnostic(
        `The References entry for "${entry.targetDocId}" is not written as the entry ` +
        `recipes read it, so they do not find it. The list marker, the target DocID in ` +
        `literal characters and the direction label must all be on one line -- ` +
        `"- ${entry.targetDocId} - Title (${entry.direction} - ...)" -- without ` +
        `formatting on the DocID. The explanation may continue on later lines.`,
        range,
        { ...data, obstruction: 'form' },
      );
    }

    if (!this.sourceLines.tellStartsSearchLine(lineNumber)) {
      return this.createDiagnostic(
        `The References entry for "${entry.targetDocId}" follows a lone carriage return ` +
        `(CR) line ending, so to a search it is the middle of the line before, and the ` +
        `entry recipes do not find it. Save the file with LF or CRLF line endings.`,
        range,
        { ...data, obstruction: 'lone-carriage-return' },
      );
    }

    return undefined;
  }

  /**
   * Reports whether an entry's first line begins as the entry recipe expects:
   * a list marker, then the target DocID in literal characters.
   *
   * @param line - The list item's first source line
   * @param entry - The parsed entry
   * @returns `true` when the entry recipe matches the line's start
   */
  private static tellEntryLineMatches(line: string, entry: ParsedReferenceEntry): boolean {
    const prefix: RegExpExecArray | null = ENTRY_LINE_PREFIX.exec(line);

    if (prefix === null) {
      return false;
    }

    const rest: string = line.slice(prefix[0].length);

    return (
      rest.startsWith(entry.targetDocId) &&
      AFTER_ENTRY_DOC_ID.test(rest.slice(entry.targetDocId.length))
    );
  }

  /**
   * Reports whether the entry's own relationship parenthetical opens on its
   * first line, with the direction label written literally after the `(`.
   *
   * The `(` is the one the parser chose: found in the parsed entry by
   * matching its final `)`, then traced to the source through the parsed
   * text node that holds it. Two shortcuts both failed. Asking whether
   * `(dependency` occurred anywhere on the line let a title such as
   * `Target (dependency graph)` answer for a formatted label. Balancing the
   * raw source separately picked a different `(` whenever markup added or
   * removed a parenthesis -- `&#40;`, `**(…)**`, a link destination holding
   * `)` -- rejecting valid entries and, in one case, excusing an invalid one.
   *
   * @param item - The list item, with its parsed segments
   * @param line - The list item's first source line
   * @param entry - The parsed entry
   * @returns `true` when the label follows the entry's own `(` on its first line
   */
  private tellLabelOpensFirstLineParenthetical(
    item: ListItemNodeData,
    line: string,
    entry: ParsedReferenceEntry,
  ): boolean {
    if (item.segments === undefined || item.range === undefined || this.sourceLines === undefined) {
      return true;
    }

    const location: ParentheticalLocation =
      ReferencesSectionRule.locateRelationshipParenthetical(item.text.trimEnd());

    if (typeof location === 'string') {
      return false;
    }

    const label: string = `(${entry.direction}`;
    let segmentStart: number = 0;

    for (const segment of item.segments) {
      const segmentEnd: number = segmentStart + segment.text.length;

      if (location.open < segmentEnd) {
        // The `(` and the whole label must come from one node. A label split
        // by formatting or a code fence -- `(**dependency**` or
        // ``(`dependency` `` -- is not literal text after the `(`. Inline
        // code holding the whole parenthetical is: 1#9.5 keeps citations out
        // of code, but no rule keeps References entries out of it, and both
        // recipes find `` `(dependency - x)` ``.
        if (segment.kind === 'other' || location.open + label.length > segmentEnd) {
          return false;
        }

        return this.tellSegmentHoldsLiteralLabel(
          segment,
          location.open - segmentStart,
          label,
          item.range.start.line,
          line,
        );
      }

      segmentStart = segmentEnd;
    }

    return false;
  }

  /**
   * Traces a parsed `(` to the source through its text node, and checks that
   * the label follows it literally on the entry's first line.
   *
   * @param segment - The text segment holding the `(`
   * @param offset - The `(`'s offset within the segment's parsed text
   * @param label - `(` followed by the direction label
   * @param firstLine - The entry's first line number
   * @param line - That line's text
   * @returns `true` when the source holds the label there, on that line
   */
  private tellSegmentHoldsLiteralLabel(
    segment: ListItemSegment,
    offset: number,
    label: string,
    firstLine: number,
    line: string,
  ): boolean {
    if (segment.range === undefined || this.sourceLines === undefined) {
      return false;
    }

    const source: string | undefined = this.sourceLines.slice(segment.range);
    const at: number | undefined =
      source === undefined ? undefined : ReferencesSectionRule.locateInSegmentSource(segment, source, offset);
    const segmentStart: number | undefined = this.sourceLines.offsetOf(segment.range.start);
    const lineStart: number | undefined = this.sourceLines.offsetOf({ line: firstLine, character: 0 });

    if (source === undefined || at === undefined || segmentStart === undefined || lineStart === undefined) {
      return false;
    }

    return source.startsWith(label, at) && segmentStart + at < lineStart + line.length;
  }

  /**
   * Validates that a list item carries a separator, and returns an error
   * diagnostic when none is found.
   *
   * Any dash variant is accepted. Detection is delegated to
   * {@link IdentifierGrammar.validateSeparator}.
   *
   * @param text - The plain text content of a list item node
   * @param range - Optional positional range for the diagnostic
   * @returns A diagnostic if a separator is invalid, or `undefined` if all separators are valid
   */
  private validateListItemSeparators(
    text: string,
    range?: PositionRange,
  ): Diagnostic | undefined {
    const separatorResult: SeparatorValidationResult =
      this.grammar.validateSeparator(text);

    if (!separatorResult.valid) {
      const detectedDescription: string = this.describeSeparator(
        separatorResult.detectedSeparator,
      );
      const diagnostic: Diagnostic = this.createDiagnostic(
        `References entry is malformed: no separator found (expected ${detectedDescription}). ` +
        `The required format is: DocID <dash> Title (direction <dash> explanation).`,
        range,
      );
      return diagnostic;
    }

    return undefined;
  }

  /**
   * Validates that a direction string is one of the allowed
   * {@link ReferenceDirection} values.
   *
   * @param candidate - The direction string extracted from the parenthetical
   * @returns `true` if the candidate is a valid direction, `false` otherwise
   */
  private tellValidDirection(candidate: string): candidate is ReferenceDirection {
    return VALID_REFERENCE_DIRECTIONS.has(candidate as ReferenceDirection);
  }

  /**
   * Creates a diagnostic object for the References Section Rule.
   *
   * All diagnostics share the same rule ID ({@link REFERENCES_SECTION_RULE_ID}),
   * severity (error), and document URI.
   *
   * @param message - Human-readable description of the issue
   * @param range - Optional positional range within the source document
   * @param data - Optional machine-readable detail, such as a `cause`
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(
    message: string,
    range?: PositionRange,
    data?: Readonly<Record<string, unknown>>,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: REFERENCES_SECTION_RULE_ID,
      severity: REFERENCES_SECTION_DIAGNOSTIC_SEVERITY,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
      ...(data !== undefined ? { data } : {}),
    };

    return diagnostic;
  }

  /**
   * Produces a human-readable description of a detected separator string.
   *
   * Replaces non-visible characters with their Unicode names to make
   * diagnostics more informative.
   *
   * @param separator - The detected separator string
   * @returns A human-readable description suitable for inclusion in a diagnostic message
   */
  private describeSeparator(separator: string): string {
    const withNamedCharacters: string = separator
      .replace(/\u2013/g, 'en dash U+2013')
      .replace(/\u2014/g, 'em dash U+2014');

    return `"${withNamedCharacters}"`;
  }

  /**
   * Determines whether any diagnostics have been emitted for list items
   * during evaluation.
   *
   * Used by {@link finalise} to distinguish between "no list items at all"
   * (which indicates a missing list node) and "list items were present but
   * all failed validation" (which does not indicate a missing list node).
   *
   * @returns `true` if at least one list-item-related diagnostic has been emitted
   */
  private tellHasListItemDiagnostics(): boolean {
    return this.collectedDiagnostics.length > 0;
  }
}

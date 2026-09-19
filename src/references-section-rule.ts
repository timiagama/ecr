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
}

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
    const parsedEntry: ParsedReferenceEntry | undefined =
      this.parseListItemText(text);

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
   * The parsing strategy splits the text at structural boundaries:
   * 1. Find the last `" ("` to split the title from the parenthetical
   * 2. Verify the parenthetical ends with `")"`
   * 3. Within the parenthetical, find `" - "` to split Direction from Explanation
   * 4. Find the first `" - "` separator to split TargetDocID from the remainder
   *
   * The title may contain `" - "` separators (e.g. "3.1 - Scenario Authoring - Prompts & Guardrails"),
   * so parsing extracts the parenthetical from the end first, then parses the DocID prefix
   * from the beginning.
   *
   * @param text - The plain text content of a list item node
   * @returns The parsed entry if the format is valid, or `undefined` if parsing fails
   */
  private parseListItemText(text: string): ParsedReferenceEntry | undefined {
    // Step 1: Find the last " (" to locate the parenthetical portion
    const lastParenOpenIndex: number = text.lastIndexOf(' (');

    if (lastParenOpenIndex < 0) {
      return undefined;
    }

    // Step 2: Verify the text ends with ")"
    if (!text.endsWith(')')) {
      return undefined;
    }

    // Extract the parenthetical content (between " (" and final ")")
    const parentheticalContent: string = text.substring(
      lastParenOpenIndex + 2,
      text.length - 1,
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
    const prefixPortion: string = text.substring(0, lastParenOpenIndex);

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
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(
    message: string,
    range?: PositionRange,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: REFERENCES_SECTION_RULE_ID,
      severity: REFERENCES_SECTION_DIAGNOSTIC_SEVERITY,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
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

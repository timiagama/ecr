/**
 * Inline Reference Rule (ECR104)
 *
 * Detects and validates inline references in document prose as defined
 * in the ECR specification:
 *   - 1#9.5 -- Inline Reference Rules
 *   - 1#10.7 -- InlineReferenceEdge
 *   - 1#6.3 -- Inline References (overview)
 *
 * This rule operates on text node data supplied by the document visitor.
 * The visitor handles AST filtering (code blocks, inline code,
 * HTML, link URLs) and heading context tracking. This rule receives only
 * text nodes that are valid for inline reference detection, along with
 * the current section context.
 *
 * The rule detects `see TargetID` and `per TargetID` forms where:
 *   - The keyword (`see` or `per`) is preceded by a word boundary
 *     (start of string, whitespace, or punctuation such as `(`)
 *   - The keyword's first letter may be capitalised (`see`, `See`, `per`, `Per`)
 *   - TargetID is a DocID, optionally followed by `#` and a section path
 *   - TargetID is maximally matched and terminated by a non-digit/non-dot
 *     character or end of string (a period followed by a non-digit is
 *     treated as punctuation, not part of the TargetID)
 *
 * For each valid inline reference, the rule checks that the TargetID's
 * parent DocID (or the TargetID itself, if it is a DocID) is declared
 * in the References section or is a self-reference to the document's
 * own DocID. Undeclared dependencies produce an error diagnostic.
 *
 * Extracted artefacts:
 *   - {@link InlineReferenceEdge} for each valid inline reference whose
 *     parent DocID is declared or is a self-reference
 */

import type {
  DocID,
  SectionID,
  Diagnostic,
  DiagnosticSeverity,
  InlineReferenceEdge,
  InlineReferenceKind,
  PositionRange,
} from './types.js';
import type { IdentifierGrammar } from './identifier-grammar.js';

// ---------------------------------------------------------------------------
// Rule identifier constant
// ---------------------------------------------------------------------------

/**
 * Canonical rule identifier for the Inline Reference Rule.
 *
 * Referenced as [ECR104] in the ECR specification (1#9.5).
 */
export const INLINE_REFERENCE_RULE_ID: string = 'ECR104';

// ---------------------------------------------------------------------------
// Input types
// ---------------------------------------------------------------------------

/**
 * Data extracted from a single text AST node, provided by the document
 * visitor/traversal layer.
 *
 * The visitor filters out text nodes inside code blocks, inline code,
 * HTML elements, and link URL portions before passing data to this rule.
 * This rule only receives text nodes that are valid candidates for
 * inline reference detection.
 */
export interface TextNodeData {
  /**
   * Plain text content of the text node.
   *
   * @example "Guardrail requirements are enforced per 3.1#2."
   */
  readonly text: string;

  /**
   * Positional range of the text node within the source document.
   * Optional; depends on whether the Markdown parser provides positional metadata.
   */
  readonly range?: PositionRange;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * The complete result produced by finalising the Inline Reference Rule
 * after all text nodes have been evaluated.
 *
 * Contains zero or more diagnostics and the list of successfully extracted
 * inline reference edges.
 */
export interface InlineReferenceRuleResult {
  /** Diagnostics emitted during evaluation (errors for undeclared references). */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Inline reference edges extracted from valid `see`/`per` forms,
   * in document traversal order.
   *
   * Each edge represents a section-attributed relationship from the
   * current section context to the referenced TargetID.
   */
  readonly inlineReferences: readonly InlineReferenceEdge[];
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Configuration options for constructing an {@link InlineReferenceRule} instance.
 */
export interface InlineReferenceRuleOptions {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   * Attached to all emitted diagnostics.
   */
  readonly uri: string;

  /**
   * The DocID established by the Document Identity Rule for this document.
   * Used for self-reference detection: an inline reference whose target
   * DocID (the TargetID itself, or the text before its `#`) equals this
   * DocID needs no declaration in the References section.
   */
  readonly docId: DocID;

  /**
   * The {@link IdentifierGrammar} instance used for TargetID validation.
   */
  readonly grammar: IdentifierGrammar;

  /**
   * The set of DocIDs declared in the References section (the References Section Rule's output).
   *
   * Used to determine whether an inline reference's parent DocID has been
   * declared. If a TargetID's parent DocID is not in this set and is not
   * a self-reference, an undeclared-reference diagnostic is emitted.
   */
  readonly declaredDocIds: ReadonlySet<DocID>;
}

// ---------------------------------------------------------------------------
// Diagnostic severity constant (module-level)
// ---------------------------------------------------------------------------

/**
 * The severity used for all Inline Reference Rule diagnostics.
 *
 * Per 1#9.5 and 1#9.8, inline references that introduce undeclared
 * document dependencies are structural violations and are reported as errors.
 */
export const INLINE_REFERENCE_DIAGNOSTIC_SEVERITY: DiagnosticSeverity = 'error';

// ---------------------------------------------------------------------------
// Internal match type
// ---------------------------------------------------------------------------

/**
 * Represents a single inline reference match detected within a text node.
 *
 * This is an intermediate type used internally during evaluation. It holds
 * the parsed components of a detected `see`/`per` form before they are
 * validated against the declared References set and assembled into an
 * {@link InlineReferenceEdge}.
 */
export interface DetectedInlineReference {
  /**
   * The keyword form that introduced this inline reference,
   * normalised to lowercase.
   */
  readonly kind: InlineReferenceKind;

  /**
   * The TargetID extracted from the text, maximally matched.
   * A DocID (`8.1`) or a SectionID (`8.1#3.2`).
   */
  readonly targetId: string;
}

// ---------------------------------------------------------------------------
// Inline reference detection pattern (module-level)
// ---------------------------------------------------------------------------

/**
 * Regular expression for detecting inline `see`/`per` references in text.
 *
 * Matches the pattern: (word boundary)(see|per)(whitespace)(TargetID)
 *
 * Word boundary is defined as start of string, whitespace, or punctuation
 * such as `(`. The keyword's first letter may be capitalised. TargetID is
 * maximally matched as a DocID with an optional `#` and section path.
 *
 * A trailing period followed by a non-digit is treated as sentence
 * punctuation, not part of the TargetID. The regex handles this because
 * `\.\d+` requires a digit after the dot — a trailing dot with no
 * following digit is not captured.
 *
 * Capture groups:
 *   1 - The keyword (`See`, `see`, `Per`, `per`)
 *   2 - The TargetID: a DocID, optionally followed by `#` and a section path
 */
const INLINE_REFERENCE_PATTERN: RegExp = /(?:^|[\s(])([Ss]ee|[Pp]er)\s+(\d+(?:\.\d+)*(?:#\d+(?:\.\d+)*)?)/g;

// ---------------------------------------------------------------------------
// Rule class
// ---------------------------------------------------------------------------

/**
 * Detects and validates inline `see` and `per` references in document
 * prose as defined in the ECR specification (1#9.5, 1#10.7).
 *
 * The rule enforces that:
 * - Inline references use the `see TargetID` or `per TargetID` keyword forms
 * - The keyword is preceded by a word boundary (start of string, whitespace,
 *   or punctuation) to prevent false positives from words like "oversee"
 *   or "hyperparameter"
 * - The keyword's first letter may be capitalised (`See`, `Per`); the
 *   `kind` field normalises to lowercase
 * - TargetID conforms to the identifier grammar and is maximally matched
 * - The parent DocID of the TargetID is declared in the References section,
 *   or the TargetID is a self-reference to the document's own DocID
 *
 * For each valid inline reference whose parent DocID is declared (or is a
 * self-reference), the rule extracts an {@link InlineReferenceEdge} with
 * `fromId` set to the section context passed per call and `kind` normalised
 * to lowercase.
 *
 * For undeclared references, the rule emits an error diagnostic and does
 * not extract an edge.
 *
 * Usage:
 * 1. Construct a rule instance with the document URI, established DocID,
 *    grammar instance, and the set of declared DocIDs from the References section.
 * 2. Call {@link evaluateTextNode} for every text node encountered during
 *    AST traversal (after the visitor has filtered out code/inlineCode/HTML/link
 *    URL contexts), passing the current section context.
 * 3. Call {@link finalise} after all text nodes have been evaluated to obtain
 *    the complete result.
 *
 * @example
 * ```ts
 * const grammar = new IdentifierGrammar();
 * const rule = new InlineReferenceRule({
 *   uri: 'file:///doc.md',
 *   docId: '5.1',
 *   grammar,
 *   declaredDocIds: new Set(['3.1', '8.1']),
 * });
 *
 * rule.evaluateTextNode(
 *   { text: 'Guardrail logic per 3.1#2 and retry semantics see 8.1.' },
 *   '5.1#1',
 * );
 *
 * const result: InlineReferenceRuleResult = rule.finalise();
 * // result.inlineReferences has two edges:
 * //   { fromId: '5.1#1', toId: '3.1#2', kind: 'per' }
 * //   { fromId: '5.1#1', toId: '8.1', kind: 'see' }
 * ```
 */
export class InlineReferenceRule {
  /** The opaque, host-provided URI identifying the document being validated. */
  private readonly uri: string;

  /** The established DocID for this document, used for self-reference detection. */
  private readonly docId: DocID;

  /** The grammar instance used for TargetID validation. */
  private readonly grammar: IdentifierGrammar;

  /** The set of DocIDs declared in the References section. */
  private readonly declaredDocIds: ReadonlySet<DocID>;

  /** Diagnostics accumulated during evaluation. */
  private readonly collectedDiagnostics: Diagnostic[];

  /** Inline reference edges extracted from valid forms, in traversal order. */
  private readonly collectedInlineReferences: InlineReferenceEdge[];

  /**
   * Constructs a new Inline Reference Rule evaluator.
   *
   * @param options - Configuration including the document URI, established DocID,
   *                  grammar instance, and declared DocIDs from the References section
   */
  public constructor(options: InlineReferenceRuleOptions) {
    this.uri = options.uri;
    this.docId = options.docId;
    this.grammar = options.grammar;
    this.declaredDocIds = options.declaredDocIds;
    this.collectedDiagnostics = [];
    this.collectedInlineReferences = [];
  }

  /**
   * Evaluates a single text node for inline `see`/`per` references.
   *
   * Scans the text for all occurrences of `see TargetID` or `per TargetID`
   * where the keyword is preceded by a word boundary. For each detected
   * inline reference:
   *
   * 1. Validates that the TargetID conforms to the identifier grammar
   * 2. Determines the parent DocID of the TargetID
   * 3. Checks whether the parent DocID is declared in the References section
   *    or is a self-reference to the document's own DocID
   * 4. If declared or self-referencing, extracts an {@link InlineReferenceEdge}
   *    with `fromId` set to the provided `sectionContext`
   * 5. If undeclared, emits an error diagnostic and does not extract an edge
   *
   * Multiple inline references within a single text node are all independently
   * detected and validated. Duplicate references are not deduplicated (that is
   * a downstream concern).
   *
   * @param textNodeData - Data extracted from a text AST node
   * @param sectionContext - The current heading identifier (DocID or SectionID)
   *                         at the point where this text node appears in the document.
   *                         Used as the `fromId` for any extracted edges.
   */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be DocID (pre-H2) or SectionID (within a section)
  public evaluateTextNode(textNodeData: TextNodeData, sectionContext: DocID | SectionID): void {
    const detectedReferences: readonly DetectedInlineReference[] =
      this.detectInlineReferences(textNodeData.text);

    for (const detectedReference of detectedReferences) {
      // Validate that the TargetID conforms to the identifier grammar. A
      // target may be either a DocID (`8.1`) or a SectionID (`8.1#3`), so both
      // grammars are tried.
      const targetIsDocId: boolean =
        this.grammar.parseDocId(detectedReference.targetId).valid;
      const targetIsSectionId: boolean =
        this.grammar.parseSectionId(detectedReference.targetId).valid;

      if (!targetIsDocId && !targetIsSectionId) {
        // TargetID does not conform to the grammar — skip silently
        // (the regex should only produce valid-grammar IDs, but this
        // is a defensive check)
        continue;
      }

      // Check whether the TargetID's parent DocID is declared or is a self-reference
      const targetIdDeclared: boolean = this.tellTargetIdDeclared(detectedReference.targetId);

      if (!targetIdDeclared) {
        // Emit an error diagnostic for the undeclared reference
        const parentDocId: string = this.showTargetDocId(detectedReference.targetId);
        const diagnostic: Diagnostic = this.createDiagnostic(
          `Inline reference "${detectedReference.kind} ${detectedReference.targetId}" ` +
          `targets undeclared DocID "${parentDocId}". ` +
          `Declare it in the References section.`,
          textNodeData.range,
        );
        this.collectedDiagnostics.push(diagnostic);
        continue;
      }

      // Declared or self-reference — extract the InlineReferenceEdge
      const inlineReferenceEdge: InlineReferenceEdge = {
        fromId: sectionContext,
        toId: detectedReference.targetId,
        kind: detectedReference.kind,
      };
      this.collectedInlineReferences.push(inlineReferenceEdge);
    }
  }

  /**
   * Finalises the rule evaluation and produces the complete result.
   *
   * This method must be called after all text nodes have been supplied
   * via {@link evaluateTextNode}. It returns the accumulated diagnostics
   * and extracted inline reference edges.
   *
   * @returns The complete rule result including all diagnostics and
   *          extracted inline reference edges
   */
  public finalise(): InlineReferenceRuleResult {
    return {
      diagnostics: this.collectedDiagnostics,
      inlineReferences: this.collectedInlineReferences,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Scans a text string for all inline reference matches.
   *
   * Detects all occurrences of `see TargetID` or `per TargetID` where:
   * - The keyword is preceded by a word boundary (start of string, whitespace,
   *   or punctuation such as `(`)
   * - The keyword's first letter may be capitalised (`See`, `Per`)
   * - TargetID is a maximal match of a DocID with an optional `#` and section path
   * - A period followed by a non-digit character terminates the TargetID
   *   (the period is treated as sentence punctuation, not part of the ID)
   *
   * @param text - The plain text content to scan
   * @returns An array of detected inline reference matches, in order of occurrence
   */
  private detectInlineReferences(text: string): readonly DetectedInlineReference[] {
    const detectedMatches: DetectedInlineReference[] = [];

    // Reset the regex lastIndex to ensure stateless scanning
    INLINE_REFERENCE_PATTERN.lastIndex = 0;

    let regexMatch: RegExpExecArray | null = INLINE_REFERENCE_PATTERN.exec(text);

    while (regexMatch !== null) {
      const keywordCapture: string | undefined = regexMatch[1];
      const targetIdCapture: string | undefined = regexMatch[2];

      if (keywordCapture === undefined || targetIdCapture === undefined) {
        regexMatch = INLINE_REFERENCE_PATTERN.exec(text);
        continue;
      }

      const keyword: string = keywordCapture;
      const targetId: string = targetIdCapture;

      const normalisedKind: InlineReferenceKind = keyword.toLowerCase() as InlineReferenceKind;

      const detectedReference: DetectedInlineReference = {
        kind: normalisedKind,
        targetId,
      };
      detectedMatches.push(detectedReference);

      regexMatch = INLINE_REFERENCE_PATTERN.exec(text);
    }

    return detectedMatches;
  }

  /**
   * Determines whether a TargetID's parent DocID is declared in the
   * References section or is a self-reference to the document's own DocID.
   *
   * The target's DocID is read directly — the TargetID itself, or the text
   * before its `#` — and compared exactly with the document's own DocID and
   * the declared set. No prefix matching is involved, so `8.1.3` is not
   * covered by a declaration of `8.1`.
   *
   * @param targetId - The TargetID to check
   * @returns `true` if the TargetID is declared or is a self-reference,
   *          `false` if it is an undeclared reference
   */
  private tellTargetIdDeclared(targetId: string): boolean {
    const targetDocId: string = this.showTargetDocId(targetId);

    // A reference into this document's own sections needs no declaration.
    if (targetDocId === this.docId) {
      return true;
    }

    return this.declaredDocIds.has(targetDocId);
  }

  /**
   * Extracts the DocID a TargetID refers to.
   *
   * This needs no inference: everything before the `#` separator is the
   * DocID, and an identifier with no separator is itself a DocID. The
   * separator removes the ambiguity a dotted-only grammar would have to
   * resolve by guessing.
   *
   * @param targetId - A DocID or SectionID as written in an inline reference
   * @returns The DocID portion of the identifier
   */
  private showTargetDocId(targetId: string): string {
    const separatorIndex: number = targetId.indexOf('#');

    if (separatorIndex < 0) {
      return targetId;
    }

    return targetId.substring(0, separatorIndex);
  }


  /**
   * Creates a diagnostic object for the Inline Reference Rule.
   *
   * All diagnostics share the same rule ID ({@link INLINE_REFERENCE_RULE_ID}),
   * severity (error), and document URI.
   *
   * @param message - Human-readable description of the issue
   * @param range - Optional positional range within the source document
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(message: string, range?: PositionRange): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: INLINE_REFERENCE_RULE_ID,
      severity: INLINE_REFERENCE_DIAGNOSTIC_SEVERITY,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
    };

    return diagnostic;
  }
}

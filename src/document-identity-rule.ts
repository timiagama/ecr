/**
 * Document Identity Rule (ECR101)
 *
 * Validates the document identity constraint defined in the ECR specification:
 *   - 1#9.3 -- Document Identity Rule [ECR101]
 *   - 1#9.8 -- Per-Document Structural Invariants ("Exactly one valid H1 DocID")
 *
 * This rule consumes heading node data from an AST traversal and validates
 * the "exactly one H1 with a valid DocID and title" constraint. It delegates
 * identifier parsing to {@link IdentifierGrammar} and emits {@link Diagnostic}
 * objects for any violations.
 *
 * Work item: ecr-wi3-document-identity-rule
 * Session:   20260220T220013Z_47df9d
 */

import type { DocID, Diagnostic, DiagnosticSeverity, PositionRange } from './types.js';
import type {
  HeadingParseResult,
  SeparatorValidationResult,
} from './identifier-grammar.js';
import { IdentifierGrammar } from './identifier-grammar.js';

// ---------------------------------------------------------------------------
// Rule identifier constant
// ---------------------------------------------------------------------------

/**
 * Canonical rule identifier for the Document Identity Rule.
 *
 * Referenced as [ECR101] in the ECR specification (1#9.3).
 */
export const DOCUMENT_IDENTITY_RULE_ID: string = 'ECR101';

// ---------------------------------------------------------------------------
// Input type
// ---------------------------------------------------------------------------

/**
 * Data extracted from a single heading AST node, provided by the
 * document traversal layer.
 *
 * The rule does not parse Markdown itself; it operates on heading
 * data supplied by the visitor/traversal infrastructure.
 */
export interface HeadingNodeData {
  /** Markdown heading depth (1 for H1, 2 for H2, etc.). */
  readonly depth: number;
  /** Plain text content of the heading node (e.g. `"3.1 - Scenario Authoring"`). */
  readonly text: string;
  /**
   * Positional range of the heading node within the source document.
   * Optional; depends on whether the Markdown parser provides positional metadata.
   */
  readonly range?: PositionRange;
}

// ---------------------------------------------------------------------------
// Result types
// ---------------------------------------------------------------------------

/**
 * Represents the successfully extracted document identity from a valid H1 heading.
 */
export interface DocumentIdentity {
  /** The DocID extracted from the H1 heading. */
  readonly docId: DocID;
  /** The title extracted from the H1 heading (display/diagnostic metadata only). */
  readonly title: string;
  /** Positional range of the H1 heading, when available. */
  readonly range?: PositionRange;
}

/**
 * The complete result produced by finalising the Document Identity Rule
 * after all headings have been evaluated.
 *
 * Contains zero or more diagnostics and, when the rule passes,
 * the extracted document identity.
 */
export interface DocumentIdentityRuleResult {
  /** Diagnostics emitted during evaluation (errors for violations, info/warnings as applicable). */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * The extracted document identity.
   * Present only when exactly one valid H1 heading was found.
   */
  readonly identity?: DocumentIdentity;
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Configuration options for constructing a {@link DocumentIdentityRule} instance.
 */
export interface DocumentIdentityRuleOptions {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   * Attached to all emitted diagnostics.
   */
  readonly uri: string;
  /**
   * The {@link IdentifierGrammar} instance used for DocID parsing
   * and separator validation.
   */
  readonly grammar: IdentifierGrammar;
}

// ---------------------------------------------------------------------------
// Internal collected heading record
// ---------------------------------------------------------------------------

/**
 * Internal record capturing the data from a single H1 heading
 * encountered during evaluation.
 */
interface CollectedH1Heading {
  /** Plain text content of the H1 heading. */
  readonly text: string;
  /** Positional range of the H1 heading, when available. */
  readonly range?: PositionRange;
}

// ---------------------------------------------------------------------------
// Diagnostic severity constant
// ---------------------------------------------------------------------------

/**
 * The severity used for all Document Identity Rule diagnostics.
 *
 * Per 1#9.8, violation of any per-document structural invariant is an ERROR.
 */
const DIAGNOSTIC_SEVERITY: DiagnosticSeverity = 'error';

// ---------------------------------------------------------------------------
// Rule class
// ---------------------------------------------------------------------------

/**
 * Validates the Document Identity Rule as defined in the ECR specification (1#9.3, 1#9.8).
 *
 * The rule enforces that a document contains exactly one H1 heading whose
 * text matches `DocID <dash> Title`, where DocID conforms to the identifier
 * grammar and Title is non-empty.
 *
 * Usage:
 * 1. Construct a rule instance with the document URI and an {@link IdentifierGrammar}.
 * 2. Call {@link evaluateHeading} for every heading node encountered during AST traversal.
 * 3. Call {@link finalise} after all headings have been evaluated to obtain
 *    the complete result including any "missing H1" diagnostics.
 *
 * @example
 * ```ts
 * const grammar = new IdentifierGrammar();
 * const rule = new DocumentIdentityRule({ uri: 'file:///doc.md', grammar });
 *
 * rule.evaluateHeading({ depth: 1, text: '3.1 - My Document', range: someRange });
 * rule.evaluateHeading({ depth: 2, text: '3.1.1 - Section', range: anotherRange });
 *
 * const result: DocumentIdentityRuleResult = rule.finalise();
 * ```
 */
export class DocumentIdentityRule {
  /** The opaque, host-provided URI identifying the document being validated. */
  private readonly uri: string;

  /** The grammar instance used for identifier parsing and separator validation. */
  private readonly grammar: IdentifierGrammar;

  /** All H1 headings encountered during evaluation, in traversal order. */
  private readonly collectedH1Headings: CollectedH1Heading[];

  /**
   * Constructs a new Document Identity Rule evaluator.
   *
   * @param options - Configuration including the document URI and grammar instance
   */
  public constructor(options: DocumentIdentityRuleOptions) {
    this.uri = options.uri;
    this.grammar = options.grammar;
    this.collectedH1Headings = [];
  }

  /**
   * Evaluates a single heading node against the document identity constraint.
   *
   * For H1 headings (depth === 1), the rule records the heading for
   * analysis during {@link finalise}. Headings with depth \> 1 are
   * ignored by this rule.
   *
   * @param headingNodeData - Data extracted from a heading AST node
   */
  public evaluateHeading(headingNodeData: HeadingNodeData): void {
    if (headingNodeData.depth !== 1) {
      return;
    }

    const collectedHeading: CollectedH1Heading = {
      text: headingNodeData.text,
      ...(headingNodeData.range !== undefined ? { range: headingNodeData.range } : {}),
    };

    this.collectedH1Headings.push(collectedHeading);
  }

  /**
   * Finalises the rule evaluation and produces the complete result.
   *
   * This method must be called after all heading nodes have been supplied
   * via {@link evaluateHeading}. It analyses all collected H1 headings
   * and emits appropriate diagnostics:
   *
   * - Zero H1 headings: emits a "missing H1" error diagnostic
   * - Multiple H1 headings: emits a "multiple H1" error diagnostic
   * - Exactly one H1 with invalid separator: emits a separator error diagnostic
   * - Exactly one H1 with invalid format: emits a format error diagnostic
   * - Exactly one valid H1: extracts the document identity
   *
   * @returns The complete rule result including all diagnostics and,
   *          when valid, the extracted document identity
   */
  public finalise(): DocumentIdentityRuleResult {
    const headingCount: number = this.collectedH1Headings.length;

    if (headingCount === 0) {
      return this.buildMissingH1Result();
    }

    if (headingCount > 1) {
      return this.buildMultipleH1Result();
    }

    return this.buildSingleH1Result();
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Builds the result for the case where no H1 headings were found.
   *
   * @returns A rule result containing a "missing H1" error diagnostic
   */
  private buildMissingH1Result(): DocumentIdentityRuleResult {
    const diagnostic: Diagnostic = this.createDiagnostic(
      'Document is missing an H1 heading with a valid DocID.',
    );

    return { diagnostics: [diagnostic] };
  }

  /**
   * Builds the result for the case where multiple H1 headings were found.
   *
   * @returns A rule result containing a "multiple H1" error diagnostic
   */
  private buildMultipleH1Result(): DocumentIdentityRuleResult {
    const firstHeading: CollectedH1Heading | undefined = this.collectedH1Headings[0];

    const headingCount: string = String(this.collectedH1Headings.length);

    const diagnostic: Diagnostic = this.createDiagnostic(
      `Document contains ${headingCount} H1 headings, but exactly one is required.`,
      firstHeading?.range,
    );

    return { diagnostics: [diagnostic] };
  }

  /**
   * Builds the result for the case where exactly one H1 heading was found.
   *
   * Validates the separator and heading format, emitting appropriate
   * diagnostics for violations or extracting the document identity on success.
   *
   * @returns A rule result containing diagnostics and/or the extracted identity
   */
  private buildSingleH1Result(): DocumentIdentityRuleResult {
    const heading: CollectedH1Heading | undefined = this.collectedH1Headings[0];

    if (heading === undefined) {
      return this.buildMissingH1Result();
    }

    const separatorDiagnostic: Diagnostic | undefined =
      this.validateHeadingSeparator(heading);

    if (separatorDiagnostic !== undefined) {
      return { diagnostics: [separatorDiagnostic] };
    }

    const headingParseResult: HeadingParseResult =
      this.grammar.parseHeading(heading.text);

    if (!headingParseResult.valid) {
      const formatDiagnostic: Diagnostic = this.createDiagnostic(
        `H1 heading does not match the required format: DocID <dash> Title.`,
        heading.range,
      );

      return { diagnostics: [formatDiagnostic] };
    }

    const identity: DocumentIdentity = {
      docId: headingParseResult.docId,
      title: headingParseResult.title,
      ...(heading.range !== undefined ? { range: heading.range } : {}),
    };

    return { diagnostics: [], identity };
  }

  /**
   * Validates the separator used in an H1 heading.
   *
   * Delegates to {@link IdentifierGrammar.validateSeparator} and, when an
   * invalid separator is detected, returns an error diagnostic describing
   * the violation.
   *
   * @param heading - The collected H1 heading to validate
   * @returns A diagnostic if the separator is invalid, or `undefined` if valid
   */
  private validateHeadingSeparator(
    heading: CollectedH1Heading,
  ): Diagnostic | undefined {
    const separatorResult: SeparatorValidationResult =
      this.grammar.validateSeparator(heading.text);

    if (separatorResult.valid) {
      return undefined;
    }


    const diagnostic: Diagnostic = this.createDiagnostic(
      `H1 heading has no recognisable separator. ` +
      `Expected: a number, a dash (-, – or —), then the title.`,
      heading.range,
    );

    return diagnostic;
  }


  /**
   * Creates a diagnostic object for the Document Identity Rule.
   *
   * All diagnostics share the same rule ID ({@link DOCUMENT_IDENTITY_RULE_ID}),
   * severity (error), and document URI.
   *
   * @param message - Human-readable description of the issue
   * @param range - Optional positional range of the heading within the source document
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(
    message: string,
    range?: PositionRange,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: DOCUMENT_IDENTITY_RULE_ID,
      severity: DIAGNOSTIC_SEVERITY,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
    };

    return diagnostic;
  }
}

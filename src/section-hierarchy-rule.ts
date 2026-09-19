/**
 * Section Hierarchy Rule (ECR102)
 *
 * Validates the section structure constraint defined in the ECR specification:
 *   - 1#9.4 -- Section Structure Rules
 *   - 1#9.8 -- Per-Document Structural Invariants ("SectionIDs unique within document")
 *
 * This rule consumes heading node data from an AST traversal and validates
 * the section hierarchy for headings with depth \>= 2. It delegates identifier
 * parsing and segment-count logic to {@link IdentifierGrammar} and emits
 * {@link Diagnostic} objects for any violations.
 *
 * Validations performed:
 *   1. A separator (any dash variant) must follow the identifier
 *   2. Heading text prefix must parse as a valid SectionID
 *   3. The SectionID's DocID must equal the document's DocID
 *   4. The section path must have d - 1 segments, where d = heading depth
 *   5. SectionIDs must be unique within the document (no duplicates)
 *   6. Heading levels must not be skipped (e.g., H3 directly after H1 is invalid)
 *
 * Extracted artefacts:
 *   - {@link SectionNode} for each valid heading, with parentId derived from the heading stack
 */

import type { DocID, SectionID, Diagnostic, DiagnosticSeverity, PositionRange, SectionNode } from './types.js';
import type {
  SectionIdParseResult,
  SeparatorValidationResult,
} from './identifier-grammar.js';
import { IdentifierGrammar } from './identifier-grammar.js';
import type { HeadingNodeData } from './document-identity-rule.js';

// ---------------------------------------------------------------------------
// Rule identifier constant
// ---------------------------------------------------------------------------

/**
 * Canonical rule identifier for the Section Hierarchy Rule.
 *
 * Referenced as [ECR102] in the ECR specification (1#9.4).
 */
export const SECTION_HIERARCHY_RULE_ID: string = 'ECR102';

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Configuration options for constructing a {@link SectionHierarchyRule} instance.
 */
export interface SectionHierarchyRuleOptions {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   * Attached to all emitted diagnostics.
   */
  readonly uri: string;

  /**
   * The DocID established by the {@link DocumentIdentityRule} for this document.
   * Used as the required prefix for all SectionIDs and to compute expected segment counts.
   */
  readonly docId: DocID;

  /**
   * The {@link IdentifierGrammar} instance used for SectionID parsing,
   * prefix validation, segment counting, and separator validation.
   */
  readonly grammar: IdentifierGrammar;
}

// ---------------------------------------------------------------------------
// Result type
// ---------------------------------------------------------------------------

/**
 * The complete result produced by finalising the Section Hierarchy Rule
 * after all headings have been evaluated.
 *
 * Contains zero or more diagnostics and the list of successfully extracted
 * section nodes, including the root H1 node.
 */
export interface SectionHierarchyRuleResult {
  /** Diagnostics emitted during evaluation (errors for violations). */
  readonly diagnostics: readonly Diagnostic[];

  /**
   * Section nodes extracted from valid headings, in document traversal order.
   *
   * Includes the root H1 node (whose id is the DocID and has no parentId)
   * and all valid sub-heading nodes with their derived parentId.
   */
  readonly sections: readonly SectionNode[];
}

// ---------------------------------------------------------------------------
// Internal heading stack entry
// ---------------------------------------------------------------------------

/**
 * Internal record tracking a heading in the depth-aware heading stack.
 *
 * The heading stack enables correct parent-child derivation across
 * heading depth transitions. Each entry records the identifier and
 * depth of a heading that may serve as the parent of subsequent
 * deeper headings.
 */
interface HeadingStackEntry {
  /** The DocID (for H1) or SectionID (for depth \>= 2) of this heading. */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: DocID for H1, SectionID for depth >= 2
  readonly id: DocID | SectionID;

  /** The Markdown heading depth (1 for H1, 2 for H2, etc.). */
  readonly depth: number;
}

// ---------------------------------------------------------------------------
// Diagnostic severity constant
// ---------------------------------------------------------------------------

/**
 * The severity used for all Section Hierarchy Rule diagnostics.
 *
 * Per 1#9.8, violation of any per-document structural invariant is an ERROR.
 */
const SECTION_HIERARCHY_DIAGNOSTIC_SEVERITY: DiagnosticSeverity = 'error';

// ---------------------------------------------------------------------------
// Separator pattern
// ---------------------------------------------------------------------------

/**
 * Matches the separator between a SectionID and its title: a dash with any
 * surrounding whitespace.
 *
 * The dash may be a hyphen-minus (U+002D), an en dash (U+2013) or an em dash
 * (U+2014); the variant carries no structural meaning.
 */
const SECTION_SEPARATOR_PATTERN: RegExp = /\s*[-–—]\s*/;

// ---------------------------------------------------------------------------
// Rule class
// ---------------------------------------------------------------------------

/**
 * Validates the Section Hierarchy Rule as defined in the ECR specification (1#9.4, 1#9.8).
 *
 * The rule enforces that every heading with depth \>= 2 has a valid SectionID
 * whose DocID is the document's own, carries a separator, has a section path of
 * one segment per heading level below the H1, and is unique within the document.
 *
 * For each valid heading, the rule extracts a {@link SectionNode} with its
 * parentId derived from the heading stack (the nearest preceding heading at
 * depth - 1).
 *
 * The root H1 heading is registered via {@link registerRootHeading} to establish
 * the heading stack base and produce the root {@link SectionNode}.
 *
 * Usage:
 * 1. Construct a rule instance with the document URI, established DocID,
 *    and an {@link IdentifierGrammar}.
 * 2. Call {@link registerRootHeading} once with the H1 heading data to
 *    establish the root of the heading stack.
 * 3. Call {@link evaluateHeading} for every heading node with depth \>= 2
 *    encountered during AST traversal.
 * 4. Call {@link finalise} after all headings have been evaluated to obtain
 *    the complete result.
 *
 * @example
 * ```ts
 * const grammar = new IdentifierGrammar();
 * const rule = new SectionHierarchyRule({
 *   uri: 'file:///doc.md',
 *   docId: '3.1',
 *   grammar,
 * });
 *
 * rule.registerRootHeading({ depth: 1, text: '3.1 - My Document' });
 * rule.evaluateHeading({ depth: 2, text: '3.1#1 - Section One' });
 * rule.evaluateHeading({ depth: 3, text: '3.1#1.1 - Sub-Section' });
 * rule.evaluateHeading({ depth: 2, text: '3.1#2 - Section Two' });
 *
 * const result: SectionHierarchyRuleResult = rule.finalise();
 * ```
 */
export class SectionHierarchyRule {
  /** The opaque, host-provided URI identifying the document being validated. */
  private readonly uri: string;

  /** The established DocID for this document. */
  private readonly docId: DocID;

  /** The grammar instance used for SectionID parsing and validation. */
  private readonly grammar: IdentifierGrammar;

  /** Diagnostics accumulated during heading evaluation. */
  private readonly collectedDiagnostics: Diagnostic[];

  /** Section nodes extracted from valid headings, in traversal order. */
  private readonly collectedSections: SectionNode[];

  /**
   * Depth-aware heading stack for parent-child derivation.
   *
   * Maintained so that each entry's depth is strictly increasing from
   * bottom to top. When a heading at depth d is encountered, all entries
   * with depth \>= d are popped before the new entry is pushed.
   */
  private readonly headingStack: HeadingStackEntry[];

  /**
   * Set of SectionIDs already encountered, for duplicate detection.
   */
  private readonly encounteredSectionIds: Set<SectionID>;

  /**
   * Constructs a new Section Hierarchy Rule evaluator.
   *
   * @param options - Configuration including the document URI, established DocID,
   *                  and grammar instance
   */
  public constructor(options: SectionHierarchyRuleOptions) {
    this.uri = options.uri;
    this.docId = options.docId;
    this.grammar = options.grammar;
    this.collectedDiagnostics = [];
    this.collectedSections = [];
    this.headingStack = [];
    this.encounteredSectionIds = new Set<SectionID>();
  }

  /**
   * Registers the root H1 heading to establish the heading stack base.
   *
   * This produces the root {@link SectionNode} (id = DocID, headingDepth = 1,
   * no parentId) and pushes the H1 onto the heading stack so that subsequent
   * depth-2 headings can derive their parentId.
   *
   * Must be called exactly once, before any calls to {@link evaluateHeading}.
   *
   * @param headingNodeData - Data extracted from the H1 heading AST node.
   *                          The depth must be 1. The title text is extracted
   *                          from the heading content after the separator.
   */
  public registerRootHeading(headingNodeData: HeadingNodeData): void {
    const title: string = this.extractHeadingTitle(headingNodeData.text);

    const rootSection: SectionNode = {
      id: this.docId,
      title,
      headingDepth: 1,
    };

    this.collectedSections.push(rootSection);
    this.updateHeadingStack(this.docId, 1);
  }

  /**
   * Evaluates a single heading node with depth \>= 2 against the section
   * hierarchy constraints.
   *
   * For each heading, the method validates:
   * 1. A separator (any dash variant) follows the identifier
   * 2. The textual prefix parses as a valid SectionID
   * 3. The SectionID's DocID equals the document's DocID
   * 4. The section path has d - 1 segments, where d is the heading depth
   * 5. The SectionID has not been seen before in this document
   * 6. No heading levels are skipped (depth must not exceed parent depth + 1)
   *
   * When all validations pass, a {@link SectionNode} is extracted with its
   * parentId derived from the heading stack (the nearest preceding heading
   * at depth - 1), and the heading stack is updated.
   *
   * When any validation fails, an error diagnostic is emitted and the heading
   * stack is still updated to maintain correct parent derivation for
   * subsequent headings.
   *
   * Headings with depth === 1 are ignored (H1 is handled by
   * {@link registerRootHeading}).
   *
   * @param headingNodeData - Data extracted from a heading AST node with depth \>= 2
   */
  public evaluateHeading(headingNodeData: HeadingNodeData): void {
    if (headingNodeData.depth === 1) {
      return;
    }

    const headingText: string = headingNodeData.text;
    const depth: number = headingNodeData.depth;
    const range: PositionRange | undefined = headingNodeData.range;

    // 1. Validate separator
    const separatorDiagnostic: Diagnostic | undefined =
      this.validateHeadingSeparator(headingText, range);

    if (separatorDiagnostic !== undefined) {
      this.collectedDiagnostics.push(separatorDiagnostic);
      return;
    }

    // 2. Extract SectionID candidate from prefix
    const candidate: string = this.extractSectionIdCandidate(headingText);

    // 3. Parse candidate as SectionID
    const parseResult: SectionIdParseResult = this.grammar.parseSectionId(candidate);

    if (!parseResult.valid) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `Heading prefix "${candidate}" does not parse as a valid SectionID.`,
        range,
      );
      this.collectedDiagnostics.push(diagnostic);
      return;
    }

    const sectionId: SectionID = parseResult.sectionId;

    // 4. Verify SectionID extends DocID
    const extendsDocId: boolean = this.grammar.tellSectionIdExtendsDocId(
      sectionId,
      this.docId,
    );

    if (!extendsDocId) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `SectionID "${sectionId}" belongs to a different document. ` +
        `Headings in this document must be written as "${this.docId}#<section path>".`,
        range,
        sectionId,
      );
      this.collectedDiagnostics.push(diagnostic);
      this.updateHeadingStack(sectionId, depth);
      return;
    }

    // 5. Verify the section path has one segment per heading level below the H1
    const actualPathLength: number = this.grammar.showSectionPathLength(sectionId);
    const expectedPathLength: number = this.grammar.showExpectedSectionPathLength(depth);

    if (actualPathLength !== expectedPathLength) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `SectionID "${sectionId}" has a section path of ${String(actualPathLength)} ` +
        `segment(s), but heading depth ${String(depth)} requires ` +
        `${String(expectedPathLength)}.`,
        range,
        sectionId,
      );
      this.collectedDiagnostics.push(diagnostic);
      this.updateHeadingStack(sectionId, depth);
      return;
    }

    // 6. Check for duplicate SectionIDs
    if (this.encounteredSectionIds.has(sectionId)) {
      const diagnostic: Diagnostic = this.createDiagnostic(
        `Duplicate SectionID "${sectionId}". SectionIDs must be unique within a document.`,
        range,
        sectionId,
      );
      this.collectedDiagnostics.push(diagnostic);
      this.updateHeadingStack(sectionId, depth);
      return;
    }

    // 7. Check for skipped heading levels
    const currentTopDepth: number = this.peekHeadingStackDepth();

    if (depth > currentTopDepth + 1) {
      const skippedFrom: number = currentTopDepth;
      const diagnostic: Diagnostic = this.createDiagnostic(
        `Heading depth ${String(depth)} skips level(s) after depth ${String(skippedFrom)}. ` +
        `Each heading level must be introduced before its children.`,
        range,
        sectionId,
      );
      this.collectedDiagnostics.push(diagnostic);
      this.updateHeadingStack(sectionId, depth);
      return;
    }

    // All validations passed — extract SectionNode
    this.encounteredSectionIds.add(sectionId);

    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: parent may be DocID or SectionID
    const parentId: DocID | SectionID | undefined = this.lookUpParentId(depth);
    const title: string = this.extractHeadingTitle(headingText);

    const sectionNode: SectionNode = {
      id: sectionId,
      title,
      headingDepth: depth,
      ...(parentId !== undefined ? { parentId } : {}),
    };

    this.collectedSections.push(sectionNode);
    this.updateHeadingStack(sectionId, depth);
  }

  /**
   * Finalises the rule evaluation and produces the complete result.
   *
   * This method must be called after all heading nodes have been supplied
   * via {@link registerRootHeading} and {@link evaluateHeading}. It returns
   * all accumulated diagnostics and extracted section nodes.
   *
   * @returns The complete rule result including all diagnostics and extracted sections
   */
  public finalise(): SectionHierarchyRuleResult {
    return {
      diagnostics: this.collectedDiagnostics,
      sections: this.collectedSections,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  /**
   * Validates that a heading string carries a separator, and returns an
   * error diagnostic when none is found.
   *
   * Delegates to {@link IdentifierGrammar.validateSeparator}.
   *
   * @param headingText - The plain text content of the heading node
   * @param range - Optional positional range for the diagnostic
   * @returns A diagnostic if the separator is invalid, or `undefined` if valid
   */
  private validateHeadingSeparator(
    headingText: string,
    range?: PositionRange,
  ): Diagnostic | undefined {
    const separatorResult: SeparatorValidationResult =
      this.grammar.validateSeparator(headingText);

    if (separatorResult.valid) {
      return undefined;
    }


    const diagnostic: Diagnostic = this.createDiagnostic(
      `Heading has no recognisable separator. ` +
      `Expected: a number, a dash (-, – or —), then the title.`,
      range,
    );

    return diagnostic;
  }

  /**
   * Extracts the SectionID candidate string from a heading's text.
   *
   * The candidate is the portion of the heading text before the first
   * occurrence of a separator (any dash variant). If no separator
   * is found, the entire trimmed text is returned as the candidate.
   *
   * @param headingText - The plain text content of the heading node
   * @returns The SectionID candidate string
   */
  private extractSectionIdCandidate(headingText: string): string {
    const match: RegExpExecArray | null = SECTION_SEPARATOR_PATTERN.exec(headingText);

    if (match === null) {
      return headingText.trim();
    }

    return headingText.substring(0, match.index).trim();
  }

  /**
   * Extracts the title text from a heading's text.
   *
   * The title is the portion of the heading text after the first
   * occurrence of a separator (any dash variant). If no separator
   * is found, an empty string is returned.
   *
   * @param headingText - The plain text content of the heading node
   * @returns The extracted title string
   */
  private extractHeadingTitle(headingText: string): string {
    const match: RegExpExecArray | null = SECTION_SEPARATOR_PATTERN.exec(headingText);

    if (match === null) {
      return '';
    }

    return headingText.substring(match.index + match[0].length);
  }

  /**
   * Looks up the parent identifier from the heading stack for a heading
   * at the given depth.
   *
   * The parent is the nearest preceding heading whose depth is exactly
   * `headingDepth - 1`. Returns `undefined` if no such heading exists
   * in the stack (which should not happen for well-formed documents
   * after the root H1 is registered).
   *
   * @param headingDepth - The depth of the heading whose parent is sought
   * @returns The parent's identifier, or `undefined` if not found
   */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: parent may be DocID or SectionID
  private lookUpParentId(headingDepth: number): DocID | SectionID | undefined {
    const targetDepth: number = headingDepth - 1;

    for (let index: number = this.headingStack.length - 1; index >= 0; index--) {
      const entry: HeadingStackEntry | undefined = this.headingStack[index];

      if (entry?.depth === targetDepth) {
        return entry.id;
      }
    }

    return undefined;
  }

  /**
   * Returns the depth of the topmost entry on the heading stack.
   *
   * Used to detect skipped heading levels: if the incoming heading depth
   * exceeds the top-of-stack depth by more than 1, an intermediate heading
   * level has been skipped.
   *
   * Returns 0 if the heading stack is empty (should not occur after
   * {@link registerRootHeading} has been called).
   *
   * @returns The depth of the topmost heading stack entry, or 0 if empty
   */
  private peekHeadingStackDepth(): number {
    if (this.headingStack.length === 0) {
      return 0;
    }

    const topEntry: HeadingStackEntry | undefined =
      this.headingStack[this.headingStack.length - 1];

    return topEntry?.depth ?? 0;
  }

  /**
   * Updates the heading stack when a new heading is encountered.
   *
   * All entries with depth \>= the new heading's depth are removed,
   * then the new heading is pushed. This ensures the stack always
   * reflects the current structural nesting.
   *
   * @param id - The DocID or SectionID of the heading
   * @param depth - The Markdown heading depth
   */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: id may be DocID or SectionID
  private updateHeadingStack(id: DocID | SectionID, depth: number): void {
    while (this.headingStack.length > 0) {
      const topEntry: HeadingStackEntry | undefined =
        this.headingStack[this.headingStack.length - 1];

      if (topEntry === undefined || topEntry.depth < depth) {
        break;
      }

      this.headingStack.pop();
    }

    this.headingStack.push({ id, depth });
  }


  /**
   * Creates a diagnostic object for the Section Hierarchy Rule.
   *
   * All diagnostics share the same rule ID ({@link SECTION_HIERARCHY_RULE_ID}),
   * severity (error), and document URI.
   *
   * @param message - Human-readable description of the issue
   * @param range - Optional positional range of the heading within the source document
   * @param sectionId - Optional SectionID providing structural context
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(
    message: string,
    range?: PositionRange,
    sectionId?: SectionID,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: SECTION_HIERARCHY_RULE_ID,
      severity: SECTION_HIERARCHY_DIAGNOSTIC_SEVERITY,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
      ...(sectionId !== undefined ? { sectionId } : {}),
    };

    return diagnostic;
  }
}

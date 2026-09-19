/**
 * Per-Document Visitor
 *
 * Orchestrates all four ECR rules (ECR101--ECR104) over a single Markdown
 * document, producing a composite {@link LintResult}.
 *
 * This is the integration layer that:
 *   1. Parses Markdown text into an AST using `unified` + `remark-parse`
 *   2. Walks the AST and dispatches nodes to the appropriate rules
 *   3. Manages the rule initialisation dependency chain:
 *      - ECR101 must complete before ECR102/ECR103 can start
 *      - ECR103 must complete before ECR104 can start (to provide declared DocIDs)
 *      - If ECR101 fails, downstream rules are skipped entirely
 *   4. Filters text nodes: excludes those inside `code`, `inlineCode`, `html`,
 *      or link URL contexts before feeding to ECR104
 *   5. Tracks the current section context (heading identifier) for ECR104
 *   6. Feeds list items within the References section to ECR103
 *   7. Finalises all rules and assembles the composite {@link LintResult}
 *
 * Spec references:
 *   - 1#8   -- Visitor and State Model
 *   - 1#11.1 -- Pass 1: Per-Document Parse, Validate, Extract
 *   - 1#9.3 -- Document Identity Rule [ECR101]
 *   - 1#9.4 -- Section Structure Rules [ECR102]
 *   - 1#9.5 -- Inline Reference Rules [ECR104]
 *   - 1#9.6 -- References Section Rules [ECR103]
 *   - 1#10.2 -- LintResult
 *   - 1#10.4 -- ExtractedDocument
 */

// ---------------------------------------------------------------------------
// Runtime imports (value imports for classes and functions)
// ---------------------------------------------------------------------------

import { unified } from 'unified';
import remarkParse from 'remark-parse';
import { toString } from 'mdast-util-to-string';

// ---------------------------------------------------------------------------
// Type-only imports (verbatimModuleSyntax requires `import type`)
// ---------------------------------------------------------------------------

import type {
  DocID,
  SectionID,
  Diagnostic,
  PositionRange,
  LintInput,
  LintResult,
  ExtractedDocument,
  SectionNode,
  ReferenceEdge,
  InlineReferenceEdge,
} from './types.js';

import type {
  DocumentIdentityRuleResult,
  DocumentIdentity,
  HeadingNodeData,
} from './document-identity-rule.js';

import type {
  SectionHierarchyRuleResult,
} from './section-hierarchy-rule.js';

import type {
  ReferencesSectionRuleResult,
  ListItemNodeData,
} from './references-section-rule.js';

import type {
  InlineReferenceRuleResult,
  TextNodeData,
} from './inline-reference-rule.js';

// ---------------------------------------------------------------------------
// Value imports for rule classes and grammar
// ---------------------------------------------------------------------------

import { DocumentIdentityRule } from './document-identity-rule.js';
import { SectionHierarchyRule } from './section-hierarchy-rule.js';
import { ReferencesSectionRule } from './references-section-rule.js';
import { InlineReferenceRule } from './inline-reference-rule.js';
import { IdentifierGrammar } from './identifier-grammar.js';

// ---------------------------------------------------------------------------
// Local MDAST node type definitions
// ---------------------------------------------------------------------------

/**
 * Generic MDAST node shape.
 *
 * Locally defined to avoid importing from `mdast` or `unist`, which are
 * not directly resolvable as module specifiers in this project. The shapes
 * match the runtime objects produced by `remark-parse`.
 */
interface MdastNode {
  /** The node type string (e.g., `'heading'`, `'text'`, `'root'`). */
  readonly type: string;
  /** Child nodes, present on parent node types. */
  readonly children?: readonly MdastNode[];
  /** Heading depth (1--6), present only on heading nodes. */
  readonly depth?: number;
  /** Text value, present only on literal nodes (e.g., `text`, `code`). */
  readonly value?: string;
  /** Positional metadata from the source document. */
  readonly position?: MdastPosition;
}

/**
 * MDAST Root node shape.
 *
 * The root node is the top-level container returned by `remark-parse`.
 * It always has `type: 'root'` and a `children` array.
 */
interface MdastRoot {
  /** Discriminant: always `'root'`. */
  readonly type: 'root';
  /** The root's child nodes in document order. */
  readonly children: readonly MdastNode[];
}

// ---------------------------------------------------------------------------
// Constructor options
// ---------------------------------------------------------------------------

/**
 * Configuration options for constructing a {@link PerDocumentVisitor} instance.
 */
export interface PerDocumentVisitorOptions {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   *
   * Passed through to all rules and echoed in the {@link LintResult.input} field.
   */
  readonly uri: string;

  /**
   * Optional version tag for the document instance.
   *
   * Passed through to the {@link LintResult.input} field. When omitted, the
   * resulting {@link LintInput.version} will be `undefined`.
   */
  readonly version?: number;
}

// ---------------------------------------------------------------------------
// Internal result types for multi-pass orchestration
// ---------------------------------------------------------------------------

/**
 * Intermediate result from the headings pass (ECR101 + ECR102 + ECR103 heading detection).
 *
 * Produced by the first traversal of the AST, which feeds heading nodes
 * to ECR101, ECR102, and ECR103, and list items within the References
 * section to ECR103.
 */
interface HeadingsAndReferencesPassResult {
  /** The identity result from ECR101. */
  readonly identityResult: DocumentIdentityRuleResult;

  /**
   * The section hierarchy result from ECR102.
   * Present only when ECR101 produced a valid DocID.
   */
  readonly sectionsResult?: SectionHierarchyRuleResult;

  /**
   * The references section result from ECR103.
   * Present only when ECR101 produced a valid DocID.
   */
  readonly referencesResult?: ReferencesSectionRuleResult;
}

/**
 * Intermediate result from the inline references pass (ECR104).
 *
 * Produced by the second traversal of the AST, which feeds filtered
 * text nodes to ECR104 with section context tracking.
 */
interface InlineReferencesPassResult {
  /** The inline reference result from ECR104. */
  readonly inlineResult: InlineReferenceRuleResult;
}

// ---------------------------------------------------------------------------
// Excluded ancestor node types for ECR104 filtering
// ---------------------------------------------------------------------------

/**
 * MDAST node types whose descendant text nodes must be excluded from
 * ECR104 inline reference detection.
 *
 * Per 1#9.5, text nodes inside code blocks, inline code, and HTML
 * elements are not valid candidates for inline reference detection.
 */
export const EXCLUDED_ANCESTOR_NODE_TYPES: ReadonlySet<string> = new Set([
  'code',
  'inlineCode',
  'html',
]);

// ---------------------------------------------------------------------------
// MDAST position type
// ---------------------------------------------------------------------------

/**
 * Shape of an MDAST position object with 1-based line and column numbers.
 */
interface MdastPosition {
  /** Start position with 1-based line and column. */
  readonly start: { readonly line: number; readonly column: number };
  /** End position with 1-based line and column. */
  readonly end: { readonly line: number; readonly column: number };
}

/**
 * Mutable wrapper that tracks the current section context identifier
 * during the ECR104 inline references pass.
 *
 * The `current` field holds a {@link DocID} before any H2 heading is
 * encountered, and a {@link SectionID} after a numbered heading is
 * processed.
 */
interface SectionContextTracker {
  /** The currently active section identifier (DocID or SectionID). */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be DocID or SectionID
  current: DocID | SectionID;
}

// ---------------------------------------------------------------------------
// Per-Document Visitor class
// ---------------------------------------------------------------------------

/**
 * Orchestrates all four ECR rules (ECR101--ECR104) over a single Markdown
 * document and produces a composite {@link LintResult}.
 *
 * The visitor is stateless between calls to {@link lint}. Each invocation
 * produces a fresh result with no side effects on the visitor instance.
 *
 * The visitor creates its own {@link IdentifierGrammar} instance internally
 * and manages the rule initialisation dependency chain:
 * - ECR101 (Document Identity) runs first on all headings
 * - If ECR101 produces a valid DocID, ECR102 (Section Hierarchy) and
 *   ECR103 (References Section) are initialised and fed their respective nodes
 * - After ECR103 finalises, the set of declared DocIDs is extracted and
 *   used to initialise ECR104 (Inline Reference)
 * - If ECR101 fails (no valid DocID), the result is returned early with
 *   `ok=false` and no `extracted` field
 *
 * Usage:
 * ```ts
 * const visitor = new PerDocumentVisitor({
 *   uri: 'file:///docs/3.1.md',
 *   version: 1,
 * });
 *
 * const result: LintResult = visitor.lint('# 3.1 - My Document\n\n## References\n- 8.1 - ...');
 * ```
 *
 * @example
 * ```ts
 * const visitor = new PerDocumentVisitor({ uri: 'file:///docs/5.1.md' });
 * const result: LintResult = visitor.lint(markdownText);
 *
 * if (result.ok) {
 *   console.log('Document is valid:', result.extracted?.docId);
 * } else {
 *   console.log('Diagnostics:', result.diagnostics);
 * }
 * ```
 */
export class PerDocumentVisitor {
  /**
   * The opaque, host-provided URI identifying the document being validated.
   */
  private readonly uri: string;

  /**
   * Optional version tag for the document instance.
   */
  private readonly version: number | undefined;

  /**
   * The {@link IdentifierGrammar} instance shared across all rules
   * within a single visitor. Created once during construction.
   */
  private readonly grammar: IdentifierGrammar;

  /**
   * Constructs a new Per-Document Visitor.
   *
   * Creates an internal {@link IdentifierGrammar} instance for use
   * across all rule evaluations performed by this visitor.
   *
   * @param options - Configuration including the document URI and optional version
   */
  public constructor(options: PerDocumentVisitorOptions) {
    this.uri = options.uri;
    this.version = options.version;
    this.grammar = new IdentifierGrammar();
  }

  /**
   * Lints a single Markdown document and produces a composite {@link LintResult}.
   *
   * Each call is stateless: the visitor creates fresh rule instances,
   * parses the Markdown text into an AST, walks the AST to feed nodes
   * to the appropriate rules, finalises all rules, and assembles the result.
   *
   * The orchestration proceeds in phases:
   * 1. Parse the Markdown text into an MDAST {@link MdastRoot} node
   * 2. First pass: walk headings and list items for ECR101, ECR102, ECR103
   * 3. If ECR101 fails (no valid DocID), return early with `ok=false`
   * 4. Second pass: walk text nodes for ECR104 (with ancestor filtering
   *    and section context tracking)
   * 5. Assemble the composite {@link LintResult} from all rule results
   *
   * @param markdownText - The raw Markdown text of the document to lint
   * @returns The composite lint result including diagnostics and, when a valid
   *          DocID is recovered, extracted structural artefacts
   */
  public lint(markdownText: string): LintResult {
    const root: MdastRoot = this.parseMarkdown(markdownText);
    const passOneResult: HeadingsAndReferencesPassResult =
      this.executeHeadingsAndReferencesPass(root);

    // If ECR101 failed (no valid identity), return early
    if (passOneResult.identityResult.identity === undefined) {
      return this.assembleLintResult(
        passOneResult.identityResult,
        undefined,
        undefined,
        undefined,
      );
    }

    // ECR101 succeeded -- extract declaredDocIds from ECR103
    const referencesResult: ReferencesSectionRuleResult | undefined =
      passOneResult.referencesResult;

    const referencesForExtraction: readonly ReferenceEdge[] =
      referencesResult !== undefined ? referencesResult.references : [];

    const declaredDocIds: ReadonlySet<DocID> =
      this.extractDeclaredDocIds(referencesForExtraction);

    // Run ECR104
    const inlineResult: InlineReferencesPassResult =
      this.executeInlineReferencesPass(
        root,
        passOneResult.identityResult.identity.docId,
        declaredDocIds,
      );

    return this.assembleLintResult(
      passOneResult.identityResult,
      passOneResult.sectionsResult,
      passOneResult.referencesResult,
      inlineResult.inlineResult,
    );
  }

  // -------------------------------------------------------------------------
  // Private: Markdown parsing
  // -------------------------------------------------------------------------

  /**
   * Parses raw Markdown text into an MDAST {@link MdastRoot} node.
   *
   * Uses `unified` with `remark-parse` to produce a standards-compliant
   * MDAST tree with positional metadata attached to all nodes.
   *
   * The `unified().use(remarkParse).parse()` call returns a type that
   * cannot be directly assigned to our local {@link MdastRoot} interface
   * because `mdast` types are not importable as a module specifier in this
   * project. The cast via `unknown` is safe because `remark-parse` always
   * produces an MDAST Root node at runtime.
   *
   * @param markdownText - The raw Markdown text to parse
   * @returns The parsed MDAST root node
   */
  private parseMarkdown(markdownText: string): MdastRoot {
    const root: MdastRoot = unified()
      .use(remarkParse)
      .parse(markdownText) as unknown as MdastRoot;
    return root;
  }

  // -------------------------------------------------------------------------
  // Private: First pass -- headings, sections, and references
  // -------------------------------------------------------------------------

  /**
   * Executes the first AST traversal pass: headings, sections, and references.
   *
   * This pass walks the AST in document order and:
   * - Feeds every heading node to ECR101 (`DocumentIdentityRule.evaluateHeading`)
   * - Finalises ECR101 to determine whether a valid DocID was recovered
   * - If a valid DocID is recovered:
   *   - Registers the root H1 heading with ECR102
   *     (`SectionHierarchyRule.registerRootHeading`)
   *   - Feeds headings with depth \>= 2 to ECR102
   *     (`SectionHierarchyRule.evaluateHeading`)
   *   - Feeds all headings to ECR103
   *     (`ReferencesSectionRule.evaluateHeading`)
   *   - Feeds list items within the References section to ECR103
   *     (`ReferencesSectionRule.evaluateListItem`)
   *   - Finalises ECR102 and ECR103
   * - If no valid DocID is recovered, ECR102 and ECR103 are skipped
   *
   * The pass is structured so that all heading nodes are collected first
   * for ECR101, then the collected headings are replayed for ECR102 and ECR103.
   *
   * @param root - The parsed MDAST root node
   * @returns The intermediate result from the headings and references pass
   */
  private executeHeadingsAndReferencesPass(
    root: MdastRoot,
  ): HeadingsAndReferencesPassResult {
    // Phase 1: Collect all headings and feed to ECR101
    const collectedHeadings: HeadingNodeData[] = [];

    this.collectHeadings(root, collectedHeadings);

    const identityRule: DocumentIdentityRule = new DocumentIdentityRule({
      uri: this.uri,
      grammar: this.grammar,
    });

    for (const headingData of collectedHeadings) {
      identityRule.evaluateHeading(headingData);
    }

    const identityResult: DocumentIdentityRuleResult = identityRule.finalise();

    // If ECR101 failed, return early -- no ECR102 or ECR103
    if (identityResult.identity === undefined) {
      return { identityResult };
    }

    // Phase 2: ECR101 succeeded -- initialise ECR102 and ECR103
    const docId: DocID = identityResult.identity.docId;

    const sectionHierarchyRule: SectionHierarchyRule = new SectionHierarchyRule({
      uri: this.uri,
      docId,
      grammar: this.grammar,
    });

    const referencesSectionRule: ReferencesSectionRule = new ReferencesSectionRule({
      uri: this.uri,
      docId,
      grammar: this.grammar,
    });

    // Feed collected headings to ECR102 and ECR103
    for (const headingData of collectedHeadings) {
      // ECR102: register root H1 or evaluate sub-headings.
      // The `## References` heading is a structural heading owned by ECR103,
      // not a numbered section heading — it must be excluded from ECR102
      // to avoid a spurious "not a valid SectionID" diagnostic.
      if (headingData.depth === 1) {
        sectionHierarchyRule.registerRootHeading(headingData);
      } else if (!this.tellReferencesHeading(headingData)) {
        sectionHierarchyRule.evaluateHeading(headingData);
      }

      // ECR103: evaluate all headings for References heading detection
      referencesSectionRule.evaluateHeading(headingData);
    }

    // Phase 3: Walk the AST again to feed list items to ECR103
    // after the References heading has been detected
    this.feedListItemsToReferencesRule(root, referencesSectionRule);

    // Finalise ECR102 and ECR103
    const sectionsResult: SectionHierarchyRuleResult =
      sectionHierarchyRule.finalise();
    const referencesResult: ReferencesSectionRuleResult =
      referencesSectionRule.finalise();

    return {
      identityResult,
      sectionsResult,
      referencesResult,
    };
  }

  /**
   * Recursively collects all heading nodes from the AST into the provided array.
   *
   * Walks the AST depth-first in document order, extracting
   * {@link HeadingNodeData} from every node with `type === 'heading'`.
   *
   * @param node - The current MDAST node being visited
   * @param headings - The accumulator array for collected heading data
   */
  private collectHeadings(
    node: MdastNode,
    headings: HeadingNodeData[],
  ): void {
    if (node.type === 'heading' && node.depth !== undefined) {
      const headingData: HeadingNodeData = this.extractHeadingNodeData(node);
      headings.push(headingData);
    }

    if (node.children !== undefined) {
      for (const child of node.children) {
        this.collectHeadings(child, headings);
      }
    }
  }

  /**
   * Walks the AST to feed list items within the References section to ECR103.
   *
   * After the References heading has been detected by ECR103, this method
   * walks the AST in document order. When the References heading is encountered,
   * subsequent list items are fed to ECR103 until a non-list sibling node
   * is encountered at heading level or until another heading appears.
   *
   * The approach iterates through the root's children to find the heading
   * node matching `## References`, then processes the immediately following
   * list node's children.
   *
   * @param root - The parsed MDAST root node
   * @param referencesSectionRule - The ECR103 rule instance to feed list items to
   */
  private feedListItemsToReferencesRule(
    root: MdastRoot,
    referencesSectionRule: ReferencesSectionRule,
  ): void {
    // Only proceed if the References heading was detected
    if (!referencesSectionRule.tellReferencesHeadingDetected()) {
      return;
    }

    // Walk the root's top-level children to find the References heading
    // and the list that immediately follows it
    let referencesHeadingFound: boolean = false;

    for (const child of root.children) {
      if (child.type === 'heading') {
        const headingText: string = toString(child);
        const headingDepth: number | undefined = child.depth;

        if (headingDepth === 2 && headingText === 'References') {
          referencesHeadingFound = true;
          continue;
        }

        // Another heading after References -- stop collecting list items
        if (referencesHeadingFound) {
          break;
        }
      } else if (child.type === 'list' && referencesHeadingFound) {
        // Feed each list item to ECR103
        if (child.children !== undefined) {
          for (const listItemNode of child.children) {
            if (listItemNode.type === 'listItem') {
              const listItemData: ListItemNodeData =
                this.extractListItemNodeData(listItemNode);
              referencesSectionRule.evaluateListItem(listItemData);
            }
          }
        }

        // Only process the first list after the References heading
        break;
      } else if (referencesHeadingFound) {
        // Non-list, non-heading node after References heading -- stop
        break;
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private: Second pass -- inline references (ECR104)
  // -------------------------------------------------------------------------

  /**
   * Executes the second AST traversal pass: inline reference detection.
   *
   * This pass walks the AST in document order using a custom recursive
   * traversal that tracks ancestor node types and:
   * - Tracks the current section context (the most recently encountered
   *   heading identifier), starting with the DocID before any H2 heading
   * - For each text node encountered, checks whether the node's ancestor
   *   chain includes any excluded node types (`code`, `inlineCode`, `html`)
   * - Text nodes whose ancestors include excluded types are skipped
   * - Valid text nodes are fed to ECR104
   *   (`InlineReferenceRule.evaluateTextNode`) with the current
   *   section context
   * - After traversal, ECR104 is finalised
   *
   * @param root - The parsed MDAST root node
   * @param docId - The document's established DocID
   * @param declaredDocIds - The set of DocIDs declared in the References section
   * @returns The intermediate result from the inline references pass
   */
  private executeInlineReferencesPass(
    root: MdastRoot,
    docId: DocID,
    declaredDocIds: ReadonlySet<DocID>,
  ): InlineReferencesPassResult {
    const inlineReferenceRule: InlineReferenceRule = new InlineReferenceRule({
      uri: this.uri,
      docId,
      grammar: this.grammar,
      declaredDocIds,
    });

    // Track the current section context -- starts with the DocID.
    // The mutable wrapper allows the recursive walk callback to update
    // the section context as headings are encountered.
    const sectionContext: SectionContextTracker = { current: docId };

    // Walk the AST recursively, tracking ancestor types for exclusion filtering.
    // When a heading is encountered, update the section context.
    // When a text node is encountered (not excluded by ancestors), feed to ECR104.
    this.walkNodesForInlineReferences(
      root,
      [],
      sectionContext,
      inlineReferenceRule,
    );

    const inlineResult: InlineReferenceRuleResult =
      inlineReferenceRule.finalise();

    return { inlineResult };
  }

  /**
   * Recursively walks the AST to find text nodes for ECR104, tracking
   * ancestor types for exclusion filtering and updating section context
   * when headings are encountered.
   *
   * A hand-written depth-first, pre-order walk, so that the ancestor types
   * needed for exclusion filtering are tracked without another dependency.
   *
   * @param node - The current MDAST node being visited
   * @param ancestorTypes - The types of all ancestor nodes from root to parent
   * @param sectionContext - Mutable wrapper holding the current section context
   * @param inlineReferenceRule - The ECR104 rule instance to feed text nodes to
   */
  private walkNodesForInlineReferences(
    node: MdastNode,
    ancestorTypes: readonly string[],
    sectionContext: SectionContextTracker,
    inlineReferenceRule: InlineReferenceRule,
  ): void {
    if (node.type === 'heading' && node.depth !== undefined) {
      const headingText: string = toString(node);
      const headingDepth: number = node.depth;

      sectionContext.current = this.determineSectionContext(
        headingText,
        headingDepth,
        sectionContext.current,
      );

      // Do not recurse into heading children for text node extraction;
      // heading text is not subject to inline reference detection.
      return;
    }

    if (node.type === 'text' && node.value !== undefined) {
      // Check ancestor exclusion
      const excluded: boolean = this.tellNodeExcludedByAncestors(ancestorTypes);

      if (!excluded) {
        const textNodeData: TextNodeData = this.extractTextNodeData(node);
        inlineReferenceRule.evaluateTextNode(textNodeData, sectionContext.current);
      }

      return;
    }

    // Recurse into children with updated ancestor types
    if (node.children !== undefined) {
      const updatedAncestors: readonly string[] = [...ancestorTypes, node.type];

      if (!this.tellNodeExcludedByAncestors(updatedAncestors)) {
        this.feedSiblingPairsForWrappedReferences(node.children, inlineReferenceRule);
      }

      for (const child of node.children) {
        this.walkNodesForInlineReferences(
          child,
          updatedAncestors,
          sectionContext,
          inlineReferenceRule,
        );
      }
    }
  }

  /**
   * Passes each text node, and the node that follows it, to ECR104's
   * wrapped-reference check.
   *
   * When a reference is written `see [8.1#3](8.1.md)`, the keyword ends one
   * text node and the identifier starts the next node, so neither is visible
   * to the per-text-node scan. Only adjacent siblings can reveal it.
   *
   * @param children - The child nodes of one parent, in document order
   * @param inlineReferenceRule - The ECR104 rule instance
   */
  private feedSiblingPairsForWrappedReferences(
    children: readonly MdastNode[],
    inlineReferenceRule: InlineReferenceRule,
  ): void {
    for (let index: number = 0; index < children.length - 1; index += 1) {
      const current: MdastNode | undefined = children[index];
      const next: MdastNode | undefined = children[index + 1];

      if (current?.type !== 'text' || current.value === undefined || next === undefined) {
        continue;
      }

      inlineReferenceRule.evaluateWrappedReference(
        current.value,
        next.type,
        toString(next),
        this.mapPosition(next.position),
      );
    }
  }

  // -------------------------------------------------------------------------
  // Private: Section context tracking
  // -------------------------------------------------------------------------

  /**
   * Determines the current section context identifier for a given heading.
   *
   * The section context is the identifier (DocID or SectionID) of the most
   * recently encountered numbered heading. Before any H2 heading, the context
   * is the DocID. After an H2 or deeper heading, the context is the
   * SectionID of that heading.
   *
   * This method extracts the identifier from the heading text using the
   * grammar's separator convention. If the heading text does not contain
   * a valid identifier, the previous context is retained.
   *
   * @param headingText - The plain text content of the heading node
   * @param headingDepth - The Markdown heading depth (1--6)
   * @param currentContext - The current section context before this heading
   * @returns The updated section context identifier
   */
  private determineSectionContext(
    headingText: string,
    headingDepth: number,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be DocID or SectionID
    currentContext: DocID | SectionID,
  ): // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: return may be DocID or SectionID
  DocID | SectionID {
    // Only headings with depth >= 2 can change the section context
    // (H1 establishes the DocID, which is the initial context)
    if (headingDepth < 2) {
      return currentContext;
    }

    // A sub-heading carries a SectionID, so it is parsed with the SectionID
    // heading grammar rather than the DocID one an H1 uses.
    const parseResult: ReturnType<IdentifierGrammar['parseSectionHeading']> =
      this.grammar.parseSectionHeading(headingText);

    if (parseResult.valid) {
      return parseResult.sectionId;
    }

    return currentContext;
  }

  // -------------------------------------------------------------------------
  // Private: References heading detection
  // -------------------------------------------------------------------------

  /**
   * Determines whether a heading is the `## References` structural heading.
   *
   * The `## References` heading is owned by ECR103 and should not be
   * evaluated by ECR102 (Section Hierarchy), because it is not a numbered
   * section heading and would fail SectionID parsing.
   *
   * Per 1#9.6, the References heading is identified by depth === 2
   * and text content exactly equal to `"References"`.
   *
   * @param headingData - The heading node data to check
   * @returns `true` if the heading is the `## References` heading, `false` otherwise
   */
  private tellReferencesHeading(headingData: HeadingNodeData): boolean {
    return headingData.depth === 2 && headingData.text === 'References';
  }

  // -------------------------------------------------------------------------
  // Private: Ancestor filtering for ECR104
  // -------------------------------------------------------------------------

  /**
   * Determines whether a node should be excluded from ECR104 inline reference
   * detection based on its ancestor chain.
   *
   * Text nodes are excluded if any ancestor in the chain has a node type
   * that is a member of {@link EXCLUDED_ANCESTOR_NODE_TYPES} (i.e., `code`,
   * `inlineCode`, or `html`).
   *
   * This method is called during the recursive AST walk, which provides
   * the ancestor type strings for each visited node.
   *
   * @param ancestorTypes - The type strings of all ancestor nodes from the root
   *                        down to (but not including) the current node
   * @returns `true` if the node should be excluded, `false` if it should be
   *          fed to ECR104
   */
  private tellNodeExcludedByAncestors(
    ancestorTypes: readonly string[],
  ): boolean {
    for (const ancestorType of ancestorTypes) {
      if (EXCLUDED_ANCESTOR_NODE_TYPES.has(ancestorType)) {
        return true;
      }
    }

    return false;
  }

  // -------------------------------------------------------------------------
  // Private: Text extraction from list items
  // -------------------------------------------------------------------------

  /**
   * Extracts the plain text content from a list item AST node.
   *
   * Uses `mdast-util-to-string` to recursively extract text from the
   * list item's child nodes, producing a single plain text string
   * suitable for feeding to ECR103.
   *
   * @param listItemNode - The MDAST list item node to extract text from
   * @returns The extracted {@link ListItemNodeData} with text and optional range
   */
  private extractListItemNodeData(
    listItemNode: MdastNode,
  ): ListItemNodeData {
    const text: string = toString(listItemNode);
    const range: PositionRange | undefined =
      this.mapPosition(listItemNode.position);

    const listItemData: ListItemNodeData = {
      text,
      ...(range !== undefined ? { range } : {}),
    };

    return listItemData;
  }

  // -------------------------------------------------------------------------
  // Private: Heading data extraction
  // -------------------------------------------------------------------------

  /**
   * Extracts heading node data from an MDAST heading node.
   *
   * Uses `mdast-util-to-string` to extract the plain text content
   * and maps the MDAST position to a {@link HeadingNodeData} structure
   * suitable for consumption by ECR101, ECR102, and ECR103.
   *
   * @param headingNode - The MDAST heading node to extract data from
   * @returns The extracted {@link HeadingNodeData} with depth, text, and optional range
   */
  private extractHeadingNodeData(
    headingNode: MdastNode,
  ): HeadingNodeData {
    const text: string = toString(headingNode);
    const range: PositionRange | undefined =
      this.mapPosition(headingNode.position);

    const headingData: HeadingNodeData = {
      depth: headingNode.depth ?? 1,
      text,
      ...(range !== undefined ? { range } : {}),
    };

    return headingData;
  }

  // -------------------------------------------------------------------------
  // Private: Text node data extraction
  // -------------------------------------------------------------------------

  /**
   * Extracts text node data from an MDAST text node.
   *
   * Maps the MDAST text node's value and position to a {@link TextNodeData}
   * structure suitable for consumption by ECR104.
   *
   * @param textNode - The MDAST text node to extract data from
   * @returns The extracted {@link TextNodeData} with text and optional range
   */
  private extractTextNodeData(
    textNode: MdastNode,
  ): TextNodeData {
    const range: PositionRange | undefined =
      this.mapPosition(textNode.position);

    const textNodeData: TextNodeData = {
      text: textNode.value ?? '',
      ...(range !== undefined ? { range } : {}),
    };

    return textNodeData;
  }

  // -------------------------------------------------------------------------
  // Private: Declared DocID extraction
  // -------------------------------------------------------------------------

  /**
   * Extracts the set of declared DocIDs from a completed ECR103 result.
   *
   * Iterates over the extracted {@link ReferenceEdge} artefacts and
   * collects the `toDocId` field from each edge into a `ReadonlySet<DocID>`.
   * This set is used to initialise ECR104 for undeclared reference detection.
   *
   * @param references - The extracted reference edges from ECR103
   * @returns The set of declared DocIDs
   */
  private extractDeclaredDocIds(
    references: readonly ReferenceEdge[],
  ): ReadonlySet<DocID> {
    const declaredDocIds: Set<DocID> = new Set<DocID>();

    for (const referenceEdge of references) {
      declaredDocIds.add(referenceEdge.toDocId);
    }

    return declaredDocIds;
  }

  // -------------------------------------------------------------------------
  // Private: Position mapping
  // -------------------------------------------------------------------------

  /**
   * Maps an MDAST position to a {@link PositionRange}, if available.
   *
   * MDAST positions use 1-based lines and 1-based columns, while
   * {@link PositionRange} uses 0-based lines and 0-based characters.
   * This method performs the conversion.
   *
   * @param mdastPosition - The MDAST position object, or `undefined` if
   *                         positional metadata is not available
   * @returns The mapped position range, or `undefined` if no position is available
   */
  private mapPosition(
    mdastPosition: MdastPosition | undefined,
  ): PositionRange | undefined {
    if (mdastPosition === undefined) {
      return undefined;
    }

    const mappedRange: PositionRange = {
      start: {
        line: mdastPosition.start.line - 1,
        character: mdastPosition.start.column - 1,
      },
      end: {
        line: mdastPosition.end.line - 1,
        character: mdastPosition.end.column - 1,
      },
    };

    return mappedRange;
  }

  // -------------------------------------------------------------------------
  // Private: Result assembly
  // -------------------------------------------------------------------------

  /**
   * Assembles the composite {@link LintResult} from individual rule results.
   *
   * Aggregates diagnostics from all rules, determines the `ok` status
   * (true when no error-severity diagnostics are present), and constructs
   * the {@link ExtractedDocument} when a valid DocID was recovered.
   *
   * @param identityResult - The result from ECR101
   * @param sectionsResult - The result from ECR102 (undefined if ECR101 failed)
   * @param referencesResult - The result from ECR103 (undefined if ECR101 failed)
   * @param inlineResult - The result from ECR104 (undefined if ECR101 failed)
   * @returns The composite lint result
   */
  private assembleLintResult(
    identityResult: DocumentIdentityRuleResult,
    sectionsResult: SectionHierarchyRuleResult | undefined,
    referencesResult: ReferencesSectionRuleResult | undefined,
    inlineResult: InlineReferenceRuleResult | undefined,
  ): LintResult {
    // Aggregate all diagnostics
    const allDiagnostics: readonly Diagnostic[] = this.aggregateDiagnostics(
      identityResult,
      sectionsResult,
      referencesResult,
      inlineResult,
    );

    const input: LintInput = this.buildLintInput();
    const isPassable: boolean = this.tellAllDiagnosticsPassable(allDiagnostics);

    // Construct extracted document if identity is valid
    if (identityResult.identity !== undefined) {
      const identity: DocumentIdentity = identityResult.identity;
      const sections: readonly SectionNode[] =
        sectionsResult !== undefined ? sectionsResult.sections : [];
      const references: readonly ReferenceEdge[] =
        referencesResult !== undefined ? referencesResult.references : [];
      const inlineReferences: readonly InlineReferenceEdge[] =
        inlineResult !== undefined ? inlineResult.inlineReferences : [];

      const extracted: ExtractedDocument = this.buildExtractedDocument(
        identity,
        sections,
        references,
        inlineReferences,
      );

      return {
        input,
        ok: isPassable,
        diagnostics: allDiagnostics,
        extracted,
      };
    }

    return {
      input,
      ok: isPassable,
      diagnostics: allDiagnostics,
    };
  }

  /**
   * Aggregates diagnostics from all rule results into a single array.
   *
   * Collects diagnostics from ECR101, ECR102, ECR103, and ECR104 in that
   * order. Rules that did not run (undefined results) contribute no
   * diagnostics.
   *
   * @param identityResult - The result from ECR101
   * @param sectionsResult - The result from ECR102 (undefined if ECR101 failed)
   * @param referencesResult - The result from ECR103 (undefined if ECR101 failed)
   * @param inlineResult - The result from ECR104 (undefined if ECR101 failed)
   * @returns The aggregated array of all diagnostics
   */
  private aggregateDiagnostics(
    identityResult: DocumentIdentityRuleResult,
    sectionsResult: SectionHierarchyRuleResult | undefined,
    referencesResult: ReferencesSectionRuleResult | undefined,
    inlineResult: InlineReferenceRuleResult | undefined,
  ): readonly Diagnostic[] {
    const allDiagnostics: Diagnostic[] = [];

    for (const diagnostic of identityResult.diagnostics) {
      allDiagnostics.push(diagnostic);
    }

    if (sectionsResult !== undefined) {
      for (const diagnostic of sectionsResult.diagnostics) {
        allDiagnostics.push(diagnostic);
      }
    }

    if (referencesResult !== undefined) {
      for (const diagnostic of referencesResult.diagnostics) {
        allDiagnostics.push(diagnostic);
      }
    }

    if (inlineResult !== undefined) {
      for (const diagnostic of inlineResult.diagnostics) {
        allDiagnostics.push(diagnostic);
      }
    }

    return allDiagnostics;
  }

  /**
   * Constructs the {@link LintInput} descriptor for the result.
   *
   * Echoes the visitor's URI and optional version into the standard
   * input descriptor shape.
   *
   * @returns The lint input descriptor
   */
  private buildLintInput(): LintInput {
    const input: LintInput = {
      uri: this.uri,
      ...(this.version !== undefined ? { version: this.version } : {}),
    };

    return input;
  }

  /**
   * Determines the composite `ok` status from an aggregated diagnostics array.
   *
   * The result is `ok` (true) when no diagnostics have severity `"error"`.
   * Any error-severity diagnostic causes the result to be not-ok (false).
   *
   * @param diagnostics - The full array of aggregated diagnostics from all rules
   * @returns `true` if no error diagnostics are present, `false` otherwise
   */
  private tellAllDiagnosticsPassable(
    diagnostics: readonly Diagnostic[],
  ): boolean {
    return !diagnostics.some(
      (diagnostic: Diagnostic): boolean => diagnostic.severity === 'error',
    );
  }

  /**
   * Constructs the {@link ExtractedDocument} from individual rule extraction
   * results.
   *
   * Assembles the document identity (DocID and title), section nodes,
   * reference edges, and inline reference edges into the canonical
   * extracted document shape.
   *
   * @param identity - The document identity from ECR101
   * @param sections - The section nodes from ECR102
   * @param references - The reference edges from ECR103
   * @param inlineReferences - The inline reference edges from ECR104
   * @returns The assembled extracted document
   */
  private buildExtractedDocument(
    identity: DocumentIdentity,
    sections: readonly SectionNode[],
    references: readonly ReferenceEdge[],
    inlineReferences: readonly InlineReferenceEdge[],
  ): ExtractedDocument {
    const extracted: ExtractedDocument = {
      docId: identity.docId,
      title: identity.title,
      sections,
      references,
      inlineReferences,
    };

    return extracted;
  }
}

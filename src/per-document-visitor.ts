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
  ListItemSegment,
} from './references-section-rule.js';

import type {
  InlineReferenceRuleResult,
  InlineSegment,
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
  /** Alternative text, present on image nodes. */
  readonly alt?: string | null;
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
// A document the parser could not read
// ---------------------------------------------------------------------------

/** Rule identifier reported when a document cannot be parsed at all. */
export const UNPARSABLE_DOCUMENT_RULE_ID: string = 'document/unparsable';

/** The `data.cause` of that diagnostic. */
export const UNPARSABLE_DOCUMENT_CAUSE: string = 'unparsable-document';

/** How much of the parser's own account of the failure to repeat. */
const UNPARSABLE_REASON_LIMIT: number = 200;

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

/**
 * MDAST node types whose children form one inline run: the text a reader
 * sees, recognised as a whole (1#9.5 rule 1). Headings are excluded, since
 * heading text is not subject to inline reference detection.
 */
const INLINE_RUN_NODE_TYPES: ReadonlySet<string> = new Set([
  'paragraph',
  'tableCell',
]);

/**
 * Inline HTML a reader sees as a line break: an opening `br` tag in any case,
 * whatever follows its name -- `<br>`, `<BR/>`, `<br class="x">`. It separates
 * the words either side of it. Other inline HTML does not, so it is
 * transparent to recognition (1#9.5 rule 1).
 *
 * Only the tag's name is read. The parser has already delimited the whole
 * tag as one node, so its attributes need no second parse here; matching
 * them again assumed every `>` closed the tag, and `<br title="x > y">` was
 * taken for transparent HTML.
 */
const LINE_BREAK_HTML: RegExp = /^<br(?=[\s/>])/i;

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
 * Where the `## References` heading was found: at the root, or inside a
 * container, which is a placement violation (1#9.11 rule 3).
 */
interface ReferencesSectionLocation {
  /** The `## References` heading node. */
  readonly heading: MdastNode;
  /** The children of its parent, in order: the root's, or a container's. */
  readonly siblings: readonly MdastNode[];
  /** The heading's index among them. */
  readonly index: number;
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

/** A list of siblings being walked, and how far through it the walk is. */
interface SiblingsFrame {
  /** The siblings, in document order. */
  readonly children: readonly MdastNode[];
  /** Index of the next sibling to visit. */
  readonly index: number;
}

/** A node waiting to be visited by the ECR104 inline references walk. */
interface InlineWalkEntry {
  /** The node to visit. */
  readonly node: MdastNode;
  /**
   * Whether an ancestor's type is one of {@link EXCLUDED_ANCESTOR_NODE_TYPES},
   * which puts the node's text outside inline reference detection.
   */
  readonly excluded: boolean;
}

/** A node waiting to be visited by an inline segment walk, with its wrappers. */
interface SegmentWalkEntry {
  /** The node to visit. */
  readonly node: MdastNode;
  /** Types of the formatting spans enclosing it, outermost first. */
  readonly wrappers: readonly string[];
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
    let root: MdastRoot;

    try {
      root = this.parseMarkdown(markdownText);
    } catch (error: unknown) {
      return this.reportUnparsable(error);
    }

    const passOneResult: HeadingsAndReferencesPassResult =
      this.executeHeadingsAndReferencesPass(root, markdownText);

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
        markdownText,
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

  /**
   * Reports a document the parser could not read.
   *
   * The parser walks a document's structure by recursion, inside a package
   * this project does not control, so a deeply nested link label or image
   * description can end the parse with a stack overflow. That must be one
   * document's error, reported like any other, and never a crash that stops
   * a corpus part way and leaves the rest unvalidated.
   *
   * @param error - What the parser threw
   * @returns A failing result carrying one error diagnostic
   */
  private reportUnparsable(error: unknown): LintResult {
    const reason: string =
      error instanceof Error ? `${error.name}: ${error.message}` : String(error);

    return {
      input: this.buildLintInput(),
      ok: false,
      diagnostics: [
        {
          severity: 'error',
          ruleId: UNPARSABLE_DOCUMENT_RULE_ID,
          message:
            `Document could not be parsed, so none of it was validated ` +
            `(${reason.slice(0, UNPARSABLE_REASON_LIMIT)}). Deeply nested Markdown is the ` +
            `usual cause, because parsing it recurses.`,
          uri: this.uri,
          data: { cause: UNPARSABLE_DOCUMENT_CAUSE },
        },
      ],
    };
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
   * @param sourceText - The document's raw Markdown, for the heading source-form check of 1#9.11
   * @returns The intermediate result from the headings and references pass
   */
  private executeHeadingsAndReferencesPass(
    root: MdastRoot,
    sourceText: string,
  ): HeadingsAndReferencesPassResult {
    // Phase 1: Collect all headings and feed to ECR101
    const collectedHeadings: HeadingNodeData[] = [];

    this.collectHeadings(root, collectedHeadings);

    const identityRule: DocumentIdentityRule = new DocumentIdentityRule({
      uri: this.uri,
      grammar: this.grammar,
      sourceText,
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
      sourceText,
    });

    const referencesSectionRule: ReferencesSectionRule = new ReferencesSectionRule({
      uri: this.uri,
      docId,
      grammar: this.grammar,
      sourceText,
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
   * Collects all heading nodes from the AST into the provided array.
   *
   * Walks the AST depth-first in document order, extracting
   * {@link HeadingNodeData} from every node with `type === 'heading'`.
   *
   * @param node - The root of the walk
   * @param headings - The accumulator array for collected heading data
   */
  private collectHeadings(
    node: MdastNode,
    headings: HeadingNodeData[],
  ): void {
    const pending: MdastNode[] = [node];

    while (pending.length > 0) {
      const current: MdastNode | undefined = pending.pop();

      if (current === undefined) {
        break;
      }

      if (current.type === 'heading' && current.depth !== undefined) {
        headings.push(this.extractHeadingNodeData(current));
      }

      PerDocumentVisitor.pushChildren(current, pending);
    }
  }

  /**
   * Reads a node's plain text: what a reader sees, with the formatting gone.
   *
   * @param node - The node to read
   * @returns Its text, and its descendants' text, in order
   */
  private static showNodeText(node: MdastNode): string {
    // What `mdast-util-to-string` returns, gathered over a stack instead of
    // by recursion: a node's own value, else an image's alternative text,
    // else its children's text in order. That package recurses, so a heading
    // of a few thousand nested emphasis spans -- which costs an author two
    // characters a level -- ended the process inside it.
    const parts: string[] = [];
    const pending: MdastNode[] = [node];

    while (pending.length > 0) {
      const current: MdastNode | undefined = pending.pop();

      if (current === undefined) {
        break;
      }

      if (current.value !== undefined) {
        parts.push(current.value);
        continue;
      }

      if (typeof current.alt === 'string' && current.alt.length > 0) {
        parts.push(current.alt);
        continue;
      }

      PerDocumentVisitor.pushChildren(current, pending);
    }

    return parts.join('');
  }

  /**
   * Puts a node's children on a walk's stack so that they come off it in
   * document order.
   *
   * Every walk over a document's nodes keeps its own stack rather than
   * calling itself, because nesting in Markdown costs the author almost
   * nothing: a few thousand nested blockquotes, or nested bold spans, fit in
   * a few kilobytes, and recursion over them exhausts the call stack and
   * takes the process with it. A stack on the heap has no such limit.
   *
   * @param node - The node whose children are to be walked
   * @param pending - The stack to push onto, from which nodes are taken with `pop`
   */
  private static pushChildren(node: MdastNode, pending: MdastNode[]): void {
    const children: readonly MdastNode[] | undefined = node.children;

    if (children === undefined) {
      return;
    }

    for (let index: number = children.length - 1; index >= 0; index -= 1) {
      const child: MdastNode | undefined = children[index];

      if (child !== undefined) {
        pending.push(child);
      }
    }
  }

  /**
   * Finds the References section and feeds its placement and entries to ECR103.
   *
   * The `## References` heading is looked for anywhere in the tree, not only
   * among the root's children. A section nested in a blockquote or a list
   * item used to be passed over, so its entries were silently discarded and
   * the document reported as having an empty References section. It is now
   * found, reported as misplaced (1#9.11 rule 3), and its entries still read.
   *
   * The entries are the items of the list that immediately follows the
   * heading, or of a list that opens the container immediately following it
   * -- which is also a placement violation.
   *
   * @param root - The parsed MDAST root node
   * @param referencesSectionRule - The ECR103 rule instance to feed
   */
  private feedListItemsToReferencesRule(
    root: MdastRoot,
    referencesSectionRule: ReferencesSectionRule,
  ): void {
    if (!referencesSectionRule.tellReferencesHeadingDetected()) {
      return;
    }

    const section: ReferencesSectionLocation | undefined = this.findReferencesSection(root);

    if (section === undefined) {
      return;
    }

    const next: MdastNode | undefined = section.siblings[section.index + 1];
    const list: MdastNode | undefined = this.findReferencesList(next);
    const nested: boolean = section.siblings !== root.children || (list !== undefined && list !== next);

    referencesSectionRule.evaluateSectionPlacement(
      this.mapPosition(section.heading.position),
      nested,
    );

    for (const listItemNode of list?.children ?? []) {
      if (listItemNode.type === 'listItem') {
        referencesSectionRule.evaluateListItem(this.extractListItemNodeData(listItemNode));
      }
    }
  }

  /**
   * Finds the list holding the References entries, given the node after the
   * heading: that node itself, or a list opening the container it is, at any
   * depth of nesting.
   *
   * Looking one container deep lost `> > - 8.1 - …`: the list was never
   * found, so its entries were discarded and the section reported as empty.
   *
   * @param next - The node immediately following the `## References` heading
   * @returns The entries' list, or `undefined` when there is none
   */
  private findReferencesList(next: MdastNode | undefined): MdastNode | undefined {
    let candidate: MdastNode | undefined = next;

    while (candidate !== undefined && candidate.type !== 'heading') {
      if (candidate.type === 'list') {
        return candidate;
      }

      candidate = candidate.children?.[0];
    }

    return undefined;
  }

  /**
   * Finds the first `## References` heading in document order, at any depth.
   *
   * @param node - The node to search from
   * @returns The heading and its position among its siblings, or `undefined`
   */
  private findReferencesSection(node: MdastNode | MdastRoot): ReferencesSectionLocation | undefined {
    // Each frame is a list of siblings and how far through it the walk is, so
    // that a match can report the position among its siblings that the caller
    // needs. Depth-first and pre-order, as the recursive form was.
    const frames: SiblingsFrame[] = [{ children: node.children ?? [], index: 0 }];

    while (frames.length > 0) {
      const frame: SiblingsFrame | undefined = frames.pop();

      if (frame === undefined) {
        break;
      }

      const child: MdastNode | undefined = frame.children[frame.index];

      if (child === undefined) {
        // These siblings are exhausted, so the frame is not put back.
        continue;
      }

      // The rest of these siblings come after everything beneath this child,
      // so they go back on the stack before it.
      frames.push({ children: frame.children, index: frame.index + 1 });

      if (child.type === 'heading' && this.tellReferencesHeading(this.extractHeadingNodeData(child))) {
        return { heading: child, siblings: frame.children, index: frame.index };
      }

      frames.push({ children: child.children ?? [], index: 0 });
    }

    return undefined;
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
   * @param sourceText - The document's raw Markdown, for the source-form checks of 1#9.11
   * @returns The intermediate result from the inline references pass
   */
  private executeInlineReferencesPass(
    root: MdastRoot,
    docId: DocID,
    declaredDocIds: ReadonlySet<DocID>,
    sourceText: string,
  ): InlineReferencesPassResult {
    const inlineReferenceRule: InlineReferenceRule = new InlineReferenceRule({
      uri: this.uri,
      docId,
      grammar: this.grammar,
      declaredDocIds,
      sourceText,
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
      sectionContext,
      inlineReferenceRule,
    );

    const inlineResult: InlineReferenceRuleResult =
      inlineReferenceRule.finalise();

    return { inlineResult };
  }

  /**
   * Walks the AST to find inline runs for ECR104, tracking whether an
   * excluded ancestor encloses the node and updating section context when
   * headings are encountered.
   *
   * A paragraph is handed to ECR104 whole, as one inline run, because a
   * citation is recognised in the text a reader sees and not one parsed text
   * node at a time (1#9.5 rule 1). Its children are not walked separately.
   *
   * A hand-written depth-first, pre-order walk over an explicit stack: document
   * order decides which section each run belongs to, and see
   * {@link PerDocumentVisitor.pushChildren} for why the stack is not the call
   * stack. Exclusion is carried down as one flag, because a node is excluded
   * exactly when some ancestor's type is, so nothing is gained by keeping the
   * ancestors themselves.
   *
   * @param root - The root of the walk
   * @param sectionContext - Mutable wrapper holding the current section context
   * @param inlineReferenceRule - The ECR104 rule instance to feed runs to
   */
  private walkNodesForInlineReferences(
    root: MdastNode,
    sectionContext: SectionContextTracker,
    inlineReferenceRule: InlineReferenceRule,
  ): void {
    const pending: InlineWalkEntry[] = [{ node: root, excluded: false }];

    while (pending.length > 0) {
      const entry: InlineWalkEntry | undefined = pending.pop();

      if (entry === undefined) {
        break;
      }

      const { node, excluded } = entry;

      if (node.type === 'heading' && node.depth !== undefined) {
        sectionContext.current = this.determineSectionContext(
          PerDocumentVisitor.showNodeText(node),
          node.depth,
          sectionContext.current,
        );

        // Do not walk into heading children for text node extraction;
        // heading text is not subject to inline reference detection.
        continue;
      }

      if (INLINE_RUN_NODE_TYPES.has(node.type) && node.children !== undefined) {
        if (!excluded) {
          const segments: InlineSegment[] = [];

          for (const child of node.children) {
            this.collectInlineSegments(child, [], segments);
          }

          inlineReferenceRule.evaluateInlineRun(segments, sectionContext.current);
        }

        continue;
      }

      // A text node outside any run is not expected from the parser, but if one
      // appears it is still evaluated, as a run of its own.
      if (node.type === 'text' && node.value !== undefined) {
        if (!excluded) {
          const textNodeData: TextNodeData = this.extractTextNodeData(node);
          inlineReferenceRule.evaluateTextNode(textNodeData, sectionContext.current);
        }

        continue;
      }

      PerDocumentVisitor.pushInlineWalkChildren(node, excluded, pending);
    }
  }

  /**
   * Puts a node's children on the inline walk's stack, in document order,
   * noting whether an excluded ancestor now encloses them.
   *
   * @param node - The node whose children are to be walked
   * @param excluded - Whether an excluded ancestor already encloses the node
   * @param pending - The stack to push onto
   */
  private static pushInlineWalkChildren(
    node: MdastNode,
    excluded: boolean,
    pending: InlineWalkEntry[],
  ): void {
    const children: readonly MdastNode[] | undefined = node.children;

    if (children === undefined) {
      return;
    }

    const childrenExcluded: boolean = excluded || EXCLUDED_ANCESTOR_NODE_TYPES.has(node.type);

    for (let index: number = children.length - 1; index >= 0; index -= 1) {
      const child: MdastNode | undefined = children[index];

      if (child !== undefined) {
        pending.push({ node: child, excluded: childrenExcluded });
      }
    }
  }

  /**
   * Flattens one inline node into the segments a reader sees, in order.
   *
   * Text becomes a `text` segment carrying its position, and inline code a
   * `code` segment. Formatting contributes its contents, each segment noting
   * the spans around it. A hard break, an image, and a `<br>` tag become a
   * `break` of one space, because a reader sees the words either side of them
   * as separate. Any other inline HTML -- a comment, or a tag such as
   * `<span>` -- contributes nothing, because it separates nothing:
   * `60<span>s</span>` reads as `60s`.
   *
   * @param node - An inline node
   * @param wrappers - Types of the formatting spans enclosing it, outermost first
   * @param segments - Accumulator the segments are appended to
   */
  private collectInlineSegments(
    node: MdastNode,
    wrappers: readonly string[],
    segments: InlineSegment[],
  ): void {
    const pending: SegmentWalkEntry[] = [{ node, wrappers }];

    while (pending.length > 0) {
      const entry: SegmentWalkEntry | undefined = pending.pop();

      if (entry === undefined) {
        break;
      }

      this.collectInlineSegment(entry, segments, pending);
    }
  }

  /**
   * Turns one inline node into segments, or puts its children on the stack
   * to be turned into segments in their turn.
   *
   * @param entry - The node and the formatting spans enclosing it
   * @param segments - Accumulator the segments are appended to
   * @param pending - The walk's stack, which children are pushed onto in document order
   */
  private collectInlineSegment(
    entry: SegmentWalkEntry,
    segments: InlineSegment[],
    pending: SegmentWalkEntry[],
  ): void {
    const { node, wrappers } = entry;

    if (node.type === 'text') {
      const range: PositionRange | undefined = this.mapPosition(node.position);

      segments.push({
        kind: 'text',
        text: node.value ?? '',
        wrappers,
        ...(range !== undefined ? { range } : {}),
      });
      return;
    }

    if (node.type === 'inlineCode') {
      segments.push({ kind: 'code', text: node.value ?? '', wrappers });
      return;
    }

    if (node.type === 'html' && !LINE_BREAK_HTML.test((node.value ?? '').trim())) {
      return;
    }

    if (node.type !== 'html' && node.children !== undefined) {
      const inner: readonly string[] = [...wrappers, node.type];

      for (let index: number = node.children.length - 1; index >= 0; index -= 1) {
        const child: MdastNode | undefined = node.children[index];

        if (child !== undefined) {
          pending.push({ node: child, wrappers: inner });
        }
      }

      return;
    }

    segments.push({ kind: 'break', text: ' ', wrappers });
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
  // Private: Text extraction from list items
  // -------------------------------------------------------------------------

  /**
   * Extracts the plain text content from a list item AST node.
   *
   * Gathers the text of the list item's child nodes into a single plain text
   * string suitable for feeding to ECR103.
   *
   * @param listItemNode - The MDAST list item node to extract text from
   * @returns The extracted {@link ListItemNodeData} with text and optional range
   */
  private extractListItemNodeData(
    listItemNode: MdastNode,
  ): ListItemNodeData {
    const segments: ListItemSegment[] = [];

    this.collectListItemSegments(listItemNode, segments);

    const text: string = segments.map((segment: ListItemSegment): string => segment.text).join('');
    const range: PositionRange | undefined =
      this.mapPosition(listItemNode.position);

    const listItemData: ListItemNodeData = {
      text,
      segments,
      ...(range !== undefined ? { range } : {}),
    };

    return listItemData;
  }

  /**
   * Classifies a literal node for tracing its text back to the source.
   *
   * @param type - The node's MDAST type
   * @returns `text` for a text node, `code` for inline code, `other` otherwise
   */
  private static showSegmentKind(type: string): ListItemSegment['kind'] {
    if (type === 'text') {
      return 'text';
    }

    return type === 'inlineCode' ? 'code' : 'other';
  }

  /**
   * Splits a list item's text into the parsed nodes it comes from.
   *
   * Follows `mdast-util-to-string` exactly -- a node's `value`, else an
   * image's `alt`, else its children in order -- so that joining the
   * segments reproduces the entry text the rule parses, and an offset in that
   * text identifies the node, and so the source, it came from.
   *
   * @param node - A node within the list item
   * @param segments - Accumulator the segments are appended to
   */
  private collectListItemSegments(node: MdastNode, segments: ListItemSegment[]): void {
    const pending: MdastNode[] = [node];

    while (pending.length > 0) {
      const current: MdastNode | undefined = pending.pop();

      if (current === undefined) {
        break;
      }

      const range: PositionRange | undefined = this.mapPosition(current.position);
      const withRange: { readonly range?: PositionRange } = range !== undefined ? { range } : {};

      if (current.value !== undefined) {
        segments.push({
          kind: PerDocumentVisitor.showSegmentKind(current.type),
          text: current.value,
          ...withRange,
        });
        continue;
      }

      if (typeof current.alt === 'string' && current.alt.length > 0) {
        segments.push({ kind: 'other', text: current.alt, ...withRange });
        continue;
      }

      PerDocumentVisitor.pushChildren(current, pending);
    }
  }

  // -------------------------------------------------------------------------
  // Private: Heading data extraction
  // -------------------------------------------------------------------------

  /**
   * Extracts heading node data from an MDAST heading node.
   *
   * Reads the plain text content with {@link PerDocumentVisitor.showNodeText}
   * and maps the MDAST position to a {@link HeadingNodeData} structure
   * suitable for consumption by ECR101, ECR102, and ECR103.
   *
   * @param headingNode - The MDAST heading node to extract data from
   * @returns The extracted {@link HeadingNodeData} with depth, text, and optional range
   */
  private extractHeadingNodeData(
    headingNode: MdastNode,
  ): HeadingNodeData {
    const text: string = PerDocumentVisitor.showNodeText(headingNode);
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

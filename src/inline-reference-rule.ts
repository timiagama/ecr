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
 * own DocID. An undeclared SectionID target (`per 3.1#2`) is an error: the
 * `#` form never occurs in prose. An undeclared DocID target is only a
 * warning, because on its own a document cannot tell `per 3.1` (a reference
 * someone forgot to declare) from `per 60 seconds` (ordinary prose). The
 * corpus validator, which knows which documents exist, raises the former to
 * an error.
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
  Position,
  PositionRange,
} from './types.js';
import type { IdentifierGrammar } from './identifier-grammar.js';
import { indexLineStarts } from './source-lines.js';
import { alignParsedToSource } from './source-alignment.js';

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

/**
 * How a piece of an inline run takes part in recognition (1#9.5 rule 1).
 *
 * - `text`: a parsed text node. Keywords and candidates may be recognised in
 *   it, and only text can be literal in the source.
 * - `code`: inline code. It may continue a candidate, but neither a keyword
 *   nor a candidate is ever recognised as starting inside it.
 * - `break`: a hard break, an image, a `<br>` tag -- anything a reader sees
 *   as separating the words either side. Its text is a single space.
 */
export type InlineSegmentKind = 'text' | 'code' | 'break';

/**
 * One piece of the text a reader sees in an inline run: a paragraph, or
 * anything else whose children are inline content.
 *
 * A Markdown text node ends wherever formatting begins, which is not where a
 * word or an identifier ends. Recognising citations one text node at a time
 * therefore missed or misread every citation that crossed formatting:
 * `per 60**s**` became a reference, and `see <span>8.1#3</span>` vanished
 * without a diagnostic. The run is scanned as a whole instead, and each
 * segment records where its characters came from.
 *
 * Inline HTML other than a line break is transparent, so it contributes no
 * segment at all.
 */
export interface InlineSegment {
  /** How the segment takes part in recognition. */
  readonly kind: InlineSegmentKind;

  /** The characters a reader sees. */
  readonly text: string;

  /** Position of the parsed text node, for a `text` segment. */
  readonly range?: PositionRange;

  /** MDAST types of the formatting spans enclosing it, outermost first. */
  readonly wrappers: readonly string[];
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

  /**
   * The document's raw Markdown source.
   *
   * 1#9.11 is the one rule stated over source rather than over the parsed
   * tree, because a search reads the file and the parser does not. A citation
   * written `see 8\\.1#3` parses to `see 8.1#3` and is invisible to every
   * recipe; only the source shows the difference.
   */
  readonly sourceText: string;
}

// ---------------------------------------------------------------------------
// Diagnostic severity constant (module-level)
// ---------------------------------------------------------------------------

/**
 * The severity of Inline Reference Rule diagnostics about targets that may be
 * ordinary prose.
 *
 * Per 1#9.5, an undeclared DocID target (`per 60`, `see 8.1`) is a warning at
 * document level: `see`/`per` followed by a number also occurs in ordinary
 * prose. The corpus validator reports an error when the target turns out to be
 * a real document. A wrapped reference is likewise a warning.
 */
export const INLINE_REFERENCE_DIAGNOSTIC_SEVERITY: DiagnosticSeverity = 'warning';

/**
 * The severity of an undeclared SectionID target (`see 8.1#3`).
 *
 * The `#` form never occurs in prose, so such a target is certainly a
 * reference, and an undeclared one is an error without consulting the corpus.
 */
export const UNDECLARED_SECTION_TARGET_SEVERITY: DiagnosticSeverity = 'error';

/**
 * The `data.reason` carried by an undeclared-target diagnostic, which the
 * corpus validator uses to find the warnings it must check against the index.
 */
export const UNDECLARED_TARGET_REASON: string = 'undeclared-target';

/**
 * The `data.cause` carried by a citation whose candidate is not a complete,
 * conforming token and contains a `#` (1#9.5 rule 1).
 */
export const MALFORMED_TARGET_CAUSE: string = 'malformed-target';

/**
 * The `data.cause` carried by a citation whose keyword and identifier are not
 * adjacent literal text on one source line (1#9.11 rule 2).
 */
export const CITATION_SOURCE_FORM_CAUSE: string = 'citation-source-form';

/**
 * Characters that may terminate a candidate identifier (1#9.5 rule 1).
 *
 * Whitespace, the end of the text, and sentence punctuation. A letter is
 * deliberately absent: `see 1#1oops` never wrote an identifier at all.
 */
const PERMITTED_TERMINATOR_PUNCTUATION: ReadonlySet<string> = new Set([
  ',', ';', ':', ')', ']', '}', '"', "'", '!', '?',
]);

/**
 * Any whitespace, which may also terminate a candidate.
 *
 * Tested as a class rather than listed, so a non-breaking or em space ends an
 * identifier as an ordinary space does. Listing only the ASCII four made
 * `see 1#1` followed by a non-breaking space a malformed-target error, and
 * silently dropped the edge for `see 1`.
 */
const WHITESPACE: RegExp = /\s/u;

/**
 * A word character, for deciding whether a keyword stands at a boundary.
 *
 * This is ripgrep's definition (Rust's `\w`), chosen after measuring both
 * published engines against the same inputs. They do not agree:
 *
 *     preceding character        ripgrep   grep -E (C.UTF-8)
 *     space, hyphen              match     match
 *     e, e-acute, digit, _       no        no
 *     combining acute (U+0301)   no        MATCH
 *     connector (U+203F)         no        MATCH
 *     supplementary (U+10400)    no        MATCH
 *
 * Where they differ, ripgrep is the stricter: it treats marks, connector
 * punctuation and supplementary letters as word characters. The looser cases
 * are simply not recognised as citations -- no edge, and no diagnostic,
 * because text like `e\u0301see 1#1` is not a citation anyone wrote
 * deliberately.
 *
 * The published recipes no longer use `\b` at all: they bound a citation by
 * ERE recipes open with `(\b|_)`: ripgrep's `\b` is this same definition, so
 * every keyword the linter recognises is found, and `_` is admitted so that
 * `_see 8.1_` -- ordinary emphasis -- is found too. Measured against 46
 * preceding characters in both engines, that form has no case where the
 * linter recognises a keyword and either engine misses it. The PCRE recipe
 * keeps an ASCII lookbehind instead, because PCRE's `\b` counts `\u00b2` and `\u00bd` as
 * word characters and would miss them. Where an engine matches a keyword
 * this set refuses, that is a permitted search hit, not an edge (1#9.11).
 */
const WORD_CHARACTER: RegExp = /[\p{Alphabetic}\p{M}\p{Nd}\p{Pc}\p{Join_Control}]/u;

/** Characters a candidate identifier may be built from. */
const CANDIDATE_CHARACTERS: RegExp = /[0-9.#]/;

/**
 * Characters the published recipes refuse after a citation: an ASCII letter
 * or digit. Anything else -- whitespace, punctuation, `_`, `*`, the `<` of a
 * tag, the `&` of a character reference -- ends it.
 */
const RECIPE_EXCLUDED_BOUNDARY: RegExp = /[0-9A-Za-z]/;

/** A character that ends a source line, which a recipe's `$` accepts. */
const LINE_BREAK_CHARACTER: RegExp = /[\n\r]/;

/** A `see`/`per` keyword at a word boundary, wherever it occurs. */
const KEYWORD_PATTERN: RegExp = /([Ss]ee|[Pp]er)/g;

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

  /** The keyword exactly as written, preserving its capitalisation. */
  readonly keyword: string;

  /**
   * The candidate run of identifier characters, before conformance is tested.
   *
   * Held separately from {@link targetId} because a candidate that fails is
   * never shortened into one that passes: `1#1#9` does not become `1#1`.
   */
  readonly candidate: string;

  /** Whether the candidate conforms, once a single trailing `.` is allowed for. */
  readonly conforms: boolean;

  /** The whitespace between the keyword and the candidate, exactly as written. */
  readonly gap: string;

  /**
   * Offset of the keyword's first character within the parsed text node.
   *
   * This is what ties a citation to its own source characters. Every approach
   * that tried to avoid carrying it -- searching for matching text, counting
   * occurrences, comparing lists of targets -- could be defeated by another
   * citation, or by raw text that merely resembled one.
   */
  readonly index: number;
}

// ---------------------------------------------------------------------------
// Split citations (module-level)
// ---------------------------------------------------------------------------

/**
 * Inline Markdown formatting that can split a citation, with the words used
 * to describe each in a diagnostic.
 */
const WRAPPER_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ['link', 'a link'],
  ['linkReference', 'a link'],
  ['strong', 'bold text'],
  ['emphasis', 'italic text'],
  ['delete', 'strikethrough text'],
]);

/**
 * How a citation split by something other than formatting is described, by
 * the kind of segment in the way. Where two text segments meet with nothing
 * visible between them, only inline HTML can have separated them.
 */
const SPLIT_DESCRIPTIONS: ReadonlyMap<string, string> = new Map([
  ['code', 'inline code'],
  ['break', 'a line break'],
]);

/** What separates inline text segments when no segment is in the way. */
const TRANSPARENT_SPLIT_DESCRIPTION: string = 'inline HTML';

/** A text segment's source, located and aligned on first use. */
interface AlignedSegment {
  /** The segment's raw source, when it could be located. */
  readonly source: string | undefined;
  /** Parsed-to-source offsets, when alignment succeeded. */
  readonly offsets: readonly number[] | undefined;
}

/** What split a citation, as a diagnostic states it. */
interface SplitDescription {
  /** Phrase completing `"see 8.1#3" …`, such as `is split by bold text`. */
  readonly because: string;
  /** Data the diagnostic carries in addition, such as the wrapper's type. */
  readonly extra?: Readonly<Record<string, unknown>>;
}

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
 * For undeclared references, the rule emits a warning diagnostic and does
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

  /** The document's raw source, for the source-form checks of 1#9.11. */
  private readonly sourceText: string;

  /** Absolute offset at which each source line begins. */
  private readonly lineStarts: readonly number[];

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
    this.sourceText = options.sourceText;
    this.lineStarts = indexLineStarts(options.sourceText);
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
   * 5. If undeclared, emits a warning diagnostic and does not extract an edge
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
  public evaluateTextNode(
    textNodeData: TextNodeData,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be a DocID or a SectionID
    sectionContext: DocID | SectionID,
  ): void {
    this.evaluateInlineRun(
      [
        {
          kind: 'text',
          text: textNodeData.text,
          wrappers: [],
          ...(textNodeData.range !== undefined ? { range: textNodeData.range } : {}),
        },
      ],
      sectionContext,
    );
  }

  /**
   * Evaluates one inline run -- a paragraph, say -- for inline references.
   *
   * Recognition reads the run as a reader sees it, across every node boundary
   * (1#9.5 rule 1). Only then is the source consulted: a citation extracts an
   * edge only when its keyword, space and identifier all lie in one text
   * segment and are literal in the source there (1#9.11 rule 2). One that
   * spans segments -- split by formatting, inline HTML, code or a break -- is
   * reported, never passed over.
   *
   * @param segments - The run's visible text, in order, per {@link InlineSegment}
   * @param sectionContext - Section the run belongs to, used as `fromId`
   */
  public evaluateInlineRun(
    segments: readonly InlineSegment[],
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be a DocID or a SectionID
    sectionContext: DocID | SectionID,
  ): void {
    const visible: string = segments.map((segment: InlineSegment): string => segment.text).join('');
    const owners: readonly number[] = InlineReferenceRule.indexSegmentOwners(segments);
    const starts: readonly number[] = InlineReferenceRule.indexSegmentStarts(segments);
    const aligned: Map<number, AlignedSegment> = new Map<number, AlignedSegment>();

    for (const detected of this.detectInlineReferences(visible, segments, owners)) {
      const keywordOwner: number = owners[detected.index] ?? 0;
      const keywordSegment: InlineSegment | undefined = segments[keywordOwner];
      const range: PositionRange | undefined = keywordSegment?.range;

      if (!detected.conforms) {
        this.reportNonConformingCandidate(detected, sectionContext, range);
        continue;
      }

      const end: number =
        detected.index + detected.keyword.length + detected.gap.length + detected.targetId.length;
      const lastOwner: number = owners[end - 1] ?? keywordOwner;

      if (lastOwner !== keywordOwner || keywordSegment === undefined) {
        const split: SplitDescription = InlineReferenceRule.describeSplit(
          segments,
          keywordOwner,
          lastOwner,
        );

        this.reportUnnavigableCitation(detected, sectionContext, range, split.because, split.extra);
        continue;
      }

      let alignment: AlignedSegment | undefined = aligned.get(keywordOwner);

      if (alignment === undefined) {
        const source: string | undefined = this.sliceSource(keywordSegment.range);

        alignment = {
          source,
          offsets:
            source === undefined
              ? undefined
              : alignParsedToSource(source, keywordSegment.text),
        };
        aligned.set(keywordOwner, alignment);
      }

      const local: DetectedInlineReference = {
        ...detected,
        index: detected.index - (starts[keywordOwner] ?? 0),
      };

      if (!this.tellCitationIsLiteral(local, range, alignment.source, alignment.offsets)) {
        this.reportUnnavigableCitation(detected, sectionContext, range);
        continue;
      }

      if (!this.tellTargetIdDeclared(detected.targetId)) {
        this.reportUndeclaredTarget(detected, sectionContext, range);
        continue;
      }

      this.collectedInlineReferences.push({
        fromId: sectionContext,
        toId: detected.targetId,
        kind: detected.kind,
      });
    }
  }

  /**
   * Records which segment each character of a run's visible text came from.
   *
   * @param segments - The run's segments
   * @returns For each visible offset, the index of its segment
   */
  private static indexSegmentOwners(segments: readonly InlineSegment[]): readonly number[] {
    const owners: number[] = [];

    // One entry per UTF-16 unit, to line up with string offsets; iterating the
    // text with for...of would step by code point instead.
    segments.forEach((segment: InlineSegment, index: number): void => {
      const start: number = owners.length;

      owners.length = start + segment.text.length;
      owners.fill(index, start);
    });

    return owners;
  }

  /**
   * Records where each segment begins in a run's visible text.
   *
   * @param segments - The run's segments
   * @returns The visible offset of each segment's first character
   */
  private static indexSegmentStarts(segments: readonly InlineSegment[]): readonly number[] {
    const starts: number[] = [];
    let offset: number = 0;

    for (const segment of segments) {
      starts.push(offset);
      offset += segment.text.length;
    }

    return starts;
  }

  /**
   * Says what split a citation across segments, for its diagnostic.
   *
   * Formatting is named when it is what differs: `see **8.1#3**` is split by
   * bold text. Otherwise the kind of segment in the way is named, and where
   * two text segments meet with nothing visible between them, only inline
   * HTML can have separated them.
   *
   * @param segments - The run's segments
   * @param first - Index of the segment holding the keyword
   * @param last - Index of the segment holding the identifier's end
   * @returns The phrase for the message, and any data it adds
   */
  private static describeSplit(
    segments: readonly InlineSegment[],
    first: number,
    last: number,
  ): SplitDescription {
    const spanned: readonly InlineSegment[] = segments.slice(first, last + 1);
    const shared: readonly string[] = spanned.reduce(
      (common: readonly string[], segment: InlineSegment): readonly string[] =>
        common.filter((wrapper: string, depth: number): boolean => segment.wrappers[depth] === wrapper),
      spanned[0]?.wrappers ?? [],
    );

    for (const segment of spanned) {
      const wrapper: string | undefined = segment.wrappers[shared.length];
      const description: string | undefined =
        wrapper === undefined ? undefined : WRAPPER_DESCRIPTIONS.get(wrapper);

      if (wrapper !== undefined && description !== undefined) {
        return { because: `is split by ${description}`, extra: { wrapper } };
      }
    }

    const obstacle: InlineSegment | undefined = spanned.find(
      (segment: InlineSegment): boolean => segment.kind !== 'text',
    );
    const description: string =
      SPLIT_DESCRIPTIONS.get(obstacle?.kind ?? '') ?? TRANSPARENT_SPLIT_DESCRIPTION;

    return { because: `is split by ${description}` };
  }

  /**
   * Reports whether this citation is written literally at its own position.
   *
   * Only the keyword, the single space and the identifier are required to be
   * literal. What follows them is not: a citation may be terminated by a
   * character reference (`see 1#1&nbsp;here`) and remain perfectly findable,
   * because a search stops at the identifier. Applying the parsed token's
   * terminator rules to raw characters rejected exactly those documents.
   *
   * @param detected - The citation under test
   * @param range - The node's range, absent in unit tests that supply bare text
   * @param source - The node's raw source, when it could be located
   * @param offsets - Parsed-to-source offset map, when alignment succeeded
   * @returns `true` when the source carries this citation literally
   */
  private tellCitationIsLiteral(
    detected: DetectedInlineReference,
    range?: PositionRange,
    source?: string,
    offsets?: readonly number[],
  ): boolean {
    if (detected.gap !== ' ') {
      return false;
    }

    // No range means no source to consult: the rule's unit tests supply bare
    // text. That differs from having a range and failing to map it, which is
    // treated as unverifiable below.
    if (range === undefined) {
      return true;
    }

    if (source === undefined || offsets === undefined) {
      return false;
    }

    const at: number | undefined = offsets[detected.index];
    const nodeStart: number | undefined = this.offsetOf(range.start);

    if (at === undefined || nodeStart === undefined) {
      return false;
    }

    return (
      source.startsWith(`${detected.keyword} ${detected.targetId}`, at) &&
      this.tellRecipeBoundsCitation(nodeStart + at, detected)
    );
  }

  /**
   * Reports whether the published recipes accept the characters either side
   * of a citation in the source (1#9.11).
   *
   * Before the keyword, the recipes accept a word boundary or `_`: `_` is a
   * word character to both engines, and `_see 8.1_` is ordinary emphasis.
   * After the identifier they accept anything but an ASCII letter or digit.
   * After a bare DocID a `#` is refused too, and a `.` is allowed only as the
   * end of a sentence -- not before a letter, digit, `.` or `#` -- so that
   * `8.1` is not found inside `8.1#3`, `8.1.2` or `8.1..2`; after a SectionID
   * a `.` is allowed, since the recipe finds a section and those below it.
   *
   * The whole source is read, not the node's slice: a citation at the start
   * of a node is preceded by whatever came before the node.
   *
   * @param start - Absolute source offset of the keyword
   * @param detected - The citation, known to be literal at `start`
   * @returns `true` when the recipe for this target would match here
   */
  private tellRecipeBoundsCitation(start: number, detected: DetectedInlineReference): boolean {
    // `(\b|_)` before the keyword: `_`, or anything the word-boundary test
    // accepts, which is ripgrep's own definition of `\b`.
    const before: string = start > 0 ? this.sourceText.charAt(start - 1) : '';

    if (before !== '_' && !this.tellAtWordBoundary(this.sourceText, start)) {
      return false;
    }

    const end: number = start + detected.keyword.length + 1 + detected.targetId.length;
    const next: string = this.sourceText.charAt(end);

    if (next === '' || LINE_BREAK_CHARACTER.test(next)) {
      return true;
    }

    if (RECIPE_EXCLUDED_BOUNDARY.test(next) || next === '#') {
      return false;
    }

    if (next !== '.' || detected.targetId.includes('#')) {
      return true;
    }

    const afterFullStop: string = this.sourceText.charAt(end + 1);

    return (
      !RECIPE_EXCLUDED_BOUNDARY.test(afterFullStop) &&
      afterFullStop !== '.' &&
      afterFullStop !== '#'
    );
  }

  /**
   * Reports a candidate that is not a complete, conforming identifier.
   *
   * The `#` decides whether anything is reported at all. Ordinary writing
   * produces numbers after `see` and `per` constantly -- `per 60s`,
   * `see 1..2` -- and never produces `1#1`. So a failed candidate carrying a
   * separator was certainly meant as an identifier and is an error, while one
   * without is prose and is passed over in silence.
   *
   * @param detected - The candidate that failed
   * @param sectionContext - Section the text belongs to
   * @param range - Positional range of the text node
   */
  private reportNonConformingCandidate(
    detected: DetectedInlineReference,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be a DocID or a SectionID
    sectionContext: DocID | SectionID,
    range?: PositionRange,
  ): void {
    if (!detected.candidate.includes('#')) {
      return;
    }

    this.collectedDiagnostics.push(
      this.createDiagnostic(
        `"${detected.keyword} ${detected.candidate}" is malformed: ` +
        `"${detected.candidate}" is not a complete identifier. It is not read as a ` +
        `reference to a shorter one.`,
        range,
        {
          cause: MALFORMED_TARGET_CAUSE,
          candidate: detected.candidate,
          fromId: sectionContext,
          kind: detected.kind,
        },
        'error',
      ),
    );
  }

  /**
   * Reports a citation whose source form no search can find (1#9.11 rule 2).
   *
   * Severity follows the same test as an undeclared target: an identifiable
   * target -- a SectionID, a declared DocID, or the document's own -- was
   * certainly meant as a citation, so an unfindable one is an error. A bare
   * number naming nothing known cannot be told from emphasised prose, so it
   * warns, and corpus validation raises it if the document turns out to exist.
   *
   * @param detected - The citation that is not literal in the source
   * @param sectionContext - Section the text belongs to
   * @param range - Positional range of the text node
   * @param split - What split it, when it spans segments, e.g. `is split by bold text`
   * @param extra - Data the diagnostic carries in addition
   */
  private reportUnnavigableCitation(
    detected: DetectedInlineReference,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be a DocID or a SectionID
    sectionContext: DocID | SectionID,
    range?: PositionRange,
    split?: string,
    extra?: Readonly<Record<string, unknown>>,
  ): void {
    const identifiable: boolean =
      detected.targetId.includes('#') || this.tellTargetIdDeclared(detected.targetId);
    const because: string =
      split === undefined
        ? 'is not written as adjacent literal text on one line'
        : `${split} rather than written as adjacent literal text on one line`;

    this.collectedDiagnostics.push(
      this.createDiagnostic(
        `"${detected.keyword} ${detected.targetId}" ${because}, so no search finds it. ` +
        `Put the keyword and the identifier on one line with a single space between ` +
        `them, and without formatting or escapes.`,
        range,
        {
          cause: CITATION_SOURCE_FORM_CAUSE,
          reason: UNDECLARED_TARGET_REASON,
          targetId: detected.targetId,
          targetDocId: this.showTargetDocId(detected.targetId),
          fromId: sectionContext,
          kind: detected.kind,
          ...(extra ?? {}),
        },
        identifiable ? 'error' : INLINE_REFERENCE_DIAGNOSTIC_SEVERITY,
      ),
    );
  }

  /**
   * Reports a conforming, navigable citation whose DocID is not declared.
   *
   * @param detected - The citation
   * @param sectionContext - Section the text belongs to
   * @param range - Positional range of the text node
   */
  private reportUndeclaredTarget(
    detected: DetectedInlineReference,
    // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: context may be a DocID or a SectionID
    sectionContext: DocID | SectionID,
    range?: PositionRange,
  ): void {
    const parentDocId: string = this.showTargetDocId(detected.targetId);
    const quoted: string = `"${detected.kind} ${detected.targetId}"`;
    const data: Readonly<Record<string, unknown>> = {
      reason: UNDECLARED_TARGET_REASON,
      targetId: detected.targetId,
      targetDocId: parentDocId,
      fromId: sectionContext,
      kind: detected.kind,
    };

    const diagnostic: Diagnostic = detected.targetId.includes('#')
      ? this.createDiagnostic(
          `${quoted} targets DocID "${parentDocId}", which the References section ` +
          `does not declare. Declare ${parentDocId} in References.`,
          range,
          data,
          UNDECLARED_SECTION_TARGET_SEVERITY,
        )
      : this.createDiagnostic(
          `${quoted} reads as a reference to DocID "${parentDocId}", which the ` +
          `References section does not declare. If it is a reference, declare ` +
          `${parentDocId} in References; if it is ordinary prose, it can be left as it is.`,
          range,
          data,
        );

    this.collectedDiagnostics.push(diagnostic);
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
   * Finds every `see`/`per` citation candidate in a run's visible text.
   *
   * A keyword is recognised where a word boundary precedes it in the text a
   * reader sees, and a candidate where digits follow it after whitespace.
   * Neither is recognised when it starts inside inline code or a break: code
   * may continue a candidate, but an author never cites through it (1#9.5).
   *
   * @param visible - The run's visible text
   * @param segments - The run's segments
   * @param owners - For each visible offset, the index of its segment
   * @returns The candidates, in order of occurrence, indexed into `visible`
   */
  private detectInlineReferences(
    visible: string,
    segments: readonly InlineSegment[],
    owners: readonly number[],
  ): readonly DetectedInlineReference[] {
    const detectedMatches: DetectedInlineReference[] = [];
    const tellIsText = (offset: number): boolean =>
      segments[owners[offset] ?? -1]?.kind === 'text';

    KEYWORD_PATTERN.lastIndex = 0;

    let keywordMatch: RegExpExecArray | null = KEYWORD_PATTERN.exec(visible);

    while (keywordMatch !== null) {
      const keyword: string = keywordMatch[1] ?? '';
      const index: number = keywordMatch.index;
      const keywordIsText: boolean = Array.from(keyword, (_: string, offset: number): boolean =>
        tellIsText(index + offset),
      ).every(Boolean);

      if (keywordIsText && this.tellAtWordBoundary(visible, index)) {
        const detected: DetectedInlineReference | undefined = this.readCandidate(
          visible,
          index,
          keyword,
        );

        if (
          detected !== undefined &&
          tellIsText(index + keyword.length + detected.gap.length)
        ) {
          detectedMatches.push(detected);
        }
      }

      keywordMatch = KEYWORD_PATTERN.exec(visible);
    }

    return detectedMatches;
  }

  /**
   * Reads the candidate identifier that follows a keyword, if there is one.
   *
   * The candidate is the maximal run of identifier characters, taken whole
   * before it is tested. Taking it whole is what stops a malformed identifier
   * decaying into a shorter valid one: `1#1#9` fails, rather than passing as
   * `1#1`.
   *
   * @param text - The run's visible text
   * @param keywordIndex - Index of the keyword's first character
   * @param keyword - The keyword exactly as written
   * @returns The candidate, or `undefined` when no digits follow the keyword
   */
  private readCandidate(
    text: string,
    keywordIndex: number,
    keyword: string,
  ): DetectedInlineReference | undefined {
    const afterKeyword: number = keywordIndex + keyword.length;
    let cursor: number = afterKeyword;

    while (cursor < text.length && WHITESPACE.test(text.charAt(cursor))) {
      cursor += 1;
    }

    const gap: string = text.slice(afterKeyword, cursor);

    if (gap.length === 0 || !/[0-9]/.test(text.charAt(cursor))) {
      return undefined;
    }

    const candidateStart: number = cursor;

    while (cursor < text.length && CANDIDATE_CHARACTERS.test(text.charAt(cursor))) {
      cursor += 1;
    }

    const candidate: string = text.slice(candidateStart, cursor);
    const terminator: string | undefined =
      cursor < text.length ? text.charAt(cursor) : undefined;

    const terminated: boolean =
      terminator === undefined ||
      WHITESPACE.test(terminator) ||
      PERMITTED_TERMINATOR_PUNCTUATION.has(terminator);

    const targetId: string = candidate.endsWith('.') ? candidate.slice(0, -1) : candidate;
    const conforms: boolean =
      terminated &&
      (this.grammar.parseDocId(targetId).valid || this.grammar.parseSectionId(targetId).valid);

    return {
      kind: keyword.toLowerCase() as InlineReferenceKind,
      keyword,
      candidate,
      targetId,
      conforms,
      gap,
      index: keywordIndex,
    };
  }

  /**
   * Reports whether a keyword at `index` stands at a word boundary.
   *
   * Reads whole code points: `charAt` would return half of a supplementary
   * character and misjudge it.
   *
   * @param text - The text being scanned
   * @param index - Index of the keyword's first character
   * @returns `true` when nothing word-like immediately precedes the keyword
   */
  private tellAtWordBoundary(text: string, index: number): boolean {
    if (index === 0) {
      return true;
    }

    const before: number | undefined = text.codePointAt(index - 1);

    if (before === undefined) {
      return true;
    }

    // A low surrogate here means the preceding character is supplementary;
    // step back one more unit to read the whole code point.
    const isLowSurrogate: boolean = before >= 0xdc00 && before <= 0xdfff;
    const codePoint: number | undefined = isLowSurrogate
      ? text.codePointAt(index - 2)
      : before;

    if (codePoint === undefined) {
      return true;
    }

    return !WORD_CHARACTER.test(String.fromCodePoint(codePoint));
  }


  /**
   * Returns the raw source belonging to a node, when its range is known.
   *
   * @param range - The node's positional range
   * @returns The source slice, or `undefined` when no range was supplied
   */
  private sliceSource(range?: PositionRange): string | undefined {
    if (range === undefined) {
      return undefined;
    }

    const startOffset: number | undefined = this.offsetOf(range.start);
    const endOffset: number | undefined = this.offsetOf(range.end);

    if (startOffset === undefined || endOffset === undefined) {
      return undefined;
    }

    return this.sourceText.slice(startOffset, endOffset);
  }

  /**
   * Converts a line/character position into an absolute source offset.
   *
   * @param position - A position within the document
   * @returns The offset, or `undefined` when the line is out of range
   */
  private offsetOf(position: Position): number | undefined {
    const lineStart: number | undefined = this.lineStarts[position.line];

    return lineStart === undefined ? undefined : lineStart + position.character;
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
   * All diagnostics share the same rule ID ({@link INLINE_REFERENCE_RULE_ID})
   * and document URI.
   *
   * @param message - Human-readable description of the issue
   * @param range - Optional positional range within the source document
   * @param data - Optional structured detail
   * @param severity - Defaults to {@link INLINE_REFERENCE_DIAGNOSTIC_SEVERITY}
   * @returns A fully populated diagnostic object
   */
  private createDiagnostic(
    message: string,
    range?: PositionRange,
    data?: Readonly<Record<string, unknown>>,
    severity: DiagnosticSeverity = INLINE_REFERENCE_DIAGNOSTIC_SEVERITY,
  ): Diagnostic {
    const diagnostic: Diagnostic = {
      ruleId: INLINE_REFERENCE_RULE_ID,
      severity,
      message,
      uri: this.uri,
      ...(range !== undefined ? { range } : {}),
      ...(data !== undefined ? { data } : {}),
    };

    return diagnostic;
  }
}

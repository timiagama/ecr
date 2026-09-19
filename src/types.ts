/**
 * ECR Output Schema Types
 *
 * Derived from section 1#10 of the ECR Structural Specification (doc 1).
 *
 * These types define the normative output schema produced by the ECR linter.
 * The schema is host-agnostic and designed for consumption by graph engines,
 * Language Servers, Obsidian plugins, and other host environments.
 */

// ---------------------------------------------------------------------------
// Identity Type Aliases (per 1#9.2)
// ---------------------------------------------------------------------------

/**
 * Stable document identity.
 *
 * Grammar: `Digit+ ("." Digit+)*`
 *
 * @example "3.1"
 */
export type DocID = string;

/**
 * Stable section identity.
 *
 * Grammar: `DocID ("." Digit+)+`
 *
 * A SectionID always extends the owning document's DocID.
 *
 * @example "3.1.2"
 */
export type SectionID = string;

// ---------------------------------------------------------------------------
// Diagnostic Types (per 1#10.3)
// ---------------------------------------------------------------------------

/**
 * Severity level for a diagnostic emitted by the ECR linter.
 */
export type DiagnosticSeverity = "error" | "warning" | "info";

/**
 * A zero-based line/character position within a document.
 */
export interface Position {
  /** Zero-based line number. */
  readonly line: number;
  /** Zero-based character offset within the line. */
  readonly character: number;
}

/**
 * A contiguous range within a document defined by a start and end position.
 */
export interface PositionRange {
  /** Inclusive start of the range. */
  readonly start: Position;
  /** Exclusive end of the range. */
  readonly end: Position;
}

/**
 * A host-agnostic diagnostic produced by the ECR linter.
 *
 * Diagnostics can be mapped into LSP diagnostics or rendered in other UIs.
 */
export interface Diagnostic {
  /** Severity of this diagnostic. */
  readonly severity: DiagnosticSeverity;
  /** Identifier of the validation rule that produced this diagnostic. */
  readonly ruleId: string;
  /** Human-readable description of the issue. */
  readonly message: string;
  /** Opaque, host-provided URI of the source document. */
  readonly uri: string;
  /**
   * Positional range within the source document.
   * Optional; depends on whether the Markdown parser provides positional metadata.
   */
  readonly range?: PositionRange;
  /** DocID of the document, when determinable. */
  readonly docId?: DocID;
  /** SectionID providing structural context, when determinable. */
  readonly sectionId?: SectionID;
  /** Arbitrary structured data associated with this diagnostic. */
  readonly data?: Readonly<Record<string, unknown>>;
}

// ---------------------------------------------------------------------------
// Reference Direction Types (per 1#9.7, 1#10.6)
// ---------------------------------------------------------------------------

/**
 * Semantic direction label for a document-level reference edge.
 *
 * Direction describes the relationship meaning; it does not alter edge orientation.
 */
export type ReferenceDirection = "authority" | "dependency" | "constraint" | "contract";

// ---------------------------------------------------------------------------
// Inline Reference Kind (per 1#10.7)
// ---------------------------------------------------------------------------

/**
 * The keyword form of an inline reference.
 */
export type InlineReferenceKind = "see" | "per";

// ---------------------------------------------------------------------------
// Extracted Structural Artefacts (per 1#10.4 - 1#10.7)
// ---------------------------------------------------------------------------

/**
 * A single section extracted from a validated ECR document.
 *
 * The H1 heading is represented as the root section node. All numbered
 * headings of depth \>= 2 are child section nodes.
 */
export interface SectionNode {
  /** DocID (for the root H1 node) or SectionID (for sub-headings). */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: DocID for H1, SectionID for depth >= 2
  readonly id: DocID | SectionID;
  /**
   * Human-readable heading text.
   * Extracted for display and diagnostics only; not part of ECR structural identity.
   */
  readonly title: string;
  /** Markdown heading depth (1 for H1, 2 for H2, etc.). */
  readonly headingDepth: number;
  /**
   * Identifier of the nearest preceding heading whose depth is exactly
   * `headingDepth - 1`. Absent for the root H1 node.
   */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: parent may be DocID (H1) or SectionID
  readonly parentId?: DocID | SectionID;
}

/**
 * A document-level typed edge extracted from a `## References` list item.
 *
 * Edges are directed from the current document to the referenced document.
 */
export interface ReferenceEdge {
  /** DocID of the document containing the reference. */
  readonly fromDocId: DocID;
  /** Target DocID declared in the References entry. */
  readonly toDocId: DocID;
  /** Semantic direction label for this edge. */
  readonly direction: ReferenceDirection;
  /** Non-empty explanation text extracted from the References entry. */
  readonly explanation: string;
  /**
   * Non-empty title text extracted from the References entry.
   * For display and diagnostics only; not part of ECR structural identity.
   */
  readonly title: string;
}

/**
 * A section-attributed edge extracted from an inline `see` or `per` reference.
 */
export interface InlineReferenceEdge {
  /** Identifier of the section context where the inline reference occurs. */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: source may be DocID or SectionID
  readonly fromId: DocID | SectionID;
  /** Target identifier referenced by the inline form. */
  // eslint-disable-next-line @typescript-eslint/no-duplicate-type-constituents -- Semantically distinct: target may be DocID or SectionID
  readonly toId: DocID | SectionID;
  /** The keyword form (`see` or `per`) that produced this edge. */
  readonly kind: InlineReferenceKind;
}

/**
 * Canonical structural representation of a single validated ECR document.
 */
export interface ExtractedDocument {
  /** DocID extracted from the H1 heading. */
  readonly docId: DocID;
  /**
   * Document title extracted from the H1 heading.
   * For display and diagnostics only; not part of ECR structural identity.
   */
  readonly title: string;
  /** All section nodes extracted from numbered headings, including the root H1. */
  readonly sections: readonly SectionNode[];
  /** Document-level reference edges extracted from the `## References` section. */
  readonly references: readonly ReferenceEdge[];
  /** Section-level inline reference edges extracted from valid `see`/`per` forms. */
  readonly inlineReferences: readonly InlineReferenceEdge[];
}

// ---------------------------------------------------------------------------
// Lint Result Types (per 1#10.2)
// ---------------------------------------------------------------------------

/**
 * Input descriptor for a single-document lint operation.
 */
export interface LintInput {
  /** Opaque, host-provided URI identifying the document instance. */
  readonly uri: string;
  /** Optional version tag for the document instance. */
  readonly version?: number;
}

/**
 * Result of a lint operation over a single Markdown document.
 */
export interface LintResult {
  /** Input descriptor identifying the document that was validated. */
  readonly input: LintInput;
  /** Whether the document satisfies per-document ECR structural invariants. */
  readonly ok: boolean;
  /** Diagnostics produced during validation. */
  readonly diagnostics: readonly Diagnostic[];
  /**
   * Extracted structural artefacts from the document.
   * Present when a valid DocID is recovered and structural extraction succeeds.
   */
  readonly extracted?: ExtractedDocument;
}

// ---------------------------------------------------------------------------
// Corpus Result Types (per 1#10.8)
// ---------------------------------------------------------------------------

/**
 * A single document entry within a corpus validation result.
 */
export interface CorpusDocumentEntry {
  /** Opaque, host-provided URI identifying the document instance. */
  readonly uri: string;
  /** Per-document lint result. */
  readonly result: LintResult;
}

/**
 * Global identifier index built from a validated corpus.
 *
 * Maps each unique identifier to the URI of the document that defines it.
 */
export interface CorpusIndex {
  /** Mapping from each DocID to the URI of its defining document. */
  readonly docIds: Readonly<Record<DocID, string>>;
  /** Mapping from each SectionID to the URI of its defining document. */
  readonly sectionIds: Readonly<Record<SectionID, string>>;
}

/**
 * Result of validating a corpus of ECR documents.
 *
 * Includes per-document results, corpus-wide diagnostics, and an optional
 * global identifier index suitable for graph construction.
 */
export interface CorpusResult {
  /** Per-document lint results for every document in the corpus. */
  readonly documents: readonly CorpusDocumentEntry[];
  /**
   * Global identifier index.
   * Present when corpus-wide indexing succeeds.
   */
  readonly index?: CorpusIndex;
  /** Corpus-wide diagnostics (e.g. duplicate DocIDs, unresolved references). */
  readonly diagnostics: readonly Diagnostic[];
}

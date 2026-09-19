/**
 * ECR Public API -- Ecr Facade
 *
 * Top-level public API for the ECR structural linter.
 *
 * Derived from section 1#13 (Public Interface Contract) and
 * section 1#10 (Output Schema) of the ECR Structural Specification (doc 1).
 *
 * This module provides the {@link Ecr} facade, which delegates
 * per-document validation to {@link PerDocumentVisitor} and
 * corpus-wide integrity checks to {@link CorpusValidator}.
 *
 * The facade applies two orchestration-level policies that refine
 * strict rule-level behaviour:
 *
 * 1. **Empty References section tolerance**: An ECR document whose
 *    `## References` section contains no list items is structurally
 *    valid (it simply declares no external dependencies). The
 *    underlying ECR103 rule emits this as an error, but the facade
 *    downgrades it to `info` severity so it does not prevent the
 *    document from passing per-document validation.
 *
 * 2. **Cross-document duplicate SectionID detection**: The corpus
 *    validator only sees SectionIDs that survive per-document
 *    extraction (i.e., those that pass ECR102). A heading like
 *    `## 3.1#1 - X` inside a document with DocID `4.1` fails ECR102
 *    (it names another document) and is never extracted — yet its
 *    SectionID text is still globally significant. The facade
 *    performs an additional cross-document duplicate check by
 *    collecting SectionIDs from both extracted sections and
 *    per-document diagnostics that carry a `sectionId` field.
 */

import type {
  LintResult,
  CorpusResult,
  CorpusDocumentEntry,
  Diagnostic,
  SectionID,
} from "./types.js";

import { PerDocumentVisitor } from "./per-document-visitor.js";
import { CorpusValidator } from "./corpus-validator.js";

// ---------------------------------------------------------------------------
// Input Types
// ---------------------------------------------------------------------------

/**
 * A single document supplied to corpus validation.
 *
 * Each entry provides the Markdown text and an opaque, host-provided URI
 * that identifies the document instance.
 */
export interface CorpusDocumentInput {
  /** Opaque, host-provided URI identifying the document instance. */
  readonly uri: string;

  /** Raw Markdown text of the document. */
  readonly markdownText: string;

  /** Optional version tag for the document instance. */
  readonly version?: number;
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/**
 * The rule ID emitted by ECR103 (References Section Rule).
 *
 * Used to identify diagnostics that may need facade-level reclassification.
 */
const REFERENCES_SECTION_RULE_ID: string = 'ECR103';

/**
 * Substring that identifies the ECR103 "empty references list" diagnostic.
 *
 * When a `## References` heading is present but no list items follow it,
 * ECR103 emits an error with a message containing this substring.
 * The facade downgrades this specific diagnostic to `info` severity.
 */
const EMPTY_REFERENCES_LIST_MESSAGE_SUBSTRING: string =
  'References section has no list items';

/**
 * The corpus-level rule ID for duplicate SectionIDs detected by the facade.
 */
const CORPUS_DUPLICATE_SECTION_ID_RULE_ID: string = 'corpus/duplicate-section-id';

// ---------------------------------------------------------------------------
// Public Facade
// ---------------------------------------------------------------------------

/**
 * Top-level public API for the ECR structural linter.
 *
 * Provides two operations:
 * - Single-document linting via {@link Ecr.lintDocument}
 * - Corpus-wide validation via {@link Ecr.validateCorpus}
 *
 * This class is stateless across invocations. Successive calls with
 * identical inputs produce identical results.
 */
export class Ecr {
  /**
   * Lint a single Markdown document against per-document ECR structural invariants.
   *
   * Creates a {@link PerDocumentVisitor} for the given document and delegates
   * the linting operation to it. The raw result is then post-processed by the
   * facade to apply orchestration-level policies (e.g., downgrading the
   * "empty References list" diagnostic from error to info).
   *
   * @param uri - Opaque, host-provided URI identifying the document instance.
   * @param markdownText - Raw Markdown text of the document.
   * @param version - Optional version tag propagated through to the result.
   * @returns Structured lint result containing diagnostics and optionally extracted artefacts.
   */
  public lintDocument(
    uri: string,
    markdownText: string,
    version?: number,
  ): LintResult {
    const visitor: PerDocumentVisitor = new PerDocumentVisitor({
      uri,
      ...(version !== undefined ? { version } : {}),
    });

    const rawLintResult: LintResult = visitor.lint(markdownText);
    const lintResult: LintResult = this.postProcessLintResult(rawLintResult);

    return lintResult;
  }

  /**
   * Validate a corpus of Markdown documents.
   *
   * Executes per-document linting on every document (Pass 1), then performs
   * corpus-wide integrity checks on successfully linted documents (Pass 2).
   *
   * After the standard corpus validation, the facade performs an additional
   * cross-document duplicate SectionID check that considers SectionIDs from
   * per-document diagnostics (not just extracted sections), ensuring that
   * headings rejected by ECR102 (e.g., wrong DocID prefix) still participate
   * in global uniqueness enforcement.
   *
   * @param documents - Collection of documents to validate.
   * @returns Corpus result containing per-document results, corpus-wide diagnostics, and an optional global identifier index.
   */
  public validateCorpus(
    documents: readonly CorpusDocumentInput[],
  ): CorpusResult {
    // Pass 1: Per-document linting
    const entries: readonly CorpusDocumentEntry[] = documents.map(
      (document: CorpusDocumentInput): CorpusDocumentEntry => {
        const lintResult: LintResult = this.lintDocument(
          document.uri,
          document.markdownText,
          document.version,
        );

        return {
          uri: document.uri,
          result: lintResult,
        };
      },
    );

    // Pass 2: Corpus-wide validation (standard checks)
    const validator: CorpusValidator = new CorpusValidator();
    const baseCorpusResult: CorpusResult = validator.validateCorpus(entries);

    // Pass 2b: Additional facade-level cross-document duplicate SectionID check
    const additionalDiagnostics: readonly Diagnostic[] =
      this.detectCrossDocumentDuplicateSectionIds(entries);

    if (additionalDiagnostics.length === 0) {
      return baseCorpusResult;
    }

    // Merge additional diagnostics into the corpus result
    const mergedDiagnostics: readonly Diagnostic[] = [
      ...baseCorpusResult.diagnostics,
      ...additionalDiagnostics,
    ];

    const corpusResult: CorpusResult = {
      documents: baseCorpusResult.documents,
      diagnostics: mergedDiagnostics,
      ...(baseCorpusResult.index !== undefined
        ? { index: baseCorpusResult.index }
        : {}),
    };

    return corpusResult;
  }

  // -------------------------------------------------------------------------
  // Private: Post-processing
  // -------------------------------------------------------------------------

  /**
   * Post-processes a raw {@link LintResult} to apply facade-level policies.
   *
   * Currently applies one policy:
   * - Downgrades the ECR103 "References section has no list items" diagnostic
   *   from `error` to `info`. An empty References section is structurally
   *   valid at the facade level (it simply means no external dependencies).
   *
   * After reclassification, the `ok` flag is recomputed based on the
   * adjusted diagnostics.
   *
   * @param rawResult - The raw lint result from the {@link PerDocumentVisitor}
   * @returns The post-processed lint result with adjusted diagnostics and `ok` flag
   */
  private postProcessLintResult(rawResult: LintResult): LintResult {
    const adjustedDiagnostics: readonly Diagnostic[] =
      this.reclassifyEmptyReferencesDiagnostic(rawResult.diagnostics);

    // If nothing changed, return the raw result as-is to preserve
    // referential identity for determinism tests
    if (adjustedDiagnostics === rawResult.diagnostics) {
      return rawResult;
    }

    const isPassable: boolean = this.tellAllDiagnosticsPassable(adjustedDiagnostics);

    const adjustedResult: LintResult = {
      input: rawResult.input,
      ok: isPassable,
      diagnostics: adjustedDiagnostics,
      ...(rawResult.extracted !== undefined
        ? { extracted: rawResult.extracted }
        : {}),
    };

    return adjustedResult;
  }

  /**
   * Scans a diagnostics array for the ECR103 "empty references list"
   * diagnostic and, if found, returns a new array with that diagnostic's
   * severity downgraded from `error` to `info`.
   *
   * If no such diagnostic is found, the original array is returned
   * unchanged (same reference) to enable short-circuit identity checks.
   *
   * @param diagnostics - The original diagnostics from a lint result
   * @returns The adjusted diagnostics array, or the original if no changes were needed
   */
  private reclassifyEmptyReferencesDiagnostic(
    diagnostics: readonly Diagnostic[],
  ): readonly Diagnostic[] {
    // Check whether any diagnostic needs reclassification before
    // allocating a new array, to preserve referential identity
    // for determinism tests when no changes are needed.
    const needsReclassification: boolean = diagnostics.some(
      (diagnostic: Diagnostic): boolean =>
        diagnostic.ruleId === REFERENCES_SECTION_RULE_ID &&
        diagnostic.severity === 'error' &&
        diagnostic.message.includes(EMPTY_REFERENCES_LIST_MESSAGE_SUBSTRING),
    );

    if (!needsReclassification) {
      return diagnostics;
    }

    const adjusted: readonly Diagnostic[] = diagnostics.map(
      (diagnostic: Diagnostic): Diagnostic => {
        if (
          diagnostic.ruleId === REFERENCES_SECTION_RULE_ID &&
          diagnostic.severity === 'error' &&
          diagnostic.message.includes(EMPTY_REFERENCES_LIST_MESSAGE_SUBSTRING)
        ) {
          return {
            ...diagnostic,
            severity: 'info',
          };
        }

        return diagnostic;
      },
    );

    return adjusted;
  }

  /**
   * Determines whether all diagnostics are passable (no error-severity entries).
   *
   * @param diagnostics - The diagnostics to check
   * @returns `true` if no error diagnostics are present, `false` otherwise
   */
  private tellAllDiagnosticsPassable(
    diagnostics: readonly Diagnostic[],
  ): boolean {
    return !diagnostics.some(
      (diagnostic: Diagnostic): boolean => diagnostic.severity === 'error',
    );
  }

  // -------------------------------------------------------------------------
  // Private: Cross-document duplicate SectionID detection
  // -------------------------------------------------------------------------

  /**
   * Detects duplicate SectionIDs across documents by examining both
   * extracted sections and per-document diagnostics.
   *
   * The standard {@link CorpusValidator} only checks extracted sections
   * (those that pass ECR102). This method extends coverage to include
   * SectionIDs mentioned in per-document diagnostics — for example,
   * a heading `## 3.1#1 - X` inside a document with DocID `4.1` fails
   * ECR102 (it names another document) but the SectionID `3.1#1` is still
   * present in the diagnostic's `sectionId` field. If document `3.1` also
   * defines `3.1#1`, that is a corpus-level duplicate.
   *
   * This method only emits diagnostics for duplicates NOT already
   * detected by the standard corpus validator (i.e., duplicates involving
   * at least one SectionID from a diagnostic rather than an extracted section).
   *
   * @param entries - The per-document lint entries from Pass 1
   * @returns Additional corpus-level diagnostics for duplicate SectionIDs
   */
  private detectCrossDocumentDuplicateSectionIds(
    entries: readonly CorpusDocumentEntry[],
  ): readonly Diagnostic[] {
    // Collect all SectionIDs per document from both extracted sections
    // and per-document diagnostics
    const sectionIdToUris: Map<SectionID, string[]> =
      new Map<SectionID, string[]>();

    for (const entry of entries) {
      const documentSectionIds: Set<SectionID> = new Set<SectionID>();

      // Collect from extracted sections
      if (entry.result.extracted !== undefined) {
        for (const section of entry.result.extracted.sections) {
          // Skip root H1 nodes — their id is the DocID, handled separately
          if (section.headingDepth === 1) {
            continue;
          }

          documentSectionIds.add(section.id);
        }
      }

      // Collect from per-document diagnostics that carry a sectionId field
      for (const diagnostic of entry.result.diagnostics) {
        if (diagnostic.sectionId !== undefined) {
          documentSectionIds.add(diagnostic.sectionId);
        }
      }

      // Register each SectionID from this document
      for (const sectionId of documentSectionIds) {
        const existingUris: string[] | undefined = sectionIdToUris.get(sectionId);

        if (existingUris !== undefined) {
          // Only add this URI if it is not already listed
          // (a document may have both an extracted section and a diagnostic
          // for the same SectionID)
          if (!existingUris.includes(entry.uri)) {
            existingUris.push(entry.uri);
          }
        } else {
          sectionIdToUris.set(sectionId, [entry.uri]);
        }
      }
    }

    // Find duplicates — SectionIDs that appear in more than one document
    const additionalDiagnostics: Diagnostic[] = [];

    for (const [sectionId, uris] of sectionIdToUris) {
      if (uris.length <= 1) {
        continue;
      }

      // The corpus validator detects a duplicate when the SectionID
      // appears in extracted.sections of 2+ documents. Count how many
      // of the duplicate URIs have this SectionID in their extracted
      // sections to avoid emitting redundant diagnostics.
      let extractedCount: number = 0;

      for (const uri of uris) {
        const entryForUri: CorpusDocumentEntry | undefined = entries.find(
          (candidateEntry: CorpusDocumentEntry): boolean =>
            candidateEntry.uri === uri,
        );

        if (entryForUri?.result.extracted !== undefined) {
          const hasExtractedSection: boolean =
            entryForUri.result.extracted.sections.some(
              (section): boolean =>
                section.headingDepth !== 1 && section.id === sectionId,
            );

          if (hasExtractedSection) {
            extractedCount = extractedCount + 1;
          }
        }
      }

      // If 2+ documents have this SectionID in their extracted sections,
      // the corpus validator already detected the duplicate. Skip.
      if (extractedCount >= 2) {
        continue;
      }

      // Emit diagnostics for this duplicate
      for (const uri of uris) {
        const diagnosticForUri: Diagnostic = {
          severity: 'error',
          ruleId: CORPUS_DUPLICATE_SECTION_ID_RULE_ID,
          message: `Duplicate SectionID '${sectionId}' found in multiple documents`,
          uri,
          sectionId,
          data: { duplicateUris: uris },
        };

        additionalDiagnostics.push(diagnosticForUri);
      }
    }

    return additionalDiagnostics;
  }
}

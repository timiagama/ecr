import type {
  CorpusDocumentEntry,
  CorpusIndex,
  CorpusResult,
  Diagnostic,
  DocID,
  ExtractedDocument,
  SectionID,
} from './types.js';
import {
  CITATION_SOURCE_FORM_CAUSE,
  INLINE_REFERENCE_RULE_ID,
  UNDECLARED_TARGET_REASON,
} from './inline-reference-rule.js';

// ---------------------------------------------------------------------------
// Internal helper types
// ---------------------------------------------------------------------------

/**
 * An extracted document paired with its host-provided URI.
 *
 * Used internally to associate extraction results with their source URI
 * during corpus-wide indexing and resolution.
 */
interface IndexableDocument {
  /** Opaque, host-provided URI of the source document. */
  readonly uri: string;
  /** Successfully extracted structural artefacts for this document. */
  readonly extracted: ExtractedDocument;
}

/**
 * Mutable accumulator for corpus-wide diagnostics collected during validation.
 */
interface DiagnosticAccumulator {
  /** The diagnostics collected so far. */
  readonly items: Diagnostic[];
}

// ---------------------------------------------------------------------------
// CorpusValidator
// ---------------------------------------------------------------------------

/**
 * Validates a corpus of ECR documents for corpus-wide structural integrity.
 *
 * Performs Pass 2 of the ECR validation algorithm (per 1#11.2):
 * global uniqueness of DocIDs and SectionIDs, resolution of reference
 * targets, and resolution of inline reference targets.
 *
 * This class is stateless. Each invocation of {@link validateCorpus}
 * operates purely over the provided document entries and produces a
 * self-contained {@link CorpusResult}.
 */
class CorpusValidator {
  /**
   * Validates corpus-wide structural invariants across a set of
   * per-document extraction results.
   *
   * Documents whose per-document lint result does not include a
   * successfully extracted artefact are excluded from corpus-wide
   * indexing and cross-reference resolution.
   *
   * Corpus-wide violations are reported as diagnostics with severity
   * `'error'` (per 1#9.9, 1#12.2), except a stale References title, which
   * is a `'warning'` (1#9.9 rule 5).
   *
   * @param documents - The per-document entries to validate as a corpus.
   * @returns A {@link CorpusResult} containing per-document results,
   *   corpus-wide diagnostics, and an optional global identifier index.
   */
  public validateCorpus(
    documents: readonly CorpusDocumentEntry[],
  ): CorpusResult {
    const indexableDocuments: readonly IndexableDocument[] =
      this.collectIndexableDocuments(documents);

    const accumulator: DiagnosticAccumulator = { items: [] };

    // Step 1–3: Build indexes and validate global uniqueness
    const docIdIndex: Map<DocID, string> =
      this.buildDocIdIndex(indexableDocuments, accumulator);
    const sectionIdIndex: Map<SectionID, string> =
      this.buildSectionIdIndex(indexableDocuments, accumulator);

    const hasDuplicateIdentifiers: boolean = accumulator.items.length > 0;

    // Step 4: Resolve ReferenceEdge.toDocId targets, and warn where an
    // entry's title has drifted from the target document's own title
    this.resolveReferenceTargets(
      indexableDocuments,
      docIdIndex,
      this.buildCanonicalTitleIndex(indexableDocuments),
      accumulator,
    );

    // Step 5: Resolve InlineReferenceEdge.toId targets
    this.resolveInlineReferenceTargets(
      indexableDocuments,
      docIdIndex,
      sectionIdIndex,
      accumulator,
    );

    // Step 6: Validate inline reference parent DocID declared in References
    this.validateInlineReferenceParentDeclarations(
      indexableDocuments,
      docIdIndex,
      accumulator,
    );

    // Step 6b: An undeclared inline target that names a real document is an error
    this.escalateUndeclaredInlineTargets(documents, docIdIndex, accumulator);

    if (hasDuplicateIdentifiers) {
      return {
        documents,
        diagnostics: accumulator.items,
      };
    }

    return {
      documents,
      index: this.buildCorpusIndex(docIdIndex, sectionIdIndex),
      diagnostics: accumulator.items,
    };
  }

  // -------------------------------------------------------------------------
  // Private helpers — filtering
  // -------------------------------------------------------------------------

  /**
   * Filters the input document entries to only those with successfully
   * extracted structural artefacts.
   *
   * Documents without an `extracted` field on their lint result are excluded
   * from corpus-wide indexing and cross-reference resolution.
   *
   * @param documents - The full set of corpus document entries.
   * @returns An array of indexable documents with guaranteed `extracted` fields.
   */
  private collectIndexableDocuments(
    documents: readonly CorpusDocumentEntry[],
  ): readonly IndexableDocument[] {
    const indexable: IndexableDocument[] = [];

    for (const entry of documents) {
      if (entry.result.extracted !== undefined) {
        indexable.push({
          uri: entry.uri,
          extracted: entry.result.extracted,
        });
      }
    }

    return indexable;
  }

  // -------------------------------------------------------------------------
  // Private helpers — index building (Steps 1–3)
  // -------------------------------------------------------------------------

  /**
   * Builds a global DocID-to-URI index and emits error diagnostics for
   * any duplicate DocIDs found across the corpus.
   *
   * Per 1#9.9: DocID MUST be globally unique. Violations are errors
   * (per 1#12.2).
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @param accumulator - Diagnostic accumulator for recording violations.
   * @returns A map from each DocID to the URI of its first-encountered defining document.
   */
  private buildDocIdIndex(
    indexableDocuments: readonly IndexableDocument[],
    accumulator: DiagnosticAccumulator,
  ): Map<DocID, string> {
    const docIdIndex: Map<DocID, string> = new Map<DocID, string>();
    const duplicateDocIds: Map<DocID, readonly string[]> = new Map<DocID, readonly string[]>();

    for (const document of indexableDocuments) {
      const docId: DocID = document.extracted.docId;
      const existingUri: string | undefined = docIdIndex.get(docId);

      if (existingUri !== undefined) {
        const existing: readonly string[] | undefined =
          duplicateDocIds.get(docId);

        if (existing !== undefined) {
          duplicateDocIds.set(docId, [...existing, document.uri]);
        } else {
          duplicateDocIds.set(docId, [existingUri, document.uri]);
        }
      } else {
        docIdIndex.set(docId, document.uri);
      }
    }

    for (const [docId, uris] of duplicateDocIds) {
      for (const uri of uris) {
        accumulator.items.push({
          severity: 'error',
          ruleId: 'corpus/duplicate-doc-id',
          message: `Duplicate DocID '${docId}' found in multiple documents`,
          uri,
          docId,
          data: { duplicateUris: uris },
        });
      }
    }

    return docIdIndex;
  }

  /**
   * Builds a global SectionID-to-URI index and emits error diagnostics for
   * any duplicate SectionIDs found across the corpus.
   *
   * Per 1#9.9: SectionID MUST be globally unique across corpus.
   * Violations are errors (per 1#12.2).
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @param accumulator - Diagnostic accumulator for recording violations.
   * @returns A map from each SectionID to the URI of its first-encountered defining document.
   */
  private buildSectionIdIndex(
    indexableDocuments: readonly IndexableDocument[],
    accumulator: DiagnosticAccumulator,
  ): Map<SectionID, string> {
    const sectionIdIndex: Map<SectionID, string> = new Map<SectionID, string>();
    const duplicateSectionIds: Map<SectionID, readonly string[]> =
      new Map<SectionID, readonly string[]>();

    for (const document of indexableDocuments) {
      for (const section of document.extracted.sections) {
        // Skip the root H1 node — its id is the DocID, handled by DocID index
        if (section.headingDepth === 1) {
          continue;
        }

        const sectionId: SectionID = section.id;
        const existingUri: string | undefined = sectionIdIndex.get(sectionId);

        if (existingUri !== undefined) {
          const existing: readonly string[] | undefined =
            duplicateSectionIds.get(sectionId);

          if (existing !== undefined) {
            duplicateSectionIds.set(sectionId, [...existing, document.uri]);
          } else {
            duplicateSectionIds.set(sectionId, [existingUri, document.uri]);
          }
        } else {
          sectionIdIndex.set(sectionId, document.uri);
        }
      }
    }

    for (const [sectionId, uris] of duplicateSectionIds) {
      for (const uri of uris) {
        const baseDiagnostic: Diagnostic = {
          severity: 'error',
          ruleId: 'corpus/duplicate-section-id',
          message: `Duplicate SectionID '${sectionId}' found in multiple documents`,
          uri,
          sectionId,
          data: { duplicateUris: uris },
        };

        accumulator.items.push(baseDiagnostic);
      }
    }

    return sectionIdIndex;
  }

  // -------------------------------------------------------------------------
  // Private helpers — reference resolution (Steps 4–6)
  // -------------------------------------------------------------------------

  /**
   * Maps each DocID to the title in its document's H1.
   *
   * Where a DocID is duplicated, the first-encountered document wins, matching
   * {@link CorpusValidator.buildDocIdIndex}. The duplicate is reported there.
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @returns A map from each DocID to its canonical title.
   */
  private buildCanonicalTitleIndex(
    indexableDocuments: readonly IndexableDocument[],
  ): ReadonlyMap<DocID, string> {
    const canonicalTitles: Map<DocID, string> = new Map<DocID, string>();

    for (const document of indexableDocuments) {
      if (!canonicalTitles.has(document.extracted.docId)) {
        canonicalTitles.set(document.extracted.docId, document.extracted.title.trim());
      }
    }

    return canonicalTitles;
  }

  /**
   * Resolves all `ReferenceEdge.toDocId` targets against the global DocID
   * index and emits error diagnostics for unresolved targets.
   *
   * Per 1#9.9 rule 3: Every TargetDocID in References MUST resolve to an
   * existing DocID. Violations are errors (per 1#12.2).
   *
   * Per 1#9.9 rule 5: where the target resolves but the entry's title differs
   * from the target's H1 title, a warning is emitted carrying the canonical
   * title. Titles are not part of graph identity, so a stale title never
   * fails validation.
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @param docIdIndex - The global DocID-to-URI index.
   * @param canonicalTitles - Each DocID's title as written in its own H1.
   * @param accumulator - Diagnostic accumulator for recording violations.
   */
  private resolveReferenceTargets(
    indexableDocuments: readonly IndexableDocument[],
    docIdIndex: ReadonlyMap<DocID, string>,
    canonicalTitles: ReadonlyMap<DocID, string>,
    accumulator: DiagnosticAccumulator,
  ): void {
    for (const document of indexableDocuments) {
      for (const reference of document.extracted.references) {
        const targetExists: boolean = docIdIndex.has(reference.toDocId);

        if (!targetExists) {
          accumulator.items.push({
            severity: 'error',
            ruleId: 'corpus/unresolved-reference-target',
            message: `References entry target DocID '${reference.toDocId}' does not resolve to any document in the corpus`,
            uri: document.uri,
            docId: document.extracted.docId,
            data: { unresolvedDocId: reference.toDocId },
          });
          continue;
        }

        const canonicalTitle: string | undefined = canonicalTitles.get(reference.toDocId);
        const referencedTitle: string = reference.title.trim();

        if (canonicalTitle !== undefined && referencedTitle !== canonicalTitle) {
          accumulator.items.push({
            severity: 'warning',
            ruleId: 'corpus/reference-title-mismatch',
            message: `References entry for '${reference.toDocId}' is titled '${referencedTitle}', but that document's title is '${canonicalTitle}'`,
            uri: document.uri,
            docId: document.extracted.docId,
            data: {
              targetDocId: reference.toDocId,
              referencedTitle,
              canonicalTitle,
            },
          });
        }
      }
    }
  }

  /**
   * Resolves all `InlineReferenceEdge.toId` targets against the union of
   * DocID and SectionID indexes and emits error diagnostics for unresolved
   * targets.
   *
   * Per 1#9.9 rule 4: Every inline TargetID MUST resolve to an existing
   * SectionID. Violations are errors (per 1#12.2).
   *
   * Note: the spec says "existing SectionID" but the algorithm (1#11.2
   * step 5) resolves against "the union of DocID and SectionID indexes",
   * meaning a DocID is also a valid resolution target for inline references.
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @param docIdIndex - The global DocID-to-URI index.
   * @param sectionIdIndex - The global SectionID-to-URI index.
   * @param accumulator - Diagnostic accumulator for recording violations.
   */
  private resolveInlineReferenceTargets(
    indexableDocuments: readonly IndexableDocument[],
    docIdIndex: ReadonlyMap<DocID, string>,
    sectionIdIndex: ReadonlyMap<SectionID, string>,
    accumulator: DiagnosticAccumulator,
  ): void {
    for (const document of indexableDocuments) {
      for (const inlineReference of document.extracted.inlineReferences) {
        const targetId: string = inlineReference.toId;
        const resolvedInDocIds: boolean = docIdIndex.has(targetId);
        const resolvedInSectionIds: boolean = sectionIdIndex.has(targetId);

        if (!resolvedInDocIds && !resolvedInSectionIds) {
          accumulator.items.push({
            severity: 'error',
            ruleId: 'corpus/unresolved-inline-target',
            message: `Inline reference target '${targetId}' does not resolve to any DocID or SectionID in the corpus`,
            uri: document.uri,
            docId: document.extracted.docId,
            data: {
              unresolvedTargetId: targetId,
              fromId: inlineReference.fromId,
              kind: inlineReference.kind,
            },
          });
        }
      }
    }
  }

  /**
   * Validates that for each extracted inline reference whose target is a
   * SectionID, the DocID of that SectionID is declared in the referring
   * document's References section.
   *
   * Per 1#9.5 rule 2 and 1#11.2 step 6: if an inline reference targets
   * `X#Y`, the DocID `X` MUST appear in the References section of the
   * referring document.
   *
   * The linter itself never extracts an undeclared edge, so through the
   * {@link Ecr} facade this cannot fire; undeclared targets are handled by
   * {@link CorpusValidator.escalateUndeclaredInlineTargets}. It guards hosts
   * that assemble extracted documents themselves.
   *
   * @param indexableDocuments - Documents with successfully extracted artefacts.
   * @param docIdIndex - The global DocID-to-URI index.
   * @param accumulator - Diagnostic accumulator for recording violations.
   */
  private validateInlineReferenceParentDeclarations(
    indexableDocuments: readonly IndexableDocument[],
    docIdIndex: ReadonlyMap<DocID, string>,
    accumulator: DiagnosticAccumulator,
  ): void {
    for (const document of indexableDocuments) {
      const declaredTargetDocIds: ReadonlySet<DocID> =
        this.collectDeclaredReferenceDocIds(document.extracted);

      for (const inlineReference of document.extracted.inlineReferences) {
        const targetId: string = inlineReference.toId;

        // If the target is itself a known DocID, no parent-declaration
        // check is needed — the inline reference targets the document
        // directly.
        if (docIdIndex.has(targetId)) {
          continue;
        }

        // The target is a SectionID. Its DocID is the text before the `#`.
        const parentDocId: DocID | undefined =
          this.findParentDocId(targetId, docIdIndex);

        if (parentDocId === undefined) {
          // No parent DocID found in corpus — the unresolved-inline-target
          // diagnostic already covers this case (step 5). Skip here.
          continue;
        }

        // If the parent DocID is the current document itself, no
        // cross-document dependency declaration is needed — the
        // section is local.
        if (parentDocId === document.extracted.docId) {
          continue;
        }

        if (!declaredTargetDocIds.has(parentDocId)) {
          accumulator.items.push({
            severity: 'error',
            ruleId: 'corpus/undeclared-inline-target',
            message: `Inline reference to '${targetId}' targets undeclared DocID '${parentDocId}' — declare it in the References section`,
            uri: document.uri,
            docId: document.extracted.docId,
            data: {
              targetId,
              parentDocId,
              fromId: inlineReference.fromId,
              kind: inlineReference.kind,
            },
          });
        }
      }
    }
  }

  /**
   * Raises a document-level undeclared-target warning to an error when the
   * target turns out to be a document in the corpus.
   *
   * Per 1#9.5 rule 3: a single document cannot tell `per 3.1` (a reference
   * whose declaration is missing) from `per 60 seconds` (prose), so ECR104
   * only warns. Here the corpus is known. If DocID `3.1` exists, the author
   * has referenced a real document without declaring it, which is an error.
   * If no document `60` exists, the warning stands on its own.
   *
   * An undeclared SectionID target (`per 3.1#2`) is already an ECR104 error,
   * so only warnings are considered here; raising it again would report the
   * same mistake twice.
   *
   * @param documents - The per-document entries, including their diagnostics.
   * @param docIdIndex - The global DocID-to-URI index.
   * @param accumulator - Diagnostic accumulator for recording violations.
   */
  private escalateUndeclaredInlineTargets(
    documents: readonly CorpusDocumentEntry[],
    docIdIndex: ReadonlyMap<DocID, string>,
    accumulator: DiagnosticAccumulator,
  ): void {
    for (const entry of documents) {
      for (const warning of entry.result.diagnostics) {
        const targetDocId: unknown = warning.data?.targetDocId;

        if (
          warning.ruleId !== INLINE_REFERENCE_RULE_ID ||
          warning.severity !== 'warning' ||
          warning.data?.reason !== UNDECLARED_TARGET_REASON ||
          typeof targetDocId !== 'string' ||
          !docIdIndex.has(targetDocId)
        ) {
          continue;
        }

        const targetId: unknown = warning.data.targetId;
        const cause: unknown = warning.data.cause;

        // A citation no search can find (1#9.5 rule 4) warns for the same
        // reason an undeclared one does, and is raised here for the same
        // reason. Declaring the target would not make it findable, so the
        // message has to name the source form as well. Only an undeclared
        // target ever warns, so both parts always apply.
        const message: string =
          cause === CITATION_SOURCE_FORM_CAUSE
            ? `Inline reference to '${String(targetId)}' is not written as adjacent literal ` +
              `text on one line, so no search finds it, and DocID '${targetDocId}' exists in ` +
              `the corpus, so it is certainly a citation — write it as literal text and ` +
              `declare it in the References section`
            : `Inline reference to '${String(targetId)}' targets DocID '${targetDocId}', ` +
              `which exists in the corpus but is not declared — declare it in the References section`;

        accumulator.items.push({
          severity: 'error',
          ruleId: 'corpus/undeclared-inline-target',
          message,
          uri: entry.uri,
          ...(warning.range !== undefined ? { range: warning.range } : {}),
          ...(entry.result.extracted !== undefined ? { docId: entry.result.extracted.docId } : {}),
          data: {
            ...(cause !== undefined ? { cause } : {}),
            targetId,
            parentDocId: targetDocId,
            fromId: warning.data.fromId,
            kind: warning.data.kind,
          },
        });
      }
    }
  }

  // -------------------------------------------------------------------------
  // Private helpers — index construction
  // -------------------------------------------------------------------------

  /**
   * Converts the mutable maps into a frozen {@link CorpusIndex}.
   *
   * @param docIdIndex - The global DocID-to-URI map.
   * @param sectionIdIndex - The global SectionID-to-URI map.
   * @returns A frozen corpus index suitable for graph construction.
   */
  private buildCorpusIndex(
    docIdIndex: ReadonlyMap<DocID, string>,
    sectionIdIndex: ReadonlyMap<SectionID, string>,
  ): CorpusIndex {
    const docIds: Record<DocID, string> = {};
    const sectionIds: Record<SectionID, string> = {};

    for (const [docId, uri] of docIdIndex) {
      docIds[docId] = uri;
    }

    for (const [sectionId, uri] of sectionIdIndex) {
      sectionIds[sectionId] = uri;
    }

    return { docIds, sectionIds };
  }

  // -------------------------------------------------------------------------
  // Private helpers — identifier utilities
  // -------------------------------------------------------------------------

  /**
   * Collects the set of target DocIDs declared in a document's References
   * section.
   *
   * @param extracted - The extracted document whose references are inspected.
   * @returns A set of DocIDs declared as reference targets.
   */
  private collectDeclaredReferenceDocIds(
    extracted: ExtractedDocument,
  ): ReadonlySet<DocID> {
    const declaredDocIds: Set<DocID> = new Set<DocID>();

    for (const reference of extracted.references) {
      declaredDocIds.add(reference.toDocId);
    }

    return declaredDocIds;
  }

  /**
   * Finds the DocID a SectionID belongs to.
   *
   * This is a direct read rather than a search: everything before the `#`
   * separator is the DocID. A dotted-only grammar would have to try
   * progressively longer dotted prefixes against the index, which cannot
   * distinguish section `1` of document `0.0.1` from section `1.3` of
   * document `0.0`, and silently prefers whichever the corpus happens to
   * contain.
   *
   * @param sectionId - The SectionID whose DocID is sought.
   * @param docIdIndex - The global DocID-to-URI index, used to confirm the document exists.
   * @returns The DocID the section belongs to, or `undefined` if it is not in the corpus.
   */
  private findParentDocId(
    sectionId: string,
    docIdIndex: ReadonlyMap<DocID, string>,
  ): DocID | undefined {
    const separatorIndex: number = sectionId.indexOf('#');

    if (separatorIndex < 0) {
      return undefined;
    }

    const docId: string = sectionId.substring(0, separatorIndex);

    return docIdIndex.has(docId) ? docId : undefined;
  }

}

export { CorpusValidator };

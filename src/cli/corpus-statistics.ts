/**
 * Corpus Statistics
 *
 * Counts the structure ECR makes explicit, so that a reader can measure their
 * own corpus rather than take anyone's figures on trust. Every number here is
 * derived from validated artefacts, not from a regular expression over the
 * source, so the same corpus always yields the same counts.
 */

import type { CorpusResult, ReferenceDirection, ExtractedDocument } from '../types.js';

/**
 * Counts of References-section entries by their declared direction.
 */
export interface DirectionCounts {
  /** Entries declaring the cited document as an authority. */
  readonly authority: number;
  /** Entries declaring the cited document as a constraint. */
  readonly constraint: number;
  /** Entries declaring the cited document as a contract. */
  readonly contract: number;
  /** Entries declaring the cited document as a dependency. */
  readonly dependency: number;
}

/**
 * A measured summary of an ECR corpus.
 */
export interface CorpusStatisticsReport {
  /** Documents validated, excluding meta-documents. */
  readonly documents: number;
  /** Documents that carry at least one References entry. */
  readonly documentsWithReferences: number;
  /** Sections extracted across the corpus, excluding the root H1 of each document. */
  readonly sections: number;
  /** Unique DocIDs found in the corpus. */
  readonly docIds: number;
  /** Unique SectionIDs found in the corpus. */
  readonly sectionIds: number;
  /** References-section entries, the document-level edges. */
  readonly referenceEntries: number;
  /** References-section entries broken down by direction. */
  readonly referencesByDirection: DirectionCounts;
  /** Inline `see`/`per` references. */
  readonly inlineReferences: number;
  /** Inline references naming a precise section rather than a whole document. */
  readonly sectionPreciseInlineReferences: number;
  /** Every edge in the corpus: References entries plus inline references. */
  readonly totalEdges: number;
}

/**
 * Derives a statistical summary from a corpus validation result.
 *
 * Only documents that produced extracted artefacts contribute. A document that
 * failed structural validation has no reliable structure to count, and
 * including a partial reading of it would make the totals depend on how far
 * parsing happened to get.
 */
export class CorpusStatistics {
  /** The validation result to summarise. */
  private readonly corpusResult: CorpusResult;

  /**
   * Creates a summariser for one validation result.
   *
   * @param corpusResult - The result produced by validating the corpus
   */
  public constructor(corpusResult: CorpusResult) {
    this.corpusResult = corpusResult;
  }

  /**
   * Computes the summary.
   *
   * @returns Counts describing the corpus's explicit structure
   */
  public summarise(): CorpusStatisticsReport {
    const extractedDocuments: readonly ExtractedDocument[] = this.collectExtractedDocuments();

    let documentsWithReferences: number = 0;
    let sections: number = 0;
    let referenceEntries: number = 0;
    let inlineReferences: number = 0;
    let sectionPreciseInlineReferences: number = 0;

    const referencesByDirection: Record<ReferenceDirection, number> = {
      authority: 0,
      constraint: 0,
      contract: 0,
      dependency: 0,
    };

    for (const document of extractedDocuments) {
      if (document.references.length > 0) {
        documentsWithReferences += 1;
      }

      // The root H1 is a node but not a section, so it is not counted here.
      sections += Math.max(document.sections.length - 1, 0);
      referenceEntries += document.references.length;
      inlineReferences += document.inlineReferences.length;

      for (const reference of document.references) {
        referencesByDirection[reference.direction] += 1;
      }

      for (const inlineReference of document.inlineReferences) {
        if (inlineReference.toId.includes('#')) {
          sectionPreciseInlineReferences += 1;
        }
      }
    }

    return {
      documents: extractedDocuments.length,
      documentsWithReferences,
      sections,
      docIds: this.countIndexEntries(this.corpusResult.index?.docIds),
      sectionIds: this.countIndexEntries(this.corpusResult.index?.sectionIds),
      referenceEntries,
      referencesByDirection: { ...referencesByDirection },
      inlineReferences,
      sectionPreciseInlineReferences,
      totalEdges: referenceEntries + inlineReferences,
    };
  }

  /**
   * Gathers the extracted artefacts of every document that produced them.
   *
   * @returns Extracted documents, in corpus order
   */
  private collectExtractedDocuments(): readonly ExtractedDocument[] {
    const extracted: ExtractedDocument[] = [];

    for (const entry of this.corpusResult.documents) {
      if (entry.result.extracted !== undefined) {
        extracted.push(entry.result.extracted);
      }
    }

    return extracted;
  }

  /**
   * Counts the entries of a corpus index map.
   *
   * @param index - A DocID or SectionID index, absent when indexing did not succeed
   * @returns The number of entries, or 0 when the index is absent
   */
  private countIndexEntries(index: Readonly<Record<string, string>> | undefined): number {
    return index === undefined ? 0 : Object.keys(index).length;
  }
}

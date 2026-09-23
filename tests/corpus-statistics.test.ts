/**
 * Corpus Statistics Tests
 *
 * `stats` measures what a corpus makes explicit. A document the parser could
 * not read contributes nothing to any count, so the summary must say which
 * documents those were and that the counts therefore describe the rest.
 *
 * These cases declare the validation result rather than parsing Markdown, so
 * they cost nothing: a document that genuinely cannot be parsed takes several
 * seconds to fail, and is covered end to end in `deep-nesting.test.ts` and
 * `cli.test.ts`.
 */

import { describe, it, expect } from 'vitest';

import { CorpusStatistics } from '../src/cli/corpus-statistics.js';
import type { CorpusStatisticsReport } from '../src/cli/corpus-statistics.js';
import { UNPARSABLE_DOCUMENT_RULE_ID } from '../src/per-document-visitor.js';
import type { CorpusDocumentEntry, CorpusResult, Diagnostic } from '../src/types.js';

/**
 * Builds the entry of a document that was read and validated.
 *
 * @param uri - The document's URI
 * @param docId - Its DocID
 * @returns The corpus entry
 */
function soundDocument(uri: string, docId: string): CorpusDocumentEntry {
  return {
    uri,
    result: {
      input: { uri },
      ok: true,
      diagnostics: [],
      extracted: {
        docId,
        title: 'Title',
        sections: [{ id: docId, title: 'Title', headingDepth: 1 }],
        references: [],
        inlineReferences: [],
      },
    },
  };
}

/**
 * Builds the entry of a document the parser could not read: it carries the
 * unparsable-document diagnostic and no extracted artefacts.
 *
 * @param uri - The document's URI
 * @returns The corpus entry
 */
function unparsableDocument(uri: string): CorpusDocumentEntry {
  const diagnostic: Diagnostic = {
    severity: 'error',
    ruleId: UNPARSABLE_DOCUMENT_RULE_ID,
    message: 'Document could not be parsed, so none of it was validated.',
    uri,
  };

  return { uri, result: { input: { uri }, ok: false, diagnostics: [diagnostic] } };
}

/**
 * Builds the entry of a document that was parsed but yielded nothing: no
 * recoverable DocID, so no extracted artefacts either.
 *
 * @param uri - The document's URI
 * @returns The corpus entry
 */
function documentWithoutDocId(uri: string): CorpusDocumentEntry {
  const diagnostic: Diagnostic = {
    severity: 'error',
    ruleId: 'ECR101',
    message: 'H1 "Notes" is not numbered.',
    uri,
  };

  return { uri, result: { input: { uri }, ok: false, diagnostics: [diagnostic] } };
}

/**
 * Summarises a corpus made of the given entries.
 *
 * @param documents - The entries
 * @returns The measured summary
 */
function summarise(documents: readonly CorpusDocumentEntry[]): CorpusStatisticsReport {
  const corpusResult: CorpusResult = { documents, diagnostics: [] };

  return new CorpusStatistics(corpusResult).summarise();
}

describe('Feature: Statistics say what they leave out', () => {
  it('counts a corpus every document of which parsed as complete', () => {
    const report: CorpusStatisticsReport = summarise([
      soundDocument('a.md', '1'),
      soundDocument('b.md', '2'),
    ]);

    expect(report.complete).toBe(true);
    expect(report.unparsable).toEqual([]);
    expect(report.documents).toBe(2);
  });

  it('names a document the parser could not read, and stops calling itself complete', () => {
    const report: CorpusStatisticsReport = summarise([
      soundDocument('a.md', '1'),
      unparsableDocument('hostile.md'),
    ]);

    expect(report.complete).toBe(false);
    expect(report.unparsable).toEqual(['hostile.md']);
    // Only the document that was read contributes to the counts.
    expect(report.documents).toBe(1);
  });

  it('names every such document, in corpus order', () => {
    const report: CorpusStatisticsReport = summarise([
      unparsableDocument('first.md'),
      soundDocument('a.md', '1'),
      unparsableDocument('second.md'),
    ]);

    expect(report.unparsable).toEqual(['first.md', 'second.md']);
  });

  it('stays complete when a document was read but yielded nothing, which is not the same thing', () => {
    const report: CorpusStatisticsReport = summarise([
      soundDocument('a.md', '1'),
      documentWithoutDocId('notes.md'),
    ]);

    // `complete` says every document was read, not that every document had
    // something to contribute: this one was read and had nothing.
    expect(report.complete).toBe(true);
    expect(report.unparsable).toEqual([]);
    expect(report.documents).toBe(1);
  });
});

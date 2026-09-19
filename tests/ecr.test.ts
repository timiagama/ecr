/**
 * Black-box test suite for the Ecr facade class.
 *
 * Derived exclusively from the Behavioural Contract for WI-9
 * (scenarios SCN-001 through SCN-023).
 *
 * All tests interact only through the approved public interface:
 * - {@link Ecr.lintDocument}
 * - {@link Ecr.validateCorpus}
 */

import { describe, it, expect } from 'vitest';
import { Ecr } from '../src/ecr.js';
import type { CorpusDocumentInput } from '../src/ecr.js';
import type {
  LintResult,
  CorpusResult,
  Diagnostic,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Test Data Helpers
// ---------------------------------------------------------------------------

/**
 * Build a minimal valid ECR-compliant Markdown document.
 *
 * @param docId - The numeric DocID (e.g. "3.1").
 * @param title - The document title.
 * @param options - Optional overrides for references and inline references.
 * @returns A Markdown string satisfying per-document ECR invariants.
 */
function buildValidDocument(
  docId: string,
  title: string,
  options?: {
    readonly referencesEntries?: ReadonlyArray<string>;
    readonly sections?: ReadonlyArray<string>;
    readonly inlineReferences?: ReadonlyArray<string>;
  },
): string {
  const sections: ReadonlyArray<string> = options?.sections ?? [
    `## ${docId}#1 - Overview`,
    '',
    'Content here.',
  ];

  const inlineLines: ReadonlyArray<string> = options?.inlineReferences ?? [];

  const referencesEntries: ReadonlyArray<string> =
    options?.referencesEntries ?? [];

  const lines: ReadonlyArray<string> = [
    `# ${docId} - ${title}`,
    '',
    ...sections,
    '',
    ...inlineLines,
    '',
    '## References',
    '',
    ...referencesEntries,
  ];

  return lines.join('\n');
}

/**
 * Build a minimal valid ECR document with a reference to another DocID.
 *
 * @param docId - The numeric DocID.
 * @param title - The document title.
 * @param targetDocId - The DocID referenced in the References section.
 * @param targetTitle - The title for the reference target.
 * @returns A Markdown string with a References entry.
 */
function buildDocumentWithReference(
  docId: string,
  title: string,
  targetDocId: string,
  targetTitle: string,
): string {
  return buildValidDocument(docId, title, {
    referencesEntries: [
      `- ${targetDocId} - ${targetTitle} (dependency - depends on this)`,
    ],
  });
}

/**
 * Build a minimal valid ECR document containing an inline reference.
 *
 * @param docId - The numeric DocID.
 * @param title - The document title.
 * @param inlineTargetId - The target identifier for the inline reference.
 * @returns A Markdown string with an inline `see` reference.
 */
function buildDocumentWithInlineReference(
  docId: string,
  title: string,
  inlineTargetId: string,
): string {
  return buildValidDocument(docId, title, {
    sections: [
      `## ${docId}#1 - Overview`,
      '',
      `Content here, see ${inlineTargetId} for details.`,
    ],
  });
}

/**
 * Check whether a diagnostic collection contains at least one error-severity entry.
 *
 * @param diagnostics - The diagnostics to inspect.
 * @returns True if any diagnostic has severity "error".
 */
function hasErrorDiagnostic(
  diagnostics: readonly Diagnostic[],
): boolean {
  return diagnostics.some(
    (diagnostic: Diagnostic) => diagnostic.severity === 'error',
  );
}

// ---------------------------------------------------------------------------
// Test Data Constants
// ---------------------------------------------------------------------------

const VALID_DOC_3_1: string = buildValidDocument('3.1', 'My Document', {
  referencesEntries: [
    '- 8.1 - Dependency Doc (dependency - depends on this)',
  ],
});

const VALID_DOC_5_1: string = buildValidDocument('5.1', 'Another Document');

const VALID_DOC_A: string = buildValidDocument('1.1', 'Document A');

const VALID_DOC_B: string = buildValidDocument('2.1', 'Document B');

const INVALID_DOC_MISSING_REFS: string = [
  '# 4.1 - No References Section',
  '',
  '## 4.1#1 - Overview',
  '',
  'Content without a References section.',
].join('\n');

const INVALID_DOC_EMPTY = '';

const INVALID_DOC_STRUCTURAL: string = [
  'This document has no valid ECR structure at all.',
  '',
  'Just some random text with no headings.',
].join('\n');

// ---------------------------------------------------------------------------
// Feature: Single-Document Linting
// ---------------------------------------------------------------------------

describe('Feature: Single-Document Linting', () => {
  /**
   * @SCN-001 - Valid ECR-compliant document produces a successful result.
   */
  it('SCN-001: valid ECR-compliant document produces a successful result', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/3.1.md',
      VALID_DOC_3_1,
    );

    expect(lintResult.ok, 'SCN-001: ok').toBe(true);

    const errorDiagnostics: readonly Diagnostic[] =
      lintResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(errorDiagnostics, 'SCN-001: no error diagnostics').toHaveLength(0);

    expect(lintResult.extracted, 'SCN-001: extracted present').toBeDefined();

    expect(
      lintResult.extracted!.docId,
      'SCN-001: extracted docId',
    ).toBeDefined();
    expect(
      lintResult.extracted!.sections,
      'SCN-001: extracted sections',
    ).toBeDefined();
    expect(
      lintResult.extracted!.references,
      'SCN-001: extracted references',
    ).toBeDefined();
    expect(
      lintResult.extracted!.inlineReferences,
      'SCN-001: extracted inlineReferences',
    ).toBeDefined();

    expect(lintResult.input.uri, 'SCN-001: input uri').toBe(
      'file:///docs/3.1.md',
    );
  });

  /**
   * @SCN-002 - Document with structural violations produces a failing result.
   */
  it('SCN-002: document with structural violations produces a failing result', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/bad.md',
      INVALID_DOC_STRUCTURAL,
    );

    expect(lintResult.ok, 'SCN-002: ok').toBe(false);
    expect(
      hasErrorDiagnostic(lintResult.diagnostics),
      'SCN-002: has error diagnostics',
    ).toBe(true);
  });

  /**
   * @SCN-003 - Version is propagated through to the result when provided.
   */
  it('SCN-003: version is propagated through to the result when provided', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/5.1.md',
      VALID_DOC_5_1,
      7,
    );

    expect(lintResult.input.uri, 'SCN-003: uri').toBe(
      'file:///docs/5.1.md',
    );
    expect(lintResult.input.version, 'SCN-003: version').toBe(7);
  });

  /**
   * @SCN-004 - Version is absent from the result when not provided.
   */
  it('SCN-004: version is absent from the result when not provided', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/5.1.md',
      VALID_DOC_5_1,
    );

    expect(lintResult.input.uri, 'SCN-004: uri').toBe(
      'file:///docs/5.1.md',
    );
    expect(lintResult.input.version, 'SCN-004: version absent').toBeUndefined();
  });

  /**
   * @SCN-005 - Empty Markdown text produces diagnostics.
   */
  it('SCN-005: empty Markdown text produces diagnostics', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/empty.md',
      INVALID_DOC_EMPTY,
    );

    expect(lintResult.ok, 'SCN-005: ok').toBe(false);
    expect(
      hasErrorDiagnostic(lintResult.diagnostics),
      'SCN-005: has error diagnostics',
    ).toBe(true);
  });

  /**
   * @SCN-006 - Document with valid DocID but other structural errors provides partial extraction.
   */
  it('SCN-006: document with valid DocID but missing References provides diagnostics', () => {
    const facade: Ecr = new Ecr();
    const lintResult: LintResult = facade.lintDocument(
      'file:///docs/partial.md',
      INVALID_DOC_MISSING_REFS,
    );

    expect(lintResult.ok, 'SCN-006: ok').toBe(false);

    const errorDiagnostics: readonly Diagnostic[] =
      lintResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      errorDiagnostics.length,
      'SCN-006: has error diagnostics',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * @SCN-007 - Linting the same document twice produces identical results.
   */
  it('SCN-007: linting the same document twice produces identical results', () => {
    const facade: Ecr = new Ecr();

    const firstResult: LintResult = facade.lintDocument(
      'file:///docs/3.1.md',
      VALID_DOC_3_1,
    );
    const secondResult: LintResult = facade.lintDocument(
      'file:///docs/3.1.md',
      VALID_DOC_3_1,
    );

    expect(secondResult, 'SCN-007').toStrictEqual(firstResult);
  });

  /**
   * @SCN-008 - Linting is stateless across invocations.
   */
  it('SCN-008: linting is stateless across invocations', () => {
    const facade: Ecr = new Ecr();

    // Lint document A first, then B
    facade.lintDocument('file:///docs/a.md', VALID_DOC_A);
    const resultBAfterA: LintResult = facade.lintDocument(
      'file:///docs/b.md',
      VALID_DOC_B,
    );

    // Lint document B in isolation on a fresh instance
    const freshFacade: Ecr = new Ecr();
    const resultBIsolated: LintResult = freshFacade.lintDocument(
      'file:///docs/b.md',
      VALID_DOC_B,
    );

    expect(resultBAfterA, 'SCN-008').toStrictEqual(resultBIsolated);
  });
});

// ---------------------------------------------------------------------------
// Feature: Corpus Validation
// ---------------------------------------------------------------------------

describe('Feature: Corpus Validation', () => {
  /**
   * @SCN-009 - Valid corpus with no cross-document issues.
   */
  it('SCN-009: valid corpus with no cross-document issues', () => {
    const docA: string = buildDocumentWithReference(
      '3.1',
      'Document A',
      '4.1',
      'Document B',
    );
    const docB: string = buildDocumentWithReference(
      '4.1',
      'Document B',
      '3.1',
      'Document A',
    );

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: docA },
      { uri: 'file:///docs/4.1.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    for (const entry of corpusResult.documents) {
      expect(entry.result.ok, 'SCN-009: per-document ok').toBe(true);
    }

    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(corpusErrors, 'SCN-009: no corpus errors').toHaveLength(0);

    expect(corpusResult.index, 'SCN-009: index present').toBeDefined();
    expect(
      corpusResult.index!.docIds['3.1'],
      'SCN-009: docId 3.1 in index',
    ).toBe('file:///docs/3.1.md');
    expect(
      corpusResult.index!.docIds['4.1'],
      'SCN-009: docId 4.1 in index',
    ).toBe('file:///docs/4.1.md');
  });

  /**
   * @SCN-010 - Corpus with duplicate DocIDs across documents.
   */
  it('SCN-010: corpus with duplicate DocIDs across documents', () => {
    const docA: string = buildValidDocument('3.1', 'Document A');
    const docB: string = buildValidDocument('3.1', 'Document B Duplicate');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/a.md', markdownText: docA },
      { uri: 'file:///docs/b.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const duplicateDocIdErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      duplicateDocIdErrors.length,
      'SCN-010: duplicate DocID error',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * @SCN-011 - Corpus with duplicate SectionIDs across documents.
   */
  it('SCN-011: corpus with duplicate SectionIDs across documents', () => {
    const docA: string = buildValidDocument('3.1', 'Document A', {
      sections: [
        '## 3.1#1 - Shared Section',
        '',
        'Content A.',
      ],
    });
    const docB: string = buildValidDocument('4.1', 'Document B', {
      sections: [
        '## 3.1#1 - Duplicated Section',
        '',
        'Content B.',
      ],
    });

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: docA },
      { uri: 'file:///docs/4.1.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const duplicateSectionErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      duplicateSectionErrors.length,
      'SCN-011: duplicate SectionID error',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * @SCN-012 - Corpus with unresolved References target.
   */
  it('SCN-012: corpus with unresolved References target', () => {
    const docA: string = buildDocumentWithReference(
      '3.1',
      'Document A',
      '9.9',
      'Nonexistent Doc',
    );

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: docA },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const unresolvedRefErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      unresolvedRefErrors.length,
      'SCN-012: unresolved reference error',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * @SCN-013 - Corpus with unresolved inline reference target.
   */
  it('SCN-013: corpus with unresolved inline reference target', () => {
    const docA: string = buildDocumentWithInlineReference(
      '3.1',
      'Document A',
      '3.1#5',
    );

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: docA },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const unresolvedInlineErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      unresolvedInlineErrors.length,
      'SCN-013: unresolved inline reference error',
    ).toBeGreaterThanOrEqual(1);
  });

  /**
   * @SCN-014 - Empty corpus produces empty results with no errors.
   */
  it('SCN-014: empty corpus produces empty results with no errors', () => {
    const corpus: ReadonlyArray<CorpusDocumentInput> = [];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    expect(corpusResult.documents, 'SCN-014: no documents').toHaveLength(0);

    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(corpusErrors, 'SCN-014: no errors').toHaveLength(0);
  });

  /**
   * @SCN-015 - Single-document corpus undergoes both passes.
   */
  it('SCN-015: single-document corpus undergoes both passes', () => {
    const doc: string = buildValidDocument('6.1', 'Single Doc');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/6.1.md', markdownText: doc },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    expect(
      corpusResult.documents,
      'SCN-015: one per-document entry',
    ).toHaveLength(1);
    expect(
      corpusResult.documents[0]!.result.ok,
      'SCN-015: per-document ok',
    ).toBe(true);

    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(corpusErrors, 'SCN-015: no corpus errors').toHaveLength(0);

    expect(corpusResult.index, 'SCN-015: index present').toBeDefined();
    expect(
      corpusResult.index!.docIds['6.1'],
      'SCN-015: docId in index',
    ).toBe('file:///docs/6.1.md');
  });

  /**
   * @SCN-016 - Corpus with a mix of valid and invalid documents.
   */
  it('SCN-016: corpus with a mix of valid and invalid documents', () => {
    const validDoc: string = buildValidDocument('3.1', 'Valid Doc');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/valid.md', markdownText: validDoc },
      { uri: 'file:///docs/invalid.md', markdownText: INVALID_DOC_STRUCTURAL },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    expect(
      corpusResult.documents,
      'SCN-016: two per-document entries',
    ).toHaveLength(2);

    const validEntry = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///docs/valid.md',
    );
    const invalidEntry = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///docs/invalid.md',
    );

    expect(validEntry, 'SCN-016: valid entry exists').toBeDefined();
    expect(invalidEntry, 'SCN-016: invalid entry exists').toBeDefined();

    expect(validEntry!.result.ok, 'SCN-016: valid doc ok').toBe(true);
    expect(invalidEntry!.result.ok, 'SCN-016: invalid doc not ok').toBe(false);
    expect(
      hasErrorDiagnostic(invalidEntry!.result.diagnostics),
      'SCN-016: invalid doc has error diagnostics',
    ).toBe(true);
  });

  /**
   * @SCN-017 - Per-document results in corpus include version when provided.
   */
  it('SCN-017: per-document results in corpus include version when provided', () => {
    const docA: string = buildValidDocument('3.1', 'Doc A');
    const docB: string = buildValidDocument('4.1', 'Doc B');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///a.md', markdownText: docA, version: 3 },
      { uri: 'file:///b.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const entryA = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///a.md',
    );
    const entryB = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///b.md',
    );

    expect(entryA, 'SCN-017: entry A exists').toBeDefined();
    expect(entryB, 'SCN-017: entry B exists').toBeDefined();

    expect(
      entryA!.result.input.version,
      'SCN-017: version 3 for A',
    ).toBe(3);
    expect(
      entryB!.result.input.version,
      'SCN-017: no version for B',
    ).toBeUndefined();
  });

  /**
   * @SCN-018 - Corpus validation is deterministic.
   */
  it('SCN-018: corpus validation is deterministic', () => {
    const docA: string = buildValidDocument('3.1', 'Doc A');
    const docB: string = buildValidDocument('4.1', 'Doc B');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: docA },
      { uri: 'file:///docs/4.1.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const firstResult: CorpusResult = facade.validateCorpus(corpus);
    const secondResult: CorpusResult = facade.validateCorpus(corpus);

    expect(secondResult, 'SCN-018').toStrictEqual(firstResult);
  });

  /**
   * @SCN-019 - Corpus validation is stateless across invocations.
   */
  it('SCN-019: corpus validation is stateless across invocations', () => {
    const corpusX: ReadonlyArray<CorpusDocumentInput> = [
      {
        uri: 'file:///docs/x.md',
        markdownText: buildValidDocument('7.1', 'Corpus X Doc'),
      },
    ];
    const corpusY: ReadonlyArray<CorpusDocumentInput> = [
      {
        uri: 'file:///docs/y.md',
        markdownText: buildValidDocument('8.1', 'Corpus Y Doc'),
      },
    ];

    const facade: Ecr = new Ecr();
    facade.validateCorpus(corpusX);
    const resultYAfterX: CorpusResult = facade.validateCorpus(corpusY);

    const freshFacade: Ecr = new Ecr();
    const resultYIsolated: CorpusResult = freshFacade.validateCorpus(corpusY);

    expect(resultYAfterX, 'SCN-019').toStrictEqual(resultYIsolated);
  });

  /**
   * @SCN-020 - Corpus where all documents fail Pass 1.
   */
  it('SCN-020: corpus where all documents fail Pass 1', () => {
    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      {
        uri: 'file:///docs/bad1.md',
        markdownText: INVALID_DOC_STRUCTURAL,
      },
      {
        uri: 'file:///docs/bad2.md',
        markdownText: INVALID_DOC_EMPTY,
      },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    for (const entry of corpusResult.documents) {
      expect(entry.result.ok, 'SCN-020: per-document not ok').toBe(false);
    }

    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      corpusErrors,
      'SCN-020: no corpus-wide cross-document errors',
    ).toHaveLength(0);
  });

  /**
   * @SCN-021 - Corpus-wide diagnostics are separate from per-document diagnostics.
   */
  it('SCN-021: corpus-wide diagnostics are separate from per-document diagnostics', () => {
    const docA: string = buildValidDocument('3.1', 'Document A');
    const docB: string = buildValidDocument('3.1', 'Document B Duplicate');

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/a.md', markdownText: docA },
      { uri: 'file:///docs/b.md', markdownText: docB },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    // Corpus-wide diagnostics should contain the duplicate DocID error
    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      corpusErrors.length,
      'SCN-021: corpus-wide has duplicate error',
    ).toBeGreaterThanOrEqual(1);

    // Per-document diagnostics should NOT contain the duplicate DocID error
    for (const entry of corpusResult.documents) {
      const perDocCorpusLevelErrors: readonly Diagnostic[] =
        entry.result.diagnostics.filter(
          (d: Diagnostic) =>
            d.severity === 'error' &&
            corpusErrors.some(
              (corpusDiag: Diagnostic) =>
                corpusDiag.ruleId === d.ruleId &&
                corpusDiag.message === d.message,
            ),
        );
      expect(
        perDocCorpusLevelErrors,
        'SCN-021: per-document has no corpus-level errors',
      ).toHaveLength(0);
    }
  });
});

// ---------------------------------------------------------------------------
// Feature: Orchestration Sequencing
// ---------------------------------------------------------------------------

describe('Feature: Orchestration Sequencing', () => {
  /**
   * @SCN-022 - Pass 2 uses only documents that passed Pass 1.
   */
  it('SCN-022: Pass 2 uses only documents that passed Pass 1', () => {
    // Two valid docs reference each other; one invalid doc
    const validDocA: string = buildDocumentWithReference(
      '3.1',
      'Valid A',
      '4.1',
      'Valid B',
    );
    const validDocB: string = buildDocumentWithReference(
      '4.1',
      'Valid B',
      '3.1',
      'Valid A',
    );

    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'file:///docs/3.1.md', markdownText: validDocA },
      { uri: 'file:///docs/4.1.md', markdownText: validDocB },
      { uri: 'file:///docs/bad.md', markdownText: INVALID_DOC_STRUCTURAL },
    ];

    const facade: Ecr = new Ecr();
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    const validAEntry = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///docs/3.1.md',
    );
    const validBEntry = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///docs/4.1.md',
    );
    const invalidEntry = corpusResult.documents.find(
      (entry) => entry.uri === 'file:///docs/bad.md',
    );

    expect(validAEntry!.result.ok, 'SCN-022: valid A ok').toBe(true);
    expect(validBEntry!.result.ok, 'SCN-022: valid B ok').toBe(true);
    expect(invalidEntry!.result.ok, 'SCN-022: invalid not ok').toBe(false);

    // Cross-document checks should have succeeded for the two valid docs
    // (they reference each other, so no unresolved references)
    const corpusErrors: readonly Diagnostic[] =
      corpusResult.diagnostics.filter(
        (d: Diagnostic) => d.severity === 'error',
      );
    expect(
      corpusErrors,
      'SCN-022: no corpus errors from valid docs',
    ).toHaveLength(0);
  });

  /**
   * @SCN-023 - No file I/O or filesystem discovery.
   *
   * This is verified by the fact that the API accepts in-memory text with
   * opaque URIs and requires no filesystem interaction. The URI is treated
   * as an opaque identifier: a nonsensical URI should not cause errors
   * beyond the document content itself.
   */
  it('SCN-023: URI is opaque and no filesystem access is performed', () => {
    const facade: Ecr = new Ecr();

    // Use a completely non-filesystem URI to demonstrate opacity
    const opaqueUri = 'custom-scheme://virtual/document/abc123';
    const lintResult: LintResult = facade.lintDocument(
      opaqueUri,
      VALID_DOC_3_1,
    );

    // The system should process the document successfully regardless of URI format
    expect(lintResult.ok, 'SCN-023: ok with opaque URI').toBe(true);
    expect(lintResult.input.uri, 'SCN-023: URI preserved').toBe(opaqueUri);

    // Also verify corpus validation treats URIs as opaque
    const corpus: ReadonlyArray<CorpusDocumentInput> = [
      { uri: 'made-up://not-a-file', markdownText: VALID_DOC_3_1 },
    ];
    const corpusResult: CorpusResult = facade.validateCorpus(corpus);

    expect(
      corpusResult.documents[0]!.result.ok,
      'SCN-023: corpus ok with opaque URI',
    ).toBe(true);
    expect(
      corpusResult.documents[0]!.uri,
      'SCN-023: corpus URI preserved',
    ).toBe('made-up://not-a-file');
  });
});


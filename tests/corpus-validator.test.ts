import { describe, it, expect } from 'vitest';
import { CorpusValidator } from '../src/corpus-validator.js';
import type {
  CorpusDocumentEntry,
  CorpusResult,
  LintResult,
  ExtractedDocument,
  SectionNode,
  ReferenceEdge,
  InlineReferenceEdge,
  Diagnostic,
  LintInput,
  CorpusIndex,
} from '../src/types.js';

// ---------------------------------------------------------------------------
// Test Data Helpers
// ---------------------------------------------------------------------------

/**
 * Builds a {@link LintInput} with a given URI and optional version.
 *
 * @param uri - The document URI.
 * @param version - Optional version tag.
 * @returns A complete {@link LintInput}.
 */
function buildLintInput(uri: string, version?: number): LintInput {
  if (version !== undefined) {
    return { uri, version };
  }
  return { uri };
}

/**
 * Builds an {@link ExtractedDocument} with sensible defaults that can be
 * overridden via a partial.
 *
 * @param overrides - Partial fields to override the defaults.
 * @returns A complete {@link ExtractedDocument}.
 */
function buildExtractedDocument(
  overrides: Partial<ExtractedDocument>,
): ExtractedDocument {
  const docId: string = overrides.docId ?? '1.0';
  const title: string = overrides.title ?? `Document ${docId}`;
  const sections: readonly SectionNode[] = overrides.sections ?? [
    { id: docId, title, headingDepth: 1 },
  ];
  const references: readonly ReferenceEdge[] = overrides.references ?? [];
  const inlineReferences: readonly InlineReferenceEdge[] =
    overrides.inlineReferences ?? [];

  return { docId, title, sections, references, inlineReferences };
}

/**
 * Builds a {@link LintResult} with a successful extraction.
 *
 * @param uri - The document URI used in the lint input.
 * @param extracted - Optional extracted document. If provided, `ok` is true.
 * @returns A complete {@link LintResult}.
 */
function buildLintResult(
  uri: string,
  extracted?: ExtractedDocument,
): LintResult {
  const input: LintInput = buildLintInput(uri);
  if (extracted !== undefined) {
    return { input, ok: true, diagnostics: [], extracted };
  }
  return { input, ok: false, diagnostics: [] };
}

/**
 * Builds a {@link CorpusDocumentEntry} pairing a URI with a lint result.
 *
 * @param uri - The document URI.
 * @param result - The per-document lint result.
 * @returns A complete {@link CorpusDocumentEntry}.
 */
function buildCorpusEntry(
  uri: string,
  result: LintResult,
): CorpusDocumentEntry {
  return { uri, result };
}

/**
 * Builds a {@link CorpusDocumentEntry} for a successfully extracted document
 * in a single call, combining URI, docId, and optional overrides.
 *
 * @param uri - The document URI.
 * @param docId - The DocID for the extracted document.
 * @param overrides - Optional partial overrides for the extracted document.
 * @returns A complete {@link CorpusDocumentEntry} with a successful extraction.
 */
function buildValidEntry(
  uri: string,
  docId: string,
  overrides?: Partial<ExtractedDocument>,
): CorpusDocumentEntry {
  const extracted: ExtractedDocument = buildExtractedDocument({
    docId,
    ...overrides,
  });
  const lintResult: LintResult = buildLintResult(uri, extracted);
  return buildCorpusEntry(uri, lintResult);
}

/**
 * Builds a {@link CorpusDocumentEntry} for a document whose per-document
 * validation failed (no extracted artefact).
 *
 * @param uri - The document URI.
 * @returns A {@link CorpusDocumentEntry} with `ok: false` and no extraction.
 */
function buildFailedEntry(uri: string): CorpusDocumentEntry {
  const lintResult: LintResult = buildLintResult(uri);
  return buildCorpusEntry(uri, lintResult);
}

/**
 * Builds a {@link SectionNode} with the given id and heading depth.
 *
 * @param id - The SectionID or DocID.
 * @param headingDepth - The heading depth (1 for H1, 2 for H2, etc.).
 * @param parentId - Optional parent identifier.
 * @returns A complete {@link SectionNode}.
 */
function buildSectionNode(
  id: string,
  headingDepth: number,
  parentId?: string,
): SectionNode {
  const node: SectionNode = {
    id,
    title: `Section ${id}`,
    headingDepth,
    ...(parentId !== undefined ? { parentId } : {}),
  };
  return node;
}

/**
 * Builds a {@link ReferenceEdge} from one DocID to another.
 *
 * @param fromDocId - The source DocID.
 * @param toDocId - The target DocID.
 * @returns A complete {@link ReferenceEdge}.
 */
function buildReferenceEdge(
  fromDocId: string,
  toDocId: string,
): ReferenceEdge {
  return {
    fromDocId,
    toDocId,
    direction: 'dependency',
    explanation: `Reference from ${fromDocId} to ${toDocId}`,
    title: `Doc ${toDocId}`,
  };
}

/**
 * Builds an {@link InlineReferenceEdge} from one identifier to another.
 *
 * @param fromId - The source section or doc identifier.
 * @param toId - The target identifier.
 * @returns A complete {@link InlineReferenceEdge}.
 */
function buildInlineReferenceEdge(
  fromId: string,
  toId: string,
): InlineReferenceEdge {
  return { fromId, toId, kind: 'see' };
}

// ---------------------------------------------------------------------------
// Instantiation
// ---------------------------------------------------------------------------

const validator: CorpusValidator = new CorpusValidator();

// ===========================================================================
// Feature: DocID Global Uniqueness
// ===========================================================================

describe('Feature: DocID Global Uniqueness', () => {
  it('SCN-001: All documents have unique DocIDs', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0'),
      buildValidEntry('file:///b.md', '2.0'),
      buildValidEntry('file:///c.md', '3.0'),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No duplicate-DocID diagnostics
    const duplicateDocIdDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('duplicate')
          && diagnostic.message.toLowerCase().includes('docid');
      });
    expect(duplicateDocIdDiagnostics).toHaveLength(0);

    // Index maps each DocID to its defining document URI
    expect(corpusResult.index).toBeDefined();
    const index: CorpusIndex = corpusResult.index!;
    expect(index.docIds['1.0']).toBe('file:///a.md');
    expect(index.docIds['2.0']).toBe('file:///b.md');
    expect(index.docIds['3.0']).toBe('file:///c.md');
  });

  it('SCN-002a: Two documents share the same DocID "3.1"', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///x.md', '3.1'),
      buildValidEntry('file:///y.md', '3.1'),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for duplicate DocID "3.1"
    const duplicateDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('3.1');
      });
    expect(duplicateDiagnostics.length).toBeGreaterThanOrEqual(1);

    // The diagnostic identifies all document URIs declaring the duplicate
    const allMessages: string = duplicateDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${diagnostic.uri} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('file:///x.md');
    expect(allMessages).toContain('file:///y.md');
  });

  it('SCN-002b: Three documents share the same DocID "7"', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///p.md', '7'),
      buildValidEntry('file:///q.md', '7'),
      buildValidEntry('file:///r.md', '7'),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for duplicate DocID "7"
    const duplicateDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('7');
      });
    expect(duplicateDiagnostics.length).toBeGreaterThanOrEqual(1);

    // The diagnostic identifies all three document URIs
    const allMessages: string = duplicateDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${diagnostic.uri} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('file:///p.md');
    expect(allMessages).toContain('file:///q.md');
    expect(allMessages).toContain('file:///r.md');
  });
});

// ===========================================================================
// Feature: SectionID Global Uniqueness
// ===========================================================================

describe('Feature: SectionID Global Uniqueness', () => {
  it('SCN-003: All sections across the corpus have unique SectionIDs', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        sections: [
          buildSectionNode('1.0', 1),
          buildSectionNode('1.0#1', 2, '1.0'),
        ],
      }),
      buildValidEntry('file:///b.md', '2.0', {
        sections: [
          buildSectionNode('2.0', 1),
          buildSectionNode('2.0#1', 2, '2.0'),
        ],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No duplicate-SectionID diagnostics
    const duplicateSectionDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('duplicate')
          && diagnostic.message.toLowerCase().includes('sectionid');
      });
    expect(duplicateSectionDiagnostics).toHaveLength(0);

    // Index maps each SectionID to its defining document URI
    expect(corpusResult.index).toBeDefined();
    const index: CorpusIndex = corpusResult.index!;
    expect(index.sectionIds['1.0#1']).toBe('file:///a.md');
    expect(index.sectionIds['2.0#1']).toBe('file:///b.md');
  });

  it('SCN-004: Two documents define the same SectionID "3.1#2"', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '3.1', {
        sections: [
          buildSectionNode('3.1', 1),
          buildSectionNode('3.1#2', 2, '3.1'),
        ],
      }),
      buildValidEntry('file:///b.md', '3.2', {
        sections: [
          buildSectionNode('3.2', 1),
          buildSectionNode('3.1#2', 2, '3.2'),
        ],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for duplicate SectionID "3.1#2"
    const duplicateDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('3.1#2');
      });
    expect(duplicateDiagnostics.length).toBeGreaterThanOrEqual(1);

    // The diagnostic identifies all document URIs declaring the duplicate
    const allMessages: string = duplicateDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${diagnostic.uri} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('file:///a.md');
    expect(allMessages).toContain('file:///b.md');
  });
});

// ===========================================================================
// Feature: Reference Target Resolution
// ===========================================================================

describe('Feature: Reference Target Resolution', () => {
  it('SCN-005: All reference targets resolve to existing DocIDs', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        references: [buildReferenceEdge('1.0', '2.0')],
      }),
      buildValidEntry('file:///b.md', '2.0', {
        references: [buildReferenceEdge('2.0', '1.0')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No unresolved-reference diagnostics
    const unresolvedDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('unresolved')
          && diagnostic.message.toLowerCase().includes('reference');
      });
    expect(unresolvedDiagnostics).toHaveLength(0);
  });

  it('SCN-006: A reference target does not resolve to any corpus DocID', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '5.1', {
        references: [buildReferenceEdge('5.1', '9.9')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for unresolved toDocId "9.9"
    const unresolvedDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('9.9');
      });
    expect(unresolvedDiagnostics.length).toBeGreaterThanOrEqual(1);

    // The diagnostic identifies the source document URI and referencing DocID "5.1"
    const allMessages: string = unresolvedDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${diagnostic.uri} ${diagnostic.docId ?? ''} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('file:///a.md');
    expect(allMessages).toContain('5.1');
  });

  it('SCN-007: Multiple unresolved reference targets in different documents', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        references: [buildReferenceEdge('1.0', '88.1')],
      }),
      buildValidEntry('file:///b.md', '2.0', {
        references: [buildReferenceEdge('2.0', '99.2')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // A separate error diagnostic for each unresolved reference target
    const unresolvedDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error';
      });

    const messagesText: string = unresolvedDiagnostics
      .map((diagnostic: Diagnostic) => {
        return diagnostic.message;
      })
      .join(' ');
    expect(messagesText).toContain('88.1');
    expect(messagesText).toContain('99.2');

    // At least two separate diagnostics (one per unresolved target)
    const diagnosticsFor881: readonly Diagnostic[] =
      unresolvedDiagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.includes('88.1');
      });
    const diagnosticsFor992: readonly Diagnostic[] =
      unresolvedDiagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.includes('99.2');
      });
    expect(diagnosticsFor881.length).toBeGreaterThanOrEqual(1);
    expect(diagnosticsFor992.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Feature: Inline Reference Target Resolution
// ===========================================================================

describe('Feature: Inline Reference Target Resolution', () => {
  it('SCN-008: Inline reference resolves to an existing SectionID', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '3.1', {
        sections: [
          buildSectionNode('3.1', 1),
          buildSectionNode('3.1#2', 2, '3.1'),
        ],
        references: [buildReferenceEdge('3.1', '5.0')],
      }),
      buildValidEntry('file:///b.md', '5.0', {
        references: [buildReferenceEdge('5.0', '3.1')],
        inlineReferences: [buildInlineReferenceEdge('5.0', '3.1#2')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No unresolved-inline-reference diagnostic for toId "3.1#2"
    const unresolvedInlineDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.includes('3.1#2')
          && diagnostic.message.toLowerCase().includes('unresolved');
      });
    expect(unresolvedInlineDiagnostics).toHaveLength(0);
  });

  it('SCN-009: Inline reference resolves to an existing DocID', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '3.1'),
      buildValidEntry('file:///b.md', '5.0', {
        references: [buildReferenceEdge('5.0', '3.1')],
        inlineReferences: [buildInlineReferenceEdge('5.0', '3.1')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No unresolved-inline-reference diagnostic for toId "3.1"
    const unresolvedInlineDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.includes('3.1')
          && diagnostic.message.toLowerCase().includes('unresolved');
      });
    expect(unresolvedInlineDiagnostics).toHaveLength(0);
  });

  it('SCN-010: Inline reference target does not exist in the corpus', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        inlineReferences: [buildInlineReferenceEdge('1.0', '99.1#3')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for unresolved inline target "99.1.3"
    const unresolvedInlineDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('99.1#3');
      });
    expect(unresolvedInlineDiagnostics.length).toBeGreaterThanOrEqual(1);

    // The diagnostic identifies the source document URI
    const allMessages: string = unresolvedInlineDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${diagnostic.uri} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('file:///a.md');
  });

  it('SCN-011: Multiple unresolved inline reference targets', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        inlineReferences: [
          buildInlineReferenceEdge('1.0', '77.1'),
          buildInlineReferenceEdge('1.0', '88.2'),
        ],
      }),
      buildValidEntry('file:///b.md', '2.0', {
        inlineReferences: [buildInlineReferenceEdge('2.0', '99.3')],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // A separate error diagnostic for each unresolved inline reference target
    const errorDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error';
      });

    const messagesText: string = errorDiagnostics
      .map((diagnostic: Diagnostic) => {
        return diagnostic.message;
      })
      .join(' ');
    expect(messagesText).toContain('77.1');
    expect(messagesText).toContain('88.2');
    expect(messagesText).toContain('99.3');
  });
});

// ===========================================================================
// Feature: Inline Reference Parent DocID Declaration
// ===========================================================================

describe('Feature: Inline Reference Parent DocID Declaration', () => {
  it('SCN-012: Inline reference to a SectionID whose parent DocID is declared in References', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///source.md', '5.1', {
        references: [buildReferenceEdge('5.1', '3.1')],
        inlineReferences: [buildInlineReferenceEdge('5.1', '3.1#2')],
      }),
      buildValidEntry('file:///target.md', '3.1', {
        sections: [
          buildSectionNode('3.1', 1),
          buildSectionNode('3.1#2', 2, '3.1'),
        ],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No undeclared-reference diagnostic for inline target "3.1#2"
    const undeclaredDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.message.includes('3.1#2')
          && diagnostic.message.toLowerCase().includes('undeclared');
      });
    expect(undeclaredDiagnostics).toHaveLength(0);
  });

  it('SCN-013: Inline reference to a SectionID whose parent DocID is NOT declared in References', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///source.md', '5.1', {
        references: [],
        inlineReferences: [buildInlineReferenceEdge('5.1', '3.1#2')],
      }),
      buildValidEntry('file:///target.md', '3.1', {
        sections: [
          buildSectionNode('3.1', 1),
          buildSectionNode('3.1#2', 2, '3.1'),
        ],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic indicating undeclared reference on DocID "3.1"
    const undeclaredDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('3.1#2')
          && diagnostic.message.toLowerCase().includes('undeclared');
      });
    expect(undeclaredDiagnostics.length).toBeGreaterThanOrEqual(1);

    // Rule IDs are public API: tools filter and suppress on them.
    expect(undeclaredDiagnostics[0]!.ruleId).toBe('corpus/undeclared-inline-target');

    // The diagnostic references DocID "3.1" as the undeclared reference
    const allMessages: string = undeclaredDiagnostics
      .map((diagnostic: Diagnostic) => {
        return `${diagnostic.message} ${JSON.stringify(diagnostic.data ?? {})}`;
      })
      .join(' ');
    expect(allMessages).toContain('3.1');
  });
});

// ===========================================================================
// Feature: Documents Without Successful Extraction Are Excluded
// ===========================================================================

describe('Feature: Documents Without Successful Extraction Are Excluded from Corpus Indexing', () => {
  it('SCN-014: Document without extracted artefact is excluded from indexing', () => {
    const failedEntry: CorpusDocumentEntry = buildFailedEntry('file:///failed.md');
    const validEntry: CorpusDocumentEntry = buildValidEntry('file:///valid.md', '1.0');
    const documents: readonly CorpusDocumentEntry[] = [failedEntry, validEntry];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // The failed document's identifiers do not appear in the corpus-wide index
    expect(corpusResult.index).toBeDefined();
    const index: CorpusIndex = corpusResult.index!;
    const allDocIds: readonly string[] = Object.keys(index.docIds);

    // Only the valid document's DocID is in the index
    expect(allDocIds).toContain('1.0');
    expect(allDocIds).toHaveLength(1);

    // No corpus-wide diagnostics (no cross-references to fail)
    expect(corpusResult.diagnostics).toHaveLength(0);
  });

  it('SCN-015: Reference targeting a DocID from a failed document is unresolved', () => {
    const documentA: CorpusDocumentEntry = buildValidEntry(
      'file:///a.md',
      '1.0',
      {
        references: [buildReferenceEdge('1.0', '4.1')],
      },
    );

    // Document B has DocID "4.1" but per-document validation failed
    const documentB: CorpusDocumentEntry = buildFailedEntry('file:///b.md');
    const documents: readonly CorpusDocumentEntry[] = [documentA, documentB];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // An error diagnostic for unresolved toDocId "4.1"
    const unresolvedDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error'
          && diagnostic.message.includes('4.1');
      });
    expect(unresolvedDiagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// Feature: Corpus Result Structure
// ===========================================================================

describe('Feature: Corpus Result Structure', () => {
  it('SCN-016: Corpus with all valid documents produces a complete result', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        sections: [
          buildSectionNode('1.0', 1),
          buildSectionNode('1.0#1', 2, '1.0'),
        ],
      }),
      buildValidEntry('file:///b.md', '2.0', {
        sections: [
          buildSectionNode('2.0', 1),
          buildSectionNode('2.0#1', 2, '2.0'),
        ],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // Per-document entries pair each URI with its lint result
    expect(corpusResult.documents).toHaveLength(2);
    const documentUris: readonly string[] = corpusResult.documents.map(
      (entry: CorpusDocumentEntry) => {
        return entry.uri;
      },
    );
    expect(documentUris).toContain('file:///a.md');
    expect(documentUris).toContain('file:///b.md');

    // Index maps DocIDs to URIs and SectionIDs to URIs
    expect(corpusResult.index).toBeDefined();
    const index: CorpusIndex = corpusResult.index!;
    expect(index.docIds['1.0']).toBe('file:///a.md');
    expect(index.docIds['2.0']).toBe('file:///b.md');
    expect(index.sectionIds['1.0#1']).toBe('file:///a.md');
    expect(index.sectionIds['2.0#1']).toBe('file:///b.md');

    // Corpus-wide diagnostics collection is empty
    expect(corpusResult.diagnostics).toHaveLength(0);
  });

  it('SCN-017: Corpus with integrity violations includes diagnostics but still produces per-document results', () => {
    // Two documents with duplicate DocID to trigger a violation
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0'),
      buildValidEntry('file:///b.md', '1.0'),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // Per-document entries for every input document
    expect(corpusResult.documents).toHaveLength(2);

    // Corpus-wide diagnostics contain one error per violation
    expect(corpusResult.diagnostics.length).toBeGreaterThanOrEqual(1);
    const errorDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity === 'error';
      });
    expect(errorDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('SCN-018: All corpus-wide violations are classified as errors', () => {
    // Corpus with multiple violation types: duplicate DocID and unresolved reference
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///a.md', '1.0', {
        references: [buildReferenceEdge('1.0', '99.0')],
      }),
      buildValidEntry('file:///b.md', '1.0'),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // Every corpus-wide diagnostic has severity "error"
    expect(corpusResult.diagnostics.length).toBeGreaterThanOrEqual(1);
    const nonErrorDiagnostics: readonly Diagnostic[] =
      corpusResult.diagnostics.filter((diagnostic: Diagnostic) => {
        return diagnostic.severity !== 'error';
      });
    expect(nonErrorDiagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Empty and Minimal Corpus
// ===========================================================================

describe('Feature: Empty and Minimal Corpus', () => {
  it('SCN-019: Empty corpus produces no diagnostics', () => {
    const documents: readonly CorpusDocumentEntry[] = [];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // No per-document entries
    expect(corpusResult.documents).toHaveLength(0);

    // Corpus-wide diagnostics collection is empty
    expect(corpusResult.diagnostics).toHaveLength(0);
  });

  it('SCN-020: Single valid document corpus produces a complete result with no corpus-wide errors', () => {
    const documents: readonly CorpusDocumentEntry[] = [
      buildValidEntry('file:///only.md', '5.0', {
        sections: [
          buildSectionNode('5.0', 1),
          buildSectionNode('5.0#1', 2, '5.0'),
          buildSectionNode('5.0#2', 2, '5.0'),
        ],
        references: [],
      }),
    ];

    const corpusResult: CorpusResult = validator.validateCorpus(documents);

    // One per-document entry
    expect(corpusResult.documents).toHaveLength(1);

    // Index includes the document's DocID and all its SectionIDs
    expect(corpusResult.index).toBeDefined();
    const index: CorpusIndex = corpusResult.index!;
    expect(index.docIds['5.0']).toBe('file:///only.md');
    expect(index.sectionIds['5.0#1']).toBe('file:///only.md');
    expect(index.sectionIds['5.0#2']).toBe('file:///only.md');

    // Corpus-wide diagnostics collection is empty
    expect(corpusResult.diagnostics).toHaveLength(0);
  });
});

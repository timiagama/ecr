/**
 * Output Schema Tests
 *
 * Black-box tests for the output schema (spec 1#10) and the graph identity
 * model (spec 1#9.10). Every scenario lints real Markdown through the public
 * {@link Ecr} facade and asserts on what the linter actually produced.
 *
 * These replace nine files that described the same scenarios but asserted on
 * object literals the tests had built themselves, so they passed regardless
 * of what the linter did. Scenario labels are kept, prefixed with the output
 * type they concern, because the SCN numbers restart in each original file.
 */

import { describe, it, expect } from 'vitest';

import { Ecr } from '../src/ecr.js';
import type {
  CorpusResult,
  Diagnostic,
  ExtractedDocument,
  InlineReferenceEdge,
  LintResult,
  SectionNode,
} from '../src/types.js';

const ecr: Ecr = new Ecr();

/** A conforming document exercising every extracted artefact. */
const PAYMENTS: string = [
  '# 4.2 - Payment Processing Contract',
  '',
  'Preamble before any section; see 8.1.',
  '',
  '## 4.2#1 - Idempotency',
  '',
  'Keys are derived per 8.1#3. See 4.2#2 for storage.',
  '',
  '### 4.2#1.1 - Key Derivation',
  '',
  'Text.',
  '',
  '## 4.2#2 - Storage',
  '',
  'Text.',
  '',
  '## References',
  '',
  '- 8.1 - Workflow Orchestration Contract (authority - governs retry of this contract)',
  '',
].join('\n');

/** The document PAYMENTS references. */
const ORCHESTRATION: string = [
  '# 8.1 - Workflow Orchestration Contract',
  '',
  '## 8.1#3 - Retry Semantics',
  '',
  'Text.',
  '',
  '## References',
  '',
].join('\n');

/** A document with no valid H1, so no DocID can be recovered. */
const NO_DOCID: string = 'Just prose.\n\n## References\n';

/**
 * Lints a single document.
 *
 * @param text - Markdown text
 * @param uri - Document URI
 * @param version - Optional version tag
 * @returns The lint result
 */
function lint(text: string, uri: string = 'file:///docs/4.2.md', version?: number): LintResult {
  return ecr.lintDocument(uri, text, version);
}

/**
 * Lints a document and returns its extracted artefacts, failing if there are none.
 *
 * @param text - Markdown text
 * @param uri - Document URI
 * @returns The extracted document
 */
function extract(text: string, uri?: string): ExtractedDocument {
  const extracted: ExtractedDocument | undefined = lint(text, uri).extracted;
  expect(extracted, 'expected extracted artefacts').toBeDefined();
  return extracted!;
}

/**
 * Projects an extracted document onto its graph structure, dropping every
 * field the spec says is not part of identity (titles).
 *
 * @param document - The extracted document
 * @returns The structural projection
 */
function structureOf(document: ExtractedDocument): unknown {
  return {
    docId: document.docId,
    sections: document.sections.map(({ id, headingDepth, parentId }) => ({ id, headingDepth, parentId })),
    references: document.references.map(({ fromDocId, toDocId, direction }) => ({ fromDocId, toDocId, direction })),
    inlineReferences: document.inlineReferences,
  };
}

/**
 * Finds a section node by identifier.
 *
 * @param document - The extracted document
 * @param id - DocID or SectionID
 * @returns The section node
 */
function section(document: ExtractedDocument, id: string): SectionNode {
  const node: SectionNode | undefined = document.sections.find((candidate) => candidate.id === id);
  expect(node, `expected section ${id}`).toBeDefined();
  return node!;
}

describe('Identifiers (spec 1#9.2)', () => {
  it('identity SCN-001/002: a DocID is the dotted number of the H1; malformed numbers are not DocIDs', () => {
    for (const docId of ['1', '3.1', '7.12', '2.4.3']) {
      expect(extract(`# ${docId} - Title\n\n## References\n`).docId).toBe(docId);
    }

    for (const malformed of ['.3', '3.', 'three', '3..1']) {
      expect(lint(`# ${malformed} - Title\n\n## References\n`).extracted).toBeUndefined();
    }
  });

  it('identity SCN-003/004: a SectionID is the DocID, "#", then the section path', () => {
    const ids: readonly string[] = extract(PAYMENTS).sections.slice(1).map((node) => node.id);

    expect(ids).toEqual(['4.2#1', '4.2#1.1', '4.2#2']);
  });

  it('identity SCN-005: a sub-heading naming another document is rejected', () => {
    const result: LintResult = lint('# 4.2 - Doc\n\n## 4.1#1 - Borrowed\n\n## References\n');

    expect(result.ok).toBe(false);
    expect(result.diagnostics.map((diagnostic) => diagnostic.ruleId)).toContain('ECR102');
    expect(result.extracted!.sections.map((node) => node.id)).not.toContain('4.1#1');
  });
});

describe('LintResult (spec 1#10.2)', () => {
  it('lint-result SCN-006/007/008: input echoes the URI, and the version only when supplied', () => {
    const withVersion: LintResult = lint(PAYMENTS, 'custom://doc', 42);
    const withoutVersion: LintResult = lint(PAYMENTS, 'custom://doc');

    expect(withVersion.input).toEqual({ uri: 'custom://doc', version: 42 });
    expect(withoutVersion.input).toEqual({ uri: 'custom://doc' });
    expect('version' in withoutVersion.input).toBe(false);
  });

  it('lint-result SCN-009/010/011: ok reflects whether any error was reported', () => {
    const passing: LintResult = lint(PAYMENTS);
    const failing: LintResult = lint('# 4.2 - Doc\n\n## 4.2.1 - Dotted\n\n## References\n');

    expect(passing.ok).toBe(true);
    expect(passing.diagnostics).toEqual([]);
    expect(failing.ok).toBe(false);
    expect(failing.diagnostics.some((diagnostic) => diagnostic.severity === 'error')).toBe(true);
  });

  it('lint-result SCN-012/013: extracted is present only when a DocID is recovered', () => {
    expect(lint(PAYMENTS).extracted?.docId).toBe('4.2');
    expect(lint(NO_DOCID).extracted).toBeUndefined();
  });
});

describe('Diagnostic (spec 1#10.3)', () => {
  const broken: LintResult = lint(
    '# 4.2 - Doc\n\n## 4.1#1 - Borrowed\n\nApplied per 9.9#1.\n\n## References\n',
    'file:///docs/broken.md',
  );

  it('diagnostic SCN-014/015/016: every diagnostic has a known severity, a rule, a message and the source URI', () => {
    expect(broken.diagnostics.length).toBeGreaterThan(0);

    for (const diagnostic of broken.diagnostics) {
      expect(['error', 'warning', 'info']).toContain(diagnostic.severity);
      expect(diagnostic.ruleId).toMatch(/\S/);
      expect(diagnostic.message).toMatch(/\S/);
      expect(diagnostic.uri).toBe('file:///docs/broken.md');
    }
  });

  it('diagnostic SCN-017: a diagnostic tied to a node carries its zero-based range', () => {
    const heading: Diagnostic | undefined = broken.diagnostics.find((diagnostic) => diagnostic.ruleId === 'ECR102');

    // The offending heading is on the third line, first column.
    expect(heading?.range?.start).toEqual({ line: 2, character: 0 });
  });

  it('diagnostic SCN-018: structural context identifiers are attached when known', () => {
    const heading: Diagnostic | undefined = broken.diagnostics.find((diagnostic) => diagnostic.ruleId === 'ECR102');
    const corpus: CorpusResult = ecr.validateCorpus([
      { uri: 'a.md', markdownText: '# 5.1 - Doc\n\n## References\n\n- 9.9 - Missing (dependency - absent)\n' },
    ]);

    expect(heading?.sectionId).toBe('4.1#1');
    expect(corpus.diagnostics[0]?.docId).toBe('5.1');
  });

  it('diagnostic SCN-019: data carries structured detail', () => {
    const corpus: CorpusResult = ecr.validateCorpus([
      { uri: 'a.md', markdownText: ORCHESTRATION },
      { uri: 'b.md', markdownText: ORCHESTRATION },
    ]);

    expect(corpus.diagnostics[0]?.data).toEqual({ duplicateUris: ['a.md', 'b.md'] });
  });
});

describe('ExtractedDocument (spec 1#10.4)', () => {
  const document: ExtractedDocument = extract(PAYMENTS);

  it('extracted SCN-020/021: DocID and title come from the H1', () => {
    expect(document.docId).toBe('4.2');
    expect(document.title).toBe('Payment Processing Contract');
  });

  it('extracted SCN-023/024/025: sections include the root; references and inline references are collected', () => {
    expect(document.sections[0]?.id).toBe('4.2');
    expect(document.sections).toHaveLength(4);
    expect(document.references).toHaveLength(1);
    expect(document.inlineReferences).toHaveLength(3);
  });
});

describe('SectionNode (spec 1#10.5)', () => {
  const document: ExtractedDocument = extract(PAYMENTS);

  it('section SCN-026: the root node is the H1, at depth 1, with no parent', () => {
    expect(document.sections[0]).toEqual({ id: '4.2', title: 'Payment Processing Contract', headingDepth: 1 });
  });

  it('section SCN-027/028: sub-headings carry this document\'s SectionIDs, one path segment per level', () => {
    for (const node of document.sections.slice(1)) {
      const [docPart, path] = node.id.split('#');

      expect(docPart).toBe('4.2');
      expect(path!.split('.')).toHaveLength(node.headingDepth - 1);
    }
  });

  it('section SCN-029: parentId is the nearest preceding heading one level up', () => {
    expect(section(document, '4.2#1').parentId).toBe('4.2');
    expect(section(document, '4.2#1.1').parentId).toBe('4.2#1');
    expect(section(document, '4.2#2').parentId).toBe('4.2');
  });

  it('section SCN-030: the title is extracted after the dash, whichever dash is used', () => {
    const emDash: ExtractedDocument = extract('# 4.2 — Doc\n\n## 4.2#1 – Idempotency\n\n## References\n');

    expect(section(emDash, '4.2#1').title).toBe('Idempotency');
  });
});

describe('ReferenceEdge (spec 1#10.6)', () => {
  it('reference SCN-031..035: each References entry becomes a typed edge from this document', () => {
    expect(extract(PAYMENTS).references).toEqual([
      {
        fromDocId: '4.2',
        toDocId: '8.1',
        direction: 'authority',
        explanation: 'governs retry of this contract',
        title: 'Workflow Orchestration Contract',
      },
    ]);
  });
});

describe('InlineReferenceEdge (spec 1#10.7)', () => {
  const edges: readonly InlineReferenceEdge[] = extract(PAYMENTS).inlineReferences;

  it('inline SCN-036/037: the source is the most recent heading, or the DocID before any sub-heading', () => {
    expect(edges.map((edge) => edge.fromId)).toEqual(['4.2', '4.2#1', '4.2#1']);
  });

  it('inline SCN-038/039: the target is the identifier as written, and the kind is normalised to lowercase', () => {
    expect(edges.map(({ toId, kind }) => ({ toId, kind }))).toEqual([
      { toId: '8.1', kind: 'see' },
      { toId: '8.1#3', kind: 'per' },
      { toId: '4.2#2', kind: 'see' },
    ]);
  });
});

describe('CorpusResult (spec 1#10.8)', () => {
  it('corpus SCN-040/041/042: per-document results, corpus diagnostics and an index mapping identifiers to URIs', () => {
    const corpus: CorpusResult = ecr.validateCorpus([
      { uri: 'payments.md', markdownText: PAYMENTS },
      { uri: 'orchestration.md', markdownText: ORCHESTRATION },
    ]);

    expect(corpus.documents.map((entry) => [entry.uri, entry.result.ok])).toEqual([
      ['payments.md', true],
      ['orchestration.md', true],
    ]);
    expect(corpus.diagnostics).toEqual([]);
    expect(corpus.index?.docIds).toEqual({ '4.2': 'payments.md', '8.1': 'orchestration.md' });
    expect(corpus.index?.sectionIds['8.1#3']).toBe('orchestration.md');
    expect(corpus.index?.sectionIds['4.2#1.1']).toBe('payments.md');
  });

  it('corpus SCN-043: the index is omitted when identifiers are not unique', () => {
    const corpus: CorpusResult = ecr.validateCorpus([
      { uri: 'a.md', markdownText: ORCHESTRATION },
      { uri: 'b.md', markdownText: ORCHESTRATION },
    ]);

    expect(corpus.index).toBeUndefined();
  });
});

describe('Graph identity (spec 1#9.10)', () => {
  it('graph SCN-044/045: editing titles, heading text and content leaves the structure unchanged', () => {
    const edited: string = PAYMENTS
      .replace('Payment Processing Contract', 'Payments Contract (Revised)')
      .replace('Idempotency', 'Idempotent Requests')
      .replace('- 8.1 - Workflow Orchestration Contract', '- 8.1 - Orchestration')
      .replace('Preamble before any section', 'A rewritten preamble');

    const original: ExtractedDocument = extract(PAYMENTS);
    const revised: ExtractedDocument = extract(edited);

    expect(revised.title).not.toBe(original.title);
    expect(structureOf(revised)).toEqual(structureOf(original));
  });

  it('graph SCN-046: the URI is not part of identity', () => {
    const atFirstPath: ExtractedDocument = extract(PAYMENTS, 'file:///a/4.2.md');
    const atSecondPath: ExtractedDocument = extract(PAYMENTS, 'obsidian://vault/4.2.md');

    expect(atSecondPath).toEqual(atFirstPath);
  });
});

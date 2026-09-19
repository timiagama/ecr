/**
 * Tests for PerDocumentVisitor
 *
 * Covers all 23 scenarios across 16 features:
 *   - Valid complete document (SCN-001)
 *   - Input echoing: uri and version (SCN-002, SCN-003)
 *   - Missing H1 heading (SCN-004)
 *   - Invalid H1 separator (SCN-005)
 *   - Empty document (SCN-006)
 *   - Section hierarchy extraction (SCN-007)
 *   - Missing References section (SCN-008)
 *   - References extraction (SCN-009)
 *   - Inline references (SCN-010)
 *   - Code block filtering (SCN-011)
 *   - Inline code filtering (SCN-012)
 *   - HTML filtering (SCN-013)
 *   - Section context tracking (SCN-014, SCN-015)
 *   - ok semantics (SCN-016, SCN-017)
 *   - H1-only document (SCN-018)
 *   - Extracted presence/absence (SCN-019, SCN-020)
 *   - List item dispatch to ECR103 (SCN-021)
 *   - Self-referencing inline references (SCN-022)
 *   - Diagnostic aggregation (SCN-023)
 */

import { describe, it, expect } from 'vitest';
import type {
  LintResult,
  ExtractedDocument,
  Diagnostic,
  SectionNode,
  ReferenceEdge,
  InlineReferenceEdge,
} from '../src/types.js';
import { PerDocumentVisitor } from '../src/per-document-visitor.js';
import type { PerDocumentVisitorOptions } from '../src/per-document-visitor.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a PerDocumentVisitor instance with sensible defaults for testing.
 *
 * @param overrides - Optional overrides for the default options
 * @returns A new PerDocumentVisitor instance
 */
function createVisitor(overrides?: Partial<PerDocumentVisitorOptions>): PerDocumentVisitor {
  const defaults: PerDocumentVisitorOptions = {
    uri: 'file:///test.md',
  };
  return new PerDocumentVisitor({ ...defaults, ...overrides });
}

/**
 * Convenience function that creates a visitor and lints a Markdown string.
 *
 * @param markdown - The raw Markdown text to lint
 * @param options - Optional overrides for the default visitor options
 * @returns The composite LintResult
 */
function lintMarkdown(markdown: string, options?: Partial<PerDocumentVisitorOptions>): LintResult {
  const visitor: PerDocumentVisitor = createVisitor(options);
  return visitor.lint(markdown);
}

// ===========================================================================
// Feature: Valid complete document producing a successful LintResult
// ===========================================================================

describe('Feature: Valid complete document producing a successful LintResult', () => {
  it('SCN-001: Fully valid ECR document produces ok=true with all extracted artefacts', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#1 - Overview',
      '',
      'Some content see 3.1#1.',
      '',
      '## References',
      '',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/3.1.md',
      version: 1,
    });

    expect(result.ok).toBe(true);
    expect(result.input.uri).toBe('file:///docs/3.1.md');
    expect(result.input.version).toBe(1);
    expect(result.diagnostics).toHaveLength(0);

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.docId).toBe('3.1');
    expect(extracted.title).toBe('Scenario Authoring');

    // Sections: root (3.1) and one sub-section (3.1#1)
    expect(extracted.sections.length).toBeGreaterThanOrEqual(2);

    const rootSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '3.1',
    );
    expect(rootSection).toBeDefined();
    expect(rootSection!.headingDepth).toBe(1);
    expect(rootSection!.parentId).toBeUndefined();

    const overviewSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '3.1#1',
    );
    expect(overviewSection).toBeDefined();
    expect(overviewSection!.headingDepth).toBe(2);
    expect(overviewSection!.parentId).toBe('3.1');

    // References: one edge to 8.1
    expect(extracted.references.length).toBeGreaterThanOrEqual(1);
    const refEdge: ReferenceEdge | undefined = extracted.references.find(
      (edge: ReferenceEdge) => edge.toDocId === '8.1',
    );
    expect(refEdge).toBeDefined();
    expect(refEdge!.fromDocId).toBe('3.1');
    expect(refEdge!.direction).toBe('constraint');

    // Inline references: one self-reference see 3.1#1
    expect(extracted.inlineReferences.length).toBeGreaterThanOrEqual(1);
    const inlineEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.toId === '3.1#1',
    );
    expect(inlineEdge).toBeDefined();
    expect(inlineEdge!.fromId).toBe('3.1#1');
    expect(inlineEdge!.kind).toBe('see');
  });
});

// ===========================================================================
// Feature: LintResult.input echoes uri and version
// ===========================================================================

describe('Feature: LintResult.input echoes uri and version', () => {
  it('SCN-002: Uri and version are echoed in the LintResult input', () => {
    const markdown: string = [
      '# 1 - Title',
      '',
      '## References',
      '',
      '- 2 - Other (dependency - some dep)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///test/doc.md',
      version: 42,
    });

    expect(result.input.uri).toBe('file:///test/doc.md');
    expect(result.input.version).toBe(42);
  });

  it('SCN-003: Version omitted produces LintResult.input without version', () => {
    const markdown: string = [
      '# 1 - Title',
      '',
      '## References',
      '',
      '- 2 - Other (dependency - some dep)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///test/doc.md',
    });

    expect(result.input.uri).toBe('file:///test/doc.md');
    expect(result.input.version).toBeUndefined();
  });
});

// ===========================================================================
// Feature: Missing H1 heading produces ECR101 error with no extracted document
// ===========================================================================

describe('Feature: Missing H1 heading produces ECR101 error with no extracted document', () => {
  it('SCN-004: Document with no H1 heading fails with ECR101 diagnostic', () => {
    const markdown: string = [
      '## 3.1#1 - Overview',
      '',
      'Some content.',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/no-h1.md',
    });

    expect(result.ok).toBe(false);

    const ecr101Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR101',
    );
    expect(ecr101Diagnostics.length).toBeGreaterThanOrEqual(1);

    expect(result.extracted).toBeUndefined();
  });
});

// ===========================================================================
// Feature: Any dash variant in the H1 separator yields a valid document
// ===========================================================================

describe('Feature: Any dash variant in the H1 separator yields a valid document', () => {
  it.each([
    { separator: '-', description: 'hyphen-minus (U+002D)' },
    { separator: '–', description: 'en dash (U+2013)' },
    { separator: '—', description: 'em dash (U+2014)' },
  ])('SCN-005: H1 with $description extracts the document', ({ separator }) => {
    const markdown: string = [
      `# 3.1 ${separator} Ingestion`,
      '',
      '## References',
      '',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/dash-variant.md',
    });

    const ecr101Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR101',
    );
    expect(
      ecr101Diagnostics.length,
      `SCN-005: expected no ECR101 diagnostic for "${separator}" separator`,
    ).toBe(0);

    expect(result.ok, 'SCN-005: expected the document to lint cleanly').toBe(true);
    expect(result.extracted?.docId as string, 'SCN-005: expected DocID "3.1"').toBe('3.1');
  });
});

// ===========================================================================
// Feature: Empty document produces ECR101 error
// ===========================================================================

describe('Feature: Empty document produces ECR101 error', () => {
  it('SCN-006: Empty string input fails with ECR101 diagnostic', () => {
    const markdown: string = '';

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/empty.md',
    });

    expect(result.ok).toBe(false);

    const ecr101Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR101',
    );
    expect(ecr101Diagnostics.length).toBeGreaterThanOrEqual(1);

    expect(result.extracted).toBeUndefined();
  });
});

// ===========================================================================
// Feature: Valid H1 with valid sections extracts correct SectionNode hierarchy
// ===========================================================================

describe('Feature: Valid H1 with valid sections extracts correct SectionNode hierarchy', () => {
  it('SCN-007: Multi-level heading hierarchy produces correct section extraction', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      '### 5.1#1.1 - Authentication',
      '',
      '## 5.1#2 - Data Model',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (dependency - consumes scenario definitions)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.sections).toHaveLength(4);

    const rootSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '5.1',
    );
    expect(rootSection).toBeDefined();
    expect(rootSection!.headingDepth).toBe(1);
    expect(rootSection!.parentId).toBeUndefined();

    const endpointsSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '5.1#1',
    );
    expect(endpointsSection).toBeDefined();
    expect(endpointsSection!.headingDepth).toBe(2);
    expect(endpointsSection!.parentId).toBe('5.1');

    const authSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '5.1#1.1',
    );
    expect(authSection).toBeDefined();
    expect(authSection!.headingDepth).toBe(3);
    expect(authSection!.parentId).toBe('5.1#1');

    const dataModelSection: SectionNode | undefined = extracted.sections.find(
      (section: SectionNode) => section.id === '5.1#2',
    );
    expect(dataModelSection).toBeDefined();
    expect(dataModelSection!.headingDepth).toBe(2);
    expect(dataModelSection!.parentId).toBe('5.1');
  });
});

// ===========================================================================
// Feature: Missing References section produces ECR103 error
// ===========================================================================

describe('Feature: Missing References section produces ECR103 error', () => {
  it('SCN-008: Document with valid H1 but no References section has ECR103 diagnostic', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#1 - Overview',
      '',
      'Some content.',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/no-refs.md',
    });

    expect(result.ok).toBe(false);

    const ecr103Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR103',
    );
    expect(ecr103Diagnostics.length).toBeGreaterThanOrEqual(1);

    const missingRefsDiagnostic: Diagnostic | undefined = ecr103Diagnostics.find(
      (diagnostic: Diagnostic) => diagnostic.message.toLowerCase().includes('references'),
    );
    expect(missingRefsDiagnostic).toBeDefined();

    // Extracted is present because a valid DocID was recovered
    expect(result.extracted).toBeDefined();
    expect(result.extracted!.docId).toBe('3.1');
  });
});

// ===========================================================================
// Feature: Valid References section with entries extracts ReferenceEdge artefacts
// ===========================================================================

describe('Feature: Valid References section with entries extracts ReferenceEdge artefacts', () => {
  it('SCN-009: References section with multiple valid entries produces edges', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.references).toHaveLength(2);

    const authorityEdge: ReferenceEdge | undefined = extracted.references.find(
      (edge: ReferenceEdge) => edge.toDocId === '3.1',
    );
    expect(authorityEdge).toBeDefined();
    expect(authorityEdge!.fromDocId).toBe('5.1');
    expect(authorityEdge!.direction).toBe('authority');
    expect(authorityEdge!.title).toBe('Scenario Authoring');
    expect(authorityEdge!.explanation).toBe('defines guardrail logic');

    const constraintEdge: ReferenceEdge | undefined = extracted.references.find(
      (edge: ReferenceEdge) => edge.toDocId === '8.1',
    );
    expect(constraintEdge).toBeDefined();
    expect(constraintEdge!.fromDocId).toBe('5.1');
    expect(constraintEdge!.direction).toBe('constraint');
    expect(constraintEdge!.title).toBe('Orchestration Contract');
    expect(constraintEdge!.explanation).toBe('defines retry semantics');
  });
});

// ===========================================================================
// Feature: Inline references in prose are extracted as InlineReferenceEdge artefacts
// ===========================================================================

describe('Feature: Inline references in prose are extracted as InlineReferenceEdge artefacts', () => {
  it('SCN-010: Prose with see and per inline references produces edges', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      'Guardrail requirements are enforced per 3.1#2 and context assembly logic see 8.1#3.',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.inlineReferences).toHaveLength(2);

    const perEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.kind === 'per',
    );
    expect(perEdge).toBeDefined();
    expect(perEdge!.fromId).toBe('5.1#1');
    expect(perEdge!.toId).toBe('3.1#2');

    const seeEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.kind === 'see',
    );
    expect(seeEdge).toBeDefined();
    expect(seeEdge!.fromId).toBe('5.1#1');
    expect(seeEdge!.toId).toBe('8.1#3');
  });
});

// ===========================================================================
// Feature: Inline references inside fenced code blocks are ignored
// ===========================================================================

describe('Feature: Inline references inside fenced code blocks are ignored', () => {
  it('SCN-011: Inline reference keyword inside a fenced code block is not detected', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      '```',
      'see 3.1#2',
      '```',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    expect(result.extracted!.inlineReferences).toHaveLength(0);

    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Inline references inside inline code are ignored
// ===========================================================================

describe('Feature: Inline references inside inline code are ignored', () => {
  it('SCN-012: Inline reference keyword inside backtick inline code is not detected', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      'Use the pattern `see 3.1#2` for reference.',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    expect(result.extracted!.inlineReferences).toHaveLength(0);

    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Inline references inside HTML elements are ignored
// ===========================================================================

describe('Feature: Inline references inside HTML elements are ignored', () => {
  it('SCN-013: Inline reference keyword inside an HTML element is not detected', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      '<div>see 3.1#2</div>',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    expect(result.extracted!.inlineReferences).toHaveLength(0);

    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Section context tracking for inline references
// ===========================================================================

describe('Feature: Section context tracking for inline references', () => {
  it('SCN-014: Inline references in different sections have correct fromId', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      'Guardrail logic per 3.1#2.',
      '',
      '## 5.1#2 - Data Model',
      '',
      'Context assembly see 3.1#3.',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.inlineReferences).toHaveLength(2);

    const perEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.kind === 'per',
    );
    expect(perEdge).toBeDefined();
    expect(perEdge!.fromId).toBe('5.1#1');
    expect(perEdge!.toId).toBe('3.1#2');

    const seeEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.kind === 'see',
    );
    expect(seeEdge).toBeDefined();
    expect(seeEdge!.fromId).toBe('5.1#2');
    expect(seeEdge!.toId).toBe('3.1#3');
  });
});

// ===========================================================================
// Feature: Section context for text before any H2 heading uses DocID
// ===========================================================================

describe('Feature: Section context for text before any H2 heading uses DocID', () => {
  it('SCN-015: Inline reference in prose before the first H2 uses DocID as fromId', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      'This document builds on see 3.1.',
      '',
      '## 5.1#1 - Endpoints',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.inlineReferences).toHaveLength(1);

    const edge: InlineReferenceEdge = extracted.inlineReferences[0]!;
    expect(edge.fromId).toBe('5.1');
    expect(edge.toId).toBe('3.1');
    expect(edge.kind).toBe('see');
  });
});

// ===========================================================================
// Feature: LintResult.ok reflects composite diagnostic status
// ===========================================================================

describe('Feature: LintResult.ok reflects composite diagnostic status', () => {
  it('SCN-016: Document with only error diagnostics has ok=false', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#1 - Overview',
      '',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/3.1.md',
    });

    expect(result.ok).toBe(false);

    const errorDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.severity === 'error',
    );
    expect(errorDiagnostics.length).toBeGreaterThanOrEqual(1);
  });

  it('SCN-017: Document with zero error diagnostics has ok=true', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#1 - Overview',
      '',
      'Some valid content.',
      '',
      '## References',
      '',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/valid.md',
    });

    expect(result.ok).toBe(true);

    const errorDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.severity === 'error',
    );
    expect(errorDiagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Document with only H1 and no other content
// ===========================================================================

describe('Feature: Document with only H1 and no other content', () => {
  it('SCN-018: Document with only a valid H1 heading fails due to missing References', () => {
    const markdown: string = '# 3.1 - Scenario Authoring';

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/3.1.md',
    });

    expect(result.ok).toBe(false);

    const ecr103Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR103',
    );
    expect(ecr103Diagnostics.length).toBeGreaterThanOrEqual(1);

    const missingRefsDiagnostic: Diagnostic | undefined = ecr103Diagnostics.find(
      (diagnostic: Diagnostic) => diagnostic.message.toLowerCase().includes('references'),
    );
    expect(missingRefsDiagnostic).toBeDefined();

    // Extracted is present because a valid DocID was recovered
    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;
    expect(extracted.docId).toBe('3.1');

    // Only the root section
    expect(extracted.sections).toHaveLength(1);
    const rootSection: SectionNode = extracted.sections[0]!;
    expect(rootSection.id).toBe('3.1');
    expect(rootSection.headingDepth).toBe(1);
    expect(rootSection.parentId).toBeUndefined();

    expect(extracted.references).toHaveLength(0);
    expect(extracted.inlineReferences).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Extracted document is present when DocID is recoverable despite other errors
// ===========================================================================

describe('Feature: Extracted document is present when DocID is recoverable despite other errors', () => {
  it('SCN-019: Valid H1 with downstream rule errors still produces extracted document', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#1 - Overview',
      '',
      'Referencing an undeclared document see 99.1#2.',
      '',
      '## References',
      '',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/3.1.md',
    });

    expect(result.ok).toBe(false);

    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics.length).toBeGreaterThanOrEqual(1);

    // Extracted is present because a valid DocID was recovered
    expect(result.extracted).toBeDefined();
    expect(result.extracted!.docId).toBe('3.1');
  });
});

// ===========================================================================
// Feature: Extracted document absent when DocID is not recoverable
// ===========================================================================

describe('Feature: Extracted document absent when DocID is not recoverable', () => {
  it('SCN-020: Invalid H1 means no extracted document', () => {
    const markdown: string = [
      '# Not A Valid Heading',
      '',
      '## References',
      '',
      '- 8.1 - Orchestration Contract (constraint - defines retry semantics)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/bad.md',
    });

    expect(result.ok).toBe(false);

    const ecr101Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR101',
    );
    expect(ecr101Diagnostics.length).toBeGreaterThanOrEqual(1);

    expect(result.extracted).toBeUndefined();
  });
});

// ===========================================================================
// Feature: List items in References section are fed to ECR103
// ===========================================================================

describe('Feature: List items in References section are fed to ECR103', () => {
  it('SCN-021: List items under References heading are evaluated by ECR103', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
      '- INVALID ENTRY',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    const ecr103Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR103',
    );
    expect(ecr103Diagnostics.length).toBeGreaterThanOrEqual(1);

    expect(result.extracted).toBeDefined();
    expect(result.extracted!.references).toHaveLength(1);

    const validEdge: ReferenceEdge = result.extracted!.references[0]!;
    expect(validEdge.fromDocId).toBe('5.1');
    expect(validEdge.toDocId).toBe('3.1');
  });
});

// ===========================================================================
// Feature: Self-referencing inline references do not require References declaration
// ===========================================================================

describe('Feature: Self-referencing inline references do not require References declaration', () => {
  it('SCN-022: Inline reference to the document\'s own DocID or its sections is valid', () => {
    const markdown: string = [
      '# 5.1 - API Design',
      '',
      '## 5.1#1 - Endpoints',
      '',
      'As defined in see 5.1#1 above.',
      '',
      '## References',
      '',
      '- 3.1 - Scenario Authoring (authority - defines guardrail logic)',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/5.1.md',
    });

    expect(result.extracted).toBeDefined();
    const extracted: ExtractedDocument = result.extracted!;

    expect(extracted.inlineReferences.length).toBeGreaterThanOrEqual(1);
    const selfRefEdge: InlineReferenceEdge | undefined = extracted.inlineReferences.find(
      (edge: InlineReferenceEdge) => edge.toId === '5.1#1',
    );
    expect(selfRefEdge).toBeDefined();
    expect(selfRefEdge!.fromId).toBe('5.1#1');
    expect(selfRefEdge!.kind).toBe('see');

    // No ECR104 diagnostics for the self-reference
    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: All diagnostics from all rules are aggregated
// ===========================================================================

describe('Feature: All diagnostics from all rules are aggregated', () => {
  it('SCN-023: Diagnostics from ECR103 and ECR104 are all present in the result', () => {
    const markdown: string = [
      '# 3.1 - Scenario Authoring',
      '',
      '## 3.1#5 - Skipped Level',
      '',
      'Undeclared dependency see 99.1.',
      '',
      '## References',
      '',
      '- INVALID ENTRY',
    ].join('\n');

    const result: LintResult = lintMarkdown(markdown, {
      uri: 'file:///docs/3.1.md',
    });

    expect(result.ok).toBe(false);

    const ecr103Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR103',
    );
    expect(ecr103Diagnostics.length).toBeGreaterThanOrEqual(1);

    const ecr104Diagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.ruleId === 'ECR104',
    );
    expect(ecr104Diagnostics.length).toBeGreaterThanOrEqual(1);
  });
});

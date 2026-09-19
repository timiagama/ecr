/**
 * Black-box test suite for SectionHierarchyRule
 *
 * 24 scenarios, exercised through the public SectionHierarchyRule class.
 */

import { describe, it, expect } from 'vitest';
import {
  SectionHierarchyRule,
  IdentifierGrammar,
  SECTION_HIERARCHY_RULE_ID,
} from '../src/index.js';
import type {
  HeadingNodeData,
  SectionNode,
  Diagnostic,
} from '../src/index.js';
import type { SectionHierarchyRuleResult } from '../src/section-hierarchy-rule.js';

// ---------------------------------------------------------------------------
// Shared instance -- stateless class, safe to share across tests
// ---------------------------------------------------------------------------

const grammar: IdentifierGrammar = new IdentifierGrammar();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constructs a SectionHierarchyRule, registers the root H1, feeds sub-headings,
 * and returns the finalised result.
 *
 * @param docId - The document's DocID
 * @param rootText - The H1 heading text (e.g. "3.1 - Title")
 * @param subHeadings - Sub-headings at depth >= 2
 * @returns The finalised rule result
 */
function evaluateDocument(
  docId: string,
  rootText: string,
  subHeadings: readonly HeadingNodeData[],
): SectionHierarchyRuleResult {
  const rule: SectionHierarchyRule = new SectionHierarchyRule({
    uri: 'file:///test.md',
    docId,
    grammar,
  });

  rule.registerRootHeading({ depth: 1, text: rootText });

  for (const heading of subHeadings) {
    rule.evaluateHeading(heading);
  }

  return rule.finalise();
}

/**
 * Finds a section node by its id within a result's sections array.
 *
 * @param sections - The array of section nodes to search
 * @param sectionId - The id to look up
 * @returns The matching section node, or undefined if not found
 */
function findSectionById(
  sections: readonly SectionNode[],
  sectionId: string,
): SectionNode | undefined {
  return sections.find((section) => { return section.id === sectionId; });
}

// ---------------------------------------------------------------------------
// Feature: Section SectionID Prefix Validation
// ---------------------------------------------------------------------------

describe('Feature: Section SectionID Prefix Validation', () => {
  // =========================================================================
  // Scenario Outline: Valid SectionID prefix at various depths (7 rows)
  // =========================================================================

  describe('Scenario Outline: Valid SectionID prefix at various depths', () => {
    it.each([
      {
        docId: '3.1',
        depth: 2,
        headingText: '3.1#1 - First Section',
        expectedId: '3.1#1',
        tag: '@SCN-PREFIX-01',
      },
      {
        docId: '3.1',
        depth: 3,
        headingText: '3.1#1.2 - Subsection',
        expectedId: '3.1#1.2',
        tag: '@SCN-PREFIX-02',
      },
      {
        docId: '3.1',
        depth: 4,
        headingText: '3.1#1.2.1 - Deep Section',
        expectedId: '3.1#1.2.1',
        tag: '@SCN-PREFIX-03',
      },
      {
        docId: '1',
        depth: 2,
        headingText: '1#1 - Only Section',
        expectedId: '1#1',
        tag: '@SCN-PREFIX-04',
      },
      {
        docId: '1',
        depth: 3,
        headingText: '1#1.1 - Sub',
        expectedId: '1#1.1',
        tag: '@SCN-PREFIX-05',
      },
      {
        docId: '7.12',
        depth: 2,
        headingText: '7.12#3 - Multi-digit',
        expectedId: '7.12#3',
        tag: '@SCN-PREFIX-06',
      },
      {
        docId: '2.4.3',
        depth: 2,
        headingText: '2.4.3#1 - Deeper DocID',
        expectedId: '2.4.3#1',
        tag: '@SCN-PREFIX-07',
      },
    ])(
      '$tag: no diagnostic for "$headingText" (docId=$docId, depth=$depth)',
      ({ docId, depth, headingText, expectedId, tag }) => {
        // Build parent headings to avoid skipped-level errors
        const subHeadings: HeadingNodeData[] = buildIntermediateHeadings(docId, depth, headingText);

        const result: SectionHierarchyRuleResult = evaluateDocument(
          docId,
          `${docId} - Title`,
          subHeadings,
        );

        const errorDiagnosticsForHeading: readonly Diagnostic[] = result.diagnostics.filter(
          (diagnostic) => { return diagnostic.message.includes(expectedId) && diagnostic.severity === 'error'; },
        );

        // The heading itself must not produce an error
        // (intermediate headings are valid by construction)
        expect(
          errorDiagnosticsForHeading.length,
          `${tag}: expected no error diagnostic for heading "${headingText}"`,
        ).toBe(0);

        const matchingSection: SectionNode | undefined = findSectionById(
          result.sections,
          expectedId,
        );

        expect(
          matchingSection,
          `${tag}: expected a section node with id "${expectedId}"`,
        ).toBeDefined();

        expect(
          matchingSection!.headingDepth,
          `${tag}: expected headingDepth to be ${depth}`,
        ).toBe(depth);
      },
    );
  });

  // =========================================================================
  // Scenario: SectionID does not begin with the document DocID
  // =========================================================================

  describe('@SCN-PREFIX-WRONG: SectionID does not begin with the document DocID', () => {
    it('emits an error diagnostic when SectionID prefix does not match DocID', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '4.2#1 - Wrong Prefix' }],
      );

      expect(
        result.diagnostics.length,
        '@SCN-PREFIX-WRONG: expected at least one diagnostic',
      ).toBeGreaterThanOrEqual(1);

      const hasErrorDiagnostic: boolean = result.diagnostics.some(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        hasErrorDiagnostic,
        '@SCN-PREFIX-WRONG: expected an error-severity diagnostic',
      ).toBe(true);
    });
  });

  // =========================================================================
  // Scenario: Heading prefix is not a valid SectionID
  // =========================================================================

  describe('@SCN-PREFIX-INVALID: Heading prefix is not a valid SectionID', () => {
    it('emits an error diagnostic when heading has no valid SectionID prefix', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: 'Introduction' }],
      );

      expect(
        result.diagnostics.length,
        '@SCN-PREFIX-INVALID: expected at least one diagnostic',
      ).toBeGreaterThanOrEqual(1);

      const hasErrorDiagnostic: boolean = result.diagnostics.some(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        hasErrorDiagnostic,
        '@SCN-PREFIX-INVALID: expected an error-severity diagnostic',
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Depth-to-Segment Count Enforcement
// ---------------------------------------------------------------------------

describe('Feature: Depth-to-Segment Count Enforcement', () => {
  // =========================================================================
  // Scenario Outline: Correct segment count for heading depth (6 rows)
  // =========================================================================

  describe('Scenario Outline: Segment count matches depth rule', () => {
    it.each([
      { docId: '3.1', depth: 2, sectionId: '3.1#1', tag: '@SCN-SEGCOUNT-OK-01' },
      { docId: '3.1', depth: 3, sectionId: '3.1#1.2', tag: '@SCN-SEGCOUNT-OK-02' },
      { docId: '3.1', depth: 4, sectionId: '3.1#1.2.1', tag: '@SCN-SEGCOUNT-OK-03' },
      { docId: '1', depth: 2, sectionId: '1#1', tag: '@SCN-SEGCOUNT-OK-04' },
      { docId: '2.4.3', depth: 2, sectionId: '2.4.3#1', tag: '@SCN-SEGCOUNT-OK-05' },
      { docId: '2.4.3', depth: 3, sectionId: '2.4.3#1.1', tag: '@SCN-SEGCOUNT-OK-06' },
    ])(
      '$tag: no diagnostic for sectionId "$sectionId" at depth $depth (docId=$docId)',
      ({ docId, depth, sectionId, tag }) => {
        const headingText = `${sectionId} - Test Section`;
        const subHeadings: HeadingNodeData[] = buildIntermediateHeadings(docId, depth, headingText);

        const result: SectionHierarchyRuleResult = evaluateDocument(
          docId,
          `${docId} - Title`,
          subHeadings,
        );

        // No error diagnostics should reference this sectionId
        const errorsForSection: readonly Diagnostic[] = result.diagnostics.filter(
          (diagnostic) => {
            return diagnostic.severity === 'error' &&
              diagnostic.message.includes(sectionId);
          },
        );

        expect(
          errorsForSection.length,
          `${tag}: expected no error diagnostic for section "${sectionId}"`,
        ).toBe(0);
      },
    );
  });

  // =========================================================================
  // Scenario Outline: Too few segments for heading depth (3 rows)
  // =========================================================================

  describe('Scenario Outline: SectionID has too few segments for heading depth', () => {
    it.each([
      {
        docId: '3.1',
        depth: 3,
        sectionId: '3.1#1',
        actualSegments: 3,
        expectedSegments: 4,
        tag: '@SCN-SEGCOUNT-FEW-01',
      },
      {
        docId: '3.1',
        depth: 4,
        sectionId: '3.1#1.2',
        actualSegments: 4,
        expectedSegments: 5,
        tag: '@SCN-SEGCOUNT-FEW-02',
      },
      {
        docId: '1',
        depth: 3,
        sectionId: '1#1',
        actualSegments: 2,
        expectedSegments: 3,
        tag: '@SCN-SEGCOUNT-FEW-03',
      },
    ])(
      '$tag: error for "$sectionId" at depth $depth (expected $expectedSegments segments, got $actualSegments)',
      ({ docId, depth, sectionId, tag }) => {
        const headingText = `${sectionId} - Test Section`;

        // Build intermediate headings up to depth-1, then add the failing heading
        const intermediateHeadings: HeadingNodeData[] = buildIntermediateHeadings(
          docId,
          depth - 1,
          undefined,
        );
        intermediateHeadings.push({ depth, text: headingText });

        const result: SectionHierarchyRuleResult = evaluateDocument(
          docId,
          `${docId} - Title`,
          intermediateHeadings,
        );

        expect(
          result.diagnostics.length,
          `${tag}: expected at least one diagnostic`,
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );

        expect(
          hasErrorDiagnostic,
          `${tag}: expected an error-severity diagnostic for segment count mismatch`,
        ).toBe(true);
      },
    );
  });

  // =========================================================================
  // Scenario Outline: Too many segments for heading depth (3 rows)
  // =========================================================================

  describe('Scenario Outline: SectionID has too many segments for heading depth', () => {
    it.each([
      {
        docId: '3.1',
        depth: 2,
        sectionId: '3.1#1.2',
        actualSegments: 4,
        expectedSegments: 3,
        tag: '@SCN-SEGCOUNT-MANY-01',
      },
      {
        docId: '3.1',
        depth: 2,
        sectionId: '3.1#1.2.1',
        actualSegments: 5,
        expectedSegments: 3,
        tag: '@SCN-SEGCOUNT-MANY-02',
      },
      {
        docId: '1',
        depth: 2,
        sectionId: '1#1.1',
        actualSegments: 3,
        expectedSegments: 2,
        tag: '@SCN-SEGCOUNT-MANY-03',
      },
    ])(
      '$tag: error for "$sectionId" at depth $depth (expected $expectedSegments segments, got $actualSegments)',
      ({ docId, depth, sectionId, tag }) => {
        const headingText = `${sectionId} - Test Section`;

        const result: SectionHierarchyRuleResult = evaluateDocument(
          docId,
          `${docId} - Title`,
          [{ depth, text: headingText }],
        );

        expect(
          result.diagnostics.length,
          `${tag}: expected at least one diagnostic`,
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );

        expect(
          hasErrorDiagnostic,
          `${tag}: expected an error-severity diagnostic for segment count mismatch`,
        ).toBe(true);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: Skipped Heading Levels
// ---------------------------------------------------------------------------

describe('Feature: Skipped Heading Levels', () => {
  // =========================================================================
  // Scenario: H3 directly after H1 with no intervening H2
  // =========================================================================

  describe('@SCN-SKIP-H1-H3: Heading depth skips from H1 to H3', () => {
    it('emits an error diagnostic when H3 appears directly after H1', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 3, text: '3.1#1.1 - Subsection' }],
      );

      expect(
        result.diagnostics.length,
        '@SCN-SKIP-H1-H3: expected at least one diagnostic',
      ).toBeGreaterThanOrEqual(1);

      const hasErrorDiagnostic: boolean = result.diagnostics.some(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        hasErrorDiagnostic,
        '@SCN-SKIP-H1-H3: expected an error-severity diagnostic indicating skipped heading depth',
      ).toBe(true);
    });
  });

  // =========================================================================
  // Scenario: H4 directly after H2 with no intervening H3
  // =========================================================================

  describe('@SCN-SKIP-H2-H4: Heading depth skips from H2 to H4', () => {
    it('emits an error diagnostic when H4 appears directly after H2', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section' },
          { depth: 4, text: '3.1#1.1.1 - Deep Jump' },
        ],
      );

      expect(
        result.diagnostics.length,
        '@SCN-SKIP-H2-H4: expected at least one diagnostic',
      ).toBeGreaterThanOrEqual(1);

      const hasErrorDiagnostic: boolean = result.diagnostics.some(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        hasErrorDiagnostic,
        '@SCN-SKIP-H2-H4: expected an error-severity diagnostic indicating skipped heading depth',
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Heading Separator Validation
// ---------------------------------------------------------------------------

describe('Feature: Heading Separator Validation', () => {
  // =========================================================================
  // Scenario: Any dash variant is accepted as a sub-heading separator
  // =========================================================================

  describe('@SCN-SEP-VARIANTS: Sub-heading separator may be any dash variant', () => {
    it.each([
      { text: '3.1#1 – Section Title', description: 'en dash (U+2013)' },
      { text: '3.1#1 — Section Title', description: 'em dash (U+2014)' },
      { text: '3.1#1-Section Title', description: 'hyphen without surrounding spaces' },
      { text: '3.1#1  -  Section Title', description: 'hyphen with extra spaces' },
    ])('produces no error diagnostic for $description', ({ text }) => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text }],
      );

      const errorDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        errorDiagnostics.length,
        `@SCN-SEP-VARIANTS: expected "${text}" to be accepted; identity is carried by the number, not the separator`,
      ).toBe(0);
    });

    it('still extracts the SectionID when a non-hyphen separator is used', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '3.1#1 – Section Title' }],
      );

      const sectionIds: readonly string[] = result.sections.map(
        (section) => { return section.id as string; },
      );

      expect(
        sectionIds,
        '@SCN-SEP-VARIANTS: expected the en-dash heading to yield SectionID 3.1#1',
      ).toContain('3.1#1');
    });
  });

  // =========================================================================
  // Scenario: Valid hyphen-minus separator accepted
  // =========================================================================

  describe('@SCN-SEP-VALID: Sub-heading uses correct hyphen-minus separator', () => {
    it('produces no separator-related diagnostic for valid hyphen-minus separator', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '3.1#1 - Section Title' }],
      );

      // No error diagnostics should be present
      const errorDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic) => { return diagnostic.severity === 'error'; },
      );

      expect(
        errorDiagnostics.length,
        '@SCN-SEP-VALID: expected no error diagnostics for valid separator',
      ).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Section Node Extraction with Parent Derivation
// ---------------------------------------------------------------------------

describe('Feature: Section Node Extraction with Parent Derivation', () => {
  // =========================================================================
  // Scenario: H1 root node has no parentId
  // =========================================================================

  describe('@SCN-PARENT-ROOT: H1 node is extracted as root with no parentId', () => {
    it('extracts root section node with DocID as id and no parentId', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [],
      );

      const rootSection: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1',
      );

      expect(
        rootSection,
        '@SCN-PARENT-ROOT: expected a section node with id "3.1"',
      ).toBeDefined();

      expect(
        rootSection!.headingDepth,
        '@SCN-PARENT-ROOT: expected headingDepth to be 1',
      ).toBe(1);

      expect(
        rootSection!.parentId,
        '@SCN-PARENT-ROOT: expected no parentId for root section node',
      ).toBeUndefined();
    });
  });

  // =========================================================================
  // Scenario: H2 parent is the H1 DocID
  // =========================================================================

  describe('@SCN-PARENT-H2: H2 section has H1 DocID as parent', () => {
    it('extracts H2 section node with parentId equal to DocID', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '3.1#1 - First Section' }],
      );

      const h2Section: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#1',
      );

      expect(
        h2Section,
        '@SCN-PARENT-H2: expected a section node with id "3.1#1"',
      ).toBeDefined();

      expect(
        h2Section!.headingDepth,
        '@SCN-PARENT-H2: expected headingDepth to be 2',
      ).toBe(2);

      expect(
        h2Section!.parentId,
        '@SCN-PARENT-H2: expected parentId to be "3.1"',
      ).toBe('3.1');
    });
  });

  // =========================================================================
  // Scenario: H3 parent is the nearest preceding H2
  // =========================================================================

  describe('@SCN-PARENT-H3: H3 section parent is nearest preceding H2', () => {
    it('extracts H3 section node with parentId equal to the preceding H2 SectionID', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section A' },
          { depth: 3, text: '3.1#1.1 - Subsection A1' },
        ],
      );

      const h3Section: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#1.1',
      );

      expect(
        h3Section,
        '@SCN-PARENT-H3: expected a section node with id "3.1#1.1"',
      ).toBeDefined();

      expect(
        h3Section!.parentId,
        '@SCN-PARENT-H3: expected parentId to be "3.1#1"',
      ).toBe('3.1#1');
    });
  });

  // =========================================================================
  // Scenario: Second H2 parent reverts to H1
  // =========================================================================

  describe('@SCN-PARENT-REVERT: Second H2 section parent is the H1 DocID', () => {
    it('extracts second H2 section node with parentId equal to DocID', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section A' },
          { depth: 3, text: '3.1#1.1 - Subsection A1' },
          { depth: 2, text: '3.1#2 - Section B' },
        ],
      );

      const secondH2Section: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#2',
      );

      expect(
        secondH2Section,
        '@SCN-PARENT-REVERT: expected a section node with id "3.1#2"',
      ).toBeDefined();

      expect(
        secondH2Section!.parentId,
        '@SCN-PARENT-REVERT: expected parentId to be "3.1" (the DocID)',
      ).toBe('3.1');
    });
  });

  // =========================================================================
  // Scenario: Depth decrease resets heading stack correctly
  // =========================================================================

  describe('@SCN-PARENT-STACK-RESET: Returning to a shallower depth after deep nesting', () => {
    it('correctly derives parentIds after depth decrease', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section A' },
          { depth: 3, text: '3.1#1.1 - Sub A1' },
          { depth: 4, text: '3.1#1.1.1 - Deep' },
          { depth: 2, text: '3.1#2 - Section B' },
          { depth: 3, text: '3.1#2.1 - Sub B1' },
        ],
      );

      const sectionB: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#2',
      );

      expect(
        sectionB,
        '@SCN-PARENT-STACK-RESET: expected a section node with id "3.1#2"',
      ).toBeDefined();

      expect(
        sectionB!.parentId,
        '@SCN-PARENT-STACK-RESET: expected "3.1#2" parentId to be "3.1"',
      ).toBe('3.1');

      const subB1: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#2.1',
      );

      expect(
        subB1,
        '@SCN-PARENT-STACK-RESET: expected a section node with id "3.1#2.1"',
      ).toBeDefined();

      expect(
        subB1!.parentId,
        '@SCN-PARENT-STACK-RESET: expected "3.1#2.1" parentId to be "3.1#2"',
      ).toBe('3.1#2');
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Duplicate SectionID Detection
// ---------------------------------------------------------------------------

describe('Feature: Duplicate SectionID Detection', () => {
  // =========================================================================
  // Scenario: Duplicate SectionID within same document
  // =========================================================================

  describe('@SCN-DUP-DETECTED: Two headings share the same SectionID', () => {
    it('emits an error diagnostic for duplicate SectionID', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section A' },
          { depth: 2, text: '3.1#1 - Section B' },
        ],
      );

      expect(
        result.diagnostics.length,
        '@SCN-DUP-DETECTED: expected at least one diagnostic for duplicate SectionID',
      ).toBeGreaterThanOrEqual(1);

      const hasDuplicateError: boolean = result.diagnostics.some(
        (diagnostic) => {
          return diagnostic.severity === 'error' &&
            diagnostic.message.toLowerCase().includes('duplicate');
        },
      );

      expect(
        hasDuplicateError,
        '@SCN-DUP-DETECTED: expected an error diagnostic indicating SectionID "3.1#1" is duplicated',
      ).toBe(true);
    });
  });

  // =========================================================================
  // Scenario: Distinct SectionIDs are accepted
  // =========================================================================

  describe('@SCN-DUP-DISTINCT: All SectionIDs are unique', () => {
    it('produces no duplicate SectionID diagnostic when all IDs are unique', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [
          { depth: 2, text: '3.1#1 - Section A' },
          { depth: 2, text: '3.1#2 - Section B' },
        ],
      );

      const duplicateDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic) => {
          return diagnostic.severity === 'error' &&
            diagnostic.message.toLowerCase().includes('duplicate');
        },
      );

      expect(
        duplicateDiagnostics.length,
        '@SCN-DUP-DISTINCT: expected no duplicate SectionID diagnostics',
      ).toBe(0);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Error Severity Classification
// ---------------------------------------------------------------------------

describe('Feature: Error Severity Classification', () => {
  // =========================================================================
  // Scenario: All section hierarchy violations produce error severity
  // =========================================================================

  describe('@SCN-SEVERITY: Section structure violation severity is always error', () => {
    it('emits diagnostics with severity "error" for section violations', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '4.2#1 - Wrong Prefix' }],
      );

      expect(
        result.diagnostics.length,
        '@SCN-SEVERITY: expected at least one diagnostic for wrong prefix',
      ).toBeGreaterThanOrEqual(1);

      for (const diagnostic of result.diagnostics) {
        expect(
          diagnostic.severity,
          '@SCN-SEVERITY: expected every section hierarchy diagnostic to have severity "error"',
        ).toBe('error');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Multi-digit and Deep DocID Support
// ---------------------------------------------------------------------------

describe('Feature: Multi-digit and Deep DocID Support', () => {
  // =========================================================================
  // Scenario Outline: Multi-digit DocIDs handled correctly (5 rows)
  // =========================================================================

  describe('Scenario Outline: Multi-digit DocID segment counts are correct', () => {
    it.each([
      {
        docId: '7.12',
        depth: 2,
        headingText: '7.12#1 - Section',
        expectedId: '7.12#1',
        tag: '@SCN-MULTI-01',
      },
      {
        docId: '7.12',
        depth: 3,
        headingText: '7.12#1.3 - Subsection',
        expectedId: '7.12#1.3',
        tag: '@SCN-MULTI-02',
      },
      {
        docId: '10.200',
        depth: 2,
        headingText: '10.200#1 - Large Numbers',
        expectedId: '10.200#1',
        tag: '@SCN-MULTI-03',
      },
      {
        docId: '2.4.3',
        depth: 2,
        headingText: '2.4.3#1 - Three-segment Doc',
        expectedId: '2.4.3#1',
        tag: '@SCN-MULTI-04',
      },
      {
        docId: '2.4.3',
        depth: 3,
        headingText: '2.4.3#1.5 - Deep',
        expectedId: '2.4.3#1.5',
        tag: '@SCN-MULTI-05',
      },
    ])(
      '$tag: no diagnostic for "$headingText" (docId=$docId, depth=$depth)',
      ({ docId, depth, headingText, expectedId, tag }) => {
        const subHeadings: HeadingNodeData[] = buildIntermediateHeadings(docId, depth, headingText);

        const result: SectionHierarchyRuleResult = evaluateDocument(
          docId,
          `${docId} - Title`,
          subHeadings,
        );

        // No error diagnostics for this specific section
        const errorsForSection: readonly Diagnostic[] = result.diagnostics.filter(
          (diagnostic) => {
            return diagnostic.severity === 'error' &&
              diagnostic.message.includes(expectedId);
          },
        );

        expect(
          errorsForSection.length,
          `${tag}: expected no error diagnostic for heading "${headingText}"`,
        ).toBe(0);

        const matchingSection: SectionNode | undefined = findSectionById(
          result.sections,
          expectedId,
        );

        expect(
          matchingSection,
          `${tag}: expected a section node with id "${expectedId}"`,
        ).toBeDefined();
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: Title Extraction from Section Headings
// ---------------------------------------------------------------------------

describe('Feature: Title Extraction from Section Headings', () => {
  // =========================================================================
  // Scenario: Section title is extracted from heading text
  // =========================================================================

  describe('@SCN-TITLE-EXTRACT: Section node title is extracted correctly', () => {
    it('extracts the title portion after the separator', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '3.1#1 - Mode-Aware Prompt Strategy' }],
      );

      const section: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#1',
      );

      expect(
        section,
        '@SCN-TITLE-EXTRACT: expected a section node with id "3.1#1"',
      ).toBeDefined();

      expect(
        section!.title,
        '@SCN-TITLE-EXTRACT: expected title to be "Mode-Aware Prompt Strategy"',
      ).toBe('Mode-Aware Prompt Strategy');
    });
  });

  // =========================================================================
  // Scenario: Title with multiple hyphen-minus separators
  // =========================================================================

  describe('@SCN-TITLE-HYPHENS: Section title containing hyphens is extracted correctly', () => {
    it('extracts full title including internal hyphens', () => {
      const result: SectionHierarchyRuleResult = evaluateDocument(
        '3.1',
        '3.1 - Title',
        [{ depth: 2, text: '3.1#1 - Prompts & Guardrails - Expert Mode' }],
      );

      const section: SectionNode | undefined = findSectionById(
        result.sections,
        '3.1#1',
      );

      expect(
        section,
        '@SCN-TITLE-HYPHENS: expected a section node with id "3.1#1"',
      ).toBeDefined();

      expect(
        section!.title,
        '@SCN-TITLE-HYPHENS: expected title to be "Prompts & Guardrails - Expert Mode"',
      ).toBe('Prompts & Guardrails - Expert Mode');
    });
  });
});

// ---------------------------------------------------------------------------
// Rule Identifier Constant and Diagnostic Metadata
// ---------------------------------------------------------------------------

describe('Rule Identifier and Diagnostic Metadata', () => {
  // =========================================================================
  // Rule ID constant
  // =========================================================================

  it('exports SECTION_HIERARCHY_RULE_ID as "ECR102"', () => {
    expect(
      SECTION_HIERARCHY_RULE_ID,
      'Expected SECTION_HIERARCHY_RULE_ID to be "ECR102"',
    ).toBe('ECR102');
  });

  it('diagnostics reference the rule identifier ECR102', () => {
    const result: SectionHierarchyRuleResult = evaluateDocument(
      '3.1',
      '3.1 - Title',
      [{ depth: 2, text: 'Introduction' }],
    );

    expect(
      result.diagnostics.length,
      'Expected at least one diagnostic for invalid heading',
    ).toBeGreaterThanOrEqual(1);

    for (const diagnostic of result.diagnostics) {
      expect(
        diagnostic.ruleId,
        'Expected diagnostic ruleId to match SECTION_HIERARCHY_RULE_ID',
      ).toBe(SECTION_HIERARCHY_RULE_ID);
    }
  });

  it('diagnostics carry the document URI provided at construction', () => {
    const documentUri = 'file:///my-document.md';
    const rule: SectionHierarchyRule = new SectionHierarchyRule({
      uri: documentUri,
      docId: '3.1',
      grammar,
    });

    rule.registerRootHeading({ depth: 1, text: '3.1 - Title' });
    rule.evaluateHeading({ depth: 2, text: 'Introduction' });

    const result: SectionHierarchyRuleResult = rule.finalise();

    expect(
      result.diagnostics.length,
      'Expected at least one diagnostic for invalid heading',
    ).toBeGreaterThanOrEqual(1);

    for (const diagnostic of result.diagnostics) {
      expect(
        diagnostic.uri,
        'Expected diagnostic uri to match the document URI provided at construction',
      ).toBe(documentUri);
    }
  });
});

// ---------------------------------------------------------------------------
// Helper: Build intermediate headings to avoid skipped-level errors
// ---------------------------------------------------------------------------

/**
 * Builds valid intermediate HeadingNodeData entries from depth 2 up to
 * (and optionally including) the target depth, ensuring no heading levels
 * are skipped.
 *
 * When `targetHeadingText` is provided, it replaces the heading at the
 * target depth. When `undefined`, intermediate headings are built only
 * up to the target depth (exclusive of the target depth itself).
 *
 * @param docId - The document's DocID
 * @param targetDepth - The target heading depth
 * @param targetHeadingText - The heading text for the target depth, or undefined to omit
 * @returns Array of HeadingNodeData from depth 2 to targetDepth
 */
function buildIntermediateHeadings(
  docId: string,
  targetDepth: number,
  targetHeadingText: string | undefined,
): HeadingNodeData[] {
  const headings: HeadingNodeData[] = [];

  // A heading at depth d carries a section path of exactly
  // d - 1 segments, independent of the DocID's own depth. Intermediate
  // headings therefore run "<docId>#1", "<docId>#1.1", and so on.
  for (let depth = 2; depth < targetDepth; depth++) {
    const sectionPath: string = new Array(depth - 1).fill('1').join('.');
    headings.push({ depth, text: `${docId}#${sectionPath} - Intermediate Section` });
  }

  if (targetHeadingText !== undefined) {
    headings.push({ depth: targetDepth, text: targetHeadingText });
  }

  return headings;
}

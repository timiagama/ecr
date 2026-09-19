/**
 * Black-box test suite for DocumentIdentityRule
 *
 * Scenarios SCN-001 through SCN-018, exercised through the public DocumentIdentityRule class.
 */

import { describe, it, expect } from 'vitest';
import { DocumentIdentityRule, DOCUMENT_IDENTITY_RULE_ID } from '../src/document-identity-rule.js';
import { IdentifierGrammar } from '../src/identifier-grammar.js';
import type { HeadingNodeData, DocumentIdentityRuleResult } from '../src/document-identity-rule.js';

// ---------------------------------------------------------------------------
// Shared instance — stateless class, safe to share across tests
// ---------------------------------------------------------------------------

const grammar: IdentifierGrammar = new IdentifierGrammar();

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Constructs a DocumentIdentityRule, feeds it the given headings,
 * and returns the finalised result.
 */
function evaluateHeadings(headings: readonly HeadingNodeData[]): DocumentIdentityRuleResult {
  const rule: DocumentIdentityRule = new DocumentIdentityRule({
    uri: 'file:///test-document.md',
    grammar,
  });

  for (const heading of headings) {
    rule.evaluateHeading(heading);
  }

  return rule.finalise();
}

// ---------------------------------------------------------------------------
// Feature: Document Identity Rule [ECR101]
// ---------------------------------------------------------------------------

describe('Feature: Document Identity Rule [ECR101]', () => {
  // =========================================================================
  // SUCCESS PATHS
  // =========================================================================

  describe('Success Paths', () => {
    // @SCN-001 — Valid document identity with well-formed H1
    describe('@SCN-001 — Valid document identity with well-formed H1', () => {
      it.each([
        {
          headingText: '3.1 - Scenario Authoring',
          expectedDocId: '3.1',
          expectedTitle: 'Scenario Authoring',
        },
        {
          headingText: '1 - Overview',
          expectedDocId: '1',
          expectedTitle: 'Overview',
        },
        {
          headingText: '7.12 - Extended Analytics',
          expectedDocId: '7.12',
          expectedTitle: 'Extended Analytics',
        },
        {
          headingText: '2.4.3 - Deeply Nested Identity',
          expectedDocId: '2.4.3',
          expectedTitle: 'Deeply Nested Identity',
        },
        {
          headingText: '5.1 - Synthetic Data - Evaluation Strategy',
          expectedDocId: '5.1',
          expectedTitle: 'Synthetic Data - Evaluation Strategy',
        },
        {
          headingText: '0.1 - ECR - Structural Specification',
          expectedDocId: '0.1',
          expectedTitle: 'ECR - Structural Specification',
        },
      ])(
        'emits no error diagnostics and extracts DocID "$expectedDocId" from "$headingText"',
        ({ headingText, expectedDocId, expectedTitle }) => {
          const result: DocumentIdentityRuleResult = evaluateHeadings([
            { depth: 1, text: headingText },
          ]);

          expect(
            result.diagnostics.length,
            `SCN-001: expected zero error diagnostics for heading "${headingText}"`,
          ).toBe(0);

          expect(
            result.identity,
            `SCN-001: expected identity to be present for heading "${headingText}"`,
          ).toBeDefined();

          expect(
            result.identity!.docId as string,
            `SCN-001: expected extracted DocID to be "${expectedDocId}"`,
          ).toBe(expectedDocId);

          expect(
            result.identity!.title,
            `SCN-001: expected extracted title to be "${expectedTitle}"`,
          ).toBe(expectedTitle);
        },
      );
    });

    // @SCN-002 — Valid identity with additional non-H1 headings present
    describe('@SCN-002 — Valid identity with additional non-H1 headings present', () => {
      it('extracts DocID when non-H1 headings are also present', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1 - Title' },
          { depth: 2, text: '3.1#1 - Section One' },
          { depth: 3, text: '3.1#1.1 - Sub Section' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-002: expected zero error diagnostics',
        ).toBe(0);

        expect(
          result.identity,
          'SCN-002: expected identity to be present',
        ).toBeDefined();

        expect(
          result.identity!.docId as string,
          'SCN-002: expected extracted DocID to be "3.1"',
        ).toBe('3.1');
      });
    });
  });

  // =========================================================================
  // FAILURE PATHS — MISSING H1
  // =========================================================================

  describe('Failure Paths — Missing H1', () => {
    // @SCN-003 — No headings at all in the document
    describe('@SCN-003 — No headings at all in the document', () => {
      it('emits an error diagnostic and extracts no DocID when no headings exist', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([]);

        expect(
          result.diagnostics.length,
          'SCN-003: expected at least one diagnostic when no headings exist',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-003: expected an error-severity diagnostic indicating no valid document identity',
        ).toBe(true);

        expect(
          result.identity,
          'SCN-003: expected no identity to be extracted',
        ).toBeUndefined();
      });
    });

    // @SCN-004 — Headings exist but none at depth 1
    describe('@SCN-004 — Headings exist but none at depth 1', () => {
      it('emits an error diagnostic and extracts no DocID when only non-H1 headings exist', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 2, text: '3.1#1 - Sub Heading' },
          { depth: 3, text: '3.1#1.1 - Deep Heading' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-004: expected at least one diagnostic when no depth-1 headings exist',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-004: expected an error-severity diagnostic indicating no valid document identity',
        ).toBe(true);

        expect(
          result.identity,
          'SCN-004: expected no identity to be extracted',
        ).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // FAILURE PATHS — MULTIPLE H1 HEADINGS
  // =========================================================================

  describe('Failure Paths — Multiple H1 Headings', () => {
    // @SCN-005 — Multiple depth-1 headings that both match the identity pattern
    describe('@SCN-005 — Multiple depth-1 headings that both match the identity pattern', () => {
      it('emits an error diagnostic when two valid H1 headings are present', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1 - First Title' },
          { depth: 1, text: '3.2 - Second Title' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-005: expected at least one diagnostic for multiple depth-1 headings',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-005: expected an error-severity diagnostic indicating multiple depth-1 headings',
        ).toBe(true);
      });
    });

    // @SCN-006 — Multiple depth-1 headings where only one matches the pattern
    describe('@SCN-006 — Multiple depth-1 headings where only one matches the pattern', () => {
      it('emits an error diagnostic when two H1 headings exist even if only one matches', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1 - Valid Title' },
          { depth: 1, text: 'Introduction' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-006: expected at least one diagnostic for multiple depth-1 headings',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-006: expected an error-severity diagnostic indicating multiple depth-1 headings',
        ).toBe(true);
      });
    });
  });

  // =========================================================================
  // SUCCESS PATHS — DASH VARIANTS
  // =========================================================================

  describe('Success Paths — Dash Variants', () => {
    // @SCN-007 — Depth-1 heading separator may be any dash variant
    describe('@SCN-007 — Depth-1 heading separator may be any dash variant', () => {
      it.each([
        { headingText: '3.1 - Ingestion', description: 'hyphen-minus (U+002D)' },
        { headingText: '3.1 – Ingestion', description: 'en dash (U+2013)' },
        { headingText: '3.1 — Ingestion', description: 'em dash (U+2014)' },
        { headingText: '3.1-Ingestion', description: 'hyphen without surrounding spaces' },
      ])(
        'extracts the identity when separator is $description',
        ({ headingText }) => {
          const result: DocumentIdentityRuleResult = evaluateHeadings([
            { depth: 1, text: headingText },
          ]);

          const errorDiagnostics = result.diagnostics.filter(
            (diagnostic) => { return diagnostic.severity === 'error'; },
          );
          expect(
            errorDiagnostics.length,
            `SCN-007: expected "${headingText}" to be accepted; identity is carried by the number, not the separator`,
          ).toBe(0);

          expect(
            result.identity,
            `SCN-007: expected an identity to be extracted from "${headingText}"`,
          ).toBeDefined();
          expect(
            result.identity?.docId as string,
            'SCN-007: expected DocID "3.1"',
          ).toBe('3.1');
        },
      );
    });
  });

  // =========================================================================
  // FAILURE PATHS — INVALID DocID FORMAT
  // =========================================================================

  describe('Failure Paths — Invalid DocID Format', () => {
    // @SCN-008 — Depth-1 heading has text that does not start with a valid DocID
    describe('@SCN-008 — Depth-1 heading has text that does not start with a valid DocID', () => {
      it.each([
        { headingText: 'Introduction', description: 'no DocID at all' },
        { headingText: 'A.1 - Alphabetic Prefix', description: 'alphabetic prefix' },
        { headingText: '.1 - Leading Dot', description: 'leading dot' },
        { headingText: '3. - Trailing Dot', description: 'trailing dot' },
        { headingText: '3.1. - Trailing Dot With Segment', description: 'trailing dot with segment' },
      ])(
        'emits an error diagnostic for "$headingText" ($description)',
        ({ headingText }) => {
          const result: DocumentIdentityRuleResult = evaluateHeadings([
            { depth: 1, text: headingText },
          ]);

          expect(
            result.diagnostics.length,
            `SCN-008: expected at least one diagnostic for invalid heading "${headingText}"`,
          ).toBeGreaterThanOrEqual(1);

          const hasErrorDiagnostic: boolean = result.diagnostics.some(
            (diagnostic) => { return diagnostic.severity === 'error'; },
          );
          expect(
            hasErrorDiagnostic,
            `SCN-008: expected an error-severity diagnostic for invalid DocID format`,
          ).toBe(true);

          expect(
            result.identity,
            `SCN-008: expected no valid identity to be extracted`,
          ).toBeUndefined();
        },
      );
    });
  });

  // =========================================================================
  // FAILURE PATHS — EMPTY OR MISSING TITLE
  // =========================================================================

  describe('Failure Paths — Empty or Missing Title', () => {
    // @SCN-009 — Depth-1 heading has a valid DocID and separator but empty title
    describe('@SCN-009 — Depth-1 heading has a valid DocID and separator but empty title', () => {
      it('emits an error diagnostic for heading with empty title', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1 - ' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-009: expected at least one diagnostic for empty title',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-009: expected an error-severity diagnostic for empty title',
        ).toBe(true);

        expect(
          result.identity,
          'SCN-009: expected no valid identity to be extracted',
        ).toBeUndefined();
      });
    });

    // @SCN-010 — Depth-1 heading has a valid DocID but no separator at all
    describe('@SCN-010 — Depth-1 heading has a valid DocID but no separator', () => {
      it('emits an error diagnostic for heading with no separator', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-010: expected at least one diagnostic for missing separator',
        ).toBeGreaterThanOrEqual(1);

        const hasErrorDiagnostic: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          hasErrorDiagnostic,
          'SCN-010: expected an error-severity diagnostic for invalid identity',
        ).toBe(true);

        expect(
          result.identity,
          'SCN-010: expected no valid identity to be extracted',
        ).toBeUndefined();
      });
    });
  });

  // =========================================================================
  // SUCCESS PATHS — SEPARATOR SPACING
  // =========================================================================

  describe('Success Paths — Separator Spacing', () => {
    // @SCN-011 — Separator spacing is not part of structural identity
    describe('@SCN-011 — Separator spacing is not part of structural identity', () => {
      it.each([
        { text: '3.1 -Title Without Leading Space' },
        { text: '3.1- Title Without Trailing Space' },
        { text: '3.1  -  Title With Extra Spaces' },
      ])('extracts the identity from "$text"', ({ text }) => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text },
        ]);

        const errorDiagnostics = result.diagnostics.filter(
          (diagnostic) => { return diagnostic.severity === 'error'; },
        );
        expect(
          errorDiagnostics.length,
          `SCN-011: expected "${text}" to be accepted`,
        ).toBe(0);

        expect(
          result.identity?.docId as string,
          `SCN-011: expected DocID "3.1" from "${text}"`,
        ).toBe('3.1');
      });
    });
  });

  // =========================================================================
  // EDGE CASES — DocID GRAMMAR BOUNDARIES
  // =========================================================================

  describe('Edge Cases — DocID Grammar Boundaries', () => {
    // @SCN-013 — Single-segment DocID (just a number)
    describe('@SCN-013 — Single-segment DocID (just a number)', () => {
      it('extracts DocID "42" from heading "42 - Standalone Document"', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '42 - Standalone Document' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-013: expected zero error diagnostics',
        ).toBe(0);

        expect(
          result.identity,
          'SCN-013: expected identity to be present',
        ).toBeDefined();

        expect(
          result.identity!.docId as string,
          'SCN-013: expected extracted DocID to be "42"',
        ).toBe('42');
      });
    });

    // @SCN-014 — DocID with many segments
    describe('@SCN-014 — DocID with many segments', () => {
      it('extracts DocID "1.2.3.4.5" from heading "1.2.3.4.5 - Deep Hierarchy"', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '1.2.3.4.5 - Deep Hierarchy' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-014: expected zero error diagnostics',
        ).toBe(0);

        expect(
          result.identity,
          'SCN-014: expected identity to be present',
        ).toBeDefined();

        expect(
          result.identity!.docId as string,
          'SCN-014: expected extracted DocID to be "1.2.3.4.5"',
        ).toBe('1.2.3.4.5');
      });
    });

    // @SCN-015 — DocID segments containing multi-digit numbers
    describe('@SCN-015 — DocID segments containing multi-digit numbers', () => {
      it('extracts DocID "10.200" from heading "10.200 - Large Segments"', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '10.200 - Large Segments' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-015: expected zero error diagnostics',
        ).toBe(0);

        expect(
          result.identity,
          'SCN-015: expected identity to be present',
        ).toBeDefined();

        expect(
          result.identity!.docId as string,
          'SCN-015: expected extracted DocID to be "10.200"',
        ).toBe('10.200');
      });
    });
  });

  // =========================================================================
  // DIAGNOSTIC METADATA
  // =========================================================================

  describe('Diagnostic Metadata', () => {
    // @SCN-016 — Error diagnostics include position information when available
    describe('@SCN-016 — Error diagnostics include position information when available', () => {
      it('includes position range in diagnostic when heading has position data', () => {
        const headingRange = {
          start: { line: 0, character: 0 },
          end: { line: 0, character: 20 },
        };

        const rule: DocumentIdentityRule = new DocumentIdentityRule({
          uri: 'file:///positioned-doc.md',
          grammar,
        });

        rule.evaluateHeading({
          depth: 1,
          text: 'Introduction',
          range: headingRange,
        });

        const result: DocumentIdentityRuleResult = rule.finalise();

        expect(
          result.diagnostics.length,
          'SCN-016: expected at least one diagnostic for invalid heading',
        ).toBeGreaterThanOrEqual(1);

        const diagnosticWithRange: boolean = result.diagnostics.some(
          (diagnostic) => { return diagnostic.range !== undefined; },
        );
        expect(
          diagnosticWithRange,
          'SCN-016: expected at least one diagnostic to include position range',
        ).toBe(true);
      });
    });

    // @SCN-017 — Error diagnostic severity is always "error" for identity violations
    describe('@SCN-017 — Error diagnostic severity is always "error" for identity violations', () => {
      it.each([
        {
          description: 'no headings at all',
          headings: [] as readonly HeadingNodeData[],
        },
        {
          description: 'no depth-1 heading',
          headings: [{ depth: 2, text: '3.1#1 - Sub Heading' }] as readonly HeadingNodeData[],
        },
        {
          description: 'multiple depth-1 headings',
          headings: [
            { depth: 1, text: '3.1 - First' },
            { depth: 1, text: '3.2 - Second' },
          ] as readonly HeadingNodeData[],
        },
        {
          description: 'no separator at all',
          headings: [{ depth: 1, text: '3.1 Title Without Separator' }] as readonly HeadingNodeData[],
        },
        {
          description: 'invalid DocID format',
          headings: [{ depth: 1, text: 'A.1 - Alphabetic Prefix' }] as readonly HeadingNodeData[],
        },
        {
          description: 'empty title',
          headings: [{ depth: 1, text: '3.1 - ' }] as readonly HeadingNodeData[],
        },
      ])(
        'all diagnostics have severity "error" for violation: $description',
        ({ headings }) => {
          const result: DocumentIdentityRuleResult = evaluateHeadings(headings);

          expect(
            result.diagnostics.length,
            'SCN-017: expected at least one diagnostic for identity violation',
          ).toBeGreaterThanOrEqual(1);

          for (const diagnostic of result.diagnostics) {
            expect(
              diagnostic.severity,
              `SCN-017: expected every identity-rule diagnostic to have severity "error"`,
            ).toBe('error');
          }
        },
      );
    });
  });

  // =========================================================================
  // TITLE EXTRACTION — HYPHEN IN TITLE
  // =========================================================================

  describe('Title Extraction — Hyphen in Title', () => {
    // @SCN-018 — Title containing hyphens is extracted correctly
    describe('@SCN-018 — Title containing hyphens is extracted correctly', () => {
      it('extracts full title "First Part - Second Part - Third Part" from heading with embedded hyphens', () => {
        const result: DocumentIdentityRuleResult = evaluateHeadings([
          { depth: 1, text: '3.1 - First Part - Second Part - Third Part' },
        ]);

        expect(
          result.diagnostics.length,
          'SCN-018: expected zero error diagnostics',
        ).toBe(0);

        expect(
          result.identity,
          'SCN-018: expected identity to be present',
        ).toBeDefined();

        expect(
          result.identity!.docId as string,
          'SCN-018: expected extracted DocID to be "3.1"',
        ).toBe('3.1');

        expect(
          result.identity!.title,
          'SCN-018: expected extracted title to include all hyphenated parts',
        ).toBe('First Part - Second Part - Third Part');
      });
    });
  });

  // =========================================================================
  // RULE IDENTIFIER CONSTANT
  // =========================================================================

  describe('Rule Identifier Constant', () => {
    it('exports DOCUMENT_IDENTITY_RULE_ID as "ECR101"', () => {
      expect(
        DOCUMENT_IDENTITY_RULE_ID,
        'Expected DOCUMENT_IDENTITY_RULE_ID to be "ECR101"',
      ).toBe('ECR101');
    });

    it('diagnostics reference the rule identifier', () => {
      const result: DocumentIdentityRuleResult = evaluateHeadings([]);

      expect(
        result.diagnostics.length,
        'Expected at least one diagnostic for empty document',
      ).toBeGreaterThanOrEqual(1);

      for (const diagnostic of result.diagnostics) {
        expect(
          diagnostic.ruleId,
          'Expected diagnostic ruleId to match DOCUMENT_IDENTITY_RULE_ID',
        ).toBe(DOCUMENT_IDENTITY_RULE_ID);
      }
    });
  });

  // =========================================================================
  // URI PROPAGATION
  // =========================================================================

  describe('URI Propagation', () => {
    it('diagnostics carry the document URI provided at construction', () => {
      const documentUri = 'file:///my-document.md';
      const rule: DocumentIdentityRule = new DocumentIdentityRule({
        uri: documentUri,
        grammar,
      });

      const result: DocumentIdentityRuleResult = rule.finalise();

      expect(
        result.diagnostics.length,
        'Expected at least one diagnostic for empty document',
      ).toBeGreaterThanOrEqual(1);

      for (const diagnostic of result.diagnostics) {
        expect(
          diagnostic.uri,
          'Expected diagnostic uri to match the document URI provided at construction',
        ).toBe(documentUri);
      }
    });
  });
});

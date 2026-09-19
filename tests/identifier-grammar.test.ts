/**
 * Black-box test suite for IdentifierGrammar
 *
 * Scenarios SCN-001 through SCN-019, exercised through the public IdentifierGrammar class.
 */

import { describe, it, expect } from 'vitest';
import { IdentifierGrammar } from '../src/identifier-grammar.js';
import type { DocID, SectionID } from '../src/types.js';
import type {
  DocIdParseResult,
  SectionIdParseResult,
  HeadingParseResult,
  SeparatorValidationResult,
} from '../src/identifier-grammar.js';

// ---------------------------------------------------------------------------
// Shared instance — stateless class, safe to share across tests
// ---------------------------------------------------------------------------

const grammar: IdentifierGrammar = new IdentifierGrammar();

// ---------------------------------------------------------------------------
// Feature: DocID Parsing
// ---------------------------------------------------------------------------

describe('Feature: DocID Parsing', () => {
  // @SCN-001 — Valid DocID strings are accepted
  describe('@SCN-001 — Valid DocID strings are accepted', () => {
    it.each([
      { input: '1' },
      { input: '3.1' },
      { input: '7.12' },
      { input: '2.4.3' },
      { input: '0' },
      { input: '10.20' },
      { input: '0.0.0' },
    ])('parseDocId("$input") succeeds', ({ input }) => {
      const result: DocIdParseResult = grammar.parseDocId(input);
      expect(result.valid, `SCN-001: expected "${input}" to be a valid DocID`).toBe(true);
    });

    it.each([
      { input: '1' },
      { input: '3.1' },
      { input: '7.12' },
      { input: '2.4.3' },
      { input: '0' },
      { input: '10.20' },
      { input: '0.0.0' },
    ])('parseDocId("$input") result represents the identifier "$input"', ({ input }) => {
      const result: DocIdParseResult = grammar.parseDocId(input);
      expect(result.valid, `SCN-001: precondition — "${input}" must be valid`).toBe(true);
      if (result.valid) {
        expect(
          result.docId as string,
          `SCN-001: expected result to represent identifier "${input}"`,
        ).toBe(input);
      }
    });
  });

  // @SCN-002 — Invalid DocID strings are rejected
  describe('@SCN-002 — Invalid DocID strings are rejected', () => {
    it.each([
      { input: '', reason: 'empty string' },
      { input: '.1', reason: 'leading dot' },
      { input: '1.', reason: 'trailing dot' },
      { input: '1..2', reason: 'consecutive dots' },
      { input: 'abc', reason: 'non-numeric' },
      { input: '1.a', reason: 'non-numeric segment' },
      { input: '1. 2', reason: 'space within identifier' },
      { input: '-1', reason: 'negative sign' },
      { input: '1.2.3 x', reason: 'trailing non-numeric characters' },
      { input: ' 3.1', reason: 'leading whitespace' },
      { input: '3.1 ', reason: 'trailing whitespace' },
    ])('parseDocId("$input") fails — $reason', ({ input }) => {
      const result: DocIdParseResult = grammar.parseDocId(input);
      expect(result.valid, `SCN-002: expected "${input}" to be an invalid DocID`).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: SectionID Parsing
// ---------------------------------------------------------------------------

describe('Feature: SectionID Parsing', () => {
  // @SCN-003 — Valid SectionID strings are accepted
  describe('@SCN-003 — Valid SectionID strings are accepted', () => {
    it.each([
      { input: '3.1#1' },
      { input: '3.1#1.1' },
      { input: '1#2' },
      { input: '7.12#3' },
      { input: '2.4.3#1' },
      { input: '0.0#1' },
      { input: '0.0.1#1' },
      { input: '10.20#30.40' },
    ])('parseSectionId("$input") succeeds', ({ input }) => {
      const result: SectionIdParseResult = grammar.parseSectionId(input);
      expect(result.valid, `SCN-003: expected "${input}" to be a valid SectionID`).toBe(true);
    });

    it.each([
      { input: '3.1#1' },
      { input: '3.1#1.1' },
      { input: '1#2' },
      { input: '7.12#3' },
      { input: '2.4.3#1' },
      { input: '0.0#1' },
      { input: '0.0.1#1' },
      { input: '10.20#30.40' },
    ])('parseSectionId("$input") result represents the identifier "$input"', ({ input }) => {
      const result: SectionIdParseResult = grammar.parseSectionId(input);
      expect(result.valid, `SCN-003: precondition — "${input}" must be valid`).toBe(true);
      if (result.valid) {
        expect(
          result.sectionId as string,
          `SCN-003: expected result to represent identifier "${input}"`,
        ).toBe(input);
      }
    });
  });

  // @SCN-004 — Invalid SectionID strings are rejected
  describe('@SCN-004 — Invalid SectionID strings are rejected', () => {
    it.each([
      { input: '', reason: 'empty string' },
      { input: '1', reason: 'a bare DocID is not a SectionID' },
      { input: '3.1', reason: 'a dotted DocID is not a SectionID' },
      { input: '3.1.1', reason: 'dotted form: the separator is mandatory' },
      { input: '3.1#', reason: 'separator with no section path' },
      { input: '#1', reason: 'separator with no DocID' },
      { input: '3.1#1#2', reason: 'more than one separator' },
      { input: '.1#2', reason: 'leading dot' },
      { input: '1.2#', reason: 'trailing separator' },
      { input: '1#2.', reason: 'trailing dot in section path' },
      { input: 'abc#1', reason: 'non-numeric DocID' },
      { input: '1#abc', reason: 'non-numeric section path' },
    ])('parseSectionId("$input") fails — $reason', ({ input }) => {
      const result: SectionIdParseResult = grammar.parseSectionId(input);
      expect(result.valid, `SCN-004: expected "${input}" to be an invalid SectionID`).toBe(false);
    });
  });

  // @SCN-004a — A parsed SectionID exposes its DocID and section path
  describe('@SCN-004a — A parsed SectionID exposes its DocID and section path', () => {
    it.each([
      { input: '3.1#1', docId: '3.1', sectionPath: '1' },
      { input: '3.1#1.1', docId: '3.1', sectionPath: '1.1' },
      { input: '0.0#2.1', docId: '0.0', sectionPath: '2.1' },
      { input: '0.0.2#1', docId: '0.0.2', sectionPath: '1' },
      { input: '8.10#1', docId: '8.10', sectionPath: '1' },
    ])('parseSectionId("$input") splits into "$docId" and "$sectionPath"', (
      { input, docId, sectionPath },
    ) => {
      const result: SectionIdParseResult = grammar.parseSectionId(input);
      expect(result.valid, `SCN-004a: precondition — "${input}" must be valid`).toBe(true);
      if (result.valid) {
        expect(result.docId as string, `SCN-004a: DocID of "${input}"`).toBe(docId);
        expect(result.sectionPath, `SCN-004a: section path of "${input}"`).toBe(sectionPath);
      }
    });

    it('distinguishes section 1 of 0.0.2 from section 2.1 of 0.0', () => {
      const nested: SectionIdParseResult = grammar.parseSectionId('0.0.2#1');
      const parent: SectionIdParseResult = grammar.parseSectionId('0.0#2.1');

      expect(nested.valid && parent.valid, 'both identifiers must parse').toBe(true);
      if (nested.valid && parent.valid) {
        expect(
          nested.sectionId as string,
          'SCN-004a: the two identifiers must not collide',
        ).not.toBe(parent.sectionId as string);
        expect(nested.docId as string).toBe('0.0.2');
        expect(parent.docId as string).toBe('0.0');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: SectionID Extends DocID Validation
// ---------------------------------------------------------------------------

describe('Feature: SectionID Extends DocID Validation', () => {
  // @SCN-005 — SectionID that correctly extends a DocID is accepted
  describe('@SCN-005 — SectionID that correctly extends a DocID is accepted', () => {
    it.each([
      { docId: '3.1', sectionId: '3.1#1' },
      { docId: '3.1', sectionId: '3.1#2' },
      { docId: '3.1', sectionId: '3.1#1.1' },
      { docId: '1', sectionId: '1#1' },
      { docId: '1', sectionId: '1#1.1' },
      { docId: '2.4.3', sectionId: '2.4.3#1' },
      { docId: '2.4.3', sectionId: '2.4.3#1.2' },
      { docId: '0.0', sectionId: '0.0#2.1' },
      { docId: '0.0.2', sectionId: '0.0.2#1' },
    ])(
      'tellSectionIdExtendsDocId("$sectionId", "$docId") returns true',
      ({ docId, sectionId }) => {
        const extendsDocId: boolean = grammar.tellSectionIdExtendsDocId(
          sectionId as SectionID,
          docId as DocID,
        );
        expect(
          extendsDocId,
          `SCN-005: expected SectionID "${sectionId}" to extend DocID "${docId}"`,
        ).toBe(true);
      },
    );
  });

  // @SCN-006 — SectionID that does not extend the DocID is rejected
  describe('@SCN-006 — SectionID that does not extend the DocID is rejected', () => {
    it.each([
      { docId: '3.1', sectionId: '4.1#1', reason: 'different first segment' },
      { docId: '3.1', sectionId: '3.2#1', reason: 'second segment does not match DocID' },
      { docId: '3.1', sectionId: '3.1', reason: 'a bare DocID is not a SectionID' },
      { docId: '3.1', sectionId: '3.1.1#1', reason: 'section of the nested document 3.1.1' },
      { docId: '3.1.1', sectionId: '3.1#1', reason: 'section of the parent document 3.1' },
      { docId: '8.1', sectionId: '8.10#1', reason: 'numeric neighbour, not a prefix match' },
      { docId: '8.1', sectionId: '8.1.3#1', reason: 'section of the nested document 8.1.3' },
      { docId: '1', sectionId: '2#1', reason: 'different DocID' },
      { docId: '2.4.3', sectionId: '2.4.1#1', reason: 'third segment does not match DocID' },
      { docId: '0.0', sectionId: '0.0.2#1', reason: 'the dotted-only collision: section 1 of 0.0.2' },
    ])(
      'tellSectionIdExtendsDocId("$sectionId", "$docId") returns false — $reason',
      ({ docId, sectionId }) => {
        const extendsDocId: boolean = grammar.tellSectionIdExtendsDocId(
          sectionId as SectionID,
          docId as DocID,
        );
        expect(
          extendsDocId,
          `SCN-006: expected SectionID "${sectionId}" NOT to extend DocID "${docId}"`,
        ).toBe(false);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: Segment Counting
// ---------------------------------------------------------------------------

describe('Feature: Segment Counting', () => {
  // @SCN-007 — Segment count is correctly determined
  describe('@SCN-007 — Segment count is correctly determined', () => {
    it.each([
      { identifier: '1', count: 1 },
      { identifier: '3.1', count: 2 },
      { identifier: '2.4.3', count: 3 },
      { identifier: '3.1.1.1', count: 4 },
      { identifier: '10.20.30.40', count: 4 },
    ])(
      'showSegmentCount("$identifier") returns $count',
      ({ identifier, count }) => {
        const segmentCount: number = grammar.showSegmentCount(identifier);
        expect(
          segmentCount,
          `SCN-007: expected segment count of "${identifier}" to be ${count}`,
        ).toBe(count);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: Depth-to-Segment Correspondence
// ---------------------------------------------------------------------------

describe('Feature: Depth-to-Segment Correspondence', () => {
  // @SCN-008 — Section-path length corresponds to heading depth
  describe('@SCN-008 — Section-path length corresponds to heading depth', () => {
    it.each([
      { depth: 2, sectionId: '3.1#1', pathLength: 1 },
      { depth: 3, sectionId: '3.1#1.2', pathLength: 2 },
      { depth: 2, sectionId: '1#1', pathLength: 1 },
      { depth: 3, sectionId: '1#1.1', pathLength: 2 },
      { depth: 2, sectionId: '2.4.3#1', pathLength: 1 },
      { depth: 4, sectionId: '2.4.3#1.1.1', pathLength: 3 },
      { depth: 2, sectionId: '0.0.2#1', pathLength: 1 },
    ])(
      'depth $depth requires a $pathLength-segment path — "$sectionId" matches',
      ({ depth, sectionId, pathLength }) => {
        expect(
          grammar.showExpectedSectionPathLength(depth),
          `SCN-008: depth ${depth} must require ${pathLength} section-path segment(s)`,
        ).toBe(pathLength);
        expect(
          grammar.showSectionPathLength(sectionId as SectionID),
          `SCN-008: "${sectionId}" must have ${pathLength} section-path segment(s)`,
        ).toBe(pathLength);
      },
    );

    it('is independent of DocID depth', () => {
      // A dotted-only grammar needs k + (d - 1), so a deeper DocID changes
      // the expected count. With the separator, the section path stands alone.
      const shallow: number = grammar.showSectionPathLength('1#1' as SectionID);
      const deep: number = grammar.showSectionPathLength('2.4.3.9#1' as SectionID);

      expect(shallow, 'SCN-008: DocID depth must not affect section-path length').toBe(deep);
      expect(shallow).toBe(grammar.showExpectedSectionPathLength(2));
    });
  });

  // @SCN-009 — Section-path length that disagrees with depth is detectable
  describe('@SCN-009 — Section-path length that disagrees with depth is detectable', () => {
    it.each([
      { depth: 2, sectionId: '3.1#1.1', pathLength: 2, reason: 'too deep for an H2' },
      { depth: 3, sectionId: '3.1#1', pathLength: 1, reason: 'too shallow for an H3' },
      { depth: 2, sectionId: '1#1.1.1', pathLength: 3, reason: 'far too deep for an H2' },
      { depth: 4, sectionId: '2.4.3#1.1', pathLength: 2, reason: 'too shallow for an H4' },
    ])(
      'depth $depth vs "$sectionId" — $reason',
      ({ depth, sectionId, pathLength }) => {
        expect(
          grammar.showSectionPathLength(sectionId as SectionID),
          `SCN-009: "${sectionId}" has ${pathLength} section-path segment(s)`,
        ).toBe(pathLength);
        expect(
          grammar.showExpectedSectionPathLength(depth),
          `SCN-009: depth ${depth} must not expect ${pathLength}`,
        ).not.toBe(pathLength);
      },
    );
  });
});

// ---------------------------------------------------------------------------
// Feature: Separator Validation
// ---------------------------------------------------------------------------

describe('Feature: Separator Validation', () => {
  // @SCN-010 — Hyphen-minus separator is accepted
  describe('@SCN-010 — Hyphen-minus separator is accepted', () => {
    it('validateSeparator with " - " (U+002D) returns valid', () => {
      const heading = '3.1 - Some Title';
      const result: SeparatorValidationResult = grammar.validateSeparator(heading);
      expect(result.valid, 'SCN-010: expected hyphen-minus separator to be valid').toBe(true);
    });
  });

  // @SCN-011 — Non-standard dash separators are accepted
  describe('@SCN-011 — Non-standard dash separators are accepted', () => {
    it.each([
      { separator: '\u2013', description: 'en dash (U+2013)' },
      { separator: '\u2014', description: 'em dash (U+2014)' },
    ])('validateSeparator with "$description" returns valid', ({ separator }) => {
      const heading = `3.1 ${separator} Some Title`;
      const result: SeparatorValidationResult = grammar.validateSeparator(heading);
      expect(
        result.valid,
        `SCN-011: expected "${separator}" separator to be accepted`,
      ).toBe(true);
    });
  });

  // @SCN-012 — Flexibly spaced separators are accepted
  describe('@SCN-012 — Flexibly spaced separators are accepted', () => {
    it.each([
      { heading: '3.1 -Title', reason: 'missing trailing space' },
      { heading: '3.1- Title', reason: 'missing leading space' },
      { heading: '3.1-Title', reason: 'no spaces around hyphen' },
    ])('validateSeparator("$heading") returns valid — $reason', ({ heading }) => {
      const result: SeparatorValidationResult = grammar.validateSeparator(heading);
      expect(
        result.valid,
        `SCN-012: expected flexibly spaced separator in "${heading}" to be accepted`,
      ).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: H1 Heading Pattern — DocID and Title Extraction
// ---------------------------------------------------------------------------

describe('Feature: H1 Heading Pattern — DocID and Title Extraction', () => {
  // @SCN-013 — Valid H1 heading strings yield a DocID and title
  describe('@SCN-013 — Valid H1 heading strings yield a DocID and title', () => {
    it.each([
      {
        heading: '3.1 - Scenario Authoring - Prompts & Guardrails',
        docId: '3.1',
        title: 'Scenario Authoring - Prompts & Guardrails',
      },
      {
        heading: '1 - Introduction',
        docId: '1',
        title: 'Introduction',
      },
      {
        heading: '7.12 - Advanced Topics',
        docId: '7.12',
        title: 'Advanced Topics',
      },
      {
        heading: '5.1 - Synthetic Data - Evaluation Strategy',
        docId: '5.1',
        title: 'Synthetic Data - Evaluation Strategy',
      },
      {
        heading: '0.1 - ECR - Structural Specification',
        docId: '0.1',
        title: 'ECR - Structural Specification',
      },
    ])(
      'parseHeading("$heading") yields DocID "$docId" and title "$title"',
      ({ heading, docId, title }) => {
        const result: HeadingParseResult = grammar.parseHeading(heading);
        expect(result.valid, `SCN-013: expected heading "${heading}" to parse successfully`).toBe(
          true,
        );
        if (result.valid) {
          expect(
            result.docId as string,
            `SCN-013: expected extracted DocID to be "${docId}"`,
          ).toBe(docId);
          expect(
            result.title,
            `SCN-013: expected extracted title to be "${title}"`,
          ).toBe(title);
        }
      },
    );
  });

  // @SCN-014 — Title containing additional hyphen-minus separators is extracted correctly
  describe('@SCN-014 — Title containing additional separators is extracted correctly', () => {
    it('parseHeading("3.1 - Scenario Authoring - Prompts & Guardrails") extracts title with embedded separators', () => {
      const heading = '3.1 - Scenario Authoring - Prompts & Guardrails';
      const result: HeadingParseResult = grammar.parseHeading(heading);
      expect(
        result.valid,
        'SCN-014: expected heading with multiple separators to parse successfully',
      ).toBe(true);
      if (result.valid) {
        expect(
          result.docId as string,
          'SCN-014: expected extracted DocID to be "3.1"',
        ).toBe('3.1');
        expect(
          result.title,
          'SCN-014: expected title to include all text after first separator',
        ).toBe('Scenario Authoring - Prompts & Guardrails');
      }
    });
  });

  // @SCN-015 — Invalid H1 heading strings are rejected
  describe('@SCN-015 — Invalid H1 heading strings are rejected', () => {
    it.each([
      { heading: '', reason: 'empty string' },
      { heading: 'Just a title', reason: 'no DocID prefix' },
      { heading: '3.1', reason: 'no separator and no title' },
      { heading: '3.1 -', reason: 'no title after separator' },
      { heading: '3.1 -  ', reason: 'title is empty/whitespace only' },
      { heading: 'abc - Some Title', reason: 'non-numeric DocID' },
    ])('parseHeading("$heading") fails — $reason', ({ heading }) => {
      const result: HeadingParseResult = grammar.parseHeading(heading);
      expect(
        result.valid,
        `SCN-015: expected heading "${heading}" to fail parsing`,
      ).toBe(false);
    });
  });

  // @SCN-016 — H1 heading separators may use any dash variant
  describe('@SCN-016 — H1 heading separators may use any dash variant', () => {
    it.each([
      { separator: '-', description: 'hyphen-minus (U+002D)' },
      { separator: '–', description: 'en dash (U+2013)' },
      { separator: '—', description: 'em dash (U+2014)' },
    ])('parseHeading with $description extracts DocID and title', ({ separator }) => {
      const heading = `3.1 ${separator} Ingestion`;
      const result: HeadingParseResult = grammar.parseHeading(heading);
      expect(
        result.valid,
        `SCN-016: expected heading with "${separator}" separator to parse`,
      ).toBe(true);
      if (result.valid) {
        expect(result.docId as string, 'SCN-016: expected DocID "3.1"').toBe('3.1');
        expect(result.title, 'SCN-016: expected title "Ingestion"').toBe('Ingestion');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Distinguishing DocID from SectionID
// ---------------------------------------------------------------------------

describe('Feature: Distinguishing DocID from SectionID', () => {
  // @SCN-017 — An identifier string is evaluated against both grammars
  describe('@SCN-017 — An identifier is a DocID or a SectionID, never both', () => {
    it.each([
      { input: '1' },
      { input: '3.1' },
      { input: '3.1.1' },
      { input: '3.1.1.1' },
      { input: '0.0.2' },
    ])('"$input" is a DocID and not a SectionID', ({ input }) => {
      expect(
        grammar.parseDocId(input).valid,
        `SCN-017: expected "${input}" to be a valid DocID`,
      ).toBe(true);
      expect(
        grammar.parseSectionId(input).valid,
        `SCN-017: "${input}" carries no separator, so it is not a SectionID`,
      ).toBe(false);
    });

    it.each([
      { input: '3#1' },
      { input: '3.1#1' },
      { input: '3.1#1.1' },
      { input: '0.0.2#1' },
    ])('"$input" is a SectionID and not a DocID', ({ input }) => {
      expect(
        grammar.parseSectionId(input).valid,
        `SCN-017: expected "${input}" to be a valid SectionID`,
      ).toBe(true);
      expect(
        grammar.parseDocId(input).valid,
        `SCN-017: "${input}" carries a separator, so it is not a DocID`,
      ).toBe(false);
    });

    it('resolves an identifier without consulting a corpus index', () => {
      // A dotted-only grammar cannot answer this: '0.0.2' is either document
      // 0.0.2 or section 2 of document 0.0, and only the corpus can say.
      expect(grammar.parseDocId('0.0.2').valid).toBe(true);
      expect(grammar.parseSectionId('0.0.2').valid).toBe(false);

      const section = grammar.parseSectionId('0.0#2');
      expect(section.valid).toBe(true);
      if (section.valid) {
        expect(section.docId as string).toBe('0.0');
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Identifier String Round-Trip Integrity
// ---------------------------------------------------------------------------

describe('Feature: Identifier String Round-Trip Integrity', () => {
  // @SCN-018 — Parsed identifiers produce identical string representations
  describe('@SCN-018 — Parsed identifiers produce identical string representations', () => {
    it.each([
      { input: '1' },
      { input: '3.1' },
      { input: '3.1.1' },
      { input: '2.4.3' },
      { input: '10.20.30.40' },
    ])('parseDocId("$input").docId round-trips to "$input"', ({ input }) => {
      const result: DocIdParseResult = grammar.parseDocId(input);
      expect(result.valid, `SCN-018: precondition — "${input}" must be a valid DocID`).toBe(true);
      if (result.valid) {
        const roundTripped: string = result.docId as string;
        expect(
          roundTripped,
          `SCN-018: expected round-trip of "${input}" to produce identical string`,
        ).toBe(input);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Heading Depth 1 is Reserved for DocID
// ---------------------------------------------------------------------------

describe('Feature: Heading Depth 1 is Reserved for DocID', () => {
  // @SCN-019 — Depth 1 heading carries the DocID, not a SectionID
  describe('@SCN-019 — Depth 1 heading carries the DocID, not a SectionID', () => {
    it('depth 1 requires a section path of zero segments', () => {
      expect(
        grammar.showExpectedSectionPathLength(1),
        'SCN-019: an H1 carries a DocID, so it has no section path',
      ).toBe(0);
    });

    it('a DocID does not parse as a SectionID at any depth', () => {
      for (const docId of ['1', '3.1', '0.0.2', '8.10']) {
        expect(
          grammar.parseSectionId(docId).valid,
          `SCN-019: "${docId}" is a DocID and must not parse as a SectionID`,
        ).toBe(false);
        expect(
          grammar.parseDocId(docId).valid,
          `SCN-019: "${docId}" must parse as a DocID`,
        ).toBe(true);
      }
    });
  });
});

// ---------------------------------------------------------------------------
// Feature: Sub-heading Parsing
// ---------------------------------------------------------------------------

describe('Feature: Sub-heading Parsing', () => {
  // @SCN-020 — A sub-heading carries a SectionID and a title
  describe('@SCN-020 — A sub-heading carries a SectionID and a title', () => {
    it.each([
      { heading: '8.1#3 - Retry Semantics', sectionId: '8.1#3', title: 'Retry Semantics' },
      { heading: '8.1#3.1 - Backoff', sectionId: '8.1#3.1', title: 'Backoff' },
      { heading: '0.0.2#1 - Purpose', sectionId: '0.0.2#1', title: 'Purpose' },
      { heading: '0.0#2.1 - Mental Model', sectionId: '0.0#2.1', title: 'Mental Model' },
      { heading: '8.10#1 - Entry Conditions', sectionId: '8.10#1', title: 'Entry Conditions' },
    ])('parses "$heading"', ({ heading, sectionId, title }) => {
      const result = grammar.parseSectionHeading(heading);
      expect(result.valid, `SCN-020: expected "${heading}" to parse`).toBe(true);
      if (result.valid) {
        expect(result.sectionId as string, 'SCN-020: SectionID').toBe(sectionId);
        expect(result.title, 'SCN-020: title').toBe(title);
      }
    });

    it.each([
      { separator: '-', description: 'hyphen-minus' },
      { separator: '–', description: 'en dash' },
      { separator: '—', description: 'em dash' },
    ])('accepts a $description separator', ({ separator }) => {
      const result = grammar.parseSectionHeading(`8.1#3 ${separator} Retry Semantics`);
      expect(result.valid, `SCN-020: expected "${separator}" to be accepted`).toBe(true);
      if (result.valid) {
        expect(result.sectionId as string).toBe('8.1#3');
      }
    });

    it('keeps a title that itself contains a dash intact', () => {
      const result = grammar.parseSectionHeading('4.2#1 - Multi-Tenant Key Derivation');
      expect(result.valid).toBe(true);
      if (result.valid) {
        expect(result.sectionId as string).toBe('4.2#1');
        expect(result.title, 'only the first dash separates identifier from title')
          .toBe('Multi-Tenant Key Derivation');
      }
    });
  });

  // @SCN-021 — Headings that do not carry a SectionID are rejected
  describe('@SCN-021 — Headings that do not carry a SectionID are rejected', () => {
    it.each([
      { heading: '8.1 - Orchestration', reason: 'a DocID heading belongs to an H1' },
      { heading: '8.1.3 - Retry Policy', reason: 'dotted form: the separator is mandatory' },
      { heading: 'References', reason: 'no identifier at all' },
      { heading: '8.1#3', reason: 'no separator or title' },
      { heading: '8.1#3 - ', reason: 'empty title' },
      { heading: '#3 - Orphan', reason: 'no DocID before the separator' },
    ])('rejects "$heading" — $reason', ({ heading }) => {
      expect(
        grammar.parseSectionHeading(heading).valid,
        `SCN-021: expected "${heading}" to be rejected`,
      ).toBe(false);
    });
  });
});

/**
 * Tests for ReferencesSectionRule (ECR103)
 *
 * Covers all 25 scenarios across 11 features:
 *   - References Section Presence (4 scenarios)
 *   - List Node Must Immediately Follow (3 scenarios)
 *   - References Entry Format Validation (4 scenarios)
 *   - Invalid Direction Values (1 scenario, 6 examples)
 *   - Non-Empty Title and Explanation (2 scenarios)
 *   - Separator Enforcement (1 scenario, 4 examples)
 *   - Invalid TargetDocID (1 scenario, 5 examples)
 *   - Malformed Entry Structure (3 scenarios)
 *   - No Duplicate TargetDocID Entries (2 scenarios)
 *   - ReferenceEdge Extraction (3 scenarios)
 *   - Empty References Section (1 scenario)
 */

import { describe, it, expect } from 'vitest';
import {
  ReferencesSectionRule,
  IdentifierGrammar,
  REFERENCES_SECTION_RULE_ID,
} from '../src/index.js';
import type {
  Diagnostic,
  ReferenceEdge,
  ReferenceDirection,
} from '../src/index.js';
import { REFERENCES_EMPTY_CAUSE } from '../src/references-section-rule.js';
import type {
  ReferencesSectionRuleResult,
} from '../src/references-section-rule.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates a ReferencesSectionRule instance with sensible defaults for testing.
 *
 * @param docId - The document's established DocID (defaults to "5.1")
 * @returns A new ReferencesSectionRule instance
 */
function createRule(docId: string = '5.1'): ReferencesSectionRule {
  const grammar: IdentifierGrammar = new IdentifierGrammar();
  return new ReferencesSectionRule({
    uri: 'file:///test.md',
    docId,
    grammar,
  });
}

/**
 * Runs a complete rule lifecycle for a single References section with the
 * given list item texts.
 *
 * Steps:
 * 1. Evaluates a `## References` heading
 * 2. Evaluates each list item text
 * 3. Finalises and returns the result
 *
 * @param listItemTexts - Array of plain text strings for each list item
 * @param docId - The document's established DocID (defaults to "5.1")
 * @returns The finalised rule result
 */
function evaluateWithEntries(
  listItemTexts: ReadonlyArray<string>,
  docId: string = '5.1',
): ReferencesSectionRuleResult {
  const rule: ReferencesSectionRule = createRule(docId);
  rule.evaluateHeading({ depth: 2, text: 'References' });
  for (const text of listItemTexts) {
    rule.evaluateListItem({ text });
  }
  return rule.finalise();
}

// ===========================================================================
// Feature: References Section Presence
// ===========================================================================

describe('Feature: References Section Presence', () => {
  it('Scenario: Document contains exactly one valid References section', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    rule.evaluateListItem({
      text: '3.1 - Some Title (authority - some explanation)',
    });
    const result: ReferencesSectionRuleResult = rule.finalise();

    // No diagnostic should be produced for References section presence
    const presenceDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('missing') &&
          diagnostic.message.toLowerCase().includes('references')
        );
      },
    );
    expect(presenceDiagnostics).toHaveLength(0);

    const duplicateDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('duplicate') &&
          diagnostic.message.toLowerCase().includes('references section')
        );
      },
    );
    expect(duplicateDiagnostics).toHaveLength(0);
  });

  it('Scenario: Document has no References section', () => {
    const rule: ReferencesSectionRule = createRule();
    // No heading evaluated at all — or only non-References headings
    rule.evaluateHeading({ depth: 2, text: 'Introduction' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    // An error diagnostic must indicate the References section is missing
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    const missingDiagnostic: Diagnostic | undefined = result.diagnostics.find(
      (diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('references');
      },
    );
    expect(missingDiagnostic).toBeDefined();
    expect(missingDiagnostic!.severity).toBe('error');
    expect(missingDiagnostic!.ruleId).toBe(REFERENCES_SECTION_RULE_ID);
  });

  it('Scenario: Document has multiple References sections', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    rule.evaluateListItem({
      text: '3.1 - Some Title (authority - some explanation)',
    });
    rule.evaluateHeading({ depth: 2, text: 'References' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    // An error diagnostic must indicate duplicate References sections
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
    const duplicateDiagnostic: Diagnostic | undefined = result.diagnostics.find(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('duplicate') ||
          diagnostic.message.toLowerCase().includes('multiple')
        );
      },
    );
    expect(duplicateDiagnostic).toBeDefined();
    expect(duplicateDiagnostic!.severity).toBe('error');
    expect(duplicateDiagnostic!.ruleId).toBe(REFERENCES_SECTION_RULE_ID);
  });

  describe('Scenario: References heading at wrong depth is not recognised', () => {
    const wrongDepths: ReadonlyArray<number> = [1, 3, 4];

    for (const depth of wrongDepths) {
      it(`depth ${depth} heading named "References" does not count as the References section`, () => {
        const rule: ReferencesSectionRule = createRule();
        // Only a References heading at the wrong depth, no depth-2 heading
        rule.evaluateHeading({ depth, text: 'References' });
        const result: ReferencesSectionRuleResult = rule.finalise();

        // Should produce a "missing References section" error
        expect(result.diagnostics.length).toBeGreaterThanOrEqual(1);
        const missingDiagnostic: Diagnostic | undefined = result.diagnostics.find(
          (diagnostic: Diagnostic) => {
            return diagnostic.message.toLowerCase().includes('references');
          },
        );
        expect(missingDiagnostic).toBeDefined();
        expect(missingDiagnostic!.severity).toBe('error');
      });
    }
  });
});

// ===========================================================================
// Feature: List Node Must Immediately Follow the References Heading
// ===========================================================================

describe('Feature: List Node Must Immediately Follow the References Heading', () => {
  it('Scenario: A list node immediately follows the References heading', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    // Providing list items signals that a list node follows the heading
    rule.evaluateListItem({
      text: '3.1 - Some Title (authority - some explanation)',
    });
    const result: ReferencesSectionRuleResult = rule.finalise();

    // No diagnostic for "missing list after References heading"
    const missingListDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('list') &&
          diagnostic.message.toLowerCase().includes('follow')
        );
      },
    );
    expect(missingListDiagnostics).toHaveLength(0);
  });

  // A section with no list is valid and reported as info (1#9.6, 1#12.3).
  // These two scenarios expected an error until the rule itself set the
  // severity; the facade used to downgrade it by matching the message text.

  it('Scenario: A non-list node immediately follows the References heading (no list items evaluated)', () => {
    // When a paragraph (or other non-list) node follows the References heading,
    // no evaluateListItem calls are made.
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    expect(result.diagnostics).toHaveLength(1);
    const emptyDiagnostic: Diagnostic = result.diagnostics[0]!;
    expect(emptyDiagnostic.severity).toBe('info');
    expect(emptyDiagnostic.ruleId).toBe(REFERENCES_SECTION_RULE_ID);
    expect(emptyDiagnostic.data?.['cause']).toBe(REFERENCES_EMPTY_CAUSE);
    expect(result.references).toHaveLength(0);
  });

  it('Scenario: The References heading is the last node in the document (no node follows)', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'Introduction' });
    rule.evaluateHeading({ depth: 2, text: 'References' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('info');
    expect(result.diagnostics[0]!.data?.['cause']).toBe(REFERENCES_EMPTY_CAUSE);
  });

  it('Scenario: Every entry is malformed, so the section is not empty', () => {
    // Entries that fail validation were still declared; reporting the section
    // as empty would describe the wrong problem.
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      'completely broken text',
      '3.1 - Title (sideways - not a direction)',
    ]);

    expect(result.diagnostics.length).toBeGreaterThanOrEqual(2);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.data?.['cause']).not.toBe(REFERENCES_EMPTY_CAUSE);
    }
  });

  it('Scenario: Duplicate entries only, so the section is not empty', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Title (authority - one)',
      '3.1 - Title (authority - two)',
    ]);

    const emptyDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => diagnostic.data?.['cause'] === REFERENCES_EMPTY_CAUSE,
    );
    expect(emptyDiagnostics).toHaveLength(0);
  });

  it('Scenario: Multiple References headings with no entries report the duplicate, not emptiness', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    rule.evaluateHeading({ depth: 2, text: 'References' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('error');
    expect(result.diagnostics[0]!.message).toContain('multiple References sections');
  });
});

// ===========================================================================
// Feature: References Entry Format Validation
// ===========================================================================

describe('Feature: References Entry Format Validation', () => {
  describe('Scenario: Valid References entry with each direction value', () => {
    interface DirectionExample {
      readonly targetDocId: string;
      readonly title: string;
      readonly direction: ReferenceDirection;
      readonly explanation: string;
    }

    const examples: ReadonlyArray<DirectionExample> = [
      {
        targetDocId: '3.1',
        title: 'Scenario Authoring - Prompts & Guardrails',
        direction: 'authority',
        explanation: 'defines guardrail logic enforced by this document',
      },
      {
        targetDocId: '8.1',
        title: 'Mastra Orchestration Contract',
        direction: 'constraint',
        explanation: 'defines retry semantics applied to this workflow',
      },
      {
        targetDocId: '2.4',
        title: 'Data Pipeline Architecture',
        direction: 'dependency',
        explanation: 'provides data transformation contracts',
      },
      {
        targetDocId: '6.0',
        title: 'API Gateway Contract',
        direction: 'contract',
        explanation: 'defines structural obligations for request routing',
      },
    ];

    for (const example of examples) {
      it(`extracts ReferenceEdge with direction "${example.direction}"`, () => {
        const entryText = `${example.targetDocId} - ${example.title} (${example.direction} - ${example.explanation})`;
        const result: ReferencesSectionRuleResult = evaluateWithEntries([entryText]);

        // No format-related diagnostics for the entry
        const formatDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
          (diagnostic: Diagnostic) => {
            return (
              diagnostic.message.toLowerCase().includes('invalid') ||
              diagnostic.message.toLowerCase().includes('malformed') ||
              diagnostic.message.toLowerCase().includes('empty')
            );
          },
        );
        expect(formatDiagnostics).toHaveLength(0);

        // A ReferenceEdge should be extracted
        expect(result.references).toHaveLength(1);
        const edge: ReferenceEdge = result.references[0]!;
        expect(edge.fromDocId).toBe('5.1');
        expect(edge.toDocId).toBe(example.targetDocId);
        expect(edge.direction).toBe(example.direction);
        expect(edge.title).toBe(example.title);
        expect(edge.explanation).toBe(example.explanation);
      });
    }
  });

  it('Scenario: Valid References entry where TargetDocID has multiple segments', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '2.4.3 - Subsystem Configuration (dependency - configuration schema consumed here)',
    ]);

    const formatDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('malformed')
        );
      },
    );
    expect(formatDiagnostics).toHaveLength(0);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]!.toDocId).toBe('2.4.3');
  });

  it('Scenario: Valid References entry where TargetDocID is a single number', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '7 - Platform Overview (authority - governs platform constraints)',
    ]);

    const formatDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('malformed')
        );
      },
    );
    expect(formatDiagnostics).toHaveLength(0);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]!.toDocId).toBe('7');
  });

  it('Scenario: Title contains hyphens (ambiguous separators resolved correctly)', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Scenario Authoring - Prompts & Guardrails (authority - defines guardrail logic enforced by this document)',
    ]);

    expect(result.references).toHaveLength(1);
    expect(result.references[0]!.title).toBe(
      'Scenario Authoring - Prompts & Guardrails',
    );
  });
});

// ===========================================================================
// Feature: Invalid Direction Values
// ===========================================================================

describe('Feature: Invalid Direction Values', () => {
  const invalidDirections: ReadonlyArray<string> = [
    'reference',
    'depends',
    'auth',
    'AUTHORITY',
    'Authority',
    'governance',
  ];

  for (const invalidDirection of invalidDirections) {
    it(`Scenario: References entry with invalid direction "${invalidDirection}"`, () => {
      const result: ReferencesSectionRuleResult = evaluateWithEntries([
        `3.1 - Some Title (${invalidDirection} - some explanation)`,
      ]);

      // An error diagnostic for invalid direction
      const directionDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic: Diagnostic) => {
          return diagnostic.message.toLowerCase().includes('direction');
        },
      );
      expect(directionDiagnostics.length).toBeGreaterThanOrEqual(1);
      expect(directionDiagnostics[0]!.severity).toBe('error');

      // No ReferenceEdge extracted
      expect(result.references).toHaveLength(0);
    });
  }
});

// ===========================================================================
// Feature: Non-Empty Title and Explanation
// ===========================================================================

describe('Feature: Non-Empty Title and Explanation', () => {
  it('Scenario: References entry with empty title', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 -  (authority - some explanation)',
    ]);

    const titleDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('title');
      },
    );
    expect(titleDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(titleDiagnostics[0]!.severity).toBe('error');
  });

  it('Scenario: References entry with empty explanation', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Some Title (authority - )',
    ]);

    const explanationDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('explanation');
      },
    );
    expect(explanationDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(explanationDiagnostics[0]!.severity).toBe('error');
  });
});

// ===========================================================================
// Feature: Separator Variants Are Accepted
// ===========================================================================

describe('Feature: Separator Variants Are Accepted', () => {
  const separatorExamples: ReadonlyArray<{
    readonly label: string;
    readonly entryText: string;
  }> = [
    {
      label: 'en dash in DocID-Title separator',
      entryText: '3.1 – Some Title (authority - some explanation)',
    },
    {
      label: 'en dash in Direction-Explanation separator',
      entryText: '3.1 - Some Title (authority – some explanation)',
    },
    {
      label: 'em dash in DocID-Title separator',
      entryText: '3.1 — Some Title (authority - some explanation)',
    },
    {
      label: 'em dash in Direction-Explanation separator',
      entryText: '3.1 - Some Title (authority — some explanation)',
    },
    {
      label: 'mixed dash variants within one entry',
      entryText: '3.1 – Some Title (authority — some explanation)',
    },
  ];

  for (const example of separatorExamples) {
    it(`Scenario: ${example.label} is accepted`, () => {
      const result: ReferencesSectionRuleResult = evaluateWithEntries([
        example.entryText,
      ]);

      const errorDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic: Diagnostic) => { return diagnostic.severity === 'error'; },
      );
      expect(
        errorDiagnostics.length,
        `expected "${example.entryText}" to be accepted; the dash variant carries no structural meaning`,
      ).toBe(0);
    });

    it(`Scenario: ${example.label} still yields a reference edge`, () => {
      const result: ReferencesSectionRuleResult = evaluateWithEntries([
        example.entryText,
      ]);

      expect(
        result.references.length,
        `expected "${example.entryText}" to yield one edge`,
      ).toBe(1);
      expect(result.references[0]!.toDocId as string).toBe('3.1');
      expect(result.references[0]!.direction).toBe('authority');
    });
  }
});

// ===========================================================================
// Feature: Invalid TargetDocID
// ===========================================================================

describe('Feature: Invalid TargetDocID', () => {
  const invalidDocIds: ReadonlyArray<string> = [
    'abc',
    '3.',
    '.3',
    '3..1',
    '3.1.',
  ];

  for (const invalidDocId of invalidDocIds) {
    it(`Scenario: References entry with invalid TargetDocID "${invalidDocId}"`, () => {
      const result: ReferencesSectionRuleResult = evaluateWithEntries([
        `${invalidDocId} - Some Title (authority - some explanation)`,
      ]);

      // An error diagnostic for invalid TargetDocID
      const docIdDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
        (diagnostic: Diagnostic) => {
          return (
            diagnostic.message.toLowerCase().includes('docid') ||
            diagnostic.message.toLowerCase().includes('doc id') ||
            diagnostic.message.toLowerCase().includes('identifier') ||
            diagnostic.message.toLowerCase().includes('invalid') ||
            diagnostic.message.toLowerCase().includes('malformed')
          );
        },
      );
      expect(docIdDiagnostics.length).toBeGreaterThanOrEqual(1);
      expect(docIdDiagnostics[0]!.severity).toBe('error');
    });
  }
});

// ===========================================================================
// Feature: Malformed Entry Structure
// ===========================================================================

describe('Feature: Malformed Entry Structure', () => {
  it('Scenario: References entry missing parentheses around direction and explanation', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Some Title authority - some explanation',
    ]);

    const malformedDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('malformed') ||
          diagnostic.message.toLowerCase().includes('format') ||
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('parse')
        );
      },
    );
    expect(malformedDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(malformedDiagnostics[0]!.severity).toBe('error');
  });

  it('Scenario: References entry missing closing parenthesis', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Some Title (authority - some explanation',
    ]);

    const malformedDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('malformed') ||
          diagnostic.message.toLowerCase().includes('format') ||
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('parse') ||
          diagnostic.message.toLowerCase().includes('parenthesis')
        );
      },
    );
    expect(malformedDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(malformedDiagnostics[0]!.severity).toBe('error');
  });

  it('Scenario: References entry that is completely unparseable', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      'This is just free text with no structure',
    ]);

    const malformedDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('malformed') ||
          diagnostic.message.toLowerCase().includes('format') ||
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('parse')
        );
      },
    );
    expect(malformedDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(malformedDiagnostics[0]!.severity).toBe('error');
  });
});

// ===========================================================================
// Feature: No Duplicate TargetDocID Entries
// ===========================================================================

describe('Feature: No Duplicate TargetDocID Entries', () => {
  it('Scenario: References section with unique TargetDocIDs', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Scenario Authoring (authority - defines guardrail criteria)',
      '8.1 - Mastra Orchestration Contract (constraint - retry semantics)',
    ]);

    // No duplicate diagnostics
    const duplicateDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('duplicate');
      },
    );
    expect(duplicateDiagnostics).toHaveLength(0);

    // Both edges extracted
    expect(result.references).toHaveLength(2);
  });

  it('Scenario: References section with duplicate TargetDocID', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - First Title (authority - first explanation)',
      '3.1 - Second Title (dependency - second explanation)',
    ]);

    // An error diagnostic for duplicate TargetDocID
    const duplicateDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return diagnostic.message.toLowerCase().includes('duplicate');
      },
    );
    expect(duplicateDiagnostics.length).toBeGreaterThanOrEqual(1);
    expect(duplicateDiagnostics[0]!.severity).toBe('error');
    // The diagnostic message should mention the duplicate DocID
    expect(duplicateDiagnostics[0]!.message).toContain('3.1');
  });
});

// ===========================================================================
// Feature: ReferenceEdge Extraction
// ===========================================================================

describe('Feature: ReferenceEdge Extraction', () => {
  it('Scenario: Multiple valid References entries produce multiple ReferenceEdges', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Scenario Authoring - Prompts & Guardrails (authority - defines guardrail criteria enforced by evaluation)',
      '8.1 - Mastra Orchestration Contract (constraint - retry semantics applied to evaluation runs)',
    ]);

    expect(result.references).toHaveLength(2);

    // Both edges have fromDocId "5.1"
    for (const edge of result.references) {
      expect(edge.fromDocId).toBe('5.1');
    }

    // First edge
    const firstEdge: ReferenceEdge = result.references[0]!;
    expect(firstEdge.toDocId).toBe('3.1');
    expect(firstEdge.direction).toBe('authority');
    expect(firstEdge.title).toBe('Scenario Authoring - Prompts & Guardrails');
    expect(firstEdge.explanation).toBe(
      'defines guardrail criteria enforced by evaluation',
    );

    // Second edge
    const secondEdge: ReferenceEdge = result.references[1]!;
    expect(secondEdge.toDocId).toBe('8.1');
    expect(secondEdge.direction).toBe('constraint');
    expect(secondEdge.title).toBe('Mastra Orchestration Contract');
    expect(secondEdge.explanation).toBe(
      'retry semantics applied to evaluation runs',
    );
  });

  it('Scenario: Valid entries are extracted even when other entries are invalid (mixed valid/invalid)', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      '3.1 - Scenario Authoring (authority - defines guardrail logic)',
      'This is not a valid entry',
      '8.1 - Mastra Orchestration Contract (constraint - retry semantics applied to evaluation runs)',
    ]);

    // An error diagnostic for the malformed second entry
    const malformedDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('malformed') ||
          diagnostic.message.toLowerCase().includes('format') ||
          diagnostic.message.toLowerCase().includes('invalid') ||
          diagnostic.message.toLowerCase().includes('parse')
        );
      },
    );
    expect(malformedDiagnostics.length).toBeGreaterThanOrEqual(1);

    // 2 ReferenceEdges extracted (entries 1 and 3)
    expect(result.references).toHaveLength(2);
    expect(result.references[0]!.toDocId).toBe('3.1');
    expect(result.references[1]!.toDocId).toBe('8.1');
  });

  it('Scenario: No ReferenceEdges extracted when all entries are invalid', () => {
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      'This is not a valid entry',
      'Neither is this one',
      'And this is also garbage',
    ]);

    // Error diagnostics for each malformed entry
    expect(result.diagnostics.length).toBeGreaterThanOrEqual(3);

    // 0 ReferenceEdges extracted
    expect(result.references).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Empty References Section (List With No Items)
// ===========================================================================

describe('Feature: Empty References Section (List With No Items)', () => {
  it('Scenario: References heading followed by an empty list', () => {
    // An empty list, a non-list node and no node at all all reach the rule
    // as zero evaluateListItem calls, and all declare the same thing: the
    // document references nothing (1#9.6). That is valid, reported as info.
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    const result: ReferencesSectionRuleResult = rule.finalise();

    expect(result.diagnostics.map((diagnostic: Diagnostic) => diagnostic.severity))
      .toEqual(['info']);

    // No "missing References section" diagnostic
    const missingRefDiagnostics: readonly Diagnostic[] = result.diagnostics.filter(
      (diagnostic: Diagnostic) => {
        return (
          diagnostic.message.toLowerCase().includes('missing') &&
          diagnostic.message.toLowerCase().includes('references section')
        );
      },
    );
    expect(missingRefDiagnostics).toHaveLength(0);

    // 0 ReferenceEdges
    expect(result.references).toHaveLength(0);
  });
});

// ===========================================================================
// Cross-cutting: Diagnostic shape and ruleId
// ===========================================================================

describe('Cross-cutting: Diagnostic metadata', () => {
  it('all diagnostics carry the correct ruleId and severity', () => {
    // Use an entry that produces at least one diagnostic (malformed entry)
    const result: ReferencesSectionRuleResult = evaluateWithEntries([
      'completely broken text',
    ]);

    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.ruleId).toBe(REFERENCES_SECTION_RULE_ID);
      expect(diagnostic.severity).toBe('error');
      expect(diagnostic.uri).toBe('file:///test.md');
    }
  });

  it('tellReferencesHeadingDetected returns false before heading evaluation', () => {
    const rule: ReferencesSectionRule = createRule();
    expect(rule.tellReferencesHeadingDetected()).toBe(false);
  });

  it('tellReferencesHeadingDetected returns true after evaluating a ## References heading', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'References' });
    expect(rule.tellReferencesHeadingDetected()).toBe(true);
  });

  it('tellReferencesHeadingDetected returns false after evaluating a non-References heading', () => {
    const rule: ReferencesSectionRule = createRule();
    rule.evaluateHeading({ depth: 2, text: 'Introduction' });
    expect(rule.tellReferencesHeadingDetected()).toBe(false);
  });
});

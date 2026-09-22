/**
 * Tests for InlineReferenceRule (ECR104)
 *
 * Covers all 25 scenarios across 7 features:
 *   - Detection of `see` and `per` keywords (6 scenarios)
 *   - No false positives from non-keyword text (4 scenarios)
 *   - Invalid TargetID (non-numeric, malformed grammar) (3 scenarios)
 *   - Undeclared dependency (3 scenarios)
 *   - Multiple inline references in one text node (3 scenarios)
 *   - Section context tracking (2 scenarios)
 *   - Edge cases -- keyword boundaries and case sensitivity (4 scenarios)
 */

import { describe, it, expect } from 'vitest';
import type { DocID, SectionID } from '../src/types.js';
import { IdentifierGrammar } from '../src/identifier-grammar.js';
import {
  InlineReferenceRule,
  INLINE_REFERENCE_RULE_ID,
} from '../src/inline-reference-rule.js';
import type {
  InlineReferenceRuleResult,
  InlineReferenceRuleOptions,
  TextNodeData,
} from '../src/inline-reference-rule.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Creates an InlineReferenceRule instance with sensible defaults for testing.
 *
 * @param overrides - Optional partial overrides for the rule configuration
 * @returns A new InlineReferenceRule instance
 */
function createRule(overrides?: Partial<InlineReferenceRuleOptions>): InlineReferenceRule {
  const defaults: InlineReferenceRuleOptions = {
    uri: 'file:///test.md',
    docId: '5.1',
    grammar: new IdentifierGrammar(),
    declaredDocIds: new Set<DocID>(['3.1', '8.1']),
    // These scenarios supply text nodes without positional ranges, so the
    // source-form check of 1#9.11 has nothing to locate and is skipped. Cases
    // that exercise source form live in navigation-guarantee.test.ts, where
    // whole documents are parsed and ranges are real.
    sourceText: '',
  };
  return new InlineReferenceRule({ ...defaults, ...overrides });
}

/**
 * Runs a complete rule lifecycle for a single text node evaluation.
 *
 * Steps:
 * 1. Creates a rule with the given overrides
 * 2. Evaluates the text node with the given section context
 * 3. Finalises and returns the result
 *
 * @param text - Plain text content of the text node
 * @param sectionContext - The current heading identifier
 * @param overrides - Optional partial overrides for the rule configuration
 * @returns The finalised rule result
 */
function evaluateText(
  text: string,
  sectionContext: DocID | SectionID,
  overrides?: Partial<InlineReferenceRuleOptions>,
): InlineReferenceRuleResult {
  const rule: InlineReferenceRule = createRule(overrides);
  const textNodeData: TextNodeData = { text };
  rule.evaluateTextNode(textNodeData, sectionContext);
  return rule.finalise();
}

// ===========================================================================
// Feature: Detection of `see` and `per` keywords
// ===========================================================================

/** Tests for detection of `see` and `per` keyword forms followed by valid TargetIDs. */
describe('Feature: Detection of `see` and `per` keywords', () => {
  it('Scenario: Detect `see` keyword followed by a valid DocID', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'For context assembly see 3.7',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['3', '3.7', '8.1']) },
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.7');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Detect `per` keyword followed by a valid SectionID', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'Guardrail requirements are enforced per 3.1#2.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('per');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Detect `see` followed by a valid single-segment DocID', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3',
      '5.1',
      { declaredDocIds: new Set<DocID>(['3', '8.1']) },
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1');
    expect(result.inlineReferences[0]!.toId).toBe('3');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: TargetID terminated by end of string', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'For details see 8.1#3',
      '5.1#2',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#2');
    expect(result.inlineReferences[0]!.toId).toBe('8.1#3');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: TargetID terminated by period (full stop)', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'Retry semantics are applied per 8.1#3.',
      '5.1#2',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#2');
    expect(result.inlineReferences[0]!.toId).toBe('8.1#3');
    expect(result.inlineReferences[0]!.kind).toBe('per');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: TargetID terminated by comma', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2, which defines the guardrails',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: No false positives from non-keyword text
// ===========================================================================

/** Tests that natural language and substrings containing `see`/`per` do not produce false positives. */
describe('Feature: No false positives from non-keyword text', () => {
  it('Scenario: Natural language reference "defined in X" is not detected', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'The guardrail logic is defined in 3.1#2.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Word containing "see" as substring is not detected', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'You must oversee 3.1#2 carefully.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Word containing "per" as substring is not detected', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'The hyperparameter 3.1#2 is tuned.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Text with no inline references produces no output', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'This section describes evaluation strategy.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Invalid TargetID (non-numeric, malformed grammar)
// ===========================================================================

/** Tests for TargetIDs that do not conform to the identifier grammar. */
describe('Feature: Invalid TargetID (non-numeric, malformed grammar)', () => {
  it('Scenario: TargetID with non-numeric characters after keyword', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see Appendix',
      '5.1#1',
    );

    // The pattern simply does not match a valid TargetID, so no inline reference is detected
    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: TargetID with leading zeros is valid per DocID grammar', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 03#1',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['03', '8.1']) },
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('03#1');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: TargetID with trailing dot is not a valid identifier', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1.',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['3', '3.1', '8.1']) },
    );

    // The trailing period is treated as punctuation terminating the TargetID, not as part of it
    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Undeclared dependency (parent DocID not in References section)
// ===========================================================================

/** Tests that inline references to undeclared DocIDs produce diagnostics: an error for a SectionID target, which is never prose; a warning for a DocID target, which may be. */
describe('Feature: Undeclared dependency (parent DocID not in References section)', () => {
  it('Scenario: Inline reference to SectionID whose parent DocID is not declared', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 9.2#1',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['3.1', '8.1']) },
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('error');
    expect(result.diagnostics[0]!.ruleId).toBe(INLINE_REFERENCE_RULE_ID);
    expect(result.diagnostics[0]!.message).toContain('9.2');
  });

  it('Scenario: Inline reference to DocID not declared in References', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'per 9.2',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['3.1', '8.1']) },
    );

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('warning');
    expect(result.diagnostics[0]!.ruleId).toBe(INLINE_REFERENCE_RULE_ID);
    expect(result.diagnostics[0]!.message).toContain('9.2');
  });

  it('Scenario: Inline reference to SectionID of the same document (self-reference) with DocID declared', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 5.1#2',
      '5.1#1',
      {
        docId: '5.1',
        declaredDocIds: new Set<DocID>(['3.1', '5.1', '8.1']),
      },
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('5.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Multiple inline references in one text node
// ===========================================================================

/** Tests for text nodes containing more than one inline reference. */
describe('Feature: Multiple inline references in one text node', () => {
  it('Scenario: Two inline references in the same text node', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'Guardrail logic per 3.1#2 and retry semantics see 8.1#3.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(2);

    // First reference: per 3.1#2
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('per');

    // Second reference: see 8.1#3
    expect(result.inlineReferences[1]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[1]!.toId).toBe('8.1#3');
    expect(result.inlineReferences[1]!.kind).toBe('see');

    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: Mix of valid and undeclared references in same text node', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2 and per 9.2#1',
      '5.1#1',
      { declaredDocIds: new Set<DocID>(['3.1', '8.1']) },
    );

    // One valid edge for 3.1#2
    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');

    // One error for the undeclared SectionID reference on 9.2
    expect(result.diagnostics).toHaveLength(1);
    expect(result.diagnostics[0]!.severity).toBe('error');
    expect(result.diagnostics[0]!.ruleId).toBe(INLINE_REFERENCE_RULE_ID);
    expect(result.diagnostics[0]!.message).toContain('9.2');
  });

  it('Scenario: Duplicate inline reference in the same text node', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2 and see 3.1#2',
      '5.1#1',
    );

    // Deduplication, if required, is a downstream concern
    expect(result.inlineReferences).toHaveLength(2);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.inlineReferences[1]!.fromId).toBe('5.1#1');
    expect(result.inlineReferences[1]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[1]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Feature: Section context tracking (fromId reflects current heading)
// ===========================================================================

/** Tests that the `fromId` on extracted edges reflects the section context at the point of evaluation. */
describe('Feature: Section context tracking (fromId reflects current heading)', () => {
  it('Scenario: fromId reflects the section context at the point of evaluation', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2',
      '5.1#2',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1#2');
  });

  it('Scenario: fromId is a DocID when the text precedes any sub-heading', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2',
      '5.1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.fromId).toBe('5.1');
  });
});

// ===========================================================================
// Feature: Edge cases -- keyword boundaries and case sensitivity
// ===========================================================================

/** Tests for keyword boundary detection and case-insensitive matching of `see`/`per`. */
describe('Feature: Edge cases -- keyword boundaries and case sensitivity', () => {
  it('Scenario: `see` keyword at the start of a text node', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'see 3.1#2 for details',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');
  });

  it('Scenario: `See` with capital S is detected (case sensitivity)', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'See 3.1#2.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    // The `kind` field normalises to lowercase "see"
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: `Per` with capital P is detected (case sensitivity)', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      'Per 8.1#3, this is enforced.',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.toId).toBe('8.1#3');
    // The `kind` field normalises to lowercase "per"
    expect(result.inlineReferences[0]!.kind).toBe('per');
    expect(result.diagnostics).toHaveLength(0);
  });

  it('Scenario: `see` preceded by opening parenthesis', () => {
    const result: InlineReferenceRuleResult = evaluateText(
      '(see 3.1#2)',
      '5.1#1',
    );

    expect(result.inlineReferences).toHaveLength(1);
    expect(result.inlineReferences[0]!.toId).toBe('3.1#2');
    expect(result.inlineReferences[0]!.kind).toBe('see');
    expect(result.diagnostics).toHaveLength(0);
  });
});

// ===========================================================================
// Cross-cutting: Diagnostic shape and ruleId
// ===========================================================================

describe('Cross-cutting: Diagnostic metadata', () => {
  it('all diagnostics carry ruleId = INLINE_REFERENCE_RULE_ID; an undeclared SectionID is an error, a DocID a warning', () => {
    // Use undeclared references to produce at least one diagnostic of each kind
    const result: InlineReferenceRuleResult = evaluateText(
      'see 9.2#1 and per 7.3',
      '5.1#1',
      { declaredDocIds: new Set<DocID>([]) },
    );

    expect(result.diagnostics.map((diagnostic) => diagnostic.severity)).toEqual(['error', 'warning']);
    for (const diagnostic of result.diagnostics) {
      expect(diagnostic.ruleId).toBe(INLINE_REFERENCE_RULE_ID);
      expect(diagnostic.uri).toBe('file:///test.md');
    }
  });

  it('finalise returns empty results when no text nodes are evaluated', () => {
    const rule: InlineReferenceRule = createRule();
    const result: InlineReferenceRuleResult = rule.finalise();

    expect(result.inlineReferences).toHaveLength(0);
    expect(result.diagnostics).toHaveLength(0);
  });
});

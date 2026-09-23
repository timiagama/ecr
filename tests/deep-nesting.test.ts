/**
 * Deep Nesting Tests
 *
 * Nesting costs a Markdown author almost nothing — two characters per level —
 * so a few kilobytes can nest thousands deep. Every walk over a document's
 * nodes must therefore survive it: recursion does not, and a stack overflow
 * takes the whole process with it rather than being reported as a problem
 * with the document.
 *
 * Each test nests deeply enough to have overflowed the call stack, and then
 * asserts that the walk in question still did its job, so that a walk which
 * returned to recursion, or quietly stopped seeing what it should, fails here.
 */

import { describe, it, expect } from 'vitest';

import { Ecr } from '../src/ecr.js';
import type { CorpusResult, Diagnostic, LintResult } from '../src/types.js';

/**
 * How deep to nest. Comfortably past the depth at which recursion overflowed
 * (about 2,000 levels of blockquote), and still only a few kilobytes.
 */
const DEPTH: number = 4000;

/** Markdown that opens `DEPTH` nested blockquotes on the line it begins. */
const QUOTES: string = '> '.repeat(DEPTH);

/** A well-formed References entry. */
const ENTRY: string = '- 2 - Other (dependency - depends on this)';

/**
 * Lints a document.
 *
 * @param lines - The document's lines
 * @returns The lint result
 */
function lint(lines: readonly string[]): LintResult {
  return new Ecr().lintDocument('file:///docs/deep.md', lines.join('\n'));
}

/**
 * Lists the rules that reported a diagnostic.
 *
 * @param result - A lint result
 * @returns Each diagnostic's rule identifier
 */
function showRuleIds(result: LintResult): readonly string[] {
  return result.diagnostics.map((diagnostic: Diagnostic): string => diagnostic.ruleId);
}

describe('Feature: A deeply nested document is linted, not fatal', () => {
  it('reads a References section buried in thousands of blockquotes', () => {
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      '## 1#1 - Overview',
      '',
      'Content here.',
      '',
      `${QUOTES}## References`,
      QUOTES,
      `${QUOTES}${ENTRY}`,
    ]);

    // The section and its entry were found: being nested is the one thing
    // wrong with them, and an unread entry would be reported as well.
    expect(showRuleIds(result)).toEqual(['ECR103']);
    expect(result.diagnostics[0]?.message).toContain('nested');
    expect(result.extracted?.references).toHaveLength(1);
  });

  it('sees a heading buried in thousands of blockquotes', () => {
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      `${QUOTES}## 1#1 - Overview`,
      '',
      '## References',
      '',
      ENTRY,
    ]);

    expect(result.extracted?.sections.map((section) => section.title)).toContain('Overview');
  });

  it('evaluates an inline reference buried in thousands of blockquotes', () => {
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      '## 1#1 - Overview',
      '',
      `${QUOTES}See 9#9.9 for this.`,
      '',
      '## References',
      '',
      ENTRY,
    ]);

    // Reached, read, and reported: 9 is not among the declared DocIDs.
    expect(showRuleIds(result)).toEqual(['ECR104']);
    expect(result.diagnostics[0]?.message).toContain('9#9.9');
  });

  it('reads a References entry whose own content nests thousands deep', () => {
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      '## 1#1 - Overview',
      '',
      'Content here.',
      '',
      '## References',
      '',
      ENTRY,
      '',
      `  ${QUOTES}note`,
    ]);

    // The entry's text is gathered from every node inside the list item, so
    // the walk that gathers it went all the way down. What it found there is
    // a malformed entry, which is the point: it was read, not skipped.
    expect(showRuleIds(result)).toEqual(['ECR103']);
    expect(result.diagnostics[0]?.message).toContain('References entry');
  });

  // Slower than the rest, and the time is the parser's: four thousand nested
  // bold spans take about six seconds to parse, where the same depth of
  // blockquote takes a fraction of a second. The depth is not arbitrary —
  // reading a heading's text overflowed the call stack at about 3,500 — and
  // one deep heading covers both places that read heading text, because a
  // heading is read once for its own data and once to set the section a
  // citation belongs to.
  it('reads the text of a heading wrapped in thousands of bold spans', { timeout: 30000 }, () => {
    const bold: string = '**'.repeat(DEPTH);
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      `## ${bold}1#1 - Overview${bold}`,
      '',
      'Content here.',
      '',
      '## References',
      '',
      ENTRY,
    ]);

    // The formatting is gone from the text, so the heading is read through it.
    expect(result.extracted?.sections.map((section) => section.title)).toContain('Overview');
    expect(result.extracted?.docId).toBe('1');
  });

  // The parser reads a link's label and an image's description by recursion,
  // inside a package this project does not control, so these two cannot be
  // made to parse. What they must not do is end the process: the document is
  // reported as one that could not be read, and the corpus around it is
  // still validated.
  it.each([
    { kind: 'a link label', markdown: (label: string): string => `[${label}](target.md)` },
    { kind: 'an image description', markdown: (label: string): string => `![${label}](target.md)` },
  ])('reports, rather than dies on, $kind nested thousands deep', { timeout: 30000 }, ({ markdown }) => {
    const bold: string = '**'.repeat(DEPTH);
    const result: LintResult = lint([
      '# 1 - Deep',
      '',
      '## 1#1 - Overview',
      '',
      markdown(`${bold}label${bold}`),
      '',
      '## References',
      '',
      ENTRY,
    ]);

    expect(result.ok).toBe(false);
    expect(showRuleIds(result)).toEqual(['document/unparsable']);
    expect(result.diagnostics[0]?.severity).toBe('error');
    expect(result.diagnostics[0]?.data?.['cause']).toBe('unparsable-document');
    expect(result.diagnostics[0]?.message).toContain('could not be parsed');
  });

  it('validates the rest of a corpus around a document it cannot parse', { timeout: 30000 }, () => {
    const bold: string = '**'.repeat(DEPTH);
    const corpusResult: CorpusResult = new Ecr().validateCorpus([
      {
        uri: 'file:///docs/unparsable.md',
        markdownText: ['# 1 - Deep', '', `[${bold}label${bold}](target.md)`].join('\n'),
      },
      {
        uri: 'file:///docs/sound.md',
        markdownText: ['# 2 - Other', '', '## 2#1 - Scope', '', 'Text.', '', '## References'].join('\n'),
      },
    ]);

    // Both documents are accounted for: one failed, the other was validated,
    // and the corpus as a whole did not pass.
    expect(corpusResult.documents).toHaveLength(2);
    expect(corpusResult.documents[0]?.result.ok).toBe(false);
    expect(corpusResult.documents[0]?.result.diagnostics[0]?.ruleId).toBe('document/unparsable');
    expect(corpusResult.documents[1]?.result.ok).toBe(true);
  });

  it('lints a document nested deeply enough to have overflowed the call stack, without throwing', () => {
    expect(() =>
      lint(['# 1 - Deep', '', '## 1#1 - Overview', '', `${QUOTES}deep`, '', '## References', '', ENTRY]),
    ).not.toThrow();
  });
});

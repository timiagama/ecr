/**
 * Navigation Recipe Tests
 *
 * The navigation protocol is the half of ECR that does the actual work: it is
 * what a coding agent reads in order to traverse a corpus. Its grep recipes are
 * therefore executable specification, not documentation, and they are tested
 * here against the example corpus in `examples/docs`.
 *
 * Two things are asserted for every recipe:
 *
 * 1. Running it over the example corpus returns exactly the expected matches.
 * 2. The pattern appears verbatim in `protocol/navigation-protocol.md`.
 *
 * The second assertion is what stops the protocol and the tests drifting apart.
 * Editing a pattern in the protocol without updating this file fails the suite,
 * and vice versa.
 *
 * Patterns are written in ripgrep syntax and executed here as JavaScript
 * regular expressions. The constructs used — word boundaries, character
 * classes, alternation, anchors — behave identically in both engines, and each
 * pattern is applied line by line, as ripgrep applies it.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT: string = join(TEST_DIRECTORY, '..');
const CORPUS_ROOT: string = join(REPOSITORY_ROOT, 'examples', 'docs');
const PROTOCOL_PATH: string = join(REPOSITORY_ROOT, 'protocol', 'navigation-protocol.md');

/** A single line of the corpus, retaining its origin for diagnostics. */
interface CorpusLine {
  /** Corpus-relative path of the file the line came from, using forward slashes. */
  readonly path: string;
  /** 1-indexed line number within that file. */
  readonly lineNumber: number;
  /** The line's text, without its terminator. */
  readonly text: string;
}

/** A navigation recipe as published in the protocol, with its expected result. */
interface NavigationRecipe {
  /** Human-readable purpose, matching the protocol's table row. */
  readonly purpose: string;
  /** The regular expression source, exactly as published. */
  readonly pattern: string;
  /** Every match the recipe is expected to produce, in corpus order. */
  readonly expectedMatches: readonly string[];
}

/**
 * Recursively collects every Markdown file beneath a directory.
 *
 * @param directory - Absolute path to search
 * @param collected - Accumulator for recursion
 * @returns Absolute paths of every `.md` file found, unsorted
 */
function collectMarkdownFiles(directory: string, collected: string[] = []): string[] {
  for (const entry of readdirSync(directory)) {
    const entryPath: string = join(directory, entry);
    if (statSync(entryPath).isDirectory()) {
      collectMarkdownFiles(entryPath, collected);
    } else if (entry.endsWith('.md')) {
      collected.push(entryPath);
    }
  }
  return collected;
}

/**
 * Loads the example corpus as a flat, ordered list of lines.
 *
 * @returns Every line of every Markdown file in the corpus, in path order
 */
function loadCorpusLines(): readonly CorpusLine[] {
  const files: string[] = collectMarkdownFiles(CORPUS_ROOT).sort();
  const lines: CorpusLine[] = [];

  for (const file of files) {
    const relativePath: string = file
      .slice(CORPUS_ROOT.length + 1)
      .split('\\')
      .join('/');
    const text: string = readFileSync(file, 'utf8');
    text.split(/\r?\n/).forEach((lineText: string, index: number): void => {
      lines.push({ path: relativePath, lineNumber: index + 1, text: lineText });
    });
  }

  return lines;
}

/**
 * Applies a recipe to the corpus and returns each match, trimmed.
 *
 * Matches are trimmed because several patterns deliberately capture one
 * trailing character in order to assert what may follow an identifier.
 *
 * @param pattern - Regular expression source, as published in the protocol
 * @param lines - The corpus to search
 * @returns Every match, in corpus order
 */
function runRecipe(pattern: string, lines: readonly CorpusLine[]): readonly string[] {
  const expression: RegExp = new RegExp(pattern, 'g');
  const matches: string[] = [];

  for (const line of lines) {
    expression.lastIndex = 0;
    let match: RegExpExecArray | null = expression.exec(line.text);
    while (match !== null) {
      // The citation recipes open with `(\b|_)`, which consumes a `_` before
      // the keyword. Dropping it reports the citation itself, so expectations
      // describe what was found rather than what bounded it.
      matches.push(match[0].replace(/^[^0-9A-Za-z]/, '').trim());
      match = expression.exec(line.text);
    }
  }

  return matches;
}

/**
 * Applies a recipe to the corpus and returns where it matched.
 *
 * Used for recipes that locate documents or References entries, where what
 * matters is which lines are hit rather than the matched text.
 *
 * @param pattern - Regular expression source, as published in the protocol
 * @param lines - The corpus to search
 * @returns `path:lineNumber` for every matching line, in corpus order
 */
function locateRecipe(pattern: string, lines: readonly CorpusLine[]): readonly string[] {
  const expression: RegExp = new RegExp(pattern);

  return lines
    .filter((line: CorpusLine): boolean => expression.test(line.text))
    .map((line: CorpusLine): string => `${line.path}:${String(line.lineNumber)}`);
}

/** A recipe that locates lines, with the lines it is expected to hit. */
interface LocatingRecipe {
  /** Human-readable purpose, matching the protocol's wording. */
  readonly purpose: string;
  /** The regular expression source, exactly as published. */
  readonly pattern: string;
  /** Every `path:lineNumber` the recipe is expected to hit, in corpus order. */
  readonly expectedHits: readonly string[];
}

const CORPUS_LINES: readonly CorpusLine[] = loadCorpusLines();
const PROTOCOL_TEXT: string = readFileSync(PROTOCOL_PATH, 'utf8');

/**
 * The reverse-reference recipes published in navigation-protocol.md §2.
 *
 * Expected results are derived from the example corpus, which deliberately
 * contains the identifiers that break naive patterns: document `8.1`, document
 * `8.1.3`, document `8.10`, sections `8.1#3` and `8.1#3.2`, references in both
 * sentence-final and mid-sentence position, and a capitalised `See`.
 */
const NAVIGATION_RECIPES: readonly NavigationRecipe[] = [
  {
    purpose: 'Who references document 8.1?',
    pattern: '(\\b|_)([Ss]ee|[Pp]er) 8\\.1(\\.[^0-9A-Za-z.#]|\\.$|[^0-9A-Za-z.#]|$)',
    expectedMatches: ['per 8.1.', 'see 8.1'],
  },
  {
    purpose: 'Who references any section of 8.1?',
    pattern: '(\\b|_)([Ss]ee|[Pp]er) 8\\.1#',
    expectedMatches: ['see 8.1#', 'per 8.1#', 'see 8.1#', 'per 8.1#', 'per 8.1#'],
  },
  {
    purpose: 'Who references section 8.1#3 or below?',
    pattern: '(\\b|_)([Ss]ee|[Pp]er) 8\\.1#3([^0-9A-Za-z#]|$)',
    // The trailing group consumes one character, as the document recipe's
    // does: here the `.` ending `8.1#3.` or opening `8.1#3.2`. The same five
    // citations are found as under the `\b` form this replaced.
    expectedMatches: [
      'see 8.1#3.',
      'per 8.1#3.',
      'see 8.1#3.',
      'per 8.1#3.',
      'per 8.1#3.',
    ],
  },
  {
    purpose: 'Either the document or any section?',
    pattern: '(\\b|_)([Ss]ee|[Pp]er) 8\\.1(#[0-9.]*|\\.[^0-9A-Za-z.#]|\\.$|[^0-9A-Za-z.#]|$)',
    expectedMatches: [
      'see 8.1#3.',
      'per 8.1.',
      'per 8.1#3.',
      'see 8.1',
      'see 8.1#3.2.',
      'per 8.1#3.2.',
      'per 8.1#3.2.',
    ],
  },
  {
    purpose: 'Every section-precise reference in the corpus',
    pattern: '(\\b|_)([Ss]ee|[Pp]er) [0-9.]+#',
    expectedMatches: [
      'see 8.1#',
      'per 4.2#',
      'See 0.0#',
      'per 8.1#',
      'see 8.1#',
      'see 0.0.1#',
      'see 3.1#',
      'per 8.1#',
      'per 8.1#',
      'see 4.2#',
    ],
  },
];

/**
 * The recipes in navigation-protocol.md §2 that locate a document or its
 * References entries. Each must hit `8.1` without also hitting `8.1.3` or
 * `8.10`, both of which the example corpus contains.
 */
const LOCATING_RECIPES: readonly LocatingRecipe[] = [
  {
    purpose: 'Open the document for a DocID',
    pattern: '^# 8\\.1[^0-9.#]',
    expectedHits: ['8. Orchestration/8.1 - Workflow Orchestration Contract.md:1'],
  },
  {
    purpose: 'References-section entries citing 8.1',
    pattern: '^\\s*([-*+]|[0-9]+[.)])\\s*\\[?8\\.1[^0-9.#]',
    expectedHits: [
      '0. Orientation/0.0 - System Overview.md:34',
      '3. Ingestion/3.1 - Ingestion - Validation Rules.md:33',
      '4. Payments/4.10 - Settlement.md:22',
      '4. Payments/4.2 - Payment Processing Contract.md:33',
      '8. Orchestration/8.1.3 - Retry Policy.md:17',
      '8. Orchestration/8.10 - Dead Letter Queue.md:20',
    ],
  },
  {
    purpose: 'Find everything a document governs',
    pattern: '^\\s*([-*+]|[0-9]+[.)])\\s*\\[?8\\.1[^0-9.#].*\\(authority',
    expectedHits: [
      '0. Orientation/0.0 - System Overview.md:34',
      '4. Payments/4.2 - Payment Processing Contract.md:33',
      '8. Orchestration/8.1.3 - Retry Policy.md:17',
      '8. Orchestration/8.10 - Dead Letter Queue.md:20',
    ],
  },
];

describe('Feature: Locating recipes hit the right document and nothing else', () => {
  it.each(LOCATING_RECIPES)('$purpose', ({ pattern, expectedHits }) => {
    expect(locateRecipe(pattern, CORPUS_LINES)).toEqual([...expectedHits]);
  });

  it.each(LOCATING_RECIPES)('the pattern for "$purpose" appears verbatim in the navigation protocol', ({ pattern }) => {
    expect(PROTOCOL_TEXT, `Pattern is tested here but not published:\n  ${pattern}`).toContain(pattern);
  });

  it('a pattern admitting "." after the DocID also opens a deeper document', () => {
    // The protocol once published this form. It matches the H1 of 8.1.3 as
    // well as 8.1 — the prefix trap the protocol tells agents to avoid.
    const hits: readonly string[] = locateRecipe('^# 8\\.1[ .–—-]', CORPUS_LINES);

    expect(hits).toContain('8. Orchestration/8.1.3 - Retry Policy.md:1');
  });
});

describe('Feature: Navigation recipes resolve correctly against the example corpus', () => {
  it('the example corpus is non-empty', () => {
    expect(
      CORPUS_LINES.length,
      'expected examples/docs to contain Markdown content',
    ).toBeGreaterThan(0);
  });

  it.each(NAVIGATION_RECIPES)('$purpose', ({ pattern, expectedMatches }) => {
    expect(runRecipe(pattern, CORPUS_LINES)).toEqual([...expectedMatches]);
  });
});

describe('Feature: Published recipes match the tested recipes', () => {
  it.each(NAVIGATION_RECIPES)(
    'the pattern for "$purpose" appears verbatim in the navigation protocol',
    ({ pattern }) => {
      // The protocol publishes patterns inside Markdown table cells, where a
      // literal pipe must be escaped. Compare against both forms.
      const published: string = pattern.split('|').join('\\|');
      const isPublished: boolean =
        PROTOCOL_TEXT.includes(pattern) || PROTOCOL_TEXT.includes(published);

      expect(
        isPublished,
        `Pattern is tested here but not published in protocol/navigation-protocol.md:\n  ${pattern}\n` +
        `If the protocol changed, update this test. If this test changed, update the protocol.`,
      ).toBe(true);
    },
  );
});

describe('Feature: Naive patterns are demonstrably unsafe', () => {
  it('a word-boundary-terminated pattern over-matches across document boundaries', () => {
    // Guards the reasoning behind the trailing group in the document-only
    // recipe. If this ever stops over-matching, the trailing group can be
    // simplified — until then it is load-bearing.
    const naiveMatches: readonly string[] = runRecipe(
      '\\b([Ss]ee|[Pp]er) 8\\.1\\b',
      CORPUS_LINES,
    );
    const correctMatches: readonly string[] = runRecipe(
      '(\\b|_)([Ss]ee|[Pp]er) 8\\.1(\\.[^0-9A-Za-z.#]|\\.$|[^0-9A-Za-z.#]|$)',
      CORPUS_LINES,
    );

    expect(
      naiveMatches.length,
      'expected the naive pattern to over-match into 8.1.3, 8.10 and 8.1#3',
    ).toBeGreaterThan(correctMatches.length);
  });

  it('a word-boundary-anchored pattern misses a citation in underscore emphasis', () => {
    // Guards the reasoning behind the explicit leading and trailing groups.
    // `_` is a word character, so `\b` fails on both sides of `_see 8.1#3_`,
    // which is ordinary Markdown emphasis around a valid citation.
    const lines: readonly CorpusLine[] = [
      { path: 'emphasis.md', lineNumber: 1, text: 'Retries follow _see 8.1#3_ exactly.' },
    ];

    expect(runRecipe('\\b([Ss]ee|[Pp]er) 8\\.1#3\\b', lines)).toEqual([]);
    expect(
      runRecipe('(\\b|_)([Ss]ee|[Pp]er) 8\\.1#3([^0-9A-Za-z#]|$)', lines),
    ).toEqual(['see 8.1#3_']);
  });

  it('a lowercase-only pattern under-reports backlinks', () => {
    const lowercaseOnly: readonly string[] = runRecipe(
      '(\\b|_)(see|per) [0-9.]+#',
      CORPUS_LINES,
    );
    const caseTolerant: readonly string[] = runRecipe(
      '(\\b|_)([Ss]ee|[Pp]er) [0-9.]+#',
      CORPUS_LINES,
    );

    expect(
      caseTolerant.length,
      'expected a capitalised "See" reference the lowercase pattern misses',
    ).toBeGreaterThan(lowercaseOnly.length);
  });
});

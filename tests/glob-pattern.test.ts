/**
 * Glob Pattern Tests
 *
 * Two things matter about {@link GlobPattern}: it must match exactly what the
 * documented syntax says, and it must do so in bounded time. The second is a
 * security property — ignore patterns come from `.ecrignore` and `--ignore`,
 * so a pattern that could take exponential time would let a crafted line in a
 * project's ignore file stop the linter.
 */

import { describe, it, expect } from 'vitest';

import { GlobPattern } from '../src/glob-pattern.js';

/**
 * Matches a path against a pattern.
 *
 * @param pattern - The glob pattern
 * @param path - The path to match
 * @returns Whether the pattern matches the whole path
 */
function matches(pattern: string, path: string): boolean {
  return new GlobPattern(pattern).matches(path);
}

describe('Feature: The documented syntax', () => {
  it.each([
    { pattern: 'notes.md', path: 'notes.md', expected: true },
    { pattern: 'notes.md', path: 'docs/notes.md', expected: false },
    // A pattern matches a whole path, never a part of one.
    { pattern: 'notes', path: 'notes.md', expected: false },
    { pattern: 'docs/*.md', path: 'docs/notes.md', expected: true },
    { pattern: 'docs/*.md', path: 'docs/deep/notes.md', expected: false },
    { pattern: 'docs/**', path: 'docs/deep/notes.md', expected: true },
    { pattern: '**/notes.md', path: 'notes.md', expected: true },
    { pattern: '**/notes.md', path: 'a/b/notes.md', expected: true },
    { pattern: '**/notes.md', path: 'a/b/other.md', expected: false },
    { pattern: 'note?.md', path: 'notes.md', expected: true },
    { pattern: 'note?.md', path: 'note.md', expected: false },
    { pattern: 'a?b', path: 'a/b', expected: false },
    { pattern: '**', path: 'a/b/c.md', expected: true },
    { pattern: '', path: '', expected: true },
    { pattern: '', path: 'a', expected: false },
  ])('$pattern against $path is $expected', ({ pattern, path, expected }) => {
    expect(matches(pattern, path)).toBe(expected);
  });

  it.each([
    { pattern: 'a.md', path: 'axmd' },
    { pattern: 'a+b.md', path: 'aab.md' },
    { pattern: 'a(b).md', path: 'ab.md' },
    { pattern: 'a|b.md', path: 'a.md' },
  ])('treats the regular-expression syntax in $pattern as ordinary characters', ({ pattern, path }) => {
    expect(matches(pattern, path)).toBe(false);
  });

  it.each([
    { pattern: 'a+b.md', path: 'a+b.md' },
    { pattern: 'notes [draft].md', path: 'notes [draft].md' },
    { pattern: 'v1.0/*.md', path: 'v1.0/notes.md' },
  ])('matches $pattern literally', ({ pattern, path }) => {
    expect(matches(pattern, path)).toBe(true);
  });
});

describe('Feature: Matching costs bounded time', () => {
  /**
   * The pattern a regular expression cannot match cheaply: every `*` can
   * divide the path in many ways, and a backtracking engine tries them all
   * before deciding that the final `b` is missing.
   */
  const CRAFTED_PATTERN: string = '*a*a*a*a*a*a*a*ab';

  it('settles a pattern built to make a regular expression backtrack', () => {
    const path: string = `${'a'.repeat(67)}.md`;
    const started: number = performance.now();

    expect(matches(CRAFTED_PATTERN, path)).toBe(false);

    // The matcher takes well under a millisecond; the same pattern compiled to
    // a regular expression did not finish in thirty seconds. The generous
    // bound is there to catch a return to exponential cost, not to time it.
    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('settles that pattern against a path far longer still', () => {
    const path: string = 'a'.repeat(5000);
    const started: number = performance.now();

    expect(matches(CRAFTED_PATTERN, path)).toBe(false);

    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('matches when the crafted pattern really is satisfied', () => {
    expect(matches(CRAFTED_PATTERN, `${'a'.repeat(40)}ab`)).toBe(true);
  });
});

describe('Feature: The matcher agrees with the syntax it replaces', () => {
  /**
   * Compiles a pattern the way an anchored regular expression would express
   * the same syntax. Only used to check agreement on small inputs, where a
   * regular expression is still cheap.
   *
   * @param pattern - The glob pattern
   * @returns The equivalent anchored regular expression
   */
  function compileToRegExp(pattern: string): RegExp {
    let expression: string = '';

    for (let index: number = 0; index < pattern.length; index += 1) {
      const character: string = pattern[index] ?? '';

      if (character === '*') {
        if (pattern[index + 1] === '*' && pattern[index + 2] === '/') {
          expression += '(?:.*/)?';
          index += 2;
        } else if (pattern[index + 1] === '*') {
          expression += '.*';
          index += 1;
        } else {
          expression += '[^/]*';
        }
        continue;
      }

      if (character === '?') {
        expression += '[^/]';
        continue;
      }

      expression += character.replace(/[.+^${}()|[\]\\]/g, '\\$&');
    }

    return new RegExp(`^${expression}$`);
  }

  const PATTERNS: readonly string[] = [
    '*',
    '**',
    '?',
    'a',
    'a/b',
    '*.md',
    '**/*.md',
    'a/**',
    'a/**/b',
    '*a*b',
    'a?b/*',
    '**a',
    'a**b',
    '*/*',
  ];

  const PATHS: readonly string[] = ['', 'a', 'b', 'ab', 'a/b', 'a/b/c', 'a.md', 'a/b.md', 'ab/c.md', '/', 'a/', 'aab'];

  it('gives the same answer as the equivalent regular expression, everywhere both are cheap', () => {
    for (const pattern of PATTERNS) {
      const expression: RegExp = compileToRegExp(pattern);

      for (const path of PATHS) {
        expect(
          matches(pattern, path),
          `pattern ${JSON.stringify(pattern)} against ${JSON.stringify(path)}`,
        ).toBe(expression.test(path));
      }
    }
  });
});

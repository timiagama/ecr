/**
 * Terminal-Safe Text Tests
 *
 * A document's own text reaches the terminal in the CLI's reports. These
 * tests hold the line between text that is displayed and text a terminal
 * would act on.
 */

import { describe, it, expect } from 'vitest';

import { showControlCharacters } from '../src/cli/safe-text.js';

/** The character that opens an ANSI escape sequence. */
const ESCAPE: string = '\u001b';

describe('Feature: Characters a terminal acts on are shown, not obeyed', () => {
  it('shows the escape that opens a sequence', () => {
    expect(showControlCharacters(`${ESCAPE}[2J`)).toBe('\\u001b[2J');
  });

  it.each([
    { name: 'a carriage return, which overwrites the line', character: '\r', shown: '\\u000d' },
    { name: 'a backspace, which erases what came before', character: '\b', shown: '\\u0008' },
    { name: 'a null', character: '\u0000', shown: '\\u0000' },
    { name: 'a bell', character: '\u0007', shown: '\\u0007' },
    { name: 'delete', character: '\u007f', shown: '\\u007f' },
    { name: 'a C1 control', character: '\u009b', shown: '\\u009b' },
    { name: 'a right-to-left override, which reorders what follows', character: '‮', shown: '\\u202e' },
    { name: 'a right-to-left isolate', character: '⁧', shown: '\\u2067' },
  ])('shows $name', ({ character, shown }) => {
    expect(showControlCharacters(`a${character}b`)).toBe(`a${shown}b`);
  });

  it.each([
    { name: 'a newline, which the report is made of', text: 'a\nb' },
    { name: 'a tab', text: 'a\tb' },
    { name: 'ordinary words', text: 'H1 "Title" is not numbered.' },
    { name: 'letters outside ASCII', text: 'Überschrift — naïve — 日本語' },
    { name: 'an emoji', text: 'done 🎉' },
  ])('leaves $name alone', ({ text }) => {
    expect(showControlCharacters(text)).toBe(text);
  });

  it('shows every acted-on character in a longer sequence, not just the first', () => {
    const attack: string = `Title${ESCAPE}[2J${ESCAPE}[H${ESCAPE}[31mINJECTED${ESCAPE}[0m`;

    const shown: string = showControlCharacters(attack);

    expect(shown).not.toContain(ESCAPE);
    expect(shown).toBe('Title\\u001b[2J\\u001b[H\\u001b[31mINJECTED\\u001b[0m');
  });
});

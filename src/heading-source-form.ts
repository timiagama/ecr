/**
 * Heading Source Form
 *
 * Checks that a heading carrying a DocID or SectionID is written in the one
 * source form the published recipes can find (1#9.11 rule 1): an ATX heading
 * whose line begins with its `#` characters, then exactly one space, then the
 * identifier in literal characters.
 *
 * The Markdown parser accepts far more than that. A setext heading, an
 * indented one, one inside a blockquote, one with a tab or two spaces after
 * the hashes, and one whose identifier is emphasised, escaped or written as a
 * character reference all parse to the same identifier -- and none of them is
 * found by `^# 8\.1[^0-9.#]` or `^#+ 8\.1#3([^0-9]|$)`. So the check reads the
 * heading's own source line and asks the question the recipe asks.
 *
 * It also asks whether that line is a line at all to a search engine. Two
 * things can hide a correctly written heading from `^`: a lone carriage
 * return before it, which Markdown treats as a line ending and the engines do
 * not, and a byte-order mark before the first line, which ripgrep skips and
 * GNU grep does not.
 *
 * Shared by ECR101 (the H1) and ECR102 (every deeper heading).
 */

import type { PositionRange } from './types.js';
import { SourceLines } from './source-lines.js';

/** The `data.cause` of a heading whose source form no recipe can find. */
export const HEADING_SOURCE_FORM_CAUSE: string = 'heading-source-form';

/**
 * Why a heading cannot be found, carried as `data.obstruction`.
 *
 * - `form`: the heading line is not `#… identifier` from its first column.
 * - `lone-carriage-return`: it is, but a lone CR precedes it, so to a search
 *   it is the middle of the line before.
 * - `byte-order-mark`: it is, but it is the first line and a byte-order mark
 *   precedes it, which GNU grep reads as text before the `#`.
 */
export type HeadingObstruction = 'form' | 'lone-carriage-return' | 'byte-order-mark';

/** The UTF-8 byte-order mark, as it appears at the start of decoded text. */
const BYTE_ORDER_MARK: string = '﻿';

/**
 * What may follow a DocID on its heading line, per the document recipe
 * `^# 8\.1[^0-9.#]`: anything but a digit, `.` or `#`, so that `8.1` is not
 * found as the start of `8.10`, `8.1.3` or `8.1#3`.
 */
const AFTER_DOC_ID: RegExp = /^[^0-9.#]/;

/**
 * What may follow a SectionID on its heading line, per the section recipe
 * `^#+ 8\.1#3([^0-9]|$)`: anything but a digit, or the end of the line.
 */
const AFTER_SECTION_ID: RegExp = /^(?:[^0-9]|$)/;

/**
 * Tells whether headings are written where the recipes look for them.
 */
export class HeadingSourceForm {
  /** The document's source, by line; absent when none was supplied. */
  private readonly lines: SourceLines | undefined;

  /**
   * @param sourceText - The document's raw Markdown. When absent, as in unit
   *                     tests that supply only parsed heading text, there is
   *                     no source to consult and every heading passes.
   */
  public constructor(sourceText: string | undefined) {
    this.lines = sourceText === undefined ? undefined : new SourceLines(sourceText);
  }

  /**
   * Finds what, if anything, stops the recipe for a heading from finding it.
   *
   * @param range - The heading node's range
   * @param depth - The heading's depth, 1 for the H1
   * @param identifier - The DocID or SectionID parsed from the heading
   * @returns The obstruction, or `undefined` when the recipe would find it
   */
  public findObstruction(
    range: PositionRange | undefined,
    depth: number,
    identifier: string,
  ): HeadingObstruction | undefined {
    if (this.lines === undefined || range === undefined) {
      return undefined;
    }

    const lineNumber: number = range.start.line;
    const line: string = this.lines.readLine(lineNumber) ?? '';

    // A mark before the first line is reported only when it is what stands
    // in the way: after it, the line must be a correct heading. A mark
    // followed by a newline obstructs nothing, since the H1 then starts a
    // later line, which both engines find.
    if (lineNumber === 0 && line.startsWith(BYTE_ORDER_MARK)) {
      return HeadingSourceForm.tellLineMatches(line.slice(1), depth, identifier)
        ? 'byte-order-mark'
        : 'form';
    }

    if (!HeadingSourceForm.tellLineMatches(line, depth, identifier)) {
      return 'form';
    }

    return this.lines.tellStartsSearchLine(lineNumber) ? undefined : 'lone-carriage-return';
  }

  /**
   * Reports whether a line reads as the recipe for its heading expects.
   *
   * @param line - The heading's source line
   * @param depth - The heading's depth
   * @param identifier - The DocID or SectionID parsed from the heading
   * @returns `true` when the line is `#… identifier` followed by an allowed character
   */
  private static tellLineMatches(line: string, depth: number, identifier: string): boolean {
    const prefix: string = `${'#'.repeat(depth)} ${identifier}`;

    if (!line.startsWith(prefix)) {
      return false;
    }

    const rest: string = line.slice(prefix.length);

    return depth === 1 ? AFTER_DOC_ID.test(rest) : AFTER_SECTION_ID.test(rest);
  }

  /**
   * The explanation a diagnostic gives for an unnavigable heading.
   *
   * @param obstruction - What stops the recipe from finding it
   * @param depth - The heading's depth
   * @param identifier - The DocID or SectionID parsed from the heading
   * @returns A message naming the obstruction and the fix
   */
  public static explain(
    obstruction: HeadingObstruction,
    depth: number,
    identifier: string,
  ): string {
    const hashes: string = '#'.repeat(depth);
    const opening: string =
      `The heading for "${identifier}" is not in the source form the navigation ` +
      `recipes search for, so no search finds it.`;

    switch (obstruction) {
      case 'lone-carriage-return':
        return (
          `${opening} It follows a lone carriage return (CR) line ending, and search ` +
          `tools start a new line only at a line feed, so to them it is the middle of ` +
          `the line before. Save the file with LF or CRLF line endings.`
        );
      case 'byte-order-mark':
        // Not `opening`: ripgrep skips the mark and does find this heading.
        return (
          `The heading for "${identifier}" is not discoverable by every published ` +
          `recipe. The file begins with a UTF-8 byte-order mark, which sits before the ` +
          `heading's # characters; ripgrep skips it, but GNU grep reads it as text there ` +
          `and finds no heading. Save the file as UTF-8 without a byte-order mark.`
        );
      default:
        return (
          `${opening} Write it as an ATX heading at the start of its line -- ` +
          `"${hashes} ${identifier} - ..." -- with one space after the # characters ` +
          `and the identifier in literal characters, without formatting, escapes or ` +
          `indentation.`
        );
    }
  }
}

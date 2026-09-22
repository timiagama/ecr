/**
 * Source Lines
 *
 * Reads a document's raw Markdown by line, for the source-form checks of the
 * navigation guarantee (1#9.11). The published recipes search raw text line
 * by line, so the rules that promise a recipe will find something have to
 * look at the same lines the recipe does.
 */

import type { Position, PositionRange } from './types.js';

/**
 * Records where each line of a source begins.
 *
 * Markdown treats LF, CRLF and a lone CR as line endings. Indexing only LF
 * left a CR-only document with a single line start, so every offset beyond
 * the first line failed to resolve and source validation was silently
 * skipped -- exactly the documents that most need it.
 *
 * @param sourceText - The document's raw Markdown
 * @returns Absolute offset of the first character of each line
 */
export function indexLineStarts(sourceText: string): readonly number[] {
  const starts: number[] = [0];

  for (let index = 0; index < sourceText.length; index += 1) {
    const character: string = sourceText.charAt(index);

    if (character === '\r') {
      const isCarriageReturnLineFeed: boolean = sourceText.charAt(index + 1) === '\n';

      starts.push(index + (isCarriageReturnLineFeed ? 2 : 1));

      if (isCarriageReturnLineFeed) {
        index += 1;
      }
    } else if (character === '\n') {
      starts.push(index + 1);
    }
  }

  return starts;
}

/**
 * A document's raw source, addressable by line.
 */
export class SourceLines {
  /** The document's raw Markdown. */
  private readonly sourceText: string;

  /** Absolute offset at which each line begins. */
  private readonly lineStarts: readonly number[];

  /**
   * Indexes a source for line access.
   *
   * @param sourceText - The document's raw Markdown
   */
  public constructor(sourceText: string) {
    this.sourceText = sourceText;
    this.lineStarts = indexLineStarts(sourceText);
  }

  /**
   * Returns one line of the source, without its line ending.
   *
   * @param line - Zero-based line number
   * @returns The line's text, or `undefined` when the line does not exist
   */
  public readLine(line: number): string | undefined {
    const start: number | undefined = this.lineStarts[line];

    if (start === undefined) {
      return undefined;
    }

    const next: number = this.lineStarts[line + 1] ?? this.sourceText.length;

    return this.sourceText.slice(start, next).replace(/(?:\r\n|\n|\r)$/, '');
  }

  /**
   * Reports whether a Markdown line also begins a line for a search engine.
   *
   * Markdown ends a line at LF, CRLF or a lone CR; ripgrep and grep end one
   * only at LF. So a line that follows a lone CR is, to a search, the middle
   * of the line before it, and no recipe anchored with `^` can match it.
   *
   * @param line - Zero-based Markdown line number
   * @returns `true` when the line starts the file or follows an LF
   */
  public tellStartsSearchLine(line: number): boolean {
    const start: number | undefined = this.lineStarts[line];

    return start === 0 || (start !== undefined && this.sourceText.charAt(start - 1) === '\n');
  }

  /**
   * Returns the source a range covers.
   *
   * @param range - A range within the document
   * @returns Its raw source, or `undefined` when it lies outside the document
   */
  public slice(range: PositionRange): string | undefined {
    const start: number | undefined = this.offsetOf(range.start);
    const end: number | undefined = this.offsetOf(range.end);

    return start === undefined || end === undefined ? undefined : this.sourceText.slice(start, end);
  }

  /**
   * Converts a line/character position into an absolute source offset.
   *
   * @param position - A position within the document
   * @returns The offset, or `undefined` when the line is out of range
   */
  public offsetOf(position: Position): number | undefined {
    const lineStart: number | undefined = this.lineStarts[position.line];

    return lineStart === undefined ? undefined : lineStart + position.character;
  }
}

/**
 * Source Alignment
 *
 * Maps a parsed text node back to the raw Markdown it came from, character by
 * character. The source-form checks of the navigation guarantee (1#9.11) need
 * to know where a parsed character sits in the source, because a search reads
 * the source: an identifier that parses correctly may be escaped, encoded or
 * split across a line there, and no recipe would find it.
 *
 * Used by ECR104 for citations and by ECR103 for the relationship label of a
 * References entry. Moved here unchanged from ECR104, where it was developed.
 */

import { decodeNamedCharacterReference } from 'decode-named-character-reference';
import { decodeNumericCharacterReference } from 'micromark-util-decode-numeric-character-reference';

/** A decoded character reference: its text, and how much source it occupied. */
interface Expansion {
  /** The characters the reference produces. */
  readonly text: string;
  /** How many source characters the reference itself spans. */
  readonly length: number;
}

/** A line ending as Markdown recognises it. */
const LINE_ENDING: RegExp = /^(?:\r\n|\n|\r)/;

/**
 * The prefix a container repeats on its continuation lines.
 *
 * A paragraph inside a blockquote or a list item carries `> ` or indentation
 * on every line after the first. The parser strips it; the source keeps it.
 */
const CONTINUATION_PREFIX: RegExp = /^[ \t>]*/;

/**
 * Whitespace the parser drops from the end of a line.
 *
 * Markdown discards spaces and tabs before a soft line break, so the source
 * carries them and the parsed text does not.
 */
const TRAILING_WHITESPACE: RegExp = /^[ \t]*/;

/** A named character reference, such as `&amp;` or `&fjlig;`. */
const NAMED_REFERENCE: RegExp = /^&[a-zA-Z][a-zA-Z0-9]{1,31};/;

/** A numeric character reference, decimal or hexadecimal. */
const NUMERIC_REFERENCE: RegExp = /^&#(?:([0-9]{1,7})|[xX]([0-9a-fA-F]{1,6}));/;


/**
 * Maps each offset of a node's parsed text to its offset in the source.
 *
 * A text node's source differs from its parsed value in several ways, and
 * the ones undone here are: backslash escapes, character references, the
 * whitespace Markdown drops before a soft line break, and the continuation
 * prefix a blockquote or list item repeats on every line after the first.
 * Line endings are carried through unchanged by the parser, so both sides
 * consume their own.
 *
 * This list is not claimed to be exhaustive. Each construct that was missed
 * rejected some piece of ordinary prose, so the cases covered here are the
 * ones with fixtures, and a failure to align is reported rather than
 * guessed at.
 *
 * Character references are decoded with the same packages the Markdown
 * parser itself uses, rather than guessed at. Earlier versions inferred an
 * expansion's length from surrounding text and were wrong in every direction:
 * `&fjlig;` produces two characters, an unknown name produces none, and
 * `&#10;` produces a line ending. Guessing is what made each round of this
 * work reject a different piece of ordinary prose.
 *
 * @param source - The node's raw source
 * @param parsed - The node's parsed text
 * @returns Source offset for each parsed offset, or `undefined` if the two
 *          could not be aligned
 */
export function alignParsedToSource(
  source: string,
  parsed: string,
): readonly number[] | undefined {
  const map: number[] = [];
  let sourceIndex: number = 0;
  let parsedIndex: number = 0;

  while (parsedIndex < parsed.length) {
    if (sourceIndex >= source.length) {
      return undefined;
    }

    const remaining: string = source.slice(sourceIndex);
    const parsedCharacter: string = parsed.charAt(parsedIndex);

    // A character reference, decoded exactly. Tested first because `&` also
    // begins its own expansion (`&amp;` parses to `&`), and because a
    // reference can produce a line ending: `&#10;` decodes to a line feed
    // while the source holds no line break at all.
    const expansion: Expansion | undefined =
      readCharacterReference(remaining);

    if (expansion !== undefined) {
      if (!parsed.startsWith(expansion.text, parsedIndex)) {
        return undefined;
      }

      for (let unit = 0; unit < expansion.text.length; unit += 1) {
        map[parsedIndex + unit] = sourceIndex;
      }

      sourceIndex += expansion.length;
      parsedIndex += expansion.text.length;
      continue;
    }

    // A soft line break, and any container prefix on the line that follows.
    //
    // The parser does not normalise line endings: a CRLF document yields a
    // text node whose value still contains CRLF. The source ending therefore
    // decides how much is consumed, on both sides. Taking the parsed text's
    // own ending instead was wrong twice over -- consuming one character for
    // a two-character ending desynchronised every multi-line paragraph in a
    // CRLF checkout, and consuming two for a one-character ending swallowed
    // the line feed that a following `&#10;` had produced.
    const parsedEnding: string | undefined = LINE_ENDING.exec(parsed.slice(parsedIndex))?.[0];

    if (parsedEnding !== undefined) {
      // Spaces and tabs before the break exist only in the source.
      const dropped: string = TRAILING_WHITESPACE.exec(remaining)?.[0] ?? '';
      const sourceEnding: string | undefined =
        LINE_ENDING.exec(remaining.slice(dropped.length))?.[0];

      if (sourceEnding === undefined) {
        return undefined;
      }

      // Consume exactly what the source spent, not what the parsed text
      // could match. The two differ when a literal CR is followed by an
      // encoded line feed: the parsed value then holds `CR LF`, of which
      // only the CR came from this line ending. Taking both would swallow
      // the entity's own character and strand the reference that produced it.
      if (!parsed.startsWith(sourceEnding, parsedIndex)) {
        return undefined;
      }

      for (let unit = 0; unit < sourceEnding.length; unit += 1) {
        map[parsedIndex + unit] = sourceIndex;
      }

      sourceIndex += dropped.length + sourceEnding.length;
      sourceIndex +=
        CONTINUATION_PREFIX.exec(source.slice(sourceIndex))?.[0].length ?? 0;
      parsedIndex += sourceEnding.length;
      continue;
    }

    // A backslash escape: two source characters produce one.
    if (remaining.startsWith(`\\${parsedCharacter}`)) {
      map[parsedIndex] = sourceIndex;
      sourceIndex += 2;
      parsedIndex += 1;
      continue;
    }

    if (remaining.startsWith(parsedCharacter)) {
      map[parsedIndex] = sourceIndex;
      sourceIndex += 1;
      parsedIndex += 1;
      continue;
    }

    return undefined;
  }

  return map;
}

/**
 * Decodes a character reference at the start of `remaining`, if there is one.
 *
 * An unrecognised name is not a reference at all -- `&NotAnEntity;` stays
 * literal -- and is reported as such by returning `undefined`, so the
 * ordinary literal comparison handles it.
 *
 * @param remaining - Source text beginning at the candidate reference
 * @returns The decoded text and the reference's source length, or `undefined`
 */
function readCharacterReference(remaining: string): Expansion | undefined {
  const numeric: RegExpExecArray | null = NUMERIC_REFERENCE.exec(remaining);

  if (numeric !== null) {
    const decimal: string | undefined = numeric[1];
    const value: string = decimal ?? numeric[2] ?? '';

    return {
      text: decodeNumericCharacterReference(value, decimal === undefined ? 16 : 10),
      length: numeric[0].length,
    };
  }

  const named: RegExpExecArray | null = NAMED_REFERENCE.exec(remaining);

  if (named === null) {
    return undefined;
  }

  const decoded: string | false = decodeNamedCharacterReference(named[0].slice(1, -1));

  return decoded === false ? undefined : { text: decoded, length: named[0].length };
}

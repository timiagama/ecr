/**
 * Terminal-Safe Text
 *
 * The CLI prints text it did not write: titles and headings quoted back from
 * documents, and the paths of files it found. A terminal reads some characters
 * as commands rather than as text — an escape sequence can clear the screen,
 * move the cursor, recolour what is already there or overwrite a line — so a
 * document could otherwise decide what the report of it appears to say.
 *
 * Anything printed as text is therefore written with those characters shown
 * rather than obeyed. The JSON form needs no such treatment, because a
 * consumer of it is not a terminal, and escaping there would change the data.
 */

/**
 * Characters a terminal acts on rather than displays: the C0 controls apart
 * from tab and newline, delete, the C1 controls, and the bidirectional
 * formatting characters, which reorder the text around them.
 */
// eslint-disable-next-line no-control-regex -- Matching control characters is the point.
const ACTED_ON_BY_TERMINALS: RegExp = /[\u0000-\u0008\u000B-\u001F\u007F-\u009F‪-‮⁦-⁩]/g;

/**
 * Shows the characters a terminal would act on, rather than letting it act on
 * them, writing each as the `\uXXXX` escape that names it.
 *
 * Tab and newline are left alone: the report is made of lines, and neither
 * can misrepresent what it says.
 *
 * @param text - Text about to be printed to a terminal
 * @returns The same text with every acted-on character shown
 */
export function showControlCharacters(text: string): string {
  return text.replace(
    ACTED_ON_BY_TERMINALS,
    (character: string): string =>
      `\\u${character.codePointAt(0)?.toString(16).padStart(4, '0') ?? ''}`,
  );
}

/**
 * Generates the shipped navigation protocol from its authored source.
 *
 * The authored document lives in the engineering corpus and is a full ECR
 * document: it carries a DocID, its headings carry SectionIDs, and it has a
 * References section. The copy `ecr init` writes into a user's corpus must not
 * carry any of that. A DocID means nothing in someone else's numbering space,
 * and the file is excluded from validation by filename anyway, so an identity
 * on it would be inert and misleading.
 *
 * The transform therefore removes this document's own identity and nothing
 * else. Fenced code blocks are left untouched, and so is any heading bearing an
 * identifier other than this document's own, because the protocol teaches the
 * convention by showing example documents.
 *
 * Usage: node scripts/generate-navigation-protocol.mjs [source] [output]
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = join(dirname(fileURLToPath(import.meta.url)), '..');

// Paths are overridable so the transform can be exercised against fixtures.
// Without arguments the script regenerates the real artifact.
const [sourceArgument, outputArgument] = process.argv.slice(2);
const sourcePath =
  sourceArgument ??
  join(repositoryRoot, 'docs', 'engineering', '0.3 - ECR Navigation Protocol for Coding Agents.md');
const outputPath =
  outputArgument ?? join(repositoryRoot, 'protocol', 'navigation-protocol.md');

const FENCE = /^\s*(```|~~~)/;
const HEADING = /^(#{1,6}) (\S+) - (.+)$/;
const DOC_ID = /^\d+(\.\d+)*$/;
const REFERENCES_HEADING = /^##\s+References\s*$/;
const ANY_HEADING = /^#{1,6}\s/;

/**
 * Strips this document's ECR identity, leaving an ordinary meta-document.
 *
 * @param {string} source - The authored document
 * @returns {string} The shipped derivative
 */
function stripEcrIdentity(source) {
  // Line endings are normalized so the artifact is identical whichever
  // platform generated it.
  const lines = source.split(/\r?\n/);

  const h1 = lines.find((line) => line.startsWith('# '));
  const h1Parts = h1 ? HEADING.exec(h1) : null;
  const docId = h1Parts && DOC_ID.test(h1Parts[2]) ? h1Parts[2] : null;

  if (docId === null) {
    // The source has not been given an ECR identity yet. Copy it through
    // rather than guessing at a transform.
    return `${lines.join('\n').replace(/\n+$/, '')}\n`;
  }

  const sectionPrefix = `${docId}#`;
  const output = [];
  let inFence = false;
  let droppingReferences = false;

  for (const line of lines) {
    if (FENCE.test(line)) {
      inFence = !inFence;
      output.push(line);
      continue;
    }

    if (inFence) {
      output.push(line);
      continue;
    }

    if (droppingReferences) {
      // The References section runs to the next heading, or to end of file.
      if (ANY_HEADING.test(line)) {
        droppingReferences = false;
      } else {
        continue;
      }
    }

    if (REFERENCES_HEADING.test(line)) {
      droppingReferences = true;
      while (output.length > 0 && output[output.length - 1].trim() === '') {
        output.pop();
      }
      continue;
    }

    const heading = HEADING.exec(line);
    if (heading !== null) {
      const [, hashes, identifier, title] = heading;

      // Only this document's own identity is removed. An identifier belonging
      // to an illustrative example is left exactly as authored.
      if (identifier === docId) {
        output.push(`${hashes} ${title}`);
        continue;
      }
      if (identifier.startsWith(sectionPrefix)) {
        output.push(`${hashes} ${identifier.slice(sectionPrefix.length)} - ${title}`);
        continue;
      }
    }

    output.push(line);
  }

  return `${output.join('\n').replace(/\n+$/, '')}\n`;
}

writeFileSync(outputPath, stripEcrIdentity(readFileSync(sourcePath, 'utf8')), {
  encoding: 'utf8',
});

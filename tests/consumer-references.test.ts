/**
 * Consumer Reference Tests
 *
 * The engineering corpus in docs/engineering/ is cited from files that are not
 * part of it: AGENTS.md and the ESLint configuration. Those citations are
 * addresses -- `per 0.1#3.1` -- and nothing in ECR checks them, because the
 * citing files are outside the corpus and are meta-documents by design.
 *
 * That gap is exactly how the previous convention failed. The ESLint rules
 * cited section numbers of a standards document, the document was replaced,
 * and every citation silently pointed somewhere else. No gate noticed, because
 * a comment cannot fail a build.
 *
 * These tests close it: every `see`/`per` address in a consumer file must
 * resolve to a DocID or SectionID that the corpus actually defines.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Ecr } from '../src/ecr.js';
import type { CorpusDocumentInput } from '../src/ecr.js';
import type { CorpusIndex, CorpusResult } from '../src/types.js';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT: string = join(TEST_DIRECTORY, '..');
const CORPUS_DIRECTORY: string = join(REPOSITORY_ROOT, 'docs', 'engineering');

/** Files that cite the corpus without belonging to it. */
const CONSUMER_FILES: readonly string[] = ['AGENTS.md', 'eslint.config.mjs'];

/**
 * A `see`/`per` reference followed by an ECR identifier. The identifier must
 * be adjacent plain text, which is what ECR itself extracts.
 */
const REFERENCE: RegExp = /\b(?:see|per) (\d+(?:\.\d+)*(?:#\d+(?:\.\d+)*)?)/g;

interface FoundReference {
  readonly file: string;
  readonly identifier: string;
}

/**
 * Indexes the engineering corpus.
 *
 * @returns The corpus index, or empty maps when nothing could be indexed
 */
function indexCorpus(): CorpusIndex {
  const documents: CorpusDocumentInput[] = readdirSync(CORPUS_DIRECTORY)
    .filter((name) => name.endsWith('.md'))
    .map((name) => ({
      uri: name,
      markdownText: readFileSync(join(CORPUS_DIRECTORY, name), 'utf8'),
    }));

  const result: CorpusResult = new Ecr().validateCorpus(documents);
  return result.index ?? { docIds: {}, sectionIds: {} };
}

/**
 * Collects every address cited by the consumer files.
 *
 * @returns The references found, with the file that carries each
 */
function findConsumerReferences(): FoundReference[] {
  const found: FoundReference[] = [];

  for (const file of CONSUMER_FILES) {
    const text: string = readFileSync(join(REPOSITORY_ROOT, file), 'utf8');
    for (const match of text.matchAll(REFERENCE)) {
      found.push({ file, identifier: match[1] as string });
    }
  }

  return found;
}

describe('Feature: consumer references into the engineering corpus', () => {
  it('finds addresses to check', () => {
    // Without this the suite would pass vacuously if the citations were
    // removed, which is the failure it exists to prevent.
    expect(findConsumerReferences().length).toBeGreaterThan(0);
  });

  it('resolves every cited address against the corpus', () => {
    const index: CorpusIndex = indexCorpus();

    const unresolved: string[] = findConsumerReferences()
      .filter(({ identifier }) =>
        identifier.includes('#')
          ? !Object.hasOwn(index.sectionIds, identifier)
          : !Object.hasOwn(index.docIds, identifier),
      )
      .map(({ file, identifier }) => `${file} cites ${identifier}`);

    expect(unresolved, 'addresses that do not resolve in docs/engineering').toEqual([]);
  });
});

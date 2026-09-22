/**
 * Corpus Discovery Tests
 *
 * Every document the CLI validates must be found by the published searches
 * (1#9.11). Those searches are recursive, so each engine applies its own
 * discovery rules -- ripgrep skips files named in `.gitignore`, `.ignore` and
 * `.rgignore`, and neither engine follows links beneath the directory it is
 * given. Searching named files would bypass all of that, so these tests
 * search directories, exactly as the published commands do.
 *
 * The ripgrep flags are read from the published protocol, so a command that
 * loses `--no-ignore` fails here.
 */

import { describe, it, expect, beforeAll, afterAll, afterEach } from 'vitest';
import { lstatSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { CorpusLoader } from '../src/cli/corpus-loader.js';
import type { LoadedCorpus } from '../src/cli/corpus-loader.js';
import { cleanupSearchEngines, listGrepMatches, listRipgrepMatches } from './search-engines.js';

const REPOSITORY_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), '..');
const PROTOCOL_TEXT: string = readFileSync(join(REPOSITORY_ROOT, 'protocol', 'navigation-protocol.md'), 'utf8');

/** The published pattern that lists every document's H1. */
const EVERY_H1_PATTERN: string = '^# [0-9]';

/**
 * The flags of the published "map the whole corpus" command, other than
 * `-n`, which only adds line numbers to what is found.
 */
const PUBLISHED_RIPGREP_FLAGS: readonly string[] = ((): readonly string[] => {
  const command: string | undefined = PROTOCOL_TEXT.split(/\r?\n/).find(
    (line: string): boolean => line.startsWith('rg ') && line.endsWith(`"${EVERY_H1_PATTERN}" docs`),
  );

  if (command === undefined) {
    throw new Error(`The protocol no longer publishes an rg command for "${EVERY_H1_PATTERN}".`);
  }

  return command
    .slice('rg '.length, command.indexOf('"'))
    .trim()
    .split(/\s+/)
    .filter((flag: string): boolean => flag !== '-n');
})();

let workspace: string;

/**
 * Writes a file, creating parent directories as needed.
 *
 * @param path - Path relative to the workspace
 * @param contents - File contents
 */
function write(path: string, contents: string): void {
  const absolutePath: string = join(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf8');
}

/**
 * Writes a conforming document.
 *
 * @param path - Path relative to the workspace
 * @param docId - The document's DocID
 */
function writeDocument(path: string, docId: string): void {
  write(path, `# ${docId} - Doc\n\n## References\n`);
}

/**
 * Asserts that both engines' recursive searches find every document the CLI
 * loads from a corpus root.
 *
 * @param root - Corpus root, relative to the workspace
 * @returns What the CLI loaded
 */
function expectEveryLoadedDocumentFound(root: string): LoadedCorpus {
  const directory: string = join(workspace, root);
  const loaded: LoadedCorpus = new CorpusLoader(directory).load();
  const uris: readonly string[] = loaded.documents.map((document) => document.uri);

  expect(uris.length, 'the scenario must load something to be a test').toBeGreaterThan(0);

  const foundByRipgrep: readonly string[] = listRipgrepMatches(EVERY_H1_PATTERN, directory, PUBLISHED_RIPGREP_FLAGS);
  const foundByGrep: readonly string[] = listGrepMatches(EVERY_H1_PATTERN, directory);

  for (const uri of uris) {
    expect(foundByRipgrep, `ripgrep (${PUBLISHED_RIPGREP_FLAGS.join(' ')}) must find ${uri}`).toContain(uri);
    expect(foundByGrep, `grep -rlE must find ${uri}`).toContain(uri);
  }

  return loaded;
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-discovery-'));
  // ripgrep honours .gitignore only inside a git repository.
  const init = spawnSync('git', ['init', '-q'], { cwd: workspace, encoding: 'utf8' });

  if (init.status !== 0) {
    throw new Error(`git init failed: ${init.stderr}`);
  }
});

afterEach(() => {
  rmSync(join(workspace, 'docs'), { recursive: true, force: true });
  rmSync(join(workspace, '.gitignore'), { force: true });
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
  cleanupSearchEngines();
});

describe('Feature: The published recursive searches find every document the CLI validates', () => {
  it('publishes --no-ignore on the command that maps the corpus', () => {
    expect(PUBLISHED_RIPGREP_FLAGS).toContain('--no-ignore');
  });

  it.each([
    { file: '.gitignore at the repository root', ignoreFile: '.gitignore', entry: 'docs/listed.md' },
    { file: '.gitignore inside the corpus', ignoreFile: 'docs/.gitignore', entry: 'listed.md' },
    { file: '.ignore', ignoreFile: 'docs/.ignore', entry: 'listed.md' },
    { file: '.rgignore', ignoreFile: 'docs/.rgignore', entry: 'listed.md' },
    { file: 'a directory in .gitignore', ignoreFile: 'docs/.gitignore', entry: 'drafts/' },
  ])('finds a document named in $file', ({ ignoreFile, entry }) => {
    writeDocument('docs/plain.md', '1.1');
    writeDocument('docs/listed.md', '2.1');
    writeDocument('docs/drafts/draft.md', '3.1');
    write(ignoreFile, `${entry}\n`);

    const loaded: LoadedCorpus = expectEveryLoadedDocumentFound('docs');

    expect(loaded.documents).toHaveLength(3);
  });

  it('would miss a gitignored document without --no-ignore, so the flag is what finds it', () => {
    writeDocument('docs/plain.md', '1.1');
    writeDocument('docs/listed.md', '2.1');
    write('.gitignore', 'docs/listed.md\n');

    const withoutFlag: readonly string[] = listRipgrepMatches(
      EVERY_H1_PATTERN,
      join(workspace, 'docs'),
      PUBLISHED_RIPGREP_FLAGS.filter((flag: string): boolean => flag !== '--no-ignore'),
    );

    expect(withoutFlag).toEqual(['plain.md']);
    expectEveryLoadedDocumentFound('docs');
  });

  it('leaves hidden documents out, which ripgrep also does; grep finding more is permitted', () => {
    writeDocument('docs/plain.md', '1.1');
    writeDocument('docs/.hidden.md', '2.1');
    writeDocument('docs/.notes/inside.md', '3.1');

    const loaded: LoadedCorpus = expectEveryLoadedDocumentFound('docs');

    expect(loaded.documents.map((document) => document.uri)).toEqual(['plain.md']);
  });

  it('does not validate a document behind a link, which neither search reaches', () => {
    writeDocument('docs/plain.md', '1.1');
    writeDocument('elsewhere/linked.md', '2.1');
    symlinkSync(join(workspace, 'elsewhere'), join(workspace, 'docs', 'shared'), 'junction');

    const directory: string = join(workspace, 'docs');
    const loaded: LoadedCorpus = expectEveryLoadedDocumentFound('docs');

    expect(loaded.notFollowedPaths).toEqual(['shared']);
    expect(listRipgrepMatches(EVERY_H1_PATTERN, directory, PUBLISHED_RIPGREP_FLAGS)).toEqual(['plain.md']);
    expect(listGrepMatches(EVERY_H1_PATTERN, directory)).toEqual(['plain.md']);
  });

  it('validates the documents beneath a corpus root that is itself a link', () => {
    writeDocument('docs/real/plain.md', '1.1');
    writeDocument('docs/real/sub/nested.md', '2.1');
    symlinkSync(join(workspace, 'docs', 'real'), join(workspace, 'docs', 'root-link'), 'junction');

    // The engines are given `root-link` itself as their argument, from its
    // parent, so this exercises how they treat a linked root they are named.
    expect(lstatSync(join(workspace, 'docs', 'root-link')).isSymbolicLink()).toBe(true);

    const loaded: LoadedCorpus = expectEveryLoadedDocumentFound('docs/root-link');

    expect(loaded.documents.map((document) => document.uri)).toEqual(['plain.md', 'sub/nested.md']);
  });
});

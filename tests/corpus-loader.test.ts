/**
 * Corpus Loader Tests
 *
 * The walk that finds a corpus's documents must see what the published
 * recursive searches see, so links beneath the root are not followed but
 * reported; it must not enter a directory an ignore pattern excludes; and it
 * must report what it could not read instead of crashing.
 *
 * Directory links are made as junctions, which Windows allows without
 * privileges; on other platforms the type is ignored and an ordinary symbolic
 * link is made. File and directory symbolic links need privileges on Windows,
 * so those tests run only where they can be made.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CorpusLoader } from '../src/cli/corpus-loader.js';
import type { LoadedCorpus } from '../src/cli/corpus-loader.js';

const VALID_DOCUMENT: string = '# 5.1 - Doc\n\n## 5.1#1 - Section\n\nText.\n\n## References\n';

let workspace: string;

/**
 * Writes a document, creating parent directories as needed.
 *
 * @param path - Path relative to the workspace
 */
function writeDocument(path: string): void {
  const absolutePath: string = join(workspace, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, VALID_DOCUMENT, 'utf8');
}

/**
 * Links a directory, as a junction on Windows.
 *
 * @param target - Directory linked to, relative to the workspace
 * @param link - Where the link is made, relative to the workspace
 */
function linkDirectory(target: string, link: string): void {
  mkdirSync(dirname(join(workspace, link)), { recursive: true });
  symlinkSync(join(workspace, target), join(workspace, link), 'junction');
}

/**
 * Links a directory, then removes what it points to.
 *
 * @param link - Where the dangling link is made, relative to the workspace
 */
function linkDanglingDirectory(link: string): void {
  const target: string = `gone-${link.replaceAll('/', '-')}`;
  mkdirSync(join(workspace, target));
  linkDirectory(target, link);
  rmSync(join(workspace, target), { recursive: true });
}

/**
 * Makes a symbolic link of the given type.
 *
 * @param target - What is linked to, relative to the workspace
 * @param link - Where the link is made, relative to the workspace
 * @param type - The kind of link, for Windows
 */
function linkSymbolically(target: string, link: string, type: 'file' | 'dir'): void {
  mkdirSync(dirname(join(workspace, link)), { recursive: true });
  symlinkSync(join(workspace, target), join(workspace, link), type);
}

/**
 * Loads a corpus beneath the workspace.
 *
 * @param root - Corpus root, relative to the workspace
 * @param ignorePatterns - Ignore patterns
 * @returns What the loader found
 */
function load(root: string, ignorePatterns: readonly string[] = []): LoadedCorpus {
  return new CorpusLoader(join(workspace, root), ignorePatterns).load();
}

/**
 * Lists the URIs of the documents a load produced.
 *
 * @param loaded - What the loader found
 * @returns Each document's corpus-relative path, in order
 */
function showUris(loaded: LoadedCorpus): readonly string[] {
  return loaded.documents.map((document) => document.uri);
}

/**
 * Whether this machine lets an unprivileged process make a symbolic link.
 * Windows requires Developer Mode or elevation; junctions do not.
 */
const CAN_MAKE_SYMBOLIC_LINKS: boolean = ((): boolean => {
  const probe: string = mkdtempSync(join(tmpdir(), 'ecr-link-probe-'));
  try {
    writeFileSync(join(probe, 'target'), '');
    symlinkSync(join(probe, 'target'), join(probe, 'link'), 'file');
    return true;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
})();

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-loader-'));
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Feature: Links beneath the root are reported, not followed', () => {
  it('does not follow a junction, so the documents behind it are not validated', () => {
    writeDocument('corpus/doc.md');
    writeDocument('elsewhere/linked.md');
    linkDirectory('elsewhere', 'corpus/shared');

    const loaded: LoadedCorpus = load('corpus');

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.notFollowedPaths).toEqual(['shared']);
    expect(loaded.unreadablePaths).toEqual([]);
  });

  it.skipIf(!CAN_MAKE_SYMBOLIC_LINKS)('does not follow a symbolic link to a directory', () => {
    writeDocument('corpus/doc.md');
    writeDocument('elsewhere/linked.md');
    linkSymbolically('elsewhere', 'corpus/shared', 'dir');

    const loaded: LoadedCorpus = load('corpus');

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.notFollowedPaths).toEqual(['shared']);
  });

  it.skipIf(!CAN_MAKE_SYMBOLIC_LINKS)('does not follow a symbolic link named like a document', () => {
    writeDocument('corpus/doc.md');
    writeDocument('elsewhere/target.md');
    linkSymbolically('elsewhere/target.md', 'corpus/alias.md', 'file');

    const loaded: LoadedCorpus = load('corpus');

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.notFollowedPaths).toEqual(['alias.md']);
  });

  it.skipIf(!CAN_MAKE_SYMBOLIC_LINKS)('says nothing of a link to a file that could never be a document', () => {
    writeDocument('corpus/doc.md');
    writeFileSync(join(workspace, 'diagram.png'), '');
    linkSymbolically('diagram.png', 'corpus/diagram.png', 'file');

    expect(load('corpus').notFollowedPaths).toEqual([]);
  });

  it('reports a dangling link as not followed, not as unreadable', () => {
    writeDocument('corpus/doc.md');
    linkDanglingDirectory('corpus/dangling');
    linkDanglingDirectory('corpus/gone.md');

    const loaded: LoadedCorpus = load('corpus');

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.notFollowedPaths).toEqual(['dangling', 'gone.md']);
    expect(loaded.unreadablePaths).toEqual([]);
  });

  it('ends at a link back to the corpus root, since it is not followed', () => {
    writeDocument('corpus/a/doc.md');
    linkDirectory('corpus', 'corpus/a/loop');

    const loaded: LoadedCorpus = load('corpus');

    expect(showUris(loaded)).toEqual(['a/doc.md']);
    expect(loaded.notFollowedPaths).toEqual(['a/loop']);
  });

  // Two links to one directory, with only one path ignored, must not let the
  // ignored path hide the other: each link is reported for what it is.
  it.each([
    { ignore: 'a/bad.md', excluded: [], notFollowed: ['a', 'b'] },
    { ignore: 'a/**', excluded: ['a'], notFollowed: ['b'] },
  ])('reports every alias when $ignore is ignored', ({ ignore, excluded, notFollowed }) => {
    writeDocument('shared/bad.md');
    writeDocument('corpus/doc.md');
    linkDirectory('shared', 'corpus/a');
    linkDirectory('shared', 'corpus/b');

    const loaded: LoadedCorpus = load('corpus', [ignore]);

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.excludedPaths).toEqual(excluded);
    expect(loaded.notFollowedPaths).toEqual(notFollowed);
  });

  it.each([
    { pattern: 'shared/**' },
    { pattern: 'shared' },
    { pattern: '**/shared' },
  ])('excludes a link that $pattern covers, instead of reporting it', ({ pattern }) => {
    writeDocument('corpus/doc.md');
    writeDocument('elsewhere/linked.md');
    linkDirectory('elsewhere', 'corpus/shared');

    const loaded: LoadedCorpus = load('corpus', [pattern]);

    expect(loaded.excludedPaths).toEqual(['shared']);
    expect(loaded.notFollowedPaths).toEqual([]);
  });
});

describe('Feature: A corpus root that is itself a link is followed', () => {
  // Both search engines follow a link named on their command line, so a
  // linked root is searched, and must be validated, like any other.
  it('reads the documents beneath a linked root', () => {
    writeDocument('real/doc.md');
    writeDocument('real/sub/nested.md');
    linkDirectory('real', 'linked-root');

    const loaded: LoadedCorpus = load('linked-root');

    expect(showUris(loaded)).toEqual(['doc.md', 'sub/nested.md']);
    expect(loaded.notFollowedPaths).toEqual([]);
  });

  it('still does not follow links beneath a linked root', () => {
    writeDocument('real/doc.md');
    writeDocument('elsewhere/linked.md');
    linkDirectory('elsewhere', 'real/shared');
    linkDirectory('real', 'linked-root');

    expect(load('linked-root').notFollowedPaths).toEqual(['shared']);
  });
});

describe('Feature: A directory an ignore pattern excludes whole is not walked', () => {
  it('does not enter it, so nothing inside it is reported', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/vendor/lib/readme-like.md');
    linkDanglingDirectory('corpus/vendor/dangling');

    const loaded: LoadedCorpus = load('corpus', ['vendor/**']);

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.excludedPaths).toEqual(['vendor/']);
    expect(loaded.notFollowedPaths).toEqual([]);
  });

  it('excludes a directory at any depth for a pattern that starts with **/', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/a/drafts/x.md');
    linkDanglingDirectory('corpus/a/drafts/dangling');

    const loaded: LoadedCorpus = load('corpus', ['**/drafts/**']);

    expect(showUris(loaded)).toEqual(['doc.md']);
    expect(loaded.excludedPaths).toEqual(['a/drafts/']);
    expect(loaded.notFollowedPaths).toEqual([]);
  });

  it('still walks a directory a single-star pattern only partly excludes', () => {
    writeDocument('corpus/vendor/top.md');
    writeDocument('corpus/vendor/nested/deep.md');

    const loaded: LoadedCorpus = load('corpus', ['vendor/*']);

    expect(showUris(loaded)).toEqual(['vendor/nested/deep.md']);
    expect(loaded.excludedPaths).toEqual(['vendor/top.md']);
  });
});

describe('Feature: What cannot be read is reported, not thrown', () => {
  // Failures of ordinary files and directories are simulated in
  // corpus-loader-errors.test.ts, which replaces the file system calls.
  it('records a corpus root that does not exist', () => {
    expect(load('missing').unreadablePaths).toEqual([{ path: '.', reason: 'ENOENT' }]);
  });
});

describe('Feature: Order does not depend on the platform', () => {
  it('orders documents by corpus-relative path, whatever the separator', () => {
    // With the platform separator, a backslash sorts after `-` and `.`, and
    // before `_`; a slash sorts before all three. Ordering by the
    // corpus-relative path gives one answer everywhere.
    writeDocument('corpus/a_b.md');
    writeDocument('corpus/a/b.md');
    writeDocument('corpus/a.md');
    writeDocument('corpus/a-b.md');

    expect(showUris(load('corpus'))).toEqual(['a-b.md', 'a.md', 'a/b.md', 'a_b.md']);
  });
});

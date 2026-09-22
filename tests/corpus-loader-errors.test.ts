/**
 * Corpus Loader Error Tests
 *
 * An ordinary file or directory that cannot be read must be reported, and the
 * command must refuse to pass a corpus it did not fully read. Permissions
 * cannot make a file unreadable portably (Windows ignores `chmod`), so this
 * file replaces the two file system calls that read, and makes them fail for
 * chosen paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import type * as FileSystem from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CorpusLoader } from '../src/cli/corpus-loader.js';
import type { LoadedCorpus } from '../src/cli/corpus-loader.js';
import { EcrCommandLine } from '../src/cli.js';
import type { CommandOutcome } from '../src/cli.js';

/** A read that must fail: which call, for a path ending how, with which code. */
interface SimulatedFailure {
  readonly call: 'readFileSync' | 'readdirSync';
  readonly pathEnding: string;
  readonly code: string;
}

const failures: SimulatedFailure[] = vi.hoisted((): SimulatedFailure[] => []);

vi.mock('node:fs', async (importOriginal: () => Promise<typeof FileSystem>): Promise<typeof FileSystem> => {
  const actual: typeof FileSystem = await importOriginal();

  /**
   * Throws the simulated error for a call and path, if one is set.
   *
   * @param call - The file system call being made
   * @param path - The path it was given
   */
  function failIfSimulated(call: SimulatedFailure['call'], path: FileSystem.PathOrFileDescriptor): void {
    const normalised: string = String(path).replaceAll('\\', '/');
    const failure: SimulatedFailure | undefined = failures.find(
      (candidate: SimulatedFailure): boolean => candidate.call === call && normalised.endsWith(candidate.pathEnding),
    );

    if (failure !== undefined) {
      throw Object.assign(new Error(`${failure.code}: simulated, ${call} '${normalised}'`), { code: failure.code });
    }
  }

  return {
    ...actual,
    readFileSync: ((path: FileSystem.PathOrFileDescriptor, options?: unknown): unknown => {
      failIfSimulated('readFileSync', path);
      return actual.readFileSync(path, options as BufferEncoding);
    }) as typeof FileSystem.readFileSync,
    readdirSync: ((path: FileSystem.PathLike, options?: unknown): unknown => {
      failIfSimulated('readdirSync', path);
      return actual.readdirSync(path, options as BufferEncoding);
    }) as typeof FileSystem.readdirSync,
  };
});

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
 * Loads a corpus beneath the workspace.
 *
 * @param ignorePatterns - Ignore patterns
 * @returns What the loader found
 */
function load(ignorePatterns: readonly string[] = []): LoadedCorpus {
  return new CorpusLoader(join(workspace, 'corpus'), ignorePatterns).load();
}

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-loader-errors-'));
});

afterEach(() => {
  failures.length = 0;
  rmSync(workspace, { recursive: true, force: true });
});

describe('Feature: An unreadable file or directory is reported and the walk goes on', () => {
  it('records a document that cannot be read, and reads the rest', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/locked.md');
    writeDocument('corpus/z/later.md');
    failures.push({ call: 'readFileSync', pathEnding: 'corpus/locked.md', code: 'EACCES' });

    const loaded: LoadedCorpus = load();

    expect(loaded.documents.map((document) => document.uri)).toEqual(['doc.md', 'z/later.md']);
    expect(loaded.unreadablePaths).toEqual([{ path: 'locked.md', reason: 'EACCES' }]);
  });

  it('records a directory that cannot be listed, and walks the rest', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/private/secret.md');
    failures.push({ call: 'readdirSync', pathEnding: 'corpus/private', code: 'EPERM' });

    const loaded: LoadedCorpus = load();

    expect(loaded.documents.map((document) => document.uri)).toEqual(['doc.md']);
    expect(loaded.unreadablePaths).toEqual([{ path: 'private', reason: 'EPERM' }]);
  });

  it('records every unreadable path, in path order', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/b.md');
    writeDocument('corpus/a/c.md');
    failures.push({ call: 'readFileSync', pathEnding: 'corpus/b.md', code: 'EACCES' });
    failures.push({ call: 'readdirSync', pathEnding: 'corpus/a', code: 'EACCES' });

    expect(load().unreadablePaths.map((unreadable) => unreadable.path)).toEqual(['a', 'b.md']);
  });

  it('does not read an excluded document, so it cannot fail', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/locked.md');
    failures.push({ call: 'readFileSync', pathEnding: 'corpus/locked.md', code: 'EACCES' });

    const loaded: LoadedCorpus = load(['locked.md']);

    expect(loaded.unreadablePaths).toEqual([]);
    expect(loaded.excludedPaths).toEqual(['locked.md']);
  });
});

describe('Feature: The command does not pass a corpus it could not fully read', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it.each([{ command: 'lint' }, { command: 'stats' }])('$command exits 2, naming each unreadable path', ({ command }) => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/locked.md');
    failures.push({ call: 'readFileSync', pathEnding: 'corpus/locked.md', code: 'EACCES' });

    const outcome: CommandOutcome = cli.run([command, join(workspace, 'corpus')]);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stream).toBe('stderr');
    expect(outcome.output).toContain('Could not read');
    expect(outcome.output).toContain('locked.md (EACCES)');
  });

  it('runs once the unreadable path is excluded', () => {
    writeDocument('corpus/doc.md');
    writeDocument('corpus/locked.md');
    failures.push({ call: 'readFileSync', pathEnding: 'corpus/locked.md', code: 'EACCES' });

    const outcome: CommandOutcome = cli.run(['lint', join(workspace, 'corpus'), '--ignore', 'locked.md']);

    expect(outcome.exitCode, outcome.output).toBe(0);
  });
});

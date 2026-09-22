/**
 * Corpus Loader Error Tests
 *
 * An ordinary file or directory that cannot be read must be reported, and the
 * command must refuse to pass a corpus it did not fully read. Permissions
 * cannot make a file unreadable portably (Windows ignores `chmod`), so this
 * file replaces the file system calls involved, and makes them fail for
 * chosen paths.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import type * as FileSystem from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { CorpusLoader } from '../src/cli/corpus-loader.js';
import type { LoadedCorpus } from '../src/cli/corpus-loader.js';
import { EcrCommandLine } from '../src/cli.js';
import type { CommandOutcome } from '../src/cli.js';

/**
 * A call that must fail: which call, for which path, with which code. The
 * path is matched by its ending, or, with `pathIncludes`, by a fragment, so
 * that a temporary file named after the real one matches too.
 */
interface SimulatedFailure {
  readonly call: 'readFileSync' | 'readdirSync' | 'cpSync' | 'writeFileSync' | 'statSync' | 'rmSync' | 'renameSync';
  readonly pathEnding?: string;
  readonly pathIncludes?: string;
  readonly code: string;
  /** For writeFileSync: empty the file first, as a write that fails part-way does. */
  readonly truncates?: boolean;
}

const failures: SimulatedFailure[] = vi.hoisted((): SimulatedFailure[] => []);

vi.mock('node:fs', async (importOriginal: () => Promise<typeof FileSystem>): Promise<typeof FileSystem> => {
  const actual: typeof FileSystem = await importOriginal();

  /**
   * Finds the simulated failure for a call and path, if one is set.
   *
   * @param call - The file system call being made
   * @param path - The path it was given
   * @returns The failure, or `undefined`
   */
  function findFailure(call: SimulatedFailure['call'], path: FileSystem.PathOrFileDescriptor): SimulatedFailure | undefined {
    const normalised: string = String(path).replaceAll('\\', '/');

    return failures.find(
      (candidate: SimulatedFailure): boolean =>
        candidate.call === call &&
        (candidate.pathEnding === undefined || normalised.endsWith(candidate.pathEnding)) &&
        (candidate.pathIncludes === undefined || normalised.includes(candidate.pathIncludes)),
    );
  }

  /**
   * Throws the simulated error for a call and path, if one is set.
   *
   * @param call - The file system call being made
   * @param path - The path it was given
   */
  function failIfSimulated(call: SimulatedFailure['call'], path: FileSystem.PathOrFileDescriptor): void {
    const failure: SimulatedFailure | undefined = findFailure(call, path);

    if (failure !== undefined) {
      if (failure.truncates === true) {
        actual.writeFileSync(path, '');
      }

      throw Object.assign(new Error(`${failure.code}: simulated, ${call} '${String(path)}'`), { code: failure.code });
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
    cpSync: ((source: string, destination: string, options?: FileSystem.CopySyncOptions): void => {
      failIfSimulated('cpSync', destination);
      actual.cpSync(source, destination, options);
    }) as typeof FileSystem.cpSync,
    writeFileSync: ((path: FileSystem.PathOrFileDescriptor, data: string, options?: FileSystem.WriteFileOptions): void => {
      failIfSimulated('writeFileSync', path);
      actual.writeFileSync(path, data, options);
    }) as typeof FileSystem.writeFileSync,
    statSync: ((path: FileSystem.PathLike, options?: FileSystem.StatSyncOptions): unknown => {
      failIfSimulated('statSync', path);
      return actual.statSync(path, options);
    }) as typeof FileSystem.statSync,
    rmSync: ((path: FileSystem.PathLike, options?: FileSystem.RmOptions): void => {
      failIfSimulated('rmSync', path);
      actual.rmSync(path, options);
    }) as typeof FileSystem.rmSync,
    renameSync: ((oldPath: FileSystem.PathLike, newPath: FileSystem.PathLike): void => {
      failIfSimulated('renameSync', newPath);
      actual.renameSync(oldPath, newPath);
    }) as typeof FileSystem.renameSync,
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

describe('Feature: init never reports a failed installation as a success', () => {
  it('removes what it copied when copying fails part-way, and leaves .ecrignore alone', () => {
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'cpSync', pathEnding: 'ecr/spec', code: 'ENOSPC' });

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.output).toContain('nothing was installed');
    expect(existsSync(join(workspace, 'ecr'))).toBe(false);
    expect(existsSync(join(workspace, '.ecrignore'))).toBe(false);
  });

  it('keeps an existing empty destination, emptied again, when copying fails', () => {
    mkdirSync(join(workspace, 'ecr'));
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'cpSync', pathEnding: 'ecr/examples', code: 'ENOSPC' });

    expect(cli.run(['init']).exitCode).toBe(2);
    expect(readdirSync(join(workspace, 'ecr'))).toEqual([]);
  });

  it('says so, and names the line to add, when .ecrignore cannot be written', () => {
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'writeFileSync', pathIncludes: '.ecrignore', code: 'EACCES' });

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.stream).toBe('stderr');
    expect(outcome.output).toContain('could not update .ecrignore (EACCES)');
    expect(outcome.output).toContain('ecr/**');
  });

  // A write that fails part-way must not cost the project the patterns it
  // already had: the error only tells the user to add the new line.
  it('keeps the existing .ecrignore intact when a write fails part-way', () => {
    const original: string = '# drafts\ndocs/drafts/**\n';
    writeFileSync(join(workspace, '.ecrignore'), original);
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'writeFileSync', pathIncludes: '.ecrignore', code: 'ENOSPC', truncates: true });

    expect(cli.run(['init']).exitCode).toBe(2);
    expect(readFileSync(join(workspace, '.ecrignore'), 'utf8')).toBe(original);
    expect(readdirSync(workspace).filter((name: string): boolean => name.startsWith('.ecrignore'))).toEqual(['.ecrignore']);
  });

  it('keeps the existing .ecrignore intact when replacing it fails', () => {
    const original: string = 'docs/drafts/**\n';
    writeFileSync(join(workspace, '.ecrignore'), original);
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'renameSync', pathEnding: '/.ecrignore', code: 'EPERM' });

    expect(cli.run(['init']).exitCode).toBe(2);
    expect(readFileSync(join(workspace, '.ecrignore'), 'utf8')).toBe(original);
    expect(readdirSync(workspace).filter((name: string): boolean => name.startsWith('.ecrignore'))).toEqual(['.ecrignore']);
  });

  it('reports, rather than throws, when the destination cannot be examined', () => {
    mkdirSync(join(workspace, 'ecr'));
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'statSync', pathEnding: '/ecr', code: 'EACCES' });

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.output).toContain('EACCES');
    expect(existsSync(join(workspace, '.ecrignore'))).toBe(false);
  });

  it('reports, rather than throws, when the destination cannot be listed', () => {
    mkdirSync(join(workspace, 'ecr'));
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'readdirSync', pathEnding: '/ecr', code: 'EACCES' });

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.output).toContain('EACCES');
  });

  it('says what was left behind when removing a failed installation also fails', () => {
    const cli: EcrCommandLine = new EcrCommandLine({ workingDirectory: workspace });
    failures.push({ call: 'cpSync', pathEnding: 'ecr/spec', code: 'ENOSPC' });
    failures.push({ call: 'rmSync', pathEnding: '/ecr', code: 'EBUSY' });

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(2);
    expect(outcome.output).not.toContain('nothing was installed');
    expect(outcome.output).toContain('could not remove');
    expect(outcome.output).toContain('ecr');
    expect(existsSync(join(workspace, '.ecrignore'))).toBe(false);
  });
});

/**
 * Executable Entry Point Tests
 *
 * The CLI tests drive `EcrCommandLine.run` in-process, which cannot see how
 * the binary is actually launched. These tests compile the package, lay it out
 * as an installed package would be, and launch the compiled `bin.js` through a
 * symlinked directory — the way `node_modules/.bin/ecr` reaches it on macOS and
 * Linux.
 *
 * The failure they guard against is silent: an entry point that decides
 * whether to run by comparing `process.argv[1]` with its own path sees the
 * symlinked path in one and the real path in the other, does nothing, and
 * exits 0. In CI that is a broken corpus reported as passing.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { cpSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import type { SpawnSyncReturns } from 'node:child_process';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT: string = join(TEST_DIRECTORY, '..');
const EXAMPLE_CORPUS: string = join(REPOSITORY_ROOT, 'examples', 'docs');

/** Compiling the package takes several seconds, well beyond the default hook timeout. */
const BUILD_TIMEOUT_MS: number = 120_000;

let workspace: string;
let linkedBinPath: string;

/**
 * Runs the compiled binary through the symlinked package directory.
 *
 * @param argv - Arguments to pass to the binary
 * @returns The completed process
 */
function runLinkedBinary(argv: readonly string[]): SpawnSyncReturns<string> {
  return spawnSync(process.execPath, [linkedBinPath, ...argv], { encoding: 'utf8' });
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-bin-'));

  // Lay the package out as it is installed: compiled code beside the
  // package.json and protocol the CLI reads at run time.
  const packageDirectory: string = join(workspace, 'package');
  const tscPath: string = createRequire(import.meta.url).resolve('typescript/bin/tsc');
  const build: SpawnSyncReturns<string> = spawnSync(
    process.execPath,
    [
      tscPath,
      '-p', join(REPOSITORY_ROOT, 'tsconfig.json'),
      '--outDir', join(packageDirectory, 'dist'),
      '--declaration', 'false',
      '--declarationMap', 'false',
      '--sourceMap', 'false',
    ],
    { encoding: 'utf8' },
  );

  if (build.status !== 0) {
    throw new Error(`Compiling the package failed:\n${build.stdout}${build.stderr}`);
  }

  cpSync(join(REPOSITORY_ROOT, 'package.json'), join(packageDirectory, 'package.json'));
  cpSync(join(REPOSITORY_ROOT, 'protocol'), join(packageDirectory, 'protocol'), { recursive: true });
  cpSync(join(REPOSITORY_ROOT, 'examples'), join(packageDirectory, 'examples'), { recursive: true });

  // Links are junctions on Windows (no privileges needed) and directory
  // symlinks elsewhere. The first gives the compiled code its dependencies.
  symlinkSync(join(REPOSITORY_ROOT, 'node_modules'), join(packageDirectory, 'node_modules'), 'junction');
  const linkedDirectory: string = join(workspace, 'linked');
  symlinkSync(packageDirectory, linkedDirectory, 'junction');
  linkedBinPath = join(linkedDirectory, 'dist', 'bin.js');
}, BUILD_TIMEOUT_MS);

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Feature: The installed binary runs when reached through a symlink', () => {
  it('reports its version', () => {
    const run: SpawnSyncReturns<string> = runLinkedBinary(['--version']);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/^ecr \d+\.\d+\.\d+ \(ECR spec \d+\.\d+\.\d+\)/);
  });

  it('lints a conforming corpus and exits 0', () => {
    const run: SpawnSyncReturns<string> = runLinkedBinary(['lint', EXAMPLE_CORPUS]);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('no errors');
  });

  it('exits 1 on a non-conforming corpus rather than exiting silently', () => {
    const corpus: string = join(workspace, 'broken');
    mkdirSync(corpus, { recursive: true });
    writeFileSync(join(corpus, '4.2 - Contract.md'), '# 4.2 - Contract\n\nNo References section.\n', 'utf8');

    const run: SpawnSyncReturns<string> = runLinkedBinary(['lint', corpus]);

    expect(run.status, run.stdout).toBe(1);
    expect(run.stdout).toContain('ECR103');
  });

  it('finds the bundled example corpus from the installed package, whatever the working directory', () => {
    const run: SpawnSyncReturns<string> = spawnSync(process.execPath, [linkedBinPath, 'stats', '--example'], {
      encoding: 'utf8',
      cwd: workspace,
    });

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toMatch(/total edges\s+38/);
  });

  // The binary is what turns supervision on, so this is the only place the
  // whole arrangement is exercised: a real document that takes unreasonable
  // time to parse, a real child process, and a real limit stopping it.
  it('stops a corpus it cannot parse in reasonable time, and reports nothing about it', () => {
    const corpus: string = join(workspace, 'slow-to-parse');
    mkdirSync(corpus, { recursive: true });
    // Four thousand nested images parse successfully, in about a minute.
    const nested: string = `${'!['.repeat(4000)}x${'](target.md)'.repeat(4000)}`;
    writeFileSync(join(corpus, 'slow.md'), `# 1 - Slow\n\n${nested}\n\n## References\n`, 'utf8');
    const started: number = Date.now();

    const run: SpawnSyncReturns<string> = runLinkedBinary(['lint', corpus, '--timeout', '3']);

    expect(run.status, run.stdout).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('did not finish');
    expect(run.stderr).not.toContain('document(s) checked');
    // Stopped at its limit rather than run to completion.
    expect(Date.now() - started).toBeLessThan(30000);
  }, 60000);

  // A heap too small to start in is the one limit that kills the child
  // outright rather than letting it report anything, and on Windows it exits
  // with a number in the billions.
  it('exits 2 when the run dies for want of heap, rather than passing on what it died with', () => {
    const run: SpawnSyncReturns<string> = runLinkedBinary([
      'lint', EXAMPLE_CORPUS, '--max-memory', '1',
    ]);

    expect(run.status, run.stderr).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('did not finish');
    expect(run.stderr).not.toContain('v8::');
  });

  // The same guarantee as the command-line test of the child's directory, but
  // through the real executable: the corpus is named relatively, and only the
  // working directory says which one it is.
  it('lints a corpus named relatively, from the directory it was run in', () => {
    const project: string = join(workspace, 'relative-corpus');
    mkdirSync(join(project, 'docs'), { recursive: true });
    writeFileSync(
      join(project, 'docs', 'only.md'),
      '# 7.1 - The only document here\n\n## References\n',
      'utf8',
    );

    const run: SpawnSyncReturns<string> = spawnSync(
      process.execPath,
      [linkedBinPath, 'lint', 'docs'],
      { encoding: 'utf8', cwd: project },
    );

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('1 document(s) checked');
  });

  it('lints normally when the work fits well inside its limits', () => {
    const run: SpawnSyncReturns<string> = runLinkedBinary(['lint', EXAMPLE_CORPUS, '--timeout', '60']);

    expect(run.status, run.stderr).toBe(0);
    expect(run.stdout).toContain('9 document(s) checked, no errors.');
  });

  it('writes a usage error to stderr, leaving stdout empty for anything piping it', () => {
    const run: SpawnSyncReturns<string> = runLinkedBinary(['lint', join(workspace, 'missing'), '--format', 'json']);

    expect(run.status).toBe(2);
    expect(run.stdout).toBe('');
    expect(run.stderr).toContain('Directory not found');
  });
});

/**
 * Navigation Protocol Generation Tests
 *
 * The navigation protocol is authored once, in the engineering corpus, as a
 * full ECR document. The copy `ecr init` installs into a user's project is
 * generated from it with this repository's identity removed, because a DocID
 * carries no meaning in someone else's numbering space.
 *
 * Two things can go wrong. The committed artifact can fall behind its source,
 * which would ship stale guidance. Or the transform can overreach and rewrite
 * the example documents the protocol uses to teach the convention, which would
 * corrupt the very thing it explains.
 */

import { describe, it, expect } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT: string = join(TEST_DIRECTORY, '..');
const GENERATOR: string = join(REPOSITORY_ROOT, 'scripts', 'generate-navigation-protocol.mjs');
const AUTHORED: string = join(
  REPOSITORY_ROOT,
  'docs',
  'engineering',
  '0.3 - ECR Navigation Protocol for Coding Agents.md',
);
const SHIPPED: string = join(REPOSITORY_ROOT, 'protocol', 'navigation-protocol.md');

/**
 * Runs the generator, returning what it wrote.
 *
 * @param source - Path to the authored document
 * @returns The generated derivative
 */
function generateFrom(source: string): string {
  const workspace = mkdtempSync(join(tmpdir(), 'ecr-protocol-'));
  try {
    const output = join(workspace, 'generated.md');
    const run = spawnSync(process.execPath, [GENERATOR, source, output], { encoding: 'utf8' });
    expect(run.status, run.stderr).toBe(0);
    return readFileSync(output, 'utf8');
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
}

/**
 * Compares ignoring line endings, which differ by checkout platform.
 *
 * @param text - The text to normalize
 * @returns The text with LF endings
 */
function normalize(text: string): string {
  return text.replace(/\r\n/g, '\n');
}

describe('Feature: shipped navigation protocol', () => {
  it('is the current output of generating from its authored source', () => {
    expect(normalize(generateFrom(AUTHORED))).toBe(normalize(readFileSync(SHIPPED, 'utf8')));
  });

  it('removes this document identity but leaves its examples untouched', () => {
    const workspace = mkdtempSync(join(tmpdir(), 'ecr-protocol-src-'));
    try {
      const source = join(workspace, 'source.md');
      writeFileSync(
        source,
        [
          '# 0.3 - ECR Navigation Protocol',
          '',
          '## 0.3#1 - What the structure gives you',
          '',
          'An ECR document looks like this:',
          '',
          '```markdown',
          '# 4.2 - Payment Processing Contract',
          '',
          '## 8.1#3 - Retry Semantics',
          '```',
          '',
          '### 0.3#1.1 - Detail',
          '',
          'Text.',
          '',
          '## 0.3#5 - Gotchas',
          '',
          'More text.',
          '',
          '## References',
          '',
          '- 0.1 - TypeScript Engineering Standard (authority - governs)',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(generateFrom(source)).toBe(
        [
          '# ECR Navigation Protocol',
          '',
          '## 1 - What the structure gives you',
          '',
          'An ECR document looks like this:',
          '',
          '```markdown',
          '# 4.2 - Payment Processing Contract',
          '',
          '## 8.1#3 - Retry Semantics',
          '```',
          '',
          '### 1.1 - Detail',
          '',
          'Text.',
          '',
          '## 5 - Gotchas',
          '',
          'More text.',
          '',
        ].join('\n'),
      );
    } finally {
      rmSync(workspace, { recursive: true, force: true });
    }
  });
});

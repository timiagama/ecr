/**
 * Project Ignore File Tests
 *
 * `.ecrignore` sits at the project root, which the CLI takes to be the working
 * directory. These tests cover reading it, adding a pattern without
 * disturbing what a person wrote, and working out the one pattern that
 * excludes an installation directory and nothing else.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { ProjectIgnoreFile } from '../src/cli/project-ignore.js';
import type { InstallExclusion, ProjectIgnoreRead } from '../src/cli/project-ignore.js';

let project: string;

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'ecr-project-ignore-'));
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('Feature: Parsing', () => {
  it('keeps patterns and drops blank lines and comments, whatever the line endings', () => {
    expect(ProjectIgnoreFile.parse('# drafts\r\n\r\ndocs/drafts/**\n  notes.md  \n#ecr/**\n')).toEqual([
      'docs/drafts/**',
      'notes.md',
    ]);
  });
});

describe('Feature: Reading', () => {
  it('treats a missing file as normal', () => {
    expect(new ProjectIgnoreFile(project).read()).toEqual({ kind: 'missing' });
  });

  it('reads the patterns of a file that exists', () => {
    writeFileSync(join(project, '.ecrignore'), 'ecr/**\n');

    expect(new ProjectIgnoreFile(project).read()).toEqual({ kind: 'patterns', patterns: ['ecr/**'] });
  });

  it('reports a file that exists but cannot be read, rather than treating it as empty', () => {
    // A directory in its place cannot be read as a file, on every platform.
    mkdirSync(join(project, '.ecrignore'));

    const read: ProjectIgnoreRead = new ProjectIgnoreFile(project).read();

    expect(read.kind).toBe('unreadable');
  });
});

describe('Feature: Adding a pattern', () => {
  it('creates the file when there is none', () => {
    expect(new ProjectIgnoreFile(project).addPattern('ecr/**')).toBe('added');
    expect(readFileSync(join(project, '.ecrignore'), 'utf8')).toBe('ecr/**\n');
  });

  it('keeps comments and adds a line break before appending to a file without a final one', () => {
    writeFileSync(join(project, '.ecrignore'), '# ours\ndocs/drafts/**');

    new ProjectIgnoreFile(project).addPattern('ecr/**');

    expect(readFileSync(join(project, '.ecrignore'), 'utf8')).toBe('# ours\ndocs/drafts/**\necr/**\n');
  });

  it('leaves the file byte for byte as it was when it already holds the pattern', () => {
    const original: string = '# ours\r\n  ecr/**  \r\n';
    writeFileSync(join(project, '.ecrignore'), original);

    expect(new ProjectIgnoreFile(project).addPattern('ecr/**')).toBe('present');
    expect(readFileSync(join(project, '.ecrignore'), 'utf8')).toBe(original);
  });

  it('does not count a commented-out pattern as present', () => {
    writeFileSync(join(project, '.ecrignore'), '# ecr/**\n');

    expect(new ProjectIgnoreFile(project).addPattern('ecr/**')).toBe('added');
  });
});

describe('Feature: The exclusion for an installation directory', () => {
  /**
   * Works out the exclusion for a destination given relative to the project.
   *
   * @param destination - Destination relative to the project root
   * @returns The exclusion
   */
  function exclusionFor(destination: string): InstallExclusion {
    return ProjectIgnoreFile.readInstallExclusion(project, join(project, destination));
  }

  it.each([
    { destination: 'ecr', pattern: 'ecr/**' },
    { destination: 'tools/ecr-docs', pattern: 'tools/ecr-docs/**' },
    { destination: 'docs [reference]', pattern: 'docs [reference]/**' },
  ])('excludes $destination exactly', ({ destination, pattern }) => {
    expect(exclusionFor(destination)).toEqual({ kind: 'pattern', pattern });
  });

  it('refuses the working directory itself, which would exclude the whole project', () => {
    expect(exclusionFor('.').kind).toBe('invalid');
  });

  it('needs no entry for a destination outside the project', () => {
    expect(exclusionFor('../elsewhere')).toEqual({ kind: 'outside' });
  });

  it.each([
    { destination: '#notes', why: 'read as a comment' },
    { destination: 'a*b', why: 'read as a wildcard' },
    { destination: 'a?b', why: 'read as a wildcard' },
    { destination: ' ecr', why: 'trimmed away' },
  ])('refuses $destination, which .ecrignore would have $why', ({ destination }) => {
    expect(exclusionFor(destination).kind).toBe('invalid');
  });

  it('never produces a pattern that covers the whole project', () => {
    for (const destination of ['ecr', 'a/b', 'x']) {
      const exclusion: InstallExclusion = exclusionFor(destination);

      expect(exclusion.kind === 'pattern' && exclusion.pattern.startsWith('**')).toBe(false);
    }
  });
});

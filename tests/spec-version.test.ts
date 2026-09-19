/**
 * Specification Version Tests
 *
 * The implemented specification version is stated in three places: the
 * `ECR_SPEC_VERSION` constant, the specification document's version line, and
 * the README. The package and the specification are versioned independently,
 * so nothing else keeps these three in step. These tests do.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { ECR_SPEC_VERSION } from '../src/spec-version.js';
import { EcrCommandLine } from '../src/cli.js';
import type { CommandOutcome } from '../src/cli.js';

const REPOSITORY_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), '..');

/**
 * Reads a repository file as UTF-8 text.
 *
 * @param relativePath - Path relative to the repository root
 * @returns The file contents
 */
function readRepositoryFile(relativePath: string): string {
  return readFileSync(join(REPOSITORY_ROOT, relativePath), 'utf8');
}

describe('Feature: The implemented specification version is stated consistently', () => {
  it('is a semantic version', () => {
    expect(ECR_SPEC_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('matches the version line in the specification document', () => {
    const specification: string = readRepositoryFile('spec/ecr-specification.md');
    const match: RegExpExecArray | null = /^\*\*Version:\*\* (\S+)$/m.exec(specification);

    expect(match, 'the specification must carry a "**Version:** x.y.z" line').not.toBeNull();
    expect(
      match?.[1],
      'ECR_SPEC_VERSION and the specification document disagree',
    ).toBe(ECR_SPEC_VERSION);
  });

  it('matches the version the README says this repository contains', () => {
    const readme: string = readRepositoryFile('README.md').replace(/\s+/g, ' ');

    expect(
      readme,
      'the README must name the specification version the package implements',
    ).toContain(`ECR ${ECR_SPEC_VERSION} specification`);
  });
});

describe('Feature: --version reports both versions', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('prints the package version and the implemented spec version', () => {
    const manifest = JSON.parse(readRepositoryFile('package.json')) as {
      readonly version: string;
    };

    const outcome: CommandOutcome = cli.run(['--version']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output.trim()).toBe(
      `ecr ${manifest.version} (ECR spec ${ECR_SPEC_VERSION})`,
    );
  });

  it('works alongside a command', () => {
    const outcome: CommandOutcome = cli.run(['lint', '--version']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain(`ECR spec ${ECR_SPEC_VERSION}`);
  });

  it('lets --help take precedence when both are given', () => {
    const outcome: CommandOutcome = cli.run(['--help', '--version']);

    expect(outcome.exitCode).toBe(0);
    expect(outcome.output).toContain('Usage');
  });

  it('is listed in the usage text', () => {
    expect(cli.run(['--help']).output).toContain('--version');
  });
});

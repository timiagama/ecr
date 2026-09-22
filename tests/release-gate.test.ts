/**
 * Release Gate Tests
 *
 * `AGENTS.md` lists the repository's authoritative quality gates. Publishing
 * from this directory runs all of them through `prepublishOnly`, with
 * lifecycle scripts enabled, so `verify` must run exactly that list, in that
 * order. Reading the list from `AGENTS.md` keeps the script and the
 * documentation from drifting apart.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPOSITORY_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), '..');

/** The fields of `package.json` these tests read. */
interface PackageManifest {
  readonly name: string;
  readonly scripts: Readonly<Record<string, string>>;
  readonly publishConfig?: { readonly access?: string };
}

const MANIFEST: PackageManifest = JSON.parse(
  readFileSync(join(REPOSITORY_ROOT, 'package.json'), 'utf8'),
) as PackageManifest;

/**
 * Reads the commands of the Verification section's code block in `AGENTS.md`.
 *
 * @returns Each gate's command, in the documented order
 */
function readDocumentedGates(): readonly string[] {
  const agents: string = readFileSync(join(REPOSITORY_ROOT, 'AGENTS.md'), 'utf8').replaceAll('\r\n', '\n');
  const section: string = agents.slice(agents.indexOf('\n## Verification\n'));
  const block: RegExpExecArray | null = /\n```\n([\s\S]*?)\n```/.exec(section);

  if (block?.[1] === undefined) {
    throw new Error('AGENTS.md no longer has a Verification section with a command block.');
  }

  return block[1].split('\n').map((line: string): string => line.trim()).filter((line: string): boolean => line !== '');
}

describe('Feature: A publish runs every documented quality gate', () => {
  it('reads the seven gates from AGENTS.md', () => {
    expect(readDocumentedGates()).toHaveLength(7);
  });

  it('verify runs exactly the documented gates, in order', () => {
    const verify: string | undefined = MANIFEST.scripts['verify'];

    expect(verify, 'package.json must define a verify script').toBeDefined();
    expect(verify?.split(' && ')).toEqual(readDocumentedGates());
  });

  it('prepublishOnly runs verify, so publishing from this directory runs every gate', () => {
    expect(MANIFEST.scripts['prepublishOnly']).toBe('npm run verify');
  });
});

describe('Feature: The scoped package publishes publicly', () => {
  // Make the intended public visibility explicit rather than relying on defaults.
  it('declares public access for its scope', () => {
    expect(MANIFEST.name.startsWith('@')).toBe(true);
    expect(MANIFEST.publishConfig?.access).toBe('public');
  });
});

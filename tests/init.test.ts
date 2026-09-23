/**
 * init and Project-Level Linting Tests
 *
 * `init` installs the ECR documentation beside a corpus, keeping the
 * repository's layout so that the README's links work in the installed copy,
 * and adds the installation to the project's `.ecrignore`. Linting from the
 * project root must then see the user's documents and nothing of ECR's own:
 * not the installed copy, and not the package inside `node_modules`.
 *
 * Every case runs in a throwaway project with its own working directory, so
 * nothing is ever installed into, or ignored in, this repository.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  cpSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { unified } from 'unified';
import remarkParse from 'remark-parse';

import { EcrCommandLine } from '../src/cli.js';
import type { CommandOutcome } from '../src/cli.js';

const REPOSITORY_ROOT: string = join(dirname(fileURLToPath(import.meta.url)), '..');

const EXIT_SUCCESS: number = 0;
const EXIT_USAGE_ERROR: number = 2;

/** A conforming document for the user's own corpus. */
const USER_DOCUMENT: string = '# 5.1 - Payments\n\n## 5.1#1 - Scope\n\nText.\n\n## References\n';

/** What `init` must install, at these paths, relative to its destination. */
const EXPECTED_FILES: readonly string[] = [
  'README.md',
  'LICENSE',
  'NOTICE',
  'protocol/navigation-protocol.md',
  'spec/v2/1 - ECR - Structural Specification.md',
  'spec/v2/2 - ECR - User Guide.md',
  'spec/v2/3 - Design Rationale - The Section Separator.md',
  'examples/docs/README.md',
];

let project: string;
let cli: EcrCommandLine;

/**
 * Writes a file into the project, creating parent directories as needed.
 *
 * @param path - Path relative to the project root
 * @param contents - File contents
 */
function write(path: string, contents: string): void {
  const absolutePath: string = join(project, path);
  mkdirSync(dirname(absolutePath), { recursive: true });
  writeFileSync(absolutePath, contents, 'utf8');
}

/**
 * Reads a project file.
 *
 * @param path - Path relative to the project root
 * @returns Its contents
 */
function read(path: string): string {
  return readFileSync(join(project, path), 'utf8');
}

/**
 * Lists every file beneath a directory, recursively.
 *
 * @param directory - Absolute directory
 * @returns Paths relative to it, with forward slashes, sorted
 */
function listFiles(directory: string): readonly string[] {
  const found: string[] = [];

  for (const entry of readdirSync(directory, { recursive: true, encoding: 'utf8' })) {
    if (statSync(join(directory, entry)).isFile()) {
      found.push(entry.replaceAll('\\', '/'));
    }
  }

  return found.sort();
}

/**
 * Parses the `excluded` list from a JSON lint report.
 *
 * @param outcome - A `lint --format json` outcome
 * @returns The excluded paths
 */
function showExcluded(outcome: CommandOutcome): readonly string[] {
  return (JSON.parse(outcome.output) as { excluded: string[] }).excluded;
}

beforeEach(() => {
  project = mkdtempSync(join(tmpdir(), 'ecr-init-'));
  cli = new EcrCommandLine({ workingDirectory: project });
});

afterEach(() => {
  rmSync(project, { recursive: true, force: true });
});

describe('Feature: init installs the documentation with the repository layout', () => {
  it('installs into ./ecr by default, and says where to start', () => {
    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.stream).toBe('stdout');
    expect(outcome.output).toContain(join('ecr', 'README.md'));
    expect(outcome.output).toContain(join('ecr', 'protocol', 'navigation-protocol.md'));

    for (const path of EXPECTED_FILES) {
      expect(existsSync(join(project, 'ecr', path)), path).toBe(true);
    }
  });

  it('installs the packaged files unchanged', () => {
    cli.run(['init']);

    for (const path of ['README.md', 'protocol/navigation-protocol.md', 'spec/v2/2 - ECR - User Guide.md']) {
      expect(read(join('ecr', path)), path).toBe(readFileSync(join(REPOSITORY_ROOT, path), 'utf8'));
    }
  });

  it('leaves every relative link in every installed document resolving', () => {
    cli.run(['init']);
    const installed: string = join(project, 'ecr');
    const unresolved: string[] = [];
    let fileLinks: number = 0;
    let fragmentLinks: number = 0;

    for (const path of listFiles(installed).filter((file: string): boolean => file.endsWith('.md'))) {
      for (const url of collectLinkUrls(readFileSync(join(installed, path), 'utf8'))) {
        // External links and fragment-only links (the user guide's table of
        // contents) are not file-system links.
        if (/^[a-z][a-z0-9+.-]*:/i.test(url)) {
          continue;
        }

        if (url.startsWith('#')) {
          fragmentLinks += 1;
          continue;
        }

        fileLinks += 1;
        const target: string = decodeURI(url.split('#')[0] ?? '');

        if (!existsSync(resolve(installed, dirname(path), target))) {
          unresolved.push(`${path} -> ${url}`);
        }
      }
    }

    expect(fileLinks, 'the check must see real file links').toBeGreaterThan(5);
    expect(fragmentLinks, 'the user guide has a table of contents').toBeGreaterThanOrEqual(7);
    expect(unresolved).toEqual([]);
  });

  it('installs into an existing empty directory', () => {
    mkdirSync(join(project, 'ecr'));

    expect(cli.run(['init']).exitCode).toBe(EXIT_SUCCESS);
    expect(existsSync(join(project, 'ecr', 'README.md'))).toBe(true);
  });

  it('leaves the user corpus exactly as it was', () => {
    write('docs/5.1.md', USER_DOCUMENT);
    const before: string = read('docs/5.1.md');

    cli.run(['init']);

    expect(listFiles(join(project, 'docs'))).toEqual(['5.1.md']);
    expect(read('docs/5.1.md')).toBe(before);
    expect(cli.run(['lint', 'docs']).exitCode).toBe(EXIT_SUCCESS);
  });
});

describe('Feature: init refuses anything it cannot do cleanly', () => {
  it('refuses a directory that is not empty, and changes nothing', () => {
    write('docs/5.1.md', USER_DOCUMENT);

    const outcome: CommandOutcome = cli.run(['init', 'docs']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.stream).toBe('stderr');
    expect(outcome.output).toContain('not empty');
    expect(listFiles(join(project, 'docs'))).toEqual(['5.1.md']);
    expect(existsSync(join(project, '.ecrignore'))).toBe(false);
  });

  it('refuses a path that is a file', () => {
    write('ecr', 'not a directory');

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('not a directory');
  });

  it('refuses the working directory itself, which could only be excluded by excluding everything', () => {
    const outcome: CommandOutcome = cli.run(['init', '.']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(readdirSync(project)).toEqual([]);
  });

  it.each([{ name: '#notes' }, { name: ' ecr' }])('refuses "$name", which .ecrignore could not name exactly', ({ name }) => {
    const outcome: CommandOutcome = cli.run(['init', name]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(readdirSync(project)).toEqual([]);
  });

  it('shows a directory name that would reorder the message it appears in', () => {
    // A right-to-left override makes the text after it read backwards, so a
    // name carrying one could rewrite what the success message appears to
    // say. The installation itself is fine: it is the report that is made safe.
    const name: string = `ecr‮docs`;

    const outcome: CommandOutcome = cli.run(['init', name]);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.output).not.toContain('‮');
    expect(outcome.output).toContain('ecr\\u202edocs');
    expect(existsSync(join(project, name, 'README.md'))).toBe(true);
  });

  it('refuses to install when .ecrignore cannot be read, and installs nothing', () => {
    mkdirSync(join(project, '.ecrignore'));

    const outcome: CommandOutcome = cli.run(['init']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('nothing was installed');
    expect(existsSync(join(project, 'ecr'))).toBe(false);
  });
});

describe('Feature: init adds the installation to .ecrignore', () => {
  it('creates .ecrignore with exactly the installed directory', () => {
    const outcome: CommandOutcome = cli.run(['init']);

    expect(read('.ecrignore')).toBe('ecr/**\n');
    expect(outcome.output).toContain('Added ecr/** to .ecrignore');
  });

  it('adds to an existing .ecrignore without disturbing it', () => {
    write('.ecrignore', '# our drafts\ndocs/drafts/**');

    cli.run(['init']);

    expect(read('.ecrignore')).toBe('# our drafts\ndocs/drafts/**\necr/**\n');
  });

  it('leaves .ecrignore untouched when it already excludes the directory', () => {
    write('.ecrignore', 'ecr/**\n# end\n');

    const outcome: CommandOutcome = cli.run(['init']);

    expect(read('.ecrignore')).toBe('ecr/**\n# end\n');
    expect(outcome.output).toContain('already excludes it');
  });

  it('names a nested destination exactly', () => {
    cli.run(['init', 'tools/ecr-docs']);

    expect(read('.ecrignore')).toBe('tools/ecr-docs/**\n');
  });

  it('leaves .ecrignore alone for a destination outside the project', () => {
    const outside: string = mkdtempSync(join(tmpdir(), 'ecr-init-outside-'));

    try {
      const outcome: CommandOutcome = cli.run(['init', join(outside, 'ecr')]);

      expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
      expect(outcome.output).toContain('outside this directory');
      expect(existsSync(join(project, '.ecrignore'))).toBe(false);
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});

describe('Feature: Linting from the project root sees only the project', () => {
  it('skips the installed documentation through .ecrignore', () => {
    write('docs/5.1.md', USER_DOCUMENT);
    cli.run(['init']);

    const outcome: CommandOutcome = cli.run(['lint', '.', '--format', 'json']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(showExcluded(outcome)).toContain('ecr/');
    expect((JSON.parse(outcome.output) as { documents: number }).documents).toBe(1);
  });

  it('skips node_modules without init ever having run, at any depth', () => {
    write('docs/5.1.md', USER_DOCUMENT);
    // An installed copy of this package carries DocIDs 1, 2 and 3, and other
    // packages carry Markdown that is not an ECR document at all.
    write('node_modules/@timiagama/ecr/spec/v2/1 - Spec.md', '# 1 - Spec\n\n## References\n');
    write('node_modules/other/CHANGES.md', 'Not an ECR document.\n');
    write('tools/node_modules/nested/NOTES.md', 'Not one either.\n');

    const outcome: CommandOutcome = cli.run(['lint', '.', '--format', 'json']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(showExcluded(outcome)).toEqual(['node_modules/', 'tools/node_modules/']);
  });

  it('still lints a corpus root named explicitly inside node_modules', () => {
    write('node_modules/vendored/docs/5.1.md', USER_DOCUMENT);

    const outcome: CommandOutcome = cli.run(['lint', 'node_modules/vendored/docs']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('1 document(s) checked');
  });

  it('treats a root beneath an excluded directory as excluded too, without walking it', () => {
    write('.ecrignore', 'ecr/**\n');
    write('ecr/sub/broken.md', '# 9.9 - Broken\n\nNo References section.\n');

    const outcome: CommandOutcome = cli.run(['lint', 'ecr/sub']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('excluded by .ecrignore');
  });

  it('refuses to lint a root that .ecrignore excludes, rather than reporting an empty pass', () => {
    cli.run(['init']);

    const outcome: CommandOutcome = cli.run(['lint', 'ecr']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('excluded by .ecrignore');
  });
});

describe('Feature: .ecrignore and --ignore keep their own bases', () => {
  it('matches .ecrignore against the project root and --ignore against the linted directory', () => {
    const broken: string = '# 9.9 - Broken\n\nNo References section.\n';
    write('docs/5.1.md', USER_DOCUMENT);
    write('docs/drafts/draft.md', broken);
    write('docs/notes/note.md', broken);
    write('.ecrignore', 'docs/drafts/**\n');

    const outcome: CommandOutcome = cli.run(['lint', 'docs', '--ignore', 'notes/**', '--format', 'json']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(showExcluded(outcome)).toEqual(['drafts/', 'notes/']);
  });

  it('does not read .ecrignore from the linted directory', () => {
    write('docs/5.1.md', USER_DOCUMENT);
    write('docs/draft.md', '# 9.9 - Broken\n\nNo References section.\n');
    write('docs/.ecrignore', 'draft.md\n');

    expect(cli.run(['lint', 'docs']).exitCode).toBe(1);
  });

  it('fails clearly when .ecrignore cannot be read', () => {
    write('docs/5.1.md', USER_DOCUMENT);
    mkdirSync(join(project, '.ecrignore'));

    const outcome: CommandOutcome = cli.run(['lint', 'docs']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('Could not read .ecrignore');
  });

  it('never applies .ecrignore to the bundled example corpus, even inside the project', () => {
    // As installed, the package and its example sit inside the project, under
    // node_modules, where a project pattern could otherwise reach them.
    const packageRoot: string = join(project, 'node_modules', '@timiagama', 'ecr');
    cpSync(join(REPOSITORY_ROOT, 'examples'), join(packageRoot, 'examples'), { recursive: true });
    write('.ecrignore', 'node_modules/**\n');

    const installed: EcrCommandLine = new EcrCommandLine({ workingDirectory: project, packageRoot });
    const outcome: CommandOutcome = installed.run(['lint', '--example']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('9 document(s) checked');
  });

  it('still applies --ignore to the bundled example corpus', () => {
    const outcome: CommandOutcome = cli.run(['lint', '--example', '--ignore', '8. Orchestration/**', '--format', 'json']);

    expect(showExcluded(outcome)).toContain('8. Orchestration/');
  });
});

/**
 * Collects the destinations of every link and link definition in a Markdown
 * document, as the parser reads them, so that example links shown in code are
 * not mistaken for real ones.
 *
 * @param markdown - Document text
 * @returns Each link's URL
 */
function collectLinkUrls(markdown: string): readonly string[] {
  const urls: string[] = [];

  /**
   * Visits a node and its children.
   *
   * @param node - A syntax tree node
   */
  function visit(node: { type: string; url?: string; children?: unknown[] }): void {
    if ((node.type === 'link' || node.type === 'definition') && typeof node.url === 'string') {
      urls.push(node.url);
    }

    for (const child of node.children ?? []) {
      visit(child as { type: string; url?: string; children?: unknown[] });
    }
  }

  visit(unified().use(remarkParse).parse(markdown));
  return urls;
}

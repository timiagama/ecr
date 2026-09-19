/**
 * CLI Tests
 *
 * The CLI is the surface most adopters meet first, so its contract — exit
 * codes, discovery, output shape — is tested directly rather than through the
 * library beneath it.
 *
 * `EcrCommandLine.run` returns its output instead of writing to a stream, so
 * these tests exercise the real command paths without capturing stdout.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EcrCommandLine, ArgumentParser } from '../src/cli.js';
import type { CommandOutcome, ParsedArguments } from '../src/cli.js';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const REPOSITORY_ROOT: string = join(TEST_DIRECTORY, '..');
const EXAMPLE_CORPUS: string = join(REPOSITORY_ROOT, 'examples', 'docs');

const EXIT_SUCCESS: number = 0;
const EXIT_VALIDATION_FAILED: number = 1;
const EXIT_USAGE_ERROR: number = 2;

let workspace: string;

/**
 * Writes a file, creating parent directories as needed.
 *
 * @param path - Absolute path to write
 * @param contents - File contents
 */
function writeDocument(path: string, contents: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents, 'utf8');
}

beforeAll(() => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-cli-'));
});

afterAll(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe('Feature: Argument parsing', () => {
  const parser: ArgumentParser = new ArgumentParser();

  it('defaults the directory to ./docs and the format to pretty', () => {
    const parsed: ParsedArguments = parser.parse(['lint']);

    expect(parsed.command).toBe('lint');
    expect(parsed.corpusRoot).toBe('docs');
    expect(parsed.format).toBe('pretty');
    expect(parsed.ignorePatterns).toEqual([]);
  });

  it('accepts a directory, a format and repeated ignore patterns', () => {
    const parsed: ParsedArguments = parser.parse([
      'lint', './corpus', '--format', 'json', '--ignore', 'A.md', '--ignore', '**/B.md',
    ]);

    expect(parsed.corpusRoot).toBe('./corpus');
    expect(parsed.format).toBe('json');
    expect(parsed.ignorePatterns).toEqual(['A.md', '**/B.md']);
  });

  it.each([
    { argv: ['bogus'], reason: 'unknown command' },
    { argv: ['lint', '--format', 'yaml'], reason: 'unsupported format' },
    { argv: ['lint', '--format'], reason: 'format with no value' },
    { argv: ['lint', '--ignore'], reason: 'ignore with no value' },
    { argv: ['lint', '--ignore', '--format'], reason: 'ignore consuming the next option' },
    { argv: ['lint', '--wat'], reason: 'unknown option' },
    { argv: ['lint', 'a', 'b'], reason: 'two directories' },
    { argv: ['lint', 'a', '--example'], reason: 'a directory and --example together' },
    { argv: ['init', '--example'], reason: '--example with init' },
  ])('rejects $reason rather than guessing', ({ argv }) => {
    expect(() => parser.parse(argv)).toThrow();
  });
});

describe('Feature: lint', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('exits 0 on the conforming example corpus', () => {
    const outcome: CommandOutcome = cli.run(['lint', EXAMPLE_CORPUS]);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('no errors');
  });

  it('exits 0 but counts warnings in the summary when there are no errors', () => {
    const corpus: string = join(workspace, 'stale-title');
    writeDocument(join(corpus, '3.1.md'), '# 3.1 - Current Title\n\n## References\n');
    writeDocument(
      join(corpus, '5.1.md'),
      '# 5.1 - Doc\n\n## References\n\n- 3.1 - Old Title (dependency - uses it)\n',
    );

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('corpus/reference-title-mismatch');
    expect(outcome.output).toContain('no errors, 1 warning(s).');
  });

  it('lists a corpus-wide diagnostic under the document it concerns', () => {
    const corpus: string = join(workspace, 'located-corpus-diagnostic');
    writeDocument(join(corpus, '3.1.md'), '# 3.1 - Current Title\n\n## References\n');
    writeDocument(
      join(corpus, '5.1.md'),
      '# 5.1 - Doc\n\n## References\n\n- 3.1 - Old Title (dependency - uses it)\n',
    );

    const pretty: string = cli.run(['lint', corpus]).output;
    const lines: readonly string[] = pretty.split('\n');
    const warningLine: number = lines.findIndex((line) => line.includes('reference-title-mismatch'));

    expect(pretty).not.toContain('(corpus)');
    expect(lines[warningLine - 1]?.trim(), pretty).toBe('5.1.md');

    const json: { diagnostics: { path: string; ruleId: string }[] } = JSON.parse(
      cli.run(['lint', corpus, '--format', 'json']).output,
    ) as { diagnostics: { path: string; ruleId: string }[] };

    expect(json.diagnostics).toContainEqual(
      expect.objectContaining({ path: '5.1.md', ruleId: 'corpus/reference-title-mismatch' }),
    );
  });

  it('exits 1 and names the rule when a document is non-conforming', () => {
    const corpus: string = join(workspace, 'broken');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2.1 - Missing Separator', '', '## References', '', ''].join('\n'),
    );

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(outcome.output).toContain('ECR102');
    expect(outcome.output).toContain('4.2 - Contract.md');
  });

  it('excludes meta-documents without being told to', () => {
    const corpus: string = join(workspace, 'with-readme');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2#1 - Purpose', '', '## References', '', ''].join('\n'),
    );
    writeDocument(join(corpus, 'README.md'), 'Just prose, no DocID.\n');

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('meta-document(s) excluded');
  });

  it('excludes project-specific documents named by --ignore', () => {
    const corpus: string = join(workspace, 'with-checklist');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2#1 - Purpose', '', '## References', '', ''].join('\n'),
    );
    writeDocument(join(corpus, 'LAST-REVIEW.md'), 'Not part of the graph.\n');

    const withoutIgnore: CommandOutcome = cli.run(['lint', corpus]);
    expect(withoutIgnore.exitCode).toBe(EXIT_VALIDATION_FAILED);

    const withIgnore: CommandOutcome = cli.run(['lint', corpus, '--ignore', 'LAST-REVIEW.md']);
    expect(withIgnore.exitCode, withIgnore.output).toBe(EXIT_SUCCESS);
  });

  it('skips hidden directories during discovery', () => {
    const corpus: string = join(workspace, 'with-hidden');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2#1 - Purpose', '', '## References', '', ''].join('\n'),
    );
    writeDocument(join(corpus, '.git', 'COMMIT_EDITMSG.md'), 'not a document\n');

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
  });

  it('emits machine-readable output with one-based positions', () => {
    const corpus: string = join(workspace, 'json-out');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2.1 - Missing Separator', '', '## References', '', ''].join('\n'),
    );

    const outcome: CommandOutcome = cli.run(['lint', corpus, '--format', 'json']);
    const parsed: unknown = JSON.parse(outcome.output);

    expect(parsed).toMatchObject({ totals: { errors: expect.any(Number) } });

    const report = parsed as { readonly diagnostics: readonly { readonly line?: number }[] };
    const positioned = report.diagnostics.filter((d) => d.line !== undefined);

    expect(positioned.length).toBeGreaterThan(0);
    expect(
      positioned.every((d) => (d.line ?? 0) >= 1),
      'positions are reported one-based so an editor can jump to them',
    ).toBe(true);
  });
});

describe('Feature: stats', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('measures the example corpus', () => {
    const outcome: CommandOutcome = cli.run(['stats', EXAMPLE_CORPUS, '--format', 'json']);
    const statistics = JSON.parse(outcome.output) as {
      readonly documents: number;
      readonly documentsWithReferences: number;
      readonly sections: number;
      readonly docIds: number;
      readonly sectionIds: number;
      readonly referenceEntries: number;
      readonly inlineReferences: number;
      readonly sectionPreciseInlineReferences: number;
      readonly totalEdges: number;
    };

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(statistics.documents, 'README.md is excluded as a meta-document').toBe(9);
    expect(statistics.documentsWithReferences).toBe(9);
    expect(statistics.docIds).toBe(9);
    expect(statistics.sectionIds).toBe(statistics.sections);
    expect(statistics.totalEdges).toBe(
      statistics.referenceEntries + statistics.inlineReferences,
    );
    expect(
      statistics.sectionPreciseInlineReferences,
      'the example corpus exercises section-precise references',
    ).toBeGreaterThan(0);
    expect(statistics.sectionPreciseInlineReferences)
      .toBeLessThanOrEqual(statistics.inlineReferences);
  });

  it('exits 0 even when the corpus has errors, because it reports rather than judges', () => {
    const corpus: string = join(workspace, 'stats-broken');
    writeDocument(join(corpus, '4.2 - Contract.md'), '# 4.2 - Contract\n\n## 4.2.1 - Bad\n');

    const outcome: CommandOutcome = cli.run(['stats', corpus]);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
  });
});

describe('Feature: init', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('writes the navigation protocol into the corpus', () => {
    const corpus: string = join(workspace, 'init-target');
    mkdirSync(corpus, { recursive: true });

    const outcome: CommandOutcome = cli.run(['init', corpus]);
    const written: string = join(corpus, 'ECR-NAVIGATION-PROTOCOL.md');

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(existsSync(written)).toBe(true);
    expect(readFileSync(written, 'utf8')).toContain('ECR Navigation Protocol for Coding Agents');
  });

  it('leaves the corpus still linting cleanly', () => {
    // Regression: `init` writes a protocol file that carries no DocID by
    // design. Until it was added to the meta-document defaults, running the
    // two documented commands in the documented order took a conforming
    // corpus from exit 0 to exit 1.
    const corpus: string = join(workspace, 'init-then-lint');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2#1 - Purpose', '', '## References', '', ''].join('\n'),
    );

    const before: CommandOutcome = cli.run(['lint', corpus]);
    expect(before.exitCode, before.output).toBe(EXIT_SUCCESS);

    expect(cli.run(['init', corpus]).exitCode).toBe(EXIT_SUCCESS);

    const after: CommandOutcome = cli.run(['lint', corpus]);
    expect(
      after.exitCode,
      `ecr init must not break ecr lint:\n${after.output}`,
    ).toBe(EXIT_SUCCESS);
  });

  it('creates the directory when it does not exist yet', () => {
    const corpus: string = join(workspace, 'fresh-project', 'docs');

    const outcome: CommandOutcome = cli.run(['init', corpus]);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(existsSync(join(corpus, 'ECR-NAVIGATION-PROTOCOL.md'))).toBe(true);
  });

  it('refuses a path that is a file, on stderr', () => {
    const file: string = join(workspace, 'not-a-directory.md');
    writeFileSync(file, '# x', 'utf8');

    const outcome: CommandOutcome = cli.run(['init', file]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.stream).toBe('stderr');
    expect(outcome.output).toContain('not a directory');
  });

  it('refuses to overwrite an existing protocol', () => {
    const corpus: string = join(workspace, 'init-twice');
    mkdirSync(corpus, { recursive: true });

    expect(cli.run(['init', corpus]).exitCode).toBe(EXIT_SUCCESS);

    const second: CommandOutcome = cli.run(['init', corpus]);

    expect(second.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(second.output).toContain('already exists');
  });
});

describe('Feature: Usage errors', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('shows usage and exits 2 when given no arguments', () => {
    const outcome: CommandOutcome = cli.run([]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('Usage');
    expect(outcome.stream).toBe('stderr');
  });

  it('shows usage and exits 0 for --help, on stdout because it was asked for', () => {
    const outcome: CommandOutcome = cli.run(['--help']);

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('Usage');
    expect(outcome.stream).toBe('stdout');
  });

  it('reports an unknown option on stderr', () => {
    const outcome: CommandOutcome = cli.run(['lint', '--wat']);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.stream).toBe('stderr');
  });

  it('exits 2 when the directory does not exist', () => {
    const outcome: CommandOutcome = cli.run(['lint', join(workspace, 'no-such-directory')]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('Directory not found');
    expect(outcome.stream).toBe('stderr');
  });

  it('exits 2 when the directory holds no Markdown', () => {
    const corpus: string = join(workspace, 'empty');
    mkdirSync(corpus, { recursive: true });

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).toContain('No Markdown documents');
    expect(outcome.stream).toBe('stderr');
  });

  it('reports a failing corpus on stdout: the report is the result, the exit code is the signal', () => {
    const corpus: string = join(workspace, 'failing-on-stdout');
    writeDocument(join(corpus, '4.2.md'), '# 4.2 - Contract\n\nNo References section.\n');

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(outcome.stream).toBe('stdout');
  });
});

describe('Feature: --example runs against the bundled example corpus', () => {
  const cli: EcrCommandLine = new EcrCommandLine();

  it('is parsed as a flag, leaving the default directory untouched', () => {
    const parsed: ParsedArguments = new ArgumentParser().parse(['stats', '--example']);

    expect(parsed.useExample).toBe(true);
    expect(parsed.corpusRoot).toBe('docs');
  });

  it('measures the example corpus without being given its path', () => {
    const outcome: CommandOutcome = cli.run(['stats', '--example', '--format', 'json']);
    const report: { documents: number; totalEdges: number } = JSON.parse(outcome.output) as {
      documents: number;
      totalEdges: number;
    };

    expect(outcome.exitCode).toBe(EXIT_SUCCESS);
    expect(report.documents).toBe(9);
    expect(report.totalEdges).toBe(38);
  });

  it('lints the example corpus clean', () => {
    const outcome: CommandOutcome = cli.run(['lint', '--example']);

    expect(outcome.exitCode, outcome.output).toBe(EXIT_SUCCESS);
    expect(outcome.output).toContain('9 document(s) validated, no errors.');
  });
});

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
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { EcrCommandLine, ArgumentParser } from '../src/cli.js';
import type { CommandOutcome, ParsedArguments } from '../src/cli.js';
import { DiagnosticReporter } from '../src/cli/diagnostic-reporter.js';

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

/**
 * Builds a document the parser cannot read: a link label nested deeply
 * enough to exhaust the call stack inside the parser itself, which is
 * about 16 KB of Markdown.
 *
 * @param docId - The DocID for its H1
 * @returns The document's text
 */
function unparsableDocument(docId: string): string {
  const bold: string = '**'.repeat(4000);

  return `# ${docId} - Hostile\n\n[${bold}label${bold}](target.md)\n\n## References\n`;
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

  it.each([
    { command: 'lint', directory: 'docs' },
    { command: 'stats', directory: 'docs' },
    // init installs beside the corpus, never in it.
    { command: 'init', directory: 'ecr' },
  ])('defaults $command to ./$directory', ({ command, directory }) => {
    expect(parser.parse([command]).corpusRoot).toBe(directory);
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

  // "checked" is what the summary can honestly claim: a document the parser
  // could not read was attempted, and counted, but nothing in it was validated.
  it('says how many documents it checked, and how many it could not parse', { timeout: 30000 }, () => {
    const corpus: string = join(workspace, 'checked-summary');
    writeDocument(join(corpus, 'sound.md'), '# 3.1 - Sound\n\n## References\n');
    writeDocument(join(corpus, 'hostile.md'), unparsableDocument('4.2'));

    const outcome: CommandOutcome = cli.run(['lint', corpus]);

    expect(outcome.exitCode).toBe(EXIT_VALIDATION_FAILED);
    expect(outcome.output).toContain(
      '2 document(s) checked: 1 error(s), 0 warning(s). 1 document(s) could not be parsed.',
    );
  });

  it('says nothing about parsing when every document parsed', () => {
    const outcome: CommandOutcome = cli.run(['lint', EXAMPLE_CORPUS]);

    expect(outcome.output).toContain('9 document(s) checked, no errors.');
    expect(outcome.output).not.toContain('could not be parsed');
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
    expect(outcome.output).toContain('path(s) excluded');
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

  // The published searches do not follow links, so a document reached only
  // through one is outside the corpus: a reference to it stays unresolved.
  it('reports links it did not follow, and keeps a reference through one unresolved', () => {
    const corpus: string = join(workspace, 'with-link');
    const elsewhere: string = join(workspace, 'with-link-target');
    writeDocument(
      join(corpus, '5.1.md'),
      '# 5.1 - Doc\n\n## References\n\n- 3.1 - Shared (dependency - uses it)\n',
    );
    writeDocument(join(elsewhere, '3.1.md'), '# 3.1 - Shared\n\n## References\n');
    symlinkSync(elsewhere, join(corpus, 'shared'), 'junction');

    const pretty: CommandOutcome = cli.run(['lint', corpus]);

    expect(pretty.exitCode, pretty.output).toBe(EXIT_VALIDATION_FAILED);
    expect(pretty.output).toContain('corpus/unresolved-reference-target');
    expect(pretty.output).toContain('1 link(s) not followed:\n    shared\n');

    const json: { notFollowed: string[] } = JSON.parse(
      cli.run(['lint', corpus, '--format', 'json']).output,
    ) as { notFollowed: string[] };

    expect(json.notFollowed).toEqual(['shared']);
  });

  it('emits machine-readable output with one-based positions', () => {
    const corpus: string = join(workspace, 'json-out');
    writeDocument(
      join(corpus, '4.2 - Contract.md'),
      ['# 4.2 - Contract', '', '## 4.2.1 - Missing Separator', '', '## References', '', ''].join('\n'),
    );

    const outcome: CommandOutcome = cli.run(['lint', corpus, '--format', 'json']);
    const report = JSON.parse(outcome.output) as {
      readonly totals: { readonly errors: unknown };
      readonly diagnostics: readonly { readonly line?: number }[];
    };

    expect(typeof report.totals.errors).toBe('number');

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

  // What was not followed was not measured, so the measurement says so.
  it('names the links it did not follow, in text and in JSON', () => {
    const corpus: string = join(workspace, 'stats-with-link');
    const elsewhere: string = join(workspace, 'stats-with-link-target');
    writeDocument(join(corpus, '5.1.md'), '# 5.1 - Doc\n\n## References\n');
    writeDocument(join(elsewhere, '3.1.md'), '# 3.1 - Shared\n\n## References\n');
    symlinkSync(elsewhere, join(corpus, 'shared'), 'junction');

    const pretty: CommandOutcome = cli.run(['stats', corpus]);

    expect(pretty.exitCode, pretty.output).toBe(EXIT_SUCCESS);
    expect(pretty.output).toContain('1 link(s) not followed:\n    shared\n');

    const json = JSON.parse(cli.run(['stats', corpus, '--format', 'json']).output) as {
      readonly documents: number;
      readonly notFollowed: readonly string[];
    };

    expect(json.documents).toBe(1);
    expect(json.notFollowed).toEqual(['shared']);
  });

  it('says nothing about links when there are none', () => {
    const outcome: CommandOutcome = cli.run(['stats', EXAMPLE_CORPUS]);

    expect(outcome.output).not.toContain('not followed');
    expect(outcome.output.endsWith('\n')).toBe(true);
  });

  // A document the parser cannot read contributes nothing to any count, so
  // measuring the rest and saying nothing would misreport the corpus.
  it('names the documents it could not parse, in text and in JSON', { timeout: 30000 }, () => {
    const corpus: string = join(workspace, 'stats-unparsable');
    writeDocument(join(corpus, '5.1.md'), '# 5.1 - Doc\n\n## References\n');
    writeDocument(join(corpus, 'hostile.md'), unparsableDocument('2'));

    const pretty: CommandOutcome = cli.run(['stats', corpus]);

    expect(pretty.output).toContain('1 document(s) could not be parsed, so they are not counted above:');
    expect(pretty.output).toContain('hostile.md');
    expect(pretty.output).toContain('These statistics describe the rest of the corpus.');

  });

  // The JSON form of the same thing, without paying twice to parse a 16 KB
  // document that cannot be parsed: the reporter is given the summary a
  // corpus with an unreadable document produces.
  it('marks the JSON statistics incomplete and names the documents left out', () => {
    const report: string = new DiagnosticReporter('json').reportStatistics(
      {
        documents: 1,
        documentsWithReferences: 0,
        sections: 0,
        docIds: 1,
        sectionIds: 0,
        referenceEntries: 0,
        referencesByDirection: { authority: 0, constraint: 0, contract: 0, dependency: 0 },
        inlineReferences: 0,
        sectionPreciseInlineReferences: 0,
        totalEdges: 0,
        complete: false,
        unparsable: ['hostile.md'],
      },
      [],
    );

    expect(JSON.parse(report)).toMatchObject({ complete: false, unparsable: ['hostile.md'] });
  });

  it('says the statistics are complete when every document parsed', () => {
    const outcome: CommandOutcome = cli.run(['stats', EXAMPLE_CORPUS, '--format', 'json']);
    const json = JSON.parse(outcome.output) as {
      readonly complete: boolean;
      readonly unparsable: readonly string[];
    };

    expect(json.complete).toBe(true);
    expect(json.unparsable).toEqual([]);
    expect(cli.run(['stats', EXAMPLE_CORPUS]).output).not.toContain('could not be parsed');
  });

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

// init has its own suite, tests/init.test.ts, which runs every case in a
// throwaway project so that nothing is ever installed into this repository.

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
    expect(outcome.output, 'no links, so no word about links').not.toContain('not followed');
    expect(outcome.stream).toBe('stderr');
  });

  it.each([{ command: 'lint' }, { command: 'stats' }])(
    '$command names the links, and why, when links are all the directory holds',
    ({ command }) => {
      const corpus: string = join(workspace, `only-links-${command}`);
      const elsewhere: string = join(workspace, `only-links-${command}-target`);
      writeDocument(join(elsewhere, '3.1.md'), '# 3.1 - Shared\n\n## References\n');
      mkdirSync(corpus, { recursive: true });
      symlinkSync(elsewhere, join(corpus, 'shared'), 'junction');

      const outcome: CommandOutcome = cli.run([command, corpus]);

      expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
      expect(outcome.stream).toBe('stderr');
      expect(outcome.output).toContain('No Markdown documents');
      expect(outcome.output).toContain('1 link(s) not followed:\n    shared\n');
      expect(outcome.output).toContain('`rg` and `grep -r` do not follow them');
    },
  );

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
    expect(outcome.output).toContain('9 document(s) checked, no errors.');
  });
});

describe('Feature: A document cannot take over the terminal it is reported in', () => {
  const cli: EcrCommandLine = new EcrCommandLine();
  /** The character that opens an ANSI escape sequence. */
  const ESCAPE: string = '\u001b';

  /**
   * Writes a document whose title carries a screen-clearing sequence, which
   * the report quotes back.
   *
   * @param name - Directory to write it in, within the workspace
   * @returns Path of the corpus directory
   */
  function writeHostileTitle(name: string): string {
    const corpus: string = join(workspace, name);
    writeDocument(
      join(corpus, 'hostile.md'),
      `# Title ${ESCAPE}[2J${ESCAPE}[H${ESCAPE}[31mINJECTED${ESCAPE}[0m\n\n## References\n\n- 2 - Other (dependency - depends on this)\n`,
    );

    return corpus;
  }

  it('shows the escape sequences in a title rather than printing them', () => {
    const outcome: CommandOutcome = cli.run(['lint', writeHostileTitle('hostile-pretty')]);

    expect(outcome.output).not.toContain(ESCAPE);
    expect(outcome.output).toContain('\\u001b[2J');
    // The title is still reported, and still readable.
    expect(outcome.output).toContain('INJECTED');
  });

  it('leaves the JSON form as it is, where the data is escaped already', () => {
    const outcome: CommandOutcome = cli.run([
      'lint',
      writeHostileTitle('hostile-json'),
      '--format',
      'json',
    ]);
    const report: { diagnostics: readonly { message: string }[] } = JSON.parse(outcome.output) as {
      diagnostics: readonly { message: string }[];
    };

    expect(outcome.output).not.toContain(ESCAPE);
    expect(report.diagnostics[0]?.message).toContain(`${ESCAPE}[2J`);
  });

  it('shows them in a path it could not read, too', () => {
    const outcome: CommandOutcome = cli.run(['lint', join(workspace, `missing${ESCAPE}[2J`)]);

    expect(outcome.exitCode).toBe(EXIT_USAGE_ERROR);
    expect(outcome.output).not.toContain(ESCAPE);
  });
});

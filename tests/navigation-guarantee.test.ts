/**
 * Navigation Guarantee Tests
 *
 * ECR's claim is that a corpus which passes validation can be traversed with
 * the published search recipes (1#9.11). These tests hold both halves to the
 * same declared truth: the fixtures in `navigation-fixtures.ts` state what each
 * document contains, and the linter and the recipes are each checked against
 * that statement rather than against one another.
 *
 * Checking them against one another is the trap. Given `see 1#1#9` the linter
 * extracts `1#1`, and a search for `1#1` finds it; they agree, and the defect
 * survives. So the expectation is written by hand and read by neither.
 *
 * The searches run in the engines the protocol actually names -- ripgrep and
 * `grep -E` -- not in JavaScript's `RegExp`. All three disagree on Unicode word
 * boundaries, so a JavaScript stand-in proves nothing about either. See
 * `search-engines.ts`.
 *
 * Recipe patterns are built from templates, each asserted to reproduce a
 * pattern published in the protocol, so neither side can drift.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

import { Ecr } from '../src/ecr.js';
import type { CorpusDocumentInput } from '../src/ecr.js';
import type { CorpusResult, Diagnostic, LintResult } from '../src/types.js';
import { ENGINES, cleanupSearchEngines, describeEngines } from './search-engines.js';
import {
  FIXTURE_GROUPS,
  UNNAVIGABLE_FIXTURES,
  SUBJECT_URI,
} from './navigation-fixtures.js';
import type {
  ExpectedDiagnostic,
  ExpectedSearch,
  Fixture,
  UnnavigableFixture,
} from './navigation-fixtures.js';

const TEST_DIRECTORY: string = dirname(fileURLToPath(import.meta.url));
const PROTOCOL_PATH: string = join(TEST_DIRECTORY, '..', 'protocol', 'navigation-protocol.md');
const PROTOCOL_TEXT: string = readFileSync(PROTOCOL_PATH, 'utf8');

/** Scratch directory holding each fixture as a real file for the engines to search. */
let workspace: string = '';

beforeAll((): void => {
  workspace = mkdtempSync(join(tmpdir(), 'ecr-nav-'));
});

afterAll((): void => {
  rmSync(workspace, { recursive: true, force: true });
  cleanupSearchEngines();
});

/**
 * Writes a fixture's document to disk so a real search engine can read it.
 *
 * Written as UTF-8 without a BOM: a BOM would sit before the first `#` and
 * defeat every line-anchored recipe.
 *
 * @param markdown - The document's source
 * @returns Absolute path of the written file
 */
function materialise(markdown: string): string {
  const path: string = join(workspace, `fixture-${String(fileCounter++)}.md`);
  writeFileSync(path, markdown, { encoding: 'utf8' });

  return path;
}

let fileCounter: number = 0;

// ---------------------------------------------------------------------------
// Recipe templates
// ---------------------------------------------------------------------------

/**
 * Escapes an ECR identifier for use inside a recipe pattern.
 *
 * Only `.` needs escaping; `#` is literal in both engines.
 *
 * @param identifier - A DocID or SectionID
 * @returns The identifier with each `.` escaped
 */
function escapeIdentifier(identifier: string): string {
  return identifier.split('.').join('\\.');
}

/**
 * Builds the published recipe of a given kind.
 *
 * @param search - Which recipe, and the identifier to substitute
 * @returns The pattern, exactly as the protocol publishes it
 */
function buildRecipe(search: ExpectedSearch): string {
  const id: string = escapeIdentifier(search.id);

  switch (search.recipe) {
    case 'document':
      return `^# ${id}[^0-9.#]`;
    case 'section':
      return `^#+ ${id}([^0-9]|$)`;
    case 'citation':
      return `(\\b|_)([Ss]ee|[Pp]er) ${id}([^0-9A-Za-z#]|$)`;
    case 'citationDocId':
      return `(\\b|_)([Ss]ee|[Pp]er) ${id}(\\.[^0-9A-Za-z.#]|\\.$|[^0-9A-Za-z.#]|$)`;
    case 'entry':
      return `^\\s*([-*+]|[0-9]+[.)])\\s*\\[?${id}[^0-9.#]`;
    case 'direction':
      return `^\\s*([-*+]|[0-9]+[.)])\\s*\\[?${id}[^0-9.#].*\\(${search.direction ?? 'authority'}`;
    case 'referencesHeading':
      return '^## References';
    default:
      throw new Error(`unknown recipe kind: ${search.recipe as string}`);
  }
}

/**
 * Describes a search for a failure message.
 *
 * @param search - The search being described
 * @returns A short human-readable label
 */
function describeSearch(search: ExpectedSearch): string {
  return `${search.recipe}(${search.id})`;
}

// ---------------------------------------------------------------------------
// Running fixtures
// ---------------------------------------------------------------------------

/**
 * Validates a fixture's document alongside the companions it declares.
 *
 * @param fixture - The declared case
 * @returns The corpus result for the whole set
 */
function validate(fixture: Fixture | UnnavigableFixture): CorpusResult {
  const documents: CorpusDocumentInput[] = [
    { uri: SUBJECT_URI, markdownText: fixture.markdown },
    ...(fixture.companions ?? []).map((companion) => ({
      uri: companion.uri,
      markdownText: companion.markdown,
    })),
  ];

  return new Ecr().validateCorpus(documents);
}

/**
 * Collects every diagnostic attributable to the document under test.
 *
 * @param result - A corpus result
 * @returns The subject's own diagnostics followed by corpus-wide ones
 */
function subjectDiagnostics(result: CorpusResult): readonly Diagnostic[] {
  const entry = result.documents.find((candidate) => candidate.uri === SUBJECT_URI);

  return [...(entry?.result.diagnostics ?? []), ...result.diagnostics];
}

/**
 * Returns the lint result for the document under test.
 *
 * @param result - A corpus result
 * @returns The subject's lint result
 */
function subjectResult(result: CorpusResult): LintResult {
  const entry = result.documents.find((candidate) => candidate.uri === SUBJECT_URI);

  if (entry === undefined) {
    throw new Error('the document under test is missing from the corpus result');
  }

  return entry.result;
}

/**
 * Describes diagnostics compactly, for failure output.
 *
 * @param diagnostics - Diagnostics to describe
 * @returns One line per diagnostic, including any structured cause
 */
function describeDiagnostics(diagnostics: readonly Diagnostic[]): string {
  if (diagnostics.length === 0) {
    return '(none)';
  }

  return diagnostics
    .map((diagnostic) => {
      const cause: unknown = diagnostic.data?.['cause'];
      const suffix: string =
        typeof cause === 'string' ? ` [cause=${cause}]` : '';

      return `${diagnostic.severity} ${diagnostic.ruleId}${suffix}: ${diagnostic.message}`;
    })
    .join('\n');
}

// ---------------------------------------------------------------------------
// The engines, and the templates they run
// ---------------------------------------------------------------------------

describe('Feature: the search engines named by the protocol are the ones tested', () => {
  it('runs real ripgrep and real grep -E', () => {
    const description: string = describeEngines();

    expect(description).toContain('ripgrep');
    expect(description).toContain('grep');
  });

  it.each([
    { what: 'the document recipe', built: buildRecipe({ recipe: 'document', id: '8.1' }) },
    { what: 'the section recipe', built: buildRecipe({ recipe: 'section', id: '8.1#3.1' }) },
    { what: 'the citation recipe', built: buildRecipe({ recipe: 'citation', id: '8.1#3' }) },
    { what: 'the bare-DocID citation recipe', built: buildRecipe({ recipe: 'citationDocId', id: '8.1' }) },
    { what: 'the References entry recipe', built: buildRecipe({ recipe: 'entry', id: '8.1' }) },
    { what: 'the direction recipe', built: buildRecipe({ recipe: 'direction', id: '8.1', direction: 'authority' }) },
    { what: 'the References heading recipe', built: buildRecipe({ recipe: 'referencesHeading', id: '' }) },
  ])('$what appears verbatim in the protocol', ({ built }) => {
    // Patterns are published inside Markdown table cells, where a literal pipe
    // is escaped. Compare against both forms, as navigation-recipes.test.ts does.
    const escaped: string = built.split('|').join('\\|');

    expect(
      PROTOCOL_TEXT.includes(built) || PROTOCOL_TEXT.includes(escaped),
      `pattern built here but not published:\n  ${built}`,
    ).toBe(true);
  });

  it('publishes no PCRE-only construct outside the recipe marked -P', () => {
    const offenders: string[] = PROTOCOL_TEXT.split(/\r?\n/)
      .filter((line: string): boolean => line.includes('rg ') && !/\brg\b[^"]*\s-P\s/.test(line))
      .filter((line: string): boolean => /\(\?[:=!<]/.test(line));

    expect(
      offenders,
      'POSIX ERE has no non-capturing group or lookaround, and the protocol\n' +
        'advertises grep -E as its fallback. Under grep -E a `(?:a|b)` group\n' +
        'stops matching the common case silently, without an error.',
    ).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// Declared extraction
// ---------------------------------------------------------------------------

describe.each([
  { group: 'malformed # targets', fixtures: FIXTURE_GROUPS.malformedTargets },
  { group: 'numeric prose', fixtures: FIXTURE_GROUPS.numericProse },
  { group: 'valid citations', fixtures: FIXTURE_GROUPS.validCitations },
  { group: 'References entries', fixtures: FIXTURE_GROUPS.referenceEntries },
])('Feature: the linter extracts what the fixture declares -- $group', ({ fixtures }) => {
  it.each(fixtures.map((fixture) => ({ name: fixture.name, fixture })))(
    'extracts the declared sections and edges for $name',
    ({ fixture }) => {
      const lint: LintResult = subjectResult(validate(fixture));

      expect(lint.extracted?.docId).toBe(fixture.docId);

      expect((lint.extracted?.sections ?? []).map((section) => section.id)).toEqual(
        fixture.sections,
      );

      expect(
        (lint.extracted?.inlineReferences ?? []).map((edge) => edge.toId),
        'inline edges must be exactly those declared -- no truncated extras',
      ).toEqual(fixture.inlineTargets);

      expect(
        (lint.extracted?.references ?? []).map((edge) => ({
          toId: edge.toDocId,
          direction: edge.direction,
          title: edge.title,
          explanation: edge.explanation,
        })),
      ).toEqual(fixture.referenceEdges);
    },
  );

  it.each(fixtures.map((fixture) => ({ name: fixture.name, fixture })))(
    'reports exactly the declared diagnostics for $name',
    ({ fixture }) => {
      const diagnostics: readonly Diagnostic[] = subjectDiagnostics(validate(fixture));

      expect(
        diagnostics.length,
        `expected ${String(fixture.diagnostics.length)} diagnostic(s), got:\n` +
          describeDiagnostics(diagnostics),
      ).toBe(fixture.diagnostics.length);

      fixture.diagnostics.forEach((expected, index) => {
        const actual: Diagnostic | undefined = diagnostics[index];

        expect(actual?.ruleId).toBe(expected.ruleId);
        expect(actual?.severity).toBe(expected.severity);
        expect(
          actual?.message.toLowerCase(),
          'the diagnostic must state the declared reason, not merely fail',
        ).toContain(expected.because.toLowerCase());
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Discoverability, in both real engines
// ---------------------------------------------------------------------------

describe('Feature: what a passing document declares is what the searches find', () => {
  const clean: readonly Fixture[] = [
    ...FIXTURE_GROUPS.numericProse,
    ...FIXTURE_GROUPS.validCitations,
    ...FIXTURE_GROUPS.referenceEntries,
  ].filter((fixture) => fixture.diagnostics.length === 0);

  describe.each(ENGINES.map((engine) => ({ engine: engine.name, run: engine.run })))(
    'in $engine',
    ({ engine: engineName, run }) => {
      it.each(clean.map((fixture) => ({ name: fixture.name, fixture })))(
        'finds every declared identifier in $name',
        ({ fixture }) => {
          const path: string = materialise(fixture.markdown);

          const required: ExpectedSearch[] = [
            ...fixture.sections.map(
              (id): ExpectedSearch => ({
                recipe: id === fixture.docId ? 'document' : 'section',
                id,
              }),
            ),
            // A bare DocID is found by a different published recipe from a
            // SectionID: the section form can end at a word boundary, while a
            // bare DocID needs the trailing group that says what may follow it.
            // Routing both through `citation` would leave the bare-DocID
            // recipe with negative controls only -- and it is the one whose
            // terminator group is being repaired.
            ...fixture.inlineTargets.map(
              (id): ExpectedSearch => ({
                recipe: id.includes('#') ? 'citation' : 'citationDocId',
                id,
              }),
            ),
            ...fixture.referenceEdges.map(
              (edge): ExpectedSearch => ({ recipe: 'entry', id: edge.toId }),
            ),
            ...fixture.referenceEdges.map(
              (edge): ExpectedSearch => ({
                recipe: 'direction',
                id: edge.toId,
                direction: edge.direction,
              }),
            ),
            ...(fixture.referenceEdges.length > 0
              ? [{ recipe: 'referencesHeading', id: '' } as ExpectedSearch]
              : []),
          ];

          for (const search of required) {
            const pattern: string = buildRecipe(search);

            expect(
              run(pattern, path).length,
              `${describeSearch(search)} was declared but the search found nothing:\n` +
                `  ${pattern}`,
            ).toBeGreaterThan(0);
          }
        },
      );

      it.each(
        clean
          .filter((fixture) => (fixture.notFindable ?? []).length > 0)
          .map((fixture) => ({ name: fixture.name, fixture })),
      )('finds nothing the fixture declares absent in $name', ({ fixture }) => {
        const path: string = materialise(fixture.markdown);

        for (const search of fixture.notFindable ?? []) {
          if (search.engine !== undefined && search.engine !== engineName) {
            continue;
          }

          const pattern: string = buildRecipe(search);

          expect(
            run(pattern, path),
            `${describeSearch(search)} must not match: the specification says this ` +
              `text is prose, not a citation, so a search that finds it would send ` +
              `an agent to a reference that does not exist.\n  ${pattern}`,
          ).toEqual([]);
        }
      });

      it.each(
        clean
          .filter((fixture) => (fixture.permittedHits ?? []).length > 0)
          .map((fixture) => ({ name: fixture.name, fixture })),
      )('finds the permitted non-reference hits in $name', ({ fixture }) => {
        const path: string = materialise(fixture.markdown);

        // The linter extracted nothing here, which the extraction suite
        // asserts. What is asserted now is that the search still matches:
        // the recipes are deliberately broader than the reference grammar.
        expect(fixture.inlineTargets).toEqual([]);

        for (const search of fixture.permittedHits ?? []) {
          if (search.engine !== undefined && search.engine !== engineName) {
            continue;
          }

          const pattern: string = buildRecipe(search);

          expect(
            run(pattern, path).length,
            `${describeSearch(search)} was declared a permitted hit, but the search ` +
              `found nothing. If the recipe was narrowed on purpose, remove the ` +
              `declaration and update 1#9.11.\n  ${pattern}`,
          ).toBeGreaterThan(0);
        }
      });
    },
  );
});

// ---------------------------------------------------------------------------
// Source forms no recipe can reach
// ---------------------------------------------------------------------------

/**
 * Asserts a set of diagnostics matches what a fixture declared, exhaustively.
 *
 * @param actual - Diagnostics produced
 * @param expected - Diagnostics declared
 * @param label - Which set is being checked, for the failure message
 */
function expectDeclaredDiagnostics(
  actual: readonly Diagnostic[],
  expected: readonly ExpectedDiagnostic[],
  label: string,
): void {
  expect(
    actual.length,
    `expected ${String(expected.length)} ${label} diagnostic(s), got:
` +
      describeDiagnostics(actual),
  ).toBe(expected.length);

  expected.forEach((declared, index) => {
    const found: Diagnostic | undefined = actual[index];

    expect(found?.ruleId, `${label} diagnostic ${String(index)} rule`).toBe(declared.ruleId);
    expect(found?.severity, `${label} diagnostic ${String(index)} severity`).toBe(
      declared.severity,
    );

    if (declared.cause !== undefined) {
      expect(
        found?.data?.['cause'],
        `${label} diagnostic ${String(index)} must carry a machine-readable cause`,
      ).toBe(declared.cause);
    }

    expect(
      found?.message.toLowerCase(),
      `${label} diagnostic ${String(index)} must explain the cause it carries`,
    ).toContain(declared.because.toLowerCase());
  });
}

describe('Feature: source forms the recipes cannot reach are rejected', () => {
  it.each(UNNAVIGABLE_FIXTURES.map((fixture) => ({ name: fixture.name, fixture })))(
    'rejects $name',
    ({ fixture }) => {
      const result: CorpusResult = validate(fixture);
      const lint: LintResult = subjectResult(result);

      expect(
        lint.ok,
        fixture.documentOk
          ? 'this form is only identifiable once the corpus is known, so the ' +
            'document alone must still pass'
          : 'an unnavigable document must not pass validation on its own',
      ).toBe(fixture.documentOk);

      expectDeclaredDiagnostics(lint.diagnostics, fixture.documentDiagnostics, 'document');
      expectDeclaredDiagnostics(result.diagnostics, fixture.corpusDiagnostics, 'corpus');

      expect(
        (lint.extracted?.inlineReferences ?? []).map((edge) => edge.toId),
        'an unnavigable citation must yield no edge: reporting the error while ' +
          'keeping the edge leaves a graph that cannot be traversed',
      ).toEqual(fixture.inlineTargets);

      expect(
        (lint.extracted?.references ?? []).map((edge) => ({
          toId: edge.toDocId,
          direction: edge.direction,
          title: edge.title,
          explanation: edge.explanation,
        })),
        'References edges must be exactly those declared: a parseable entry in the ' +
          'wrong source form is still read, and a malformed one yields nothing',
      ).toEqual(fixture.referenceEdges);
    },
  );
});


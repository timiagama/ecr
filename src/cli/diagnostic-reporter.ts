/**
 * Diagnostic Reporting
 *
 * Renders validation results for a terminal or for a machine. The pretty form
 * groups diagnostics by document and prints a `path:line:column` prefix so an
 * editor can jump to them; the JSON form is the same data unformatted, for CI
 * and for tooling built on top of the CLI.
 */

import { showControlCharacters } from './safe-text.js';
import { UNPARSABLE_DOCUMENT_RULE_ID } from '../per-document-visitor.js';
import type { CorpusResult, Diagnostic, DiagnosticSeverity } from '../types.js';
import type { CorpusStatisticsReport, DirectionCounts } from './corpus-statistics.js';

/**
 * Output formats the CLI can produce.
 */
export type ReportFormat = 'pretty' | 'json';

/**
 * A diagnostic together with the document it belongs to.
 */
interface LocatedDiagnostic {
  /** Corpus-relative path of the document, or `(corpus)` when a diagnostic names no known document. */
  readonly path: string;
  /** The diagnostic itself. */
  readonly diagnostic: Diagnostic;
}

/**
 * Counts of diagnostics by severity.
 */
export interface SeverityTotals {
  /** Diagnostics that make the corpus non-conforming. */
  readonly errors: number;
  /** Diagnostics that warrant attention but do not fail validation. */
  readonly warnings: number;
  /** Informational diagnostics. */
  readonly infos: number;
}

/** Label used for a diagnostic whose URI matches no validated document. */
const CORPUS_SCOPE_LABEL: string = '(corpus)';

/**
 * Formats corpus validation results and statistics for output.
 */
export class DiagnosticReporter {
  /** The format to render in. */
  private readonly format: ReportFormat;

  /**
   * Creates a reporter.
   *
   * @param format - The output format to produce
   */
  public constructor(format: ReportFormat) {
    this.format = format;
  }

  /**
   * Renders a corpus validation result.
   *
   * @param corpusResult - The result to render
   * @param excludedPaths - Paths skipped as meta-documents or by ignore pattern
   * @param notFollowedPaths - Links beneath the corpus root that were not followed
   * @returns The text to write to standard output
   */
  public reportValidation(
    corpusResult: CorpusResult,
    excludedPaths: readonly string[],
    notFollowedPaths: readonly string[],
  ): string {
    const located: readonly LocatedDiagnostic[] = this.collectDiagnostics(corpusResult);
    const totals: SeverityTotals = this.countSeverities(located);

    if (this.format === 'json') {
      return JSON.stringify(
        {
          documents: corpusResult.documents.length,
          excluded: excludedPaths,
          notFollowed: notFollowedPaths,
          totals,
          diagnostics: located.map((entry: LocatedDiagnostic) => ({
            path: entry.path,
            ruleId: entry.diagnostic.ruleId,
            severity: entry.diagnostic.severity,
            message: entry.diagnostic.message,
            ...(entry.diagnostic.range !== undefined
              ? {
                  // Positions are zero-based internally; editors are one-based.
                  line: entry.diagnostic.range.start.line + 1,
                  column: entry.diagnostic.range.start.character + 1,
                }
              : {}),
          })),
        },
        null,
        2,
      );
    }

    return this.renderPretty(corpusResult, located, totals, excludedPaths, notFollowedPaths);
  }

  /**
   * Renders a statistics report.
   *
   * @param statistics - The measured summary to render
   * @param notFollowedPaths - Links beneath the corpus root that were not followed, and so not measured
   * @returns The text to write to standard output
   */
  public reportStatistics(
    statistics: CorpusStatisticsReport,
    notFollowedPaths: readonly string[],
  ): string {
    if (this.format === 'json') {
      return JSON.stringify({ ...statistics, notFollowed: notFollowedPaths }, null, 2);
    }

    const direction: DirectionCounts = statistics.referencesByDirection;
    const links: readonly string[] = DiagnosticReporter.listNotFollowed(notFollowedPaths);
    // A document the parser could not read contributes nothing to any of
    // these numbers, so saying which ones, and that the numbers are therefore
    // partial, is the difference between a measurement and a misreading.
    const unparsable: readonly string[] =
      statistics.unparsable.length === 0
        ? []
        : [
            `  ${String(statistics.unparsable.length)} document(s) could not be parsed, ` +
            'so they are not counted above:',
            ...statistics.unparsable.map((path: string): string => `    ${path}`),
            '  These statistics describe the rest of the corpus.',
            '',
          ];
    const lines: readonly string[] = [
      '',
      '  Corpus structure',
      '  ────────────────',
      `  documents                      ${String(statistics.documents)}`,
      `    with a References section    ${String(statistics.documentsWithReferences)}`,
      `  sections                       ${String(statistics.sections)}`,
      '',
      `  unique DocIDs                  ${String(statistics.docIds)}`,
      `  unique SectionIDs              ${String(statistics.sectionIds)}`,
      '',
      `  References entries             ${String(statistics.referenceEntries)}`,
      `    authority                    ${String(direction.authority)}`,
      `    constraint                   ${String(direction.constraint)}`,
      `    contract                     ${String(direction.contract)}`,
      `    dependency                   ${String(direction.dependency)}`,
      '',
      `  inline see/per references      ${String(statistics.inlineReferences)}`,
      `    section-precise              ${String(statistics.sectionPreciseInlineReferences)}`,
      '',
      `  total edges                    ${String(statistics.totalEdges)}`,
      '',
      ...unparsable,
      ...links,
      ...(links.length > 0 ? [''] : []),
    ];

    return showControlCharacters(lines.join('\n'));
  }

  /**
   * Counts the documents the parser could not read.
   *
   * @param corpusResult - The result being reported
   * @returns How many documents produced an unparsable-document diagnostic
   */
  private static countUnparsable(corpusResult: CorpusResult): number {
    return corpusResult.documents.filter((entry): boolean =>
      entry.result.diagnostics.some(
        (diagnostic: Diagnostic): boolean => diagnostic.ruleId === UNPARSABLE_DOCUMENT_RULE_ID,
      ),
    ).length;
  }

  /**
   * Lists the links a walk did not follow, by name: unlike an exclusion,
   * nobody asked for them to be skipped.
   *
   * @param notFollowedPaths - Links beneath the corpus root that were not followed
   * @returns Lines to print; none when there are no such links
   */
  public static listNotFollowed(notFollowedPaths: readonly string[]): readonly string[] {
    if (notFollowedPaths.length === 0) {
      return [];
    }

    return [
      `  ${String(notFollowedPaths.length)} link(s) not followed:`,
      ...notFollowedPaths.map((path: string): string => `    ${path}`),
    ];
  }

  /**
   * Renders the human-readable form of a validation result.
   *
   * @param corpusResult - The result being rendered
   * @param located - Diagnostics paired with their document paths
   * @param totals - Severity counts across the corpus
   * @param excludedPaths - Paths skipped during discovery
   * @param notFollowedPaths - Links beneath the corpus root that were not followed
   * @returns The text to write to standard output
   */
  private renderPretty(
    corpusResult: CorpusResult,
    located: readonly LocatedDiagnostic[],
    totals: SeverityTotals,
    excludedPaths: readonly string[],
    notFollowedPaths: readonly string[],
  ): string {
    const lines: string[] = [''];

    let currentPath: string | undefined = undefined;
    for (const entry of located) {
      if (entry.path !== currentPath) {
        lines.push(`  ${entry.path}`);
        currentPath = entry.path;
      }

      const position: string =
        entry.diagnostic.range !== undefined
          ? `${String(entry.diagnostic.range.start.line + 1)}:` +
            String(entry.diagnostic.range.start.character + 1)
          : '-';

      lines.push(
        `    ${position.padEnd(8)} ${entry.diagnostic.severity.padEnd(7)} ` +
        `${entry.diagnostic.ruleId.padEnd(10)} ${entry.diagnostic.message}`,
      );
    }

    if (located.length > 0) {
      lines.push('');
    }

    const documentCount: string = String(corpusResult.documents.length);

    // "checked" covers every document the command attempted, which is not the
    // same as every document having been validated: one the parser could not
    // read was attempted and counted, but nothing in it was validated. Those
    // are then stated outright, and their errors are in the total already.
    const unparsableCount: number = DiagnosticReporter.countUnparsable(corpusResult);
    const unparsableNote: string =
      unparsableCount > 0
        ? ` ${String(unparsableCount)} document(s) could not be parsed.`
        : '';

    if (totals.errors === 0 && totals.warnings > 0) {
      lines.push(
        `  ${documentCount} document(s) checked, no errors, ` +
        `${String(totals.warnings)} warning(s).${unparsableNote}`,
      );
    } else if (totals.errors === 0) {
      lines.push(`  ${documentCount} document(s) checked, no errors.${unparsableNote}`);
    } else {
      lines.push(
        `  ${documentCount} document(s) checked: ` +
        `${String(totals.errors)} error(s), ${String(totals.warnings)} warning(s).${unparsableNote}`,
      );
    }

    if (excludedPaths.length > 0) {
      lines.push(`  ${String(excludedPaths.length)} path(s) excluded.`);
    }

    lines.push(...DiagnosticReporter.listNotFollowed(notFollowedPaths));

    lines.push('');

    // Every line here can carry text quoted from a document or a path from
    // the disk, so the whole report is made safe to print in one place.
    return showControlCharacters(lines.join('\n'));
  }

  /**
   * Flattens per-document and corpus-wide diagnostics into one ordered list,
   * grouped by document.
   *
   * A corpus-wide diagnostic still names the document it concerns — a
   * duplicate DocID, an unresolved reference or a stale References title each
   * belong to a specific file — so it is listed under that document, after the
   * document's own diagnostics. Only a corpus-wide diagnostic whose URI matches
   * no validated document falls back to the `(corpus)` label.
   *
   * @param corpusResult - The result to read
   * @returns Diagnostics paired with the path they belong to, in document order
   */
  private collectDiagnostics(corpusResult: CorpusResult): readonly LocatedDiagnostic[] {
    const located: LocatedDiagnostic[] = [];
    const documentUris: ReadonlySet<string> = new Set(
      corpusResult.documents.map((entry): string => entry.uri),
    );

    for (const entry of corpusResult.documents) {
      for (const diagnostic of entry.result.diagnostics) {
        located.push({ path: entry.uri, diagnostic });
      }

      for (const diagnostic of corpusResult.diagnostics) {
        if (diagnostic.uri === entry.uri) {
          located.push({ path: entry.uri, diagnostic });
        }
      }
    }

    for (const diagnostic of corpusResult.diagnostics) {
      if (!documentUris.has(diagnostic.uri)) {
        located.push({ path: CORPUS_SCOPE_LABEL, diagnostic });
      }
    }

    return located;
  }

  /**
   * Counts diagnostics by severity.
   *
   * @param located - The diagnostics to count
   * @returns Totals per severity
   */
  private countSeverities(located: readonly LocatedDiagnostic[]): SeverityTotals {
    let errors: number = 0;
    let warnings: number = 0;
    let infos: number = 0;

    for (const entry of located) {
      const severity: DiagnosticSeverity = entry.diagnostic.severity;

      if (severity === 'error') {
        errors += 1;
      } else if (severity === 'warning') {
        warnings += 1;
      } else {
        infos += 1;
      }
    }

    return { errors, warnings, infos };
  }
}

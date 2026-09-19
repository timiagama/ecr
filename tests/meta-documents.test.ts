/**
 * Meta-Document Filter Tests
 *
 * ECR governs architectural documents. A corpus also contains documents that
 * deliberately sit outside the reference graph — READMEs, agent instruction
 * files, contributing guides — and reporting those as structurally invalid is
 * noise that teaches adopters to ignore the linter.
 *
 * File discovery is the host's responsibility, so these tests exercise the
 * filter a host applies when assembling a corpus.
 */

import { describe, it, expect } from 'vitest';
import { MetaDocumentFilter, DEFAULT_META_DOCUMENT_NAMES } from '../src/meta-documents.js';

describe('Feature: Conventional meta-documents are recognised', () => {
  const filter: MetaDocumentFilter = new MetaDocumentFilter();

  it.each([
    { path: 'README.md' },
    { path: 'readme.md' },
    { path: 'ReadMe.MD' },
    { path: 'CLAUDE.md' },
    { path: 'AGENTS.md' },
    { path: 'CONTRIBUTING.md' },
    { path: 'CHANGELOG.md' },
    { path: 'LICENSE.md' },
    { path: 'LICENCE.md' },
    { path: 'docs/README.md' },
    { path: '0. Orientation/README.md' },
  ])('"$path" is a meta-document', ({ path }) => {
    expect(
      filter.shouldExclude(path),
      `expected "${path}" to be excluded from ECR validation`,
    ).toBe(true);
  });

  it.each([
    { path: '0.0 - System Overview.md' },
    { path: '4. Payments/4.2 - Payment Processing Contract.md' },
    { path: 'readme-driven-development.md' },
    { path: 'docs/licenses-explained.md' },
    { path: 'changelog-format.md' },
  ])('"$path" is an architectural document', ({ path }) => {
    expect(
      filter.shouldExclude(path),
      `expected "${path}" to be validated, not excluded`,
    ).toBe(false);
  });

  it('matches on the whole filename, not a substring of it', () => {
    // "readme-driven-development" contains "readme" but is not a README.
    expect(filter.isMetaDocument('readme-driven-development.md')).toBe(false);
    expect(filter.isMetaDocument('README.md')).toBe(true);
  });

  it('handles a file with no extension', () => {
    expect(filter.isMetaDocument('LICENSE')).toBe(true);
    expect(filter.isMetaDocument('4.2 - Contract')).toBe(false);
  });

  it('exposes its defaults so a host can extend rather than replace them', () => {
    expect(DEFAULT_META_DOCUMENT_NAMES).toContain('readme');
    expect(DEFAULT_META_DOCUMENT_NAMES).toContain('claude');
    expect(DEFAULT_META_DOCUMENT_NAMES.length).toBeGreaterThan(0);
  });
});

describe('Feature: Project-specific documents are excluded by ignore pattern', () => {
  it('excludes a named file', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['LAST-REVIEW.md']);

    expect(filter.shouldExclude('LAST-REVIEW.md')).toBe(true);
    expect(filter.shouldExclude('0.0 - System Overview.md')).toBe(false);
  });

  it('supports a single-segment wildcard that does not cross directories', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['*-CHECKLIST.md']);

    expect(filter.shouldExclude('UI-UX-REVIEW-CHECKLIST.md')).toBe(true);
    expect(filter.shouldExclude('docs/UI-UX-REVIEW-CHECKLIST.md')).toBe(false);
  });

  it('supports a recursive wildcard that does cross directories', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['**/*-CHECKLIST.md']);

    expect(filter.shouldExclude('docs/UI-UX-REVIEW-CHECKLIST.md')).toBe(true);
    expect(filter.shouldExclude('a/b/c/REVIEW-CHECKLIST.md')).toBe(true);
    expect(filter.shouldExclude('docs/4.2 - Contract.md')).toBe(false);
  });

  it('excludes a whole directory', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['_drafts/**']);

    expect(filter.shouldExclude('_drafts/4.2 - Draft.md')).toBe(true);
    expect(filter.shouldExclude('_drafts/deep/4.2 - Draft.md')).toBe(true);
    expect(filter.shouldExclude('4. Payments/4.2 - Contract.md')).toBe(false);
  });

  it('treats regex metacharacters in a pattern literally', () => {
    // A naive implementation would read "." and "+" as regex syntax.
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['notes(draft).md']);

    expect(filter.shouldExclude('notes(draft).md')).toBe(true);
    expect(filter.shouldExclude('notesXdraftY.md')).toBe(false);
  });

  it('anchors patterns so a partial match does not exclude', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter(['draft.md']);

    expect(filter.shouldExclude('draft.md')).toBe(true);
    expect(filter.shouldExclude('final-draft.md')).toBe(false);
    expect(filter.shouldExclude('docs/draft.md')).toBe(false);
  });

  it('accepts a caller-supplied meta-document name list', () => {
    const filter: MetaDocumentFilter = new MetaDocumentFilter([], ['notes']);

    expect(filter.shouldExclude('NOTES.md')).toBe(true);
    expect(
      filter.shouldExclude('README.md'),
      'a replacement list replaces the defaults rather than extending them',
    ).toBe(false);
  });
});

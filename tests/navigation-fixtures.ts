/**
 * Navigation Guarantee Fixtures
 *
 * Every fixture below states, by hand, what its document contains and what
 * should be reported about it. Nothing here is derived from the linter, and
 * nothing is derived from the search recipes. That independence is the whole
 * point of the file.
 *
 * The obvious way to test the navigation guarantee is to ask whether a search
 * finds what the linter extracted. That test is worthless precisely where it
 * matters most: given `see 1#1#9`, the linter extracts `1#1` and a search for
 * `1#1` matches it too. Both are wrong in the same way, they agree, and the
 * test passes. So the expectation has to come from a third place -- written
 * down, read by neither -- and both are checked against it.
 *
 * Diagnostics are declared by rule and by reason, not merely by severity. A
 * fixture asserting only "this fails" proves nothing: `see 1#1oops` fails today
 * for the wrong reason (an undeclared target), and a test that accepted any
 * failure would pass while the defect it was written for remained.
 */

/** Severity as 1#12 classifies it. */
export type ExpectedSeverity = 'error' | 'warning' | 'info';

/** A diagnostic a fixture expects, identified by its cause rather than its text. */
export interface ExpectedDiagnostic {
  /** Rule that must report it, e.g. `ECR104` or `corpus/unresolved-inline-target`. */
  readonly ruleId: string;
  /** Severity 1#12 assigns to this finding. */
  readonly severity: ExpectedSeverity;
  /** Fragment the message must contain, so the reason is asserted and not just the outcome. */
  readonly because: string;
  /**
   * Machine-readable cause in `data.cause`, where the rule defines one.
   *
   * A message fragment alone is not enough: `because: 'References'` is
   * satisfied by today's generic "References section has no list items", the
   * wrong problem reported for the right document.
   */
  readonly cause?: string;
}

/** A document-level edge a fixture declares, field by field. */
export interface ExpectedReferenceEdge {
  /** Target DocID. */
  readonly toId: string;
  /** Direction label. */
  readonly direction: 'authority' | 'dependency' | 'constraint' | 'contract';
  /** Title exactly as it should be parsed out of the entry. */
  readonly title: string;
  /** Explanation exactly as it should be parsed out of the entry. */
  readonly explanation: string;
}

/** A document that must be present so a fixture's targets resolve. */
export interface CompanionDocument {
  readonly uri: string;
  readonly markdown: string;
}

/** One declared case: a document, and the truth about it. */
export interface Fixture {
  /** Short name used in test titles. */
  readonly name: string;
  /** The document under test. */
  readonly markdown: string;
  /** DocID the document defines. */
  readonly docId: string;
  /** Every SectionID the document defines, in document order. */
  readonly sections: readonly string[];
  /** Every inline target an edge should be extracted for, in document order. */
  readonly inlineTargets: readonly string[];
  /** Every References edge, field by field. */
  readonly referenceEdges: readonly ExpectedReferenceEdge[];
  /** Every diagnostic expected, by rule and reason. Empty means the document is clean. */
  readonly diagnostics: readonly ExpectedDiagnostic[];
  /** Other documents the corpus must contain for this case to mean what it says. */
  readonly companions?: readonly CompanionDocument[];
  /**
   * Searches that must find nothing in this document.
   *
   * Declared, not derived. Asserting only the positives would let a recipe
   * match text the specification says is not a reference -- the published
   * bare-DocID pattern does exactly that for `per 60s` -- and nothing would
   * notice, because no fixture asks the question.
   */
  readonly notFindable?: readonly ExpectedSearch[];
  /**
   * Searches that must match although the linter extracts no edge.
   *
   * The guarantee runs one way (1#9.11): every reference the linter recognises
   * is found, but not every hit is a reference. The recipes read raw source,
   * where markup can sit between a number and the unit that makes it prose,
   * so `per 60**s**` is a hit for document 60 and not an edge. Declaring the
   * hit pins that asymmetry down, so that neither side changes it by accident.
   */
  readonly permittedHits?: readonly ExpectedSearch[];
}

/** A recipe published in the navigation protocol. */
export type RecipeKind =
  | 'document'
  | 'section'
  | 'citation'
  | 'citationDocId'
  | 'entry'
  | 'direction'
  | 'referencesHeading';

/** A search, and the identifier it is applied to. */
export interface ExpectedSearch {
  /** Which published recipe to run. */
  readonly recipe: RecipeKind;
  /** The identifier to substitute into it; ignored by `referencesHeading`. */
  readonly id: string;
  /** For `direction`, the label the recipe filters on. */
  readonly direction?: string;
  /**
   * Restricts the expectation to one engine.
   *
   * The two published engines do not agree on every input. Where they differ,
   * the expectation still has to be stated for the engine it holds for --
   * dropping it entirely would give up a real assertion to avoid a false one.
   */
  readonly engine?: 'ripgrep' | 'grep -E';
}

// ---------------------------------------------------------------------------
// Companions
// ---------------------------------------------------------------------------

/** Document `1`, carrying section `1#1`, so truncated targets would resolve. */
const DOCUMENT_ONE: CompanionDocument = {
  uri: 'one.md',
  markdown: `# 1 - Alpha

## 1#1 - First

Body.

## References

- 2 - Beta (contract - consumer)
`,
};

/**
 * Document `1` under a chosen title.
 *
 * A References entry's title is checked against its target's H1
 * (`corpus/reference-title-mismatch`), so a fixture exercising an unusual title
 * must give the target that same title. Otherwise the fixture would fail on a
 * stale-title warning and prove nothing about what it was written for.
 *
 * @param title - The H1 title document `1` should carry
 * @returns Document `1` with that title
 */
function alphaTitled(title: string): CompanionDocument {
  return {
    uri: 'one.md',
    markdown: `# 1 - ${title}

## 1#1 - First

Body.

## References

- 2 - Beta (contract - consumer)
`,
  };
}

/** Document `60`, so numeric prose could be mistaken for a citation to it. */
const DOCUMENT_SIXTY: CompanionDocument = {
  uri: 'sixty.md',
  markdown: `# 60 - Sixty

Body.

## References

- 2 - Beta (contract - consumer)
`,
};

/** Document `8.1`, carrying section `8.1#3`, used by the discoverability cases. */
const DOCUMENT_EIGHT_ONE: CompanionDocument = {
  uri: 'eight-one.md',
  markdown: `# 8.1 - Orchestration

## 8.1#3 - Retry

Body.

## References

- 2 - Beta (contract - consumer)
`,
};

/**
 * Wraps a body in a document declaring `1` and `8.1`, so that a target which
 * ought to resolve does resolve, and a failure can only be about form.
 *
 * @param body - Markdown placed between the H1 and the References section
 * @param entries - References entries, already formatted
 * @returns A complete document with DocID `2`
 */
function documentTwo(body: string, entries: string): string {
  return `# 2 - Beta

## 2#1 - Uses

${body}

## References

${entries}
`;
}


/**
 * The same document with CRLF line endings.
 *
 * Every other fixture uses LF, and a defect that only appears under CRLF
 * therefore reached the corpus checks rather than this suite. A Windows clone
 * with `core.autocrlf=true` produces CRLF for every file in the repository, so
 * it is the common case for this project's own contributors.
 *
 * @param body - Markdown placed between the H1 and the References section
 * @param entries - References entries, already formatted
 * @returns A complete document with DocID `2`, using CRLF throughout
 */
function documentTwoCrlf(body: string, entries: string): string {
  return documentTwo(body, entries).split('\n').join('\r\n');
}

/** The standard declaration block: both companions declared. */
const DECLARES_BOTH: string = `- 1 - Alpha (dependency - provides the first section)
- 8.1 - Orchestration (dependency - provides the retry contract)`;

/** The entry declaring document 1, as {@link DECLARES_BOTH} writes it. */
const EDGE_ALPHA: ExpectedReferenceEdge = {
  toId: '1',
  direction: 'dependency',
  title: 'Alpha',
  explanation: 'provides the first section',
};

/** The entry declaring document 8.1, as {@link DECLARES_BOTH} writes it. */
const EDGE_ORCHESTRATION: ExpectedReferenceEdge = {
  toId: '8.1',
  direction: 'dependency',
  title: 'Orchestration',
  explanation: 'provides the retry contract',
};

/** The edges {@link DECLARES_BOTH} yields, in order. */
const DECLARES_BOTH_EDGES: readonly ExpectedReferenceEdge[] = [EDGE_ALPHA, EDGE_ORCHESTRATION];

// ---------------------------------------------------------------------------
// Malformed `#` targets -- 1#9.5 rule 1
//
// Each target is present in the corpus AND declared in References, so an
// undeclared-target error cannot be what makes these fail. What must fail is
// the token itself.
// ---------------------------------------------------------------------------

const MALFORMED_TARGETS: readonly Fixture[] = [
  {
    name: 'a second separator (see 1#1#9)',
    markdown: documentTwo('Retries are bounded see 1#1#9 in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a dangling separator (see 1#)',
    markdown: documentTwo('Retries are bounded see 1# in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an identifier running into a word (see 1#1oops)',
    markdown: documentTwo('Retries are bounded see 1#1oops in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // Formatting does not exempt a candidate from being taken whole. These
  // passed with no diagnostic when the wrapped text was matched by a prefix
  // pattern of its own.
  {
    name: 'a second separator inside bold (see **1#1#9**)',
    markdown: documentTwo('Retries are bounded see **1#1#9** in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a dangling separator inside bold (see **1#**)',
    markdown: documentTwo('Retries are bounded see **1#** in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // The reader sees `1#1x`. The text node ends at `1#1` only because the bold
  // begins there, and treating that as a terminator extracted a silent edge.
  {
    name: 'an identifier running into a bold word (see 1#1**x**)',
    markdown: documentTwo('Retries are bounded see 1#1**x** in the first section.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [{ ruleId: 'ECR104', severity: 'error', because: 'malformed' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
];

// ---------------------------------------------------------------------------
// Numeric prose -- 1#9.5 rule 1, disposition without `#`
//
// The third configuration is the one that matters: today, `per 60s` in a corpus
// containing document `60` silently produces a real edge to it.
// ---------------------------------------------------------------------------

const NUMERIC_PROSE: readonly Fixture[] = [
  {
    name: 'a unit suffix, no such document (per 60s)',
    markdown: documentTwo('The limit is 100 requests per 60s.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a unit suffix where that document exists but is undeclared (per 60s)',
    markdown: documentTwo('The limit is 100 requests per 60s.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a unit suffix where that document exists and is declared (per 60s)',
    markdown: documentTwo(
      'The limit is 100 requests per 60s.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a millisecond figure (per 10ms)',
    markdown: documentTwo('Checkpoints are written once per 10ms.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '10' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a range, where truncation would resolve (see 1..2)',
    markdown: documentTwo('Stages see 1..2 run in order.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '1' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // Emphasis does not turn prose into a reference. All three configurations
  // are declared because each failed differently: a warning with no such
  // document, a warning plus a corpus error when it existed undeclared, and a
  // local error once it was declared.
  {
    name: 'a bold unit suffix, no such document (per **60s**)',
    markdown: documentTwo('The limit is 100 requests per **60s**.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bold unit suffix where that document exists but is undeclared (per **60s**)',
    markdown: documentTwo('The limit is 100 requests per **60s**.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a bold unit suffix where that document exists and is declared (per **60s**)',
    markdown: documentTwo(
      'The limit is 100 requests per **60s**.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },

  // The candidate is read on past the end of the formatting, so the unit that
  // follows it still makes it prose.
  {
    name: 'a unit suffix after a bold number (per **60**s)',
    markdown: documentTwo(
      'The limit is 100 requests per **60**s.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },

  // The mirror image: a literal number whose unit is formatted. The text node
  // ends at `60` only because the formatting begins there, and taking that as
  // a terminator extracted a real edge to document 60 from prose.
  //
  // In the source, `60` is directly followed by markup, so the bare-DocID
  // recipe matches. That hit is permitted (1#9.11): the recipes are broader
  // than the reference grammar, and are declared so here.
  {
    name: 'a bold unit suffix after a literal number (per 60**s**)',
    markdown: documentTwo(
      'The limit is 100 requests per 60**s**.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a code-span unit suffix after a literal number (per 60`s`)',
    markdown: documentTwo(
      'The limit is 100 requests per 60`s`.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },

  // Inline HTML other than a line break separates nothing a reader sees, so
  // `60<span>s</span>` reads as `60s`. Treating every tag as whitespace made
  // these into silent edges to document 60.
  {
    name: 'a unit suffix inside an inline tag (per 60<span>s</span>)',
    markdown: documentTwo(
      'The limit is 100 requests per 60<span>s</span>.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  // Preservation controls for the tag-name rule: an ordinary tag or comment
  // holding a quoted `>` stays transparent, and so does a tag whose name
  // merely begins with `br`.
  {
    name: 'a unit suffix inside a tag whose attribute holds ">" (per 60<span title="x > y">s</span>)',
    markdown: documentTwo(
      'The limit is 100 requests per 60<span title="x > y">s</span>.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a unit suffix after a comment holding ">" (per 60<!-- x > y -->s)',
    markdown: documentTwo(
      'The limit is 100 requests per 60<!-- x > y -->s.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a unit suffix inside a tag whose name begins with "br" (per 60<bra>s</bra>)',
    markdown: documentTwo(
      'The limit is 100 requests per 60<bra>s</bra>.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  {
    name: 'a unit suffix after an HTML comment (per 60<!-- note -->s)',
    markdown: documentTwo(
      'The limit is 100 requests per 60<!-- note -->s.',
      `${DECLARES_BOTH}\n- 60 - Sixty (dependency - unrelated to the prose above)`,
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
      { toId: '60', direction: 'dependency', title: 'Sixty', explanation: 'unrelated to the prose above' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citationDocId', id: '60' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
];

// ---------------------------------------------------------------------------
// Sentence punctuation must still resolve -- 1#9.5 rule 1, trailing `.`
// ---------------------------------------------------------------------------

const VALID_CITATIONS: readonly Fixture[] = [
  {
    name: 'a citation ending a sentence (see 8.1#3.)',
    markdown: documentTwo('Retries follow see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // A candidate is now read on past the end of its text node, into whatever
  // follows on the line. These guard the other direction: formatting around a
  // whole citation, and inline nodes that end a line or a word, must still
  // leave it a citation.
  {
    name: 'a whole citation in bold (**see 8.1#3**)',
    markdown: documentTwo('Retries follow **see 8.1#3** exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a whole citation in italics ending a sentence (*see 8.1#3*.)',
    markdown: documentTwo('Retries follow *see 8.1#3*.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation followed by inline HTML (see 8.1#3<br>)',
    markdown: documentTwo('Retries follow see 8.1#3<br>exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation before a hard line break',
    markdown: documentTwo('Retries follow see 8.1#3  \nexactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation inside a table cell',
    markdown: documentTwo('| Rule | Source |\n| --- | --- |\n| retries | see 8.1#3 |', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  // Underscore emphasis is ordinary Markdown, and `_` is a word character to
  // both engines, so a `\b`-anchored recipe missed all three of these on both
  // sides while the linter extracted their edges.
  {
    name: 'a bare DocID citation in underscore emphasis (_see 8.1_)',
    markdown: documentTwo('Retries follow _see 8.1_ exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation in double underscores (__see 8.1__)',
    markdown: documentTwo('Retries follow __see 8.1__ exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a SectionID citation in underscore emphasis (_see 8.1#3_)',
    markdown: documentTwo('Retries follow _see 8.1#3_ exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation before a <br> tag',
    markdown: documentTwo('Retries follow see 8.1<br>exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // A `br` tag is a break whatever it carries. Only attribute-free spellings
  // were recognised, so these read as `8.1#3next` -- a malformed-target
  // error -- and `8.1next`, a citation silently dropped.
  {
    name: 'a SectionID citation before a <br> with attributes',
    markdown: documentTwo('Retries follow see 8.1#3<br class="x">next.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation before a <br> with attributes',
    markdown: documentTwo('Retries follow see 8.1<br class="x">next.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // A `>` inside a quoted attribute does not close the tag. The parser
  // delimits the tag correctly; matching its attributes a second time took
  // the first `>` as the end, and the break for transparent HTML.
  {
    name: 'a SectionID citation before a <br> whose attribute holds ">"',
    markdown: documentTwo('Retries follow see 8.1#3<br title="x > y">next.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation before a <br> whose attribute holds ">"',
    markdown: documentTwo('Retries follow see 8.1<br title="x > y">next.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: "a bare DocID citation before a <br> whose single-quoted attribute holds '>'",
    markdown: documentTwo("Retries follow see 8.1<br title='x > y'>next.", DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // Inline code may continue a candidate, but never starts one (1#9.5 rule 1):
  // an identifier in code is an example, not a citation.
  {
    name: 'an identifier in inline code after the keyword is not a citation',
    markdown: documentTwo('Retries follow see `8.1#3` as an example.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citation', id: '8.1#3' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // The keyword side of the same question. A keyword at the start of a text
  // node is preceded by whatever came before the node, and here the reader
  // sees `xsee`. The recipe matches, because markup sits between `x` and the
  // keyword in the source; that hit is permitted, and declared.
  {
    name: 'a keyword run into a bold word before it (**x**see 8.1#3)',
    markdown: documentTwo('Retries follow **x**see 8.1#3 exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citation', id: '8.1#3' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a keyword run into a word through an inline tag (x<span>see 8.1#3</span>)',
    markdown: documentTwo('Retries follow x<span>see 8.1#3</span> exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    permittedHits: [{ recipe: 'citation', id: '8.1#3' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation inside quotation marks ("see 8.1#3")',
    markdown: documentTwo('The rule reads "see 8.1#3" in full.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bold title beside a literal identifier',
    markdown: `# 2 - Beta

## 2#1 - **Uses** the contract

Retries follow see 8.1#3 exactly.

## References

${DECLARES_BOTH}
`,
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // Heading forms the source-form check must leave alone: closing hashes are
  // after the identifier, where no recipe looks, and CRLF line endings are
  // not part of the line a recipe matches.
  {
    name: 'headings with optional closing hashes',
    markdown: `# 2 - Beta #

## 2#1 - Uses ##

Retries follow see 8.1#3 exactly.

## References

${DECLARES_BOTH}
`,
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    // The mark is the whole first line, so the H1 begins a later line, which
    // both engines find. Only a mark that obstructs a heading is rejected.
    name: 'a byte-order mark on a line of its own before the H1',
    markdown: `\uFEFF\n# 2 - Beta\n\n## 2#1 - Uses\n\nRetries follow see 8.1#3 exactly.\n\n## References\n\n${DECLARES_BOTH}\n`,
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'headings in a CRLF document',
    markdown: documentTwoCrlf('Retries follow see 8.1#3 exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation that is declared',
    markdown: documentTwo('Validation follows see 1 closely.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare DocID citation ending a sentence',
    markdown: documentTwo('Validation follows see 1.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a non-breaking space after a SectionID',
    markdown: documentTwo('Retries follow see 8.1#3\u00A0exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an em space after a bare DocID',
    markdown: documentTwo('Validation follows see 1\u2003exactly.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['1'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a keyword preceded by a letter is not a citation',
    markdown: documentTwo('The word esee 8.1#3 is not a keyword.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a keyword preceded by an accented letter is not a citation',
    markdown: documentTwo('The word \u00E9see 8.1#3 is not a keyword either.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    notFindable: [{ recipe: 'citation', id: '8.1#3' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a combining mark before the keyword is not a boundary',
    markdown: documentTwo('Use e\u0301see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    // The engines disagree here: ripgrep finds nothing, GNU grep matches. The
    // linter follows the stricter engine, so the assertion is stated for that
    // engine rather than abandoned. ECR guarantees that what it extracts is
    // findable, never that every search hit is a reference.
    notFindable: [{ recipe: 'citation', id: '8.1#3', engine: 'ripgrep' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'connector punctuation before the keyword is not a boundary',
    markdown: documentTwo('Use \u203Fsee 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    // The engines disagree here: ripgrep finds nothing, GNU grep matches. The
    // linter follows the stricter engine, so the assertion is stated for that
    // engine rather than abandoned. ECR guarantees that what it extracts is
    // findable, never that every search hit is a reference.
    notFindable: [{ recipe: 'citation', id: '8.1#3', engine: 'ripgrep' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a supplementary letter before the keyword is not a boundary',
    markdown: documentTwo('Use \u{10400}see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    // The engines disagree here: ripgrep finds nothing, GNU grep matches. The
    // linter follows the stricter engine, so the assertion is stated for that
    // engine rather than abandoned. ECR guarantees that what it extracts is
    // findable, never that every search hit is a reference.
    notFindable: [{ recipe: 'citation', id: '8.1#3', engine: 'ripgrep' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // An emoji is not a word character, so the keyword stands at a boundary.
  // An ASCII-class recipe missed this in GNU grep 3.0, which does not match a
  // character outside the Basic Multilingual Plane with a negated bracket;
  // the `(\b|_)` recipe finds it in both engines.
  {
    name: 'an emoji directly before the keyword',
    markdown: documentTwo('Use \u{1F512}see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an emoji directly before a bold citation',
    markdown: documentTwo('Use \u{1F512}**see 8.1#3** here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an emoji and a space before the keyword',
    markdown: documentTwo('Use \u{1F512} see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bold "see" before a valid citation',
    markdown: documentTwo('We **see** examples; use see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character-reference "see" before a valid citation',
    markdown: documentTwo('We s&#101;e examples; use see 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character reference before a citation',
    markdown: documentTwo('A &amp; B; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character reference after a citation',
    markdown: documentTwo('Use see 8.1#3 with A &amp; B.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a multi-character reference before a citation',
    markdown: documentTwo('Use &fjlig; notation; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an escaped backslash before a citation',
    markdown: documentTwo('Path C:\\\\ then see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a bare ampersand that is not a reference',
    markdown: documentTwo('A & B; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation on a blockquote continuation line',
    markdown: documentTwo('> Intro\n> see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation on a list continuation line',
    markdown: documentTwo('- Intro\n  see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation on an indented continuation line',
    markdown: documentTwo('Intro\n  see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'adjacent character references',
    markdown: documentTwo('A &amp;&amp; B; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character reference beside escapes',
    markdown: documentTwo('A &amp; \\\\*B\\\\*; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an unknown entity name left literal',
    markdown: documentTwo('A &NotAnEntity; B; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an encoded newline before a citation',
    markdown: documentTwo('A &#10; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'text after a citation repeating its own characters',
    markdown: documentTwo('Use see 8.1#3 and &fjlig;j', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation after a character reference that resembles a keyword',
    markdown: documentTwo('Use &#101;see 8.1#2; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character reference terminating an identifier',
    markdown: documentTwo('Use see 8.1#3&nbsp;here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an encoded punctuation mark terminating an identifier',
    markdown: documentTwo('Use see 8.1#3&#33;', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation in a multi-line paragraph with CRLF endings',
    markdown: documentTwoCrlf('Retries follow\nsee 8.1#3 here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation on the first line of a CRLF paragraph',
    markdown: documentTwoCrlf('Retries see 8.1#3\ncontinue here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing space on the line before a citation',
    markdown: documentTwo('Before \nsee 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing tab on the line before a citation',
    markdown: documentTwo('Before\\t\nsee 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing space on the citation own line',
    markdown: documentTwo('Use see 8.1#3 \nthen here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing space inside a blockquote',
    markdown: documentTwo('> Before \n> see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing space with CRLF endings',
    markdown: documentTwoCrlf('Before \nsee 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a trailing space after a citation with CRLF endings',
    markdown: documentTwoCrlf('Use see 8.1#3 \nthen here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a literal CR followed by an encoded line feed',
    markdown: documentTwo('Before\r&#10;see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a literal CR followed by a named line feed',
    markdown: documentTwo('Before\r&NewLine;see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a literal CR and encoded line feed after a citation',
    markdown: documentTwo('Use see 8.1#3\r&#10;then here.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a real CRLF break followed by a character reference',
    markdown: documentTwo('Before\r\n&amp; see 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an encoded CR followed by a literal line feed',
    markdown: documentTwo('Before&#13;\nsee 8.1#3.', DECLARES_BOTH),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: ['8.1#3'],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
      { toId: '8.1', direction: 'dependency', title: 'Orchestration', explanation: 'provides the retry contract' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
];

// ---------------------------------------------------------------------------
// References entry parsing -- 1#9.6
//
// The first two already parse correctly today and must survive the rewrite.
// The third is the defect: the last `" ("` currently wins, and the edge is
// typed `contract` instead of `dependency`.
// ---------------------------------------------------------------------------

const REFERENCE_ENTRIES: readonly Fixture[] = [
  {
    name: 'a parenthesis in the title (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha (draft) (dependency - still provisional)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (draft)', explanation: 'still provisional' },
    ],
    diagnostics: [],
    companions: [alphaTitled('Alpha (draft)')],
  },
  {
    name: 'an unmatched bracket in the title (preservation)',
    markdown: documentTwo('Body.', '- 1 - Close ) operator (dependency - names an operator)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Close ) operator', explanation: 'names an operator' },
    ],
    diagnostics: [],
    companions: [alphaTitled('Close ) operator')],
  },
  {
    name: 'a nested parenthetical in the explanation',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - defines retries (contract - policy))'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      {
        toId: '1',
        direction: 'dependency',
        title: 'Alpha',
        explanation: 'defines retries (contract - policy)',
      },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a bracketed aside in the explanation',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - defines retries (including backoff))'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      {
        toId: '1',
        direction: 'dependency',
        title: 'Alpha',
        explanation: 'defines retries (including backoff)',
      },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an ordered marker with a full stop',
    markdown: documentTwo('Body.', '1. 1 - Alpha (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an ordered marker with a bracket',
    markdown: documentTwo('Body.', '1) 1 - Alpha (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a star marker',
    markdown: documentTwo('Body.', '* 1 - Alpha (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a plus bullet',
    markdown: documentTwo('Body.', '+ 1 - Alpha (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'formatting inside the explanation',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - provides the **first** section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an explanation continuing on the next line',
    markdown: documentTwo(
      'Body.',
      '- 1 - Alpha (dependency - provides the first section, and goes on\n  at some length about why that matters)',
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      {
        toId: '1',
        direction: 'dependency',
        title: 'Alpha',
        explanation: 'provides the first section, and goes on\nat some length about why that matters',
      },
    ],
    diagnostics: [],
    companions: [alphaTitled('Alpha')],
  },
  {
    // The recipes allow one `[` before the target, so a linked DocID is found.
    name: 'a target DocID written as a link',
    markdown: documentTwo('Body.', '- [1](one.md) - Alpha (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    // The mirror of the unmatched `)` above: the parenthetical is matched from
    // the final `)`, so an unmatched `(` in the title is left to the title.
    name: 'an unmatched opening parenthesis in the title (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha (beta (dependency - provides the first section)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (beta', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [alphaTitled('Alpha (beta')],
  },
  {
    // The control for the title-names-the-direction rejections: with the
    // label written literally, the title's own parentheses are harmless.
    name: 'a title that names a direction, beside a literal label (preservation)',
    markdown: documentTwo(
      'Body.',
      '- 1 - Alpha (dependency graph) (dependency - provides the first section)',
    ),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (dependency graph)', explanation: 'provides the first section' },
    ],
    diagnostics: [],
    companions: [alphaTitled('Alpha (dependency graph)')],
  },

  // Markup that adds or removes parentheses between source and parsed text.
  // The relationship parenthetical is the parser's: balancing the raw source
  // separately chose a different `(` for each of these and rejected them,
  // although both published recipes find every one.
  {
    name: 'an encoded opening parenthesis in the explanation (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - supports &#40;draft))'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'supports (draft)' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an encoded closing parenthesis balancing a literal one (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - supports (draft&#41;)'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'supports (draft)' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a relationship parenthetical in bold (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha **(dependency - provides the first section)**'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    // 1#9.5 keeps citations out of inline code; no rule keeps References
    // entries out of it, and both recipes find the literal `(dependency`.
    name: 'a relationship parenthetical in inline code (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha `(dependency - provides the first section)`'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    // A double fence with padding spaces: the parser strips one space from
    // each side, so the source position of `(` is not simply after the fence.
    name: 'a relationship parenthetical in a padded double-backtick code span (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha `` (dependency - provides the first section) ``'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a link destination holding ")" in the explanation (preservation)',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - see [guide](<https://example.test/a)b>))'),
    docId: '2',
    sections: ['2', '2#1'],
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha', explanation: 'see guide' },
    ],
    diagnostics: [],
    companions: [DOCUMENT_ONE],
  },
];

// ---------------------------------------------------------------------------
// Source forms the recipes cannot find -- 1#9.11
//
// Every one of these validates today and extracts what it should. That is the
// defect: the document passes and no recipe can reach it.
// ---------------------------------------------------------------------------

/** A source form that must be rejected because no recipe can find it. */
export interface UnnavigableFixture {
  /** Short name used in test titles. */
  readonly name: string;
  /** The document under test. */
  readonly markdown: string;
  /**
   * Whether single-document linting alone should reject it.
   *
   * Not every unnavigable form is visible to one document. A bare DocID that
   * only the corpus can confirm is a real reference is a warning on its own and
   * an error once the corpus is known, so the two outcomes are declared
   * separately rather than collapsed into "it fails".
   */
  readonly documentOk: boolean;
  /**
   * Inline edges the document must yield despite the error.
   *
   * An unnavigable citation must extract nothing: emitting the right
   * diagnostic while keeping the edge would leave a graph nobody can traverse.
   */
  readonly inlineTargets: readonly string[];
  /**
   * Every References edge the document must yield despite the error, field
   * by field.
   *
   * Required, so that no rejection case can leave it unsaid. A References
   * entry in the wrong source form, or a misplaced section, is reported and
   * its entries still read: withholding them would make every citation of
   * those documents undeclared. A malformed entry yields no edge at all.
   * Without this, neither half of that was asserted anywhere.
   */
  readonly referenceEdges: readonly ExpectedReferenceEdge[];
  /**
   * Every diagnostic single-document linting must produce -- no more, no fewer.
   *
   * Declared exhaustively rather than as "at least one match". An assertion
   * that merely finds the expected warning also accepts a spurious corpus
   * error alongside it, which is the opposite of what the unknown wrapped
   * DocID fixture exists to prove.
   */
  readonly documentDiagnostics: readonly ExpectedDiagnostic[];
  /** Every corpus-wide diagnostic, declared with the same exhaustiveness. */
  readonly corpusDiagnostics: readonly ExpectedDiagnostic[];
  /** Companions needed for targets to resolve, so form is the only thing at fault. */
  readonly companions?: readonly CompanionDocument[];
}

const UNNAVIGABLE: readonly UnnavigableFixture[] = [
  {
    name: 'an identifier wrapped in bold in a heading',
    markdown: `# 2 - Beta

## **2#1** - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a setext heading carrying an identifier',
    markdown: `# 2 - Beta

2#1 - Uses
----------

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an indented heading',
    markdown: `# 2 - Beta

   ## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a tab between the hashes and the identifier',
    markdown: `# 2 - Beta

##\t2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  // Further heading forms the parser accepts and no recipe finds. Each parses
  // to the identifier 2#1; none puts `## 2#1` at the start of a line.
  {
    name: 'two spaces between the hashes and the identifier',
    markdown: `# 2 - Beta

##  2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a backslash escape inside a heading identifier',
    markdown: `# 2 - Beta

## 2\\#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a character reference inside a heading identifier',
    markdown: `# 2 - Beta

## 2&#35;1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a numbered heading inside a blockquote',
    markdown: `# 2 - Beta

> ## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  // Correctly written headings that are not at the start of a search line.
  // Markdown ends a line at a lone CR; ripgrep and grep end one only at LF,
  // so each heading below is, to a search, the middle of the line before it.
  {
    name: 'a section heading after a lone carriage return',
    markdown: `# 2 - Beta\n\nLead\r## 2#1 - Uses\n\nBody.\n\n## References\n\n${DECLARES_BOTH}\n`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'carriage return' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an H1 after a lone carriage return',
    markdown: `Lead\r# 2 - Beta\n\n## 2#1 - Uses\n\nBody.\n\n## References\n\n${DECLARES_BOTH}\n`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'carriage return' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // A byte-order mark sits before the first line's `#` in the raw file.
  // ripgrep skips it; GNU grep does not, and finds no H1.
  {
    name: 'an H1 directly after a byte-order mark',
    markdown: `\uFEFF# 2 - Beta\n\n## 2#1 - Uses\n\nBody.\n\n## References\n\n${DECLARES_BOTH}\n`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'byte-order mark' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation split across a line break',
    markdown: documentTwo('Retries follow see\n8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'one line' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a backslash escape inside a citation',
    markdown: documentTwo('Retries follow see 8\\.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'two spaces between keyword and identifier',
    markdown: documentTwo('Retries follow see  8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'one line' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a wrapped identifier in a citation',
    markdown: documentTwo('Retries follow see **8.1#3** exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a formatted References heading',
    markdown: `# 2 - Beta

## 2#1 - Uses

Body.

## **References**

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-heading-source-form', because: 'References' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a References section inside a blockquote',
    markdown: `# 2 - Beta

## 2#1 - Uses

Body.

> ## References
>
> - 1 - Alpha (dependency - provides the first section)
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-placement', because: 'References' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  // Two more placements the recipes cannot reach: a list that sits in a
  // container after a top-level heading, and a section inside a list item.
  // Each is reported once, as misplaced, and its entries are still read.
  {
    name: 'a References list inside a blockquote after a top-level heading',
    markdown: `# 2 - Beta

## 2#1 - Uses

Body.

## References

> - 1 - Alpha (dependency - provides the first section)
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-placement', because: 'References' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a References section inside a list item',
    markdown: `# 2 - Beta

## 2#1 - Uses

Body.

- ## References

  - 1 - Alpha (dependency - provides the first section)
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-placement', because: 'References' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },

  // Nesting at any depth. Looking one container deep lost this list: the
  // section was reported as empty and its declaration silently dropped.
  {
    name: 'a References list nested two containers deep',
    markdown: `# 2 - Beta

## 2#1 - Uses

Body.

## References

> > - 1 - Alpha (dependency - provides the first section)
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-placement', because: 'References' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },

  // The title must not answer for the parenthetical. Checking only that
  // `(dependency` occurred somewhere on the line accepted both of these,
  // because the title supplies it.
  {
    name: 'a formatted direction label beside a title that names the direction',
    markdown: documentTwo(
      'Body.',
      '- 1 - Alpha (dependency graph) (**dependency** - provides the first section)',
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (dependency graph)', explanation: 'provides the first section' },
    ],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [alphaTitled('Alpha (dependency graph)')],
  },
  {
    name: 'a relationship parenthetical on the next line after a title that names the direction',
    markdown: documentTwo(
      'Body.',
      '- 1 - Alpha (dependency graph)\n  (dependency - provides the first section)',
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (dependency graph)', explanation: 'provides the first section' },
    ],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'one line' }],
    corpusDiagnostics: [],
    companions: [alphaTitled('Alpha (dependency graph)')],
  },

  // The same transformations in the other direction. A raw `)` in a link
  // destination made the separate source balance land on the title's `(`,
  // so the title again excused a formatted label. And a `(` that exists only
  // as a character reference is no literal label, whatever it parses to.
  {
    name: 'a link destination holding ")" beside a formatted label and a title naming the direction',
    markdown: documentTwo(
      'Body.',
      '- 1 - Alpha (dependency graph (**dependency** - [guide](<https://example.test/a)b>))',
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [
      { toId: '1', direction: 'dependency', title: 'Alpha (dependency graph', explanation: 'guide' },
    ],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [alphaTitled('Alpha (dependency graph')],
  },
  {
    // The mirror of the code-span preservation cases: here only the label is
    // in code, so a backtick sits between `(` and the label in the source.
    name: 'a direction label alone in inline code',
    markdown: documentTwo('Body.', '- 1 - Alpha (`dependency` - provides the first section)'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a relationship parenthetical opened by a character reference',
    markdown: documentTwo('Body.', '- 1 - Alpha &#40;dependency - provides the first section)'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },

  // The References heading's line is `## References` exactly. The check
  // numbered headings share allows a suffix after the identifier, which let
  // these through.
  {
    name: 'a References heading with closing hashes',
    markdown: documentTwo('Body.', DECLARES_BOTH).replace('## References', '## References ##'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-heading-source-form', because: 'exactly' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a References heading with trailing spaces',
    markdown: documentTwo('Body.', DECLARES_BOTH).replace('## References', '## References   '),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-heading-source-form', because: 'exactly' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },

  // Lone carriage returns hide the References section from the anchored
  // recipes exactly as they hide headings. The all-CR document is the case
  // carried over from the heading work: its section heading, its References
  // heading and its entry each follow a lone CR.
  {
    name: 'a References heading after a lone carriage return',
    markdown: `# 2 - Beta\n\n## 2#1 - Uses\n\nBody.\n\nLead\r## References\n\n- 1 - Alpha (dependency - provides the first section)\n`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-heading-source-form', because: 'carriage return' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a References entry after a lone carriage return',
    markdown: `# 2 - Beta\n\n## 2#1 - Uses\n\nBody.\n\n## References\n\n- 8.1 - Orchestration (dependency - provides the retry contract)\r- 1 - Alpha (dependency - provides the first section)\n`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ORCHESTRATION, EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'carriage return' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a document using lone carriage returns throughout',
    markdown: `# 2 - Beta\r\r## 2#1 - Uses\r\rBody.\r\r## References\r\r- 1 - Alpha (dependency - provides the first section)\r`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [
      { ruleId: 'ECR102', severity: 'error', cause: 'heading-source-form', because: 'carriage return' },
      { ruleId: 'ECR103', severity: 'error', cause: 'references-heading-source-form', because: 'carriage return' },
      { ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'carriage return' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an entry whose direction label is on the next line',
    markdown: documentTwo('Body.', '- 1 - Alpha\n  (dependency - provides the first section)'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'one line' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'an identifier wrapped in bold in the H1',
    markdown: `# **2** - Beta

## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a setext H1',
    markdown: `2 - Beta
========

## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an indented H1',
    markdown: `   # 2 - Beta

## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a tab after the H1 hash',
    markdown: `#\t2 - Beta

## 2#1 - Uses

Body.

## References

${DECLARES_BOTH}
`,
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR101', severity: 'error', cause: 'heading-source-form', because: 'source form' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a References entry whose marker is alone on its line',
    markdown: documentTwo('Body.', '-\n  1 - Alpha (dependency - provides the first section)'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'one line' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a References entry whose target is formatted',
    markdown: documentTwo('Body.', '- **1** - Alpha (dependency - provides the first section)'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ALPHA],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a References entry with an unbalanced relationship parenthetical',
    markdown: documentTwo('Body.', '- 1 - Alpha (dependency - x))'),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [],
    documentDiagnostics: [{ ruleId: 'ECR103', severity: 'error', cause: 'references-entry-unbalanced', because: 'balanced' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE],
  },
  {
    name: 'a wrapped DocID the References section declares',
    markdown: documentTwo('Retries follow see **1** exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: "a wrapped DocID that is the document's own",
    markdown: documentTwo('This document is see **2** itself.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a wrapped DocID only the corpus confirms',
    markdown: documentTwo('The limit follows see **60** closely.', DECLARES_BOTH),
    documentOk: true,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'warning', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [{ ruleId: 'corpus/undeclared-inline-target', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE, DOCUMENT_SIXTY],
  },
  // The candidate is read on past the formatting, so this is SectionID 1#1,
  // and an error. Document 1 is deliberately left undeclared: read as bare
  // DocID 1, as it once was, it would only have warned.
  {
    name: 'a SectionID whose separator follows the bold (see **1**#1)',
    markdown: documentTwo(
      'Retries follow see **1**#1 exactly.',
      '- 8.1 - Orchestration (dependency - provides the retry contract)',
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: [EDGE_ORCHESTRATION],
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a SectionID split by bold after its separator (see 1#**1**)',
    markdown: documentTwo('Retries follow see 1#**1** exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  // Recognised across the edges of nodes, as a reader sees them, and so
  // reported. Each of these passed with no edge and no diagnostic while the
  // keyword and the digits were required to share a text node.
  {
    name: 'a citation split by an inline tag (see <span>8.1#3</span>)',
    markdown: documentTwo('Retries follow see <span>8.1#3</span> exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'inline HTML' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation split by an HTML comment (see <!-- gap -->8.1#3)',
    markdown: documentTwo('Retries follow see <!-- gap -->8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'inline HTML' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation whose keyword alone is bold (**see** 8.1#3)',
    markdown: documentTwo('Retries follow **see** 8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'bold text' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation split by a <br> tag (see<br>8.1#3)',
    markdown: documentTwo('Retries follow see<br>8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'line break' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a citation split by a <br> whose attribute holds ">"',
    markdown: documentTwo('Retries follow see<br title="x > y">8.1#3 exactly.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'line break' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a wrapped DocID naming nothing known',
    markdown: documentTwo('The limit follows see **99** closely.', DECLARES_BOTH),
    documentOk: true,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [{ ruleId: 'ECR104', severity: 'warning', cause: 'citation-source-form', because: 'literal' }],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an escaped citation beside a correct one on the same line',
    markdown: documentTwo(
      'Use see 8\\.1#3 here, then see 8.1#3 there.',
      DECLARES_BOTH,
    ),
    documentOk: false,
    inlineTargets: ['8.1#3'],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [
      { ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an escaped citation beside a correct one inside inline code',
    markdown: documentTwo(
      'Use see 8\\.1#3 here; example: `see 8.1#3`.',
      DECLARES_BOTH,
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [
      { ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'a code span before an escaped citation',
    markdown: documentTwo(
      'Example: `see 8.1#3`; use see 8\\.1#3 here.',
      DECLARES_BOTH,
    ),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [
      { ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an escaped citation beside a substring inside a longer word',
    markdown: documentTwo('Use see 8\\.1#3; foresee 8.1#3.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [
      { ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
  {
    name: 'an escaped citation beside a reference that resembles a keyword',
    markdown: documentTwo('Use &#101;see 8.1#3; see 8\\.1#3.', DECLARES_BOTH),
    documentOk: false,
    inlineTargets: [],
    referenceEdges: DECLARES_BOTH_EDGES,
    documentDiagnostics: [
      { ruleId: 'ECR104', severity: 'error', cause: 'citation-source-form', because: 'literal' },
    ],
    corpusDiagnostics: [],
    companions: [DOCUMENT_ONE, DOCUMENT_EIGHT_ONE],
  },
];

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Every fixture whose document and expectations are declared in full. */
export const DECLARED_FIXTURES: readonly Fixture[] = [
  ...MALFORMED_TARGETS,
  ...NUMERIC_PROSE,
  ...VALID_CITATIONS,
  ...REFERENCE_ENTRIES,
];

/** Fixtures grouped for targeted suites. */
export const FIXTURE_GROUPS = {
  malformedTargets: MALFORMED_TARGETS,
  numericProse: NUMERIC_PROSE,
  validCitations: VALID_CITATIONS,
  referenceEntries: REFERENCE_ENTRIES,
} as const;

/** Source forms that must be rejected because no recipe can find them. */
export const UNNAVIGABLE_FIXTURES: readonly UnnavigableFixture[] = UNNAVIGABLE;

/** The URI used for the document under test in every fixture. */
export const SUBJECT_URI: string = 'subject.md';

# AGENTS.md

Instructions for coding agents working in this repository. This file supplies
what the governing engineering documents deliberately leave to the repository:
the verification commands, and the decisions and constraints particular to this
project.

`CLAUDE.md` points here. There is no other instruction file.

## Governing documents

`docs/engineering/` is an ECR corpus. Its documents are addressed by DocID, and
this file cites them by address rather than repeating them:

* **0.1** — TypeScript Engineering Standard: the properties the code must have.
* **0.2** — TypeScript Coding-Agent Contract: how to operate while changing the
  repository.
* **0.3** — ECR Navigation Protocol: how to resolve these addresses.

Those documents are authoritative. Do not restate or reinterpret their rules
here.

`see` and `per` are interchangeable in ECR; the obligation comes from the
direction label in a References section, not from the keyword. This file uses
`per` for constraints it expects you to honour and `see` for navigation. That
is a local readability convention, not ECR semantics.

## Critical constraints

Summary only; the authoritative text is at the address given. These are the
constraints whose violation is least self-correcting — retain them even if you
resolve nothing.

* Do not manufacture success — resolve failures at their cause, per 0.2#6
* Preserve behavioural protection — a change must not reduce the suite's
  protection of existing behaviour, per 0.1#3.4
* Preserve type safety — contain an escape hatch at the boundary that forces
  it, per 0.1#3.1
* Make the smallest coherent change — complete, but no wider than the task,
  per 0.2#4
* Run the repository's verification gates — and claim only what was actually
  run, per 0.2#7

## Engineering guidance index

Navigational, not normative. Resolve only what the task calls for.

TypeScript Engineering Standard

* Core principles — see 0.1#2
* Type safety — see 0.1#3.1
* Runtime boundaries — see 0.1#3.2
* Type design — see 0.1#4
* Dependencies — see 0.1#6
* Errors and outcomes — see 0.1#7
* Async and resources — see 0.1#8
* Naming and readability — see 0.1#9
* Documentation — see 0.1#10
* Testing — see 0.1#11

Coding-Agent Contract

* Understand before changing — see 0.2#2
* Preserve existing intent — see 0.2#3
* Change scope — see 0.2#4
* Existing solutions — see 0.2#5
* Do not manufacture success — see 0.2#6
* Verification — see 0.2#7

## Navigating the corpus

An address such as `0.1#3.1` is an identity, not a position. Resolve it by
searching `docs/engineering/` for a heading that begins with it, and read that
section rather than the whole document.

Before materially changing a section, search for its address to find what
depends on it. `eslint.config.mjs` cites sections of the standard, and this
file cites all three documents.

The full protocol is document 0.3: structure and identifiers, see 0.3#1;
finding and reverse lookup, see 0.3#2; reference obligations, see 0.3#3;
grounding, see 0.3#4; gotchas, see 0.3#5.

## Verification

These are the repository's authoritative quality gates. Run all of them from the
repository root before considering a change complete.

```
npm run typecheck
npm run lint
npm test
npm run build
node dist/bin.js lint spec/v2
node dist/bin.js lint docs/engineering
node dist/bin.js lint --example
```

The three corpus checks need `npm run build` to have run first, because they
execute the built binary.

`npm run verify` runs all seven, in this order. Publishing from this directory
runs all seven gates through `prepublishOnly`, with lifecycle scripts enabled.
`tests/release-gate.test.ts` fails if the script and this list drift apart.

`npm test` runs the navigation-guarantee suite, which executes the two search
engines the protocol names — ripgrep and `grep -E` — against real files rather
than simulating them with JavaScript regular expressions. The three engines
disagree on Unicode word boundaries, so a simulation proves nothing about
either. Two consequences:

* Install with optional dependencies. `@vscode/ripgrep` obtains its platform
  binary through `optionalDependencies`, so `npm ci --no-optional` strips it and
  the suite fails at load. This is a devDependency and reaches no consumer.
* GNU grep must be resolvable. On Windows it ships with Git; the harness falls
  back to Git's `usr\bin` when it is not on PATH. A missing engine is an error,
  never a silent skip.

CI runs the first six on Linux and Windows against Node 22 and 24. The example
corpus is covered separately, by a job that installs the packed tarball into a
fresh project and runs the binary through `node_modules/.bin`. That job exists
because an entry point reached through a symlink can silently exit 0 without
running, which the in-process tests cannot see.

## Working in git

Work on a feature branch taken from `main`; do not commit to `main` directly.

One commit per validated change, not one commit per session: run the gates above
before each commit, so that every commit on the branch is a state the gates
passed. A change that needs several coherent steps is several commits.

Integrate with `git merge --ff-only`, which keeps history linear. If the merge
will not fast-forward, `main` has moved and the branch needs rebasing onto it
first; do not resolve that by creating a merge commit.

Commit messages state what changed and why, in prose. An agent's commits carry a
`Co-Authored-By` trailer identifying it.

Nothing is pushed or published from here without being asked.

## Repository-specific requirements

These specialize the standard's defaults. Each states its reason, because the
reason is what lets you tell a genuine exception from a violation.

### Runtime dependency surface

This package is a linter people install, so install weight and supply-chain
surface are product concerns, not preferences. It ships five runtime
dependencies. The local implementations of command-line argument parsing
(`src/cli.ts`) and ignore-pattern matching (`src/meta-documents.ts`) are
deliberate, not oversights.

Two of the five — `decode-named-character-reference` and
`micromark-util-decode-numeric-character-reference` — are declared for
`src/inline-reference-rule.ts`, which must map a parsed citation back to its own
source characters to enforce 1#9.11. Both were already installed as transitive
dependencies of `remark-parse`, so declaring them added nothing to a consumer's
install; they are the parser's own decoders, which is the point. Inferring what
a character reference expands to, rather than decoding it, produced a series of
false errors on ordinary prose.

Do not replace them with third-party packages, and do not add a runtime
dependency, unless the task is specifically to reconsider that decision. This
specializes per 0.1#6.1, Prefer Proven Implementations Over Bespoke Commodity
Code, which is otherwise correct and still applies to genuinely new
general-purpose functionality.

### Module format

The package is ESM with `module` and `moduleResolution` set to `Node16`.
Relative imports carry the `.js` extension in TypeScript source
(`from './types.js'`). `verbatimModuleSyntax` is on, so type-only imports must
use `import type`.

### Command-line behaviour

Commands return a `CommandOutcome` — text, target stream, exit code — rather
than writing to the console themselves, so that `--format json` output is never
interleaved with an error message. Diagnostics go to stdout; usage errors go to
stderr. A corpus containing errors must exit non-zero.

The published entry point is `src/bin.ts`, kept separate from `src/cli.ts`
precisely so it works when invoked through a symlink. `tests/bin.test.ts` guards
that; do not collapse the two.

### Diagnostic severity is defined by the specification

`spec/v2/1 - ECR - Structural Specification.md` section `1#12` fixes which findings are errors,
which are warnings and which are informational: structural and referential
breakage is always an error, while advisory findings — a stale References title,
an undeclared prose-looking DocID target, an empty References section — never
fail validation.

A reference whose identifier is wrapped, escaped, line-broken or multiply spaced
is not advisory by default: it is an error whenever the target is identifiable
(a SectionID, a declared DocID, the document's own DocID, or one the corpus
confirms), and a warning only when the target is a bare number naming nothing
known.

Severity is part of the specified contract. Do not change a diagnostic's
severity as an implementation decision; that requires a specification change.
`tests/diagnostic-severity-invariants.test.ts` enforces this.

### Cross-platform behaviour

Development happens on Windows; CI runs on Linux and Windows. Do not hardcode
path separators or line endings. `.gitattributes` sets `* text=auto` and the
compiler emits LF (`newLine: lf`) so the published binary is unaffected by a
contributor's local settings.

Filenames are lowercase kebab-case. The Windows checkout is case-insensitive
and CI is not, so a case-only rename must be made with `git mv -f` and verified
with `git status` and `git ls-files` before committing — an editor rename
records nothing.

### Toolchain

Development is pinned to Node 22 (`.nvmrc`); `engines` is deliberately open at
`>=22`, and CI tests 24 to keep that promise honest. TypeScript is held at
`~6.0.3`: typescript-eslint supports `<6.1.0`, and npm's `latest` is TypeScript
7. Do not upgrade either without being asked.

### Naming documents in the engineering corpus

A document in `docs/engineering/` is named `<DocID> - <Title>.md`, with the
title matching its H1 — the convention the example corpus in `examples/docs/`
teaches. ECR does not require it; the linter treats the URI as opaque and takes
identity from the H1. It is a convention so that a corpus is navigable by
listing a directory rather than by grepping every file.

Do not give a corpus document a basename that appears in
`DEFAULT_META_DOCUMENT_NAMES`. Such a file is excluded from validation by name,
so its DocID is never indexed and every address into it silently stops
resolving. The DocID prefix makes this collision impossible.

### The shipped navigation protocol is generated

`protocol/navigation-protocol.md` is a build artifact. Edit
`docs/engineering/0.3 - ECR Navigation Protocol for Coding Agents.md` and run
`npm run generate:protocol`;
the build does this too. The shipped copy has this repository's ECR identity
removed, because `ecr init` writes it verbatim into a user's corpus where a
DocID of ours would mean nothing.

The artifact is committed rather than ignored so that the test suite and
`npm pack` work without a prior build. A test asserts it is the current output
of generation.

### Patterns in existing code that are not requirements

Both governing documents say a repeated pattern is not necessarily an
intentional convention. Two specific cases in this repository:

* **Explicit annotations on local variables.** `const hasErrors: boolean = …`
  appears throughout `src/` as residue of a `typedef` lint rule that has been
  removed. Do not propagate it for consistency. Prefer inference for internal
  values when the inferred type is clear, per 0.1#4.2.
* **TSDoc on internal members.** Documentation blocks on private methods are
  residue of a blanket documentation rule now scoped to the published API.
  Documenting an internal helper is welcome where it adds information, but it is
  not required, and existing examples do not establish a requirement.

Neither is a cleanup instruction. Existing code stays as it is until touched for
a task-derived reason.

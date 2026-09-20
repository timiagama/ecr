# AGENTS.md

Instructions for coding agents working in this repository. This file supplies
what the governing engineering documents deliberately leave to the repository:
the verification commands, and the decisions and constraints particular to this
project.

`CLAUDE.md` points here. There is no other instruction file.

## Governing documents

For TypeScript work, read and follow:

* `docs/engineering/typescript-engineering-standard.md` — the properties the
  code must have.
* `docs/engineering/typescript-coding-agent-contract.md` — how to operate while
  changing the repository.

Those documents are authoritative. Do not restate or reinterpret their rules
here.

## Critical constraints — summary only

A reminder index, not a source of rules. Each line names a section of a
governing document; that section is what binds.

* **Do Not Manufacture Success** (contract) — resolve failures at their cause.
* **Preserve Behavioural Protection** (standard) — a change must not reduce the
  suite's protection of existing supported behaviour.
* **Preserve Type Safety** (standard) — contain an escape hatch at the boundary
  that forces it; prefer mechanisms that expire when it is no longer needed.
* **Make the Smallest Coherent Change** (contract) — complete, but no wider than
  the task.
* **Verify the Change** (contract) — run the gates below, and claim only what
  was actually run.

## Verification

These are the repository's authoritative quality gates. Run all of them from the
repository root before considering a change complete.

```
npm run typecheck
npm run lint
npm test
npm run build
node dist/bin.js lint spec
node dist/bin.js lint --example
```

The two corpus checks need `npm run build` to have run first, because they
execute the built binary.

CI runs the same gates on Linux and Windows against Node 22 and 24, and
additionally installs the packed tarball into a fresh project and runs the
binary through `node_modules/.bin`. That last job exists because an entry point
reached through a symlink can silently exit 0 without running, which the
in-process tests cannot see.

## Repository-specific requirements

These specialize the standard's defaults. Each states its reason, because the
reason is what lets you tell a genuine exception from a violation.

### Runtime dependency surface

This package is a linter people install, so install weight and supply-chain
surface are product concerns, not preferences. It ships three runtime
dependencies. The local implementations of command-line argument parsing
(`src/cli.ts`) and ignore-pattern matching (`src/meta-documents.ts`) are
deliberate, not oversights.

Do not replace them with third-party packages, and do not add a runtime
dependency, unless the task is specifically to reconsider that decision. This
specializes the standard's "Prefer Proven Implementations Over Bespoke Commodity
Code", which is otherwise correct and still applies to genuinely new
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

`spec/ecr-specification.md` section `1#12` fixes which findings are errors,
which are warnings and which are informational: structural and referential
breakage is always an error, while advisory findings — a stale References title,
an undeclared prose-looking DocID target, a wrapped reference, an empty
References section — never fail validation.

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

### Patterns in existing code that are not requirements

Both governing documents say a repeated pattern is not necessarily an
intentional convention. Two specific cases in this repository:

* **Explicit annotations on local variables.** `const hasErrors: boolean = …`
  appears throughout `src/` as residue of a `typedef` lint rule that has been
  removed. Do not propagate it for consistency. Prefer inference for internal
  values when the inferred type is clear, as "Be Explicit at Important
  Boundaries" requires.
* **TSDoc on internal members.** Documentation blocks on private methods are
  residue of a blanket documentation rule now scoped to the published API.
  Documenting an internal helper is welcome where it adds information, but it is
  not required, and existing examples do not establish a requirement.

Neither is a cleanup instruction. Existing code stays as it is until touched for
a task-derived reason.

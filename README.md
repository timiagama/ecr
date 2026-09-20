# ECR — Explicit Constraint Referencing

**A Markdown convention that helps reduce coding agent errors by turning
cross-references in architecture docs into a graph that coding agents navigate 
with `grep`.**

Agents gain IDE-like "Go to Definition" and "Find all references" across large
document corpora, reducing missed constraints and context-window bloat.

No server. No index. No embeddings. Just numbered headings and a
`## References` section.

---

## Why coding agents miss constraints

Your architecture documentation contains constraints. Some govern other
constraints. Some impose limits. Some define contracts that other components
must satisfy.

You understand those relationships when you read the docs. A coding agent does
not — because ordinary Markdown does not encode them in a form an agent can
deterministically traverse. They live in your head, in the ordering of files,
in the fact that you happen to remember that the retry policy in one document
constrains the payment flow in another.

Without stable identifiers and explicit references, the agent either pulls
more documentation into context hoping the relevant constraint is there, or
proceeds with what it has found and silently violates a constraint written
somewhere it never looked.

The second failure is the expensive one, and it is easy to miss in local
review. Nothing in the file you are reading points at the thing you missed.

## ECR exploits how coding agents already work

A coding agent does not read your whole repository into its context window.

Its harness gives it tools to inspect the repository on demand: list files,
search for text or symbols, open the relevant files, read specific sections,
and run commands.

When an agent works on code, it has stable identifiers: function names, type
names, imports, filenames, symbols. It can search for `retryWithBackoff`, find
where it is defined and used, read a handful of relevant files, and never load
the repository into context.

That is how an agent can operate on a codebase far larger than its context
window. The model builds the context it needs as it works.

Code already gives the agent stable identifiers to search for. Architecture
prose usually does not.

The "retry policy" is "retry semantics" in one document, "backoff rules" in
another, "the orchestration contract" in a third. There is nothing exact to
search for.

ECR gives architecture documentation the same kind of searchable structure
that code already has. Stable identifiers and explicit references turn "what
constrains this?" into something the agent can actually look up.

## What ECR does

Your IDE gives you two operations on code: **Go to Definition** and **Find All
References**. ECR gives your architecture documents the same two operations,
with `grep` doing the job the IDE's index does, and with nothing to build or
keep in sync.

| IDE operation | ECR equivalent | Answers |
|---|---|---|
| Go to Definition | forward reference | What does this document rely on or answer to? |
| Find All References | reverse reference | What elsewhere relies on or refers to this? |

> General-purpose links help you navigate from a known source to a known
> destination. ECR adds something different: stable section identities and
> explicit relationships that an agent can traverse mechanically in both
> directions.
> 
> That means the agent can **retrieve a constraint from the specific section
> that defines it rather than loading the document that contains it**. And it
> can search backwards to discover everything elsewhere in the corpus that
> refers to that constraint.

The two directions solve different problems. Forward references surface the
constraints a document knows it must obey. Reverse references surface
everything elsewhere in the corpus that relies on it — relationships the
target has no reason to know exist, and each one a limit on what you can
safely change.

In practice, both operations are one search.

For example, one document sets a constraint. The sub-heading containing the constraint has
a stable identifier `8.1#3.2`:

```markdown
### 8.1#3.2 - Bounds

At most five attempts. A stage that exhausts its attempts fails permanently
and is reported, not re-queued.
```

Another document, elsewhere in the corpus, depends on that constraint and
cites it by the same stable identifier:

```markdown
A discrepancy halts settlement for that merchant only. Orchestration-level
retry does not apply — see 8.1#3.2.
```

They need not share a folder, a filename convention, an index or a database.
The stable identifier is enough to make the section-level link searchable, so
finding either end from the other is one search:

```bash
grep -r "8.1#3.2" docs/
```

That is the mechanism. The identifier is exact, so the search is exact: it
returns the section that defines the constraint and every document citing it,
wherever they sit. Nothing is indexed, nothing is embedded, and there is no
ranking to be wrong about.

Nobody loads a repository into their head to use **Go to Definition**. The
index does the work and you read only what it returns. ECR works the same way:
the edges are plain text on disk, so an agent greps and pulls the few sections
that matter instead of the whole corpus. **The graph lives in your filesystem,
not in your context window.**

## The four rules

**1. Every document has a numbered H1.** That number is its DocID — its
identity, independent of title or path.

```markdown
# 4.2 - Payment Processing Contract
```

**2. Every sub-heading number begins with the DocID.**

```markdown
# 4.2 - Payment Processing Contract
## 4.2#1 - Idempotency
### 4.2#1.1 - Key Derivation
```

A sub-heading number is a SectionID, and it is self-locating: `4.2#1.1` is
document `4.2`, section 1, sub-section 1. The `#` marks where the document
identifier ends and the section path begins, so `4.2#1` and `4.2.1#1` are
different things and neither can be mistaken for the other.

**3. Inline references use `see` or `per`.**

```markdown
Retry semantics are applied per 8.1#3.
```

Not "as described in the orchestration doc." A number, so it can be found.

**4. Every document declares its external references** in a `## References`
section, with a typed direction and a reason.

```markdown
## References

- 3.1 - Prompt Contracts (authority - defines the guardrail criteria enforced here)
- 8.1 - Orchestration Contract (constraint - retry semantics applied to evaluation runs)
```

That's the whole convention. Four rules, no new syntax, no tooling required to
adopt it.

### Direction semantics

| Direction | Meaning (ECR) | Agent action (recommended) |
|---|---|---|
| `authority` | the cited document governs this one | Read it first. Treat it as the governing source. Flag apparent conflicts. |
| `constraint` | the cited document restricts this one | Check your change doesn't violate it. |
| `contract` | the cited document defines interfaces or obligations | Conform exactly. |
| `dependency` | this document consumes the cited one | Read it to use it correctly. |

### Searching precisely

A literal search shows the mechanism. Two refinements make it reliable:

```bash
# Go to Definition — locate the section a reference names
grep -RInE "^#+ 8\.1#3([^0-9]|$)" docs/

# Find All References — every document citing that section or its sub-sections
grep -RInE "([Ss]ee|[Pp]er) 8\.1#3([^0-9]|$)" docs/
```

The reverse search is where ECR exposes relationships the target section
cannot know about. On the example corpus it returns five documents across
four folders, three of which cite `8.1#3.2` specifically: downstream
documents a change to the retry bounds could break. One of them, settlement, appears nowhere in the orchestration contract.

Match `[Ss]ee` and `[Pp]er`, not just lowercase: a reference at the start of a
sentence is still a reference, and a pattern that misses it under-reports the
exact thing you are searching for. The `([^0-9]|$)` ending stops `8.1#3` also
matching `8.1#30`. Matching a whole document rather than its sections needs a
stronger guard, because `.` and `#` are not word boundaries — the supplied
coding agent navigation protocol carries the tested pattern.

## Why `grep` is enough

What ECR produces is a directed graph: documents and sections are nodes,
cross-references are edges, and document-level edges carry relationship types.

The useful property of a graph is that you can answer questions about a node
by following its edges, without reading every other node. That's the property
being borrowed. `grep` may scan every file, but the agent only reads what the
edges lead it to. An agent asking "what governs this component?" doesn't read
your entire documentation corpus — it resolves an identifier and follows
edges, and every edge it follows is one it can justify rather than infer.

It matters that the identifiers are stable and the edges are plain text. Exact
identifiers make retrieval deterministic: against the same corpus, the same
query returns the same sections every time, with no ranking, no similarity
threshold, and no chance of a plausible-looking near-miss. Plain text on disk
means the traversal tool is `grep`, which every coding agent already has.

## Evidence from one project

Here is my experience with it: **one project, my own assessment, not a benchmark**.

I converted a documentation corpus to ECR: **47 Markdown files**, 40 carrying
`## References`, **1,672 numbered headings**, and **575 inter-document references** —
413 References entries plus 162 inline `see`/`per` citations, 95 of them
section-precise.

Then I pointed a coding agent at the navigation protocol, told it to use ECR,
and started building. It produced around **19,000 lines of TypeScript across
124 source files** with **34 test files**. Retrieval was `grep`. There was no
server, no index, no embedding model and no MCP tool in the loop — the agent
read the protocol, walked the references, and pulled the sections it needed.

In my judgement the result contained unusually few errors for a build of that
complexity. That's a subjective claim about an unpublished, commercially
confidential corpus, and you should weight it accordingly. The mechanism
underneath it, though, is not subjective — you can check that on your own
documentation in about two minutes.

## Getting started

### Commands

```bash
npx @timiagama/ecr init ./docs    # add the agent navigation protocol
npx @timiagama/ecr lint ./docs    # check structural compliance
npx @timiagama/ecr stats ./docs   # measure the structure you already have
```

### Try it on the example corpus

A small example corpus ships with the package, so you can try the tool before
pointing it at your own documents:

```bash
npx @timiagama/ecr stats --example
```

```
  documents                      9
    with a References section    9
  sections                       34

  unique DocIDs                  9
  unique SectionIDs              34

  References entries             21
    authority                    5
    constraint                   2
    contract                     2
    dependency                   12

  inline see/per references      17
    section-precise              10

  total edges                    38
```

### What the commands do

`init` writes [the coding agent navigation protocol](protocol/navigation-protocol.md) into
your documentation folder. That file teaches your coding agent to walk the
corpus. **The protocol does the navigation work; the linter only checks that
the structure holds**.

`lint` exits `0` when the corpus is clean, `1` when it contains errors, and
`2` when the command line could not be understood, so it drops straight into
CI. `--format json` gives you the same diagnostics as data.

READMEs, `CLAUDE.md`, contributing guides and changelogs are excluded
automatically. Use `--ignore` for anything project-specific:

```bash
npx @timiagama/ecr lint ./docs --ignore '**/*-CHECKLIST.md' --ignore 'LAST-REVIEW.md'
```

There is no `backlinks` command, and there never will be. Navigation is what
`grep` is for; a navigation command here would make the tool a dependency of
the thing ECR exists to prove unnecessary.

You can adopt ECR entirely by hand. The tooling is optional.

## Migrating existing documentation

You do not need to convert everything at once. ECR degrades gracefully: a
partially-converted corpus is more navigable than an unconverted one, and
documents without DocIDs are simply outside the graph.

A workable order:

1. Assign DocIDs to your architectural documents — the ones that constrain
   other documents. Leave READMEs and guides alone.
2. Renumber headings to extend the DocID.
3. Add `## References` to each document, typing the direction of each edge.
4. Convert natural-language references ("as described in the storage doc")
   into `see` / `per` citations with numbers.
5. Run `ecr lint` and resolve what it reports.

Step 2 changes heading numbers to SectionIDs (`## 8.1#3 - Retry Semantics`),
and step 4 needs corpus-wide knowledge: resolving
`as described in the storage doc` to `per 7.1#2` means knowing what documents
exist and what they cover.

### Using a coding agent to migrate

Migration always requires knowledge of the corpus, which makes it a good fit
for a coding agent. Much of the work is mechanical once the DocID set is known,
but it is too corpus-aware to script blindly.

My advice, from doing this on a real corpus:

- **Start with two fresh sessions from the same model family.** Use one session 
  to implement and a separate session to review. In my experience, a fresh
  session reviews what is on the page rather than what the first one intended.
- **Finish with a review by a model from a different family.** In my
  experience, a second model family catches assumptions the first one can
  repeat.

Run `ecr lint` after each pass. The linter catches structural breakage; the
reviews catch the judgement calls the linter cannot see, such as whether an
edge is really an `authority` or just a `dependency`.

## What ECR is not

- It does not interpret constraint semantics. It exposes structure; you decide
  what the structure means.
- It does not evaluate whether a constraint is satisfied.
- It does not enforce Markdown style.
- It is not a search engine. Retrieval is exact-match on identifiers, which is
  the point — there is no ranking to be wrong about.
  

What distinguishes ECR isn't that its references form a graph. Any linked corpus
does. ECR makes the structure **stable**, **section-addressable**, **explicit** and 
**mechanically reversible**, with **typed document-level relationships**.

## Beyond architecture docs

ECR can be useful anywhere an agent needs to navigate a document corpus by
exact reference rather than similarity. For example, I used the same approach
in an oil-and-gas engineering PoC where every answer the AI agent provided had
to cite its evidence. I converted the engineering documents to ECR-compliant
Markdown so an agent could locate the exact supporting section on demand. The
same pattern may be useful for standards, policies, legal documents,
procedures, or other documents where traceable references matter.

## Documentation

This repository contains the ECR 1.0.0 specification and `@timiagama/ecr`, a
linter that implements it.

- [Specification](spec/ecr-specification.md) — the formal grammar and rules
- [User guide](spec/ecr-user-guide.md) — writing ECR-compliant documents
- [Design rationale](spec/design-rationale-section-separator.md) — why
  identifiers carry a `#`
- [Navigation protocol](protocol/navigation-protocol.md) — the instructions
  you give your coding agent

## Licence

Apache License 2.0. See [LICENSE](LICENSE).

Apache-2.0 includes an explicit patent grant that MIT does not provide.

# 3 - Design Rationale - The Section Separator

**Status:** Part of the specification
**Explains:** why a SectionID carries the `#` separator
**Audience:** anyone asking why identifiers are not simply dotted

## 3#1 - Summary

ECR uses a single character, `#`, marking the boundary between a
document identifier and a section path.

```
0.0.2#1        section 1 of document 0.0.2
0.0#2.1        section 2, subsection 1, of document 0.0
```

This makes SectionIDs globally unique by construction, makes reference
resolution deterministic without a corpus index, and permits a DocID to be a
prefix of another DocID — so a numbering scheme may express document hierarchy
to a human reader without creating identifier collisions.

## 3#2 - The problem

The obvious design is for a SectionID to extend its DocID by appending dot-separated
segments, and DocIDs may themselves contain dots. Nothing marks where one ends
and the other begins, so a dotted identifier has more than one legal reading.

Given a corpus containing both a document `0.0` and a document `0.0.2`, the
identifier `0.0.2.1` legally denotes either:

- section `1` of document `0.0.2`, or
- section `2.1` of document `0.0`.

A dotted-only grammar permits both, so in practice both occur. Validating a
real 47-document corpus produced 14 duplicate-SectionID errors of exactly this
form, every one of them legitimately numbered under a dotted-only grammar:

```
0.0 - System Overview.md:20         ### 0.0.2.1 - How to Think About a Scenario
0.0.2 - Build QA Contract.md:3       ## 0.0.2.1 - Purpose
```

The collision is structural, not accidental. A document's section namespace
occupies the same flat numeric space as its sibling documents' identifiers, so
any corpus that numbers documents hierarchically will collide. Because the
duplicates block corpus indexing, the effect is total: no identifier in the
corpus resolves.

The same ambiguity degrades reference resolution. `see 0.0.2` cannot be resolved
without consulting an index, and where both readings exist in the index it
cannot be resolved at all.

### 3#2.1 - Rejected alternatives

Two schemes preserve pure-numeric identifiers. Both fail on **stability** —
SectionIDs are referenced from other documents, so any scheme in which adding a
document changes another document's SectionIDs is not viable.

| Scheme | Failure |
|---|---|
| A parent document numbers its own sections above the range used by its children | Adding a child renumbers the parent's sections, invalidating every reference to them |
| A parent reserves a `.0` segment for its own sections | Same failure on gaining a first child; `0` is also already in use as a document number |

A third option — forbidding any DocID from being a proper prefix of another —
is stable and needs no new syntax, but purchases uniqueness by prohibiting
hierarchical document numbering, which is the property this amendment exists to
preserve.

## 3#3 - The rule

> **Rule 2a.** A SectionID consists of a DocID, the separator `#`, and a section
> path of one or more dot-separated numeric segments. The separator is mandatory
> in every SectionID, whether or not ambiguity is possible in a given corpus.

```
DocID       ::= Digit+ ( "." Digit+ )*
SectionPath ::= Digit+ ( "." Digit+ )*
SectionID   ::= DocID "#" SectionPath
Identifier  ::= DocID | SectionID
```

A heading at Markdown depth *d* (d ≥ 2) carries a section path of exactly
*d − 1* segments. `## References` remains unnumbered, per Rule 4.

### 3#3.1 - Uniqueness

SectionIDs are unique by construction, and no corpus-wide check is needed to
establish it:

1. DocIDs are globally unique (see 1, corpus-wide rules).
2. Section paths are unique within a document (Rule 2).
3. A SectionID is a DocID and a section path joined by a character that appears
   in neither.

Therefore two SectionIDs are equal only when they name the same section of the
same document. The corpus duplicate-SectionID check is retained as a safety net
against malformed input, but under a conforming corpus it cannot fire.

### 3#3.2 - Resolution

Resolution requires no index and no disambiguation:

- An identifier containing `#` is a SectionID. The text before `#` is the DocID.
- An identifier containing no `#` is a DocID.

A DocID may now be a proper prefix of another DocID. `0.0`, `0.0.1` and `0.0.2`
may all be documents, and none of their section namespaces can overlap.

## 3#4 - Examples

```markdown
# 0.0 - System Overview

## 0.0#1 - Purpose

### 0.0#1.1 - Scope

## 0.0#2 - Mental Model

Evaluation criteria are defined per 0.0.2#3.

## References

- 0.0.2 - Build Quality Assurance Contract (authority - defines the quality gates referenced here)
```

```markdown
# 0.0.2 - Build Quality Assurance Contract

## 0.0.2#1 - Purpose

## 0.0.2#3 - Evaluation Criteria
```

`0.0#1` and `0.0.2#1` are both "section 1", of different documents, and are
distinct identifiers. Without the separator the second would be written `0.0.2.1`
and would have collided with `0.0`'s `### 0.0.2.1`.

## 3#5 - Effect on navigation

A dotted-only grammar cannot distinguish a document from a
similarly-numbered sibling. This pattern:

```bash
rg -n "\b([Ss]ee|[Pp]er) 8\.1(\.\d+)*\b" docs
```

matches references to sections of document `8.1`, **and** references to document
`8.1.3` and all of its sections. The separator distinguishes the cases:

| Question | Pattern |
|---|---|
| Who references document `8.1`? | `rg -n "(\b\|_)([Ss]ee\|[Pp]er) 8\.1(\.[^0-9A-Za-z.#]\|\.$\|[^0-9A-Za-z.#]\|$)" docs` |
| Who references any section of `8.1`? | `rg -n "(\b\|_)([Ss]ee\|[Pp]er) 8\.1#" docs` |
| Who references section `8.1#3` or below? | `rg -n "(\b\|_)([Ss]ee\|[Pp]er) 8\.1#3([^0-9A-Za-z#]\|$)" docs` |
| Either the document or any section? | `rg -n "(\b\|_)([Ss]ee\|[Pp]er) 8\.1(#[0-9.]*\|\.[^0-9A-Za-z.#]\|\.$\|[^0-9A-Za-z.#]\|$)" docs` |
| Every section-precise reference in the corpus | `rg -n "(\b\|_)([Ss]ee\|[Pp]er) [0-9.]+#" docs` |

The last row is not expressible without the separator.

`see` and `per` are matched with an optional capital because a reference at the
start of a sentence is still a reference. These rows are the same patterns the
navigation protocol publishes, where they are tested against the example corpus;
change them there first.

### 3#5.1 - Why the patterns bound a citation explicitly

`\b` cannot terminate an identifier, because `.` and `#` are both non-word
characters: a search for `8\.1\b` matches inside `8.1.3`, `8.1#3` and `8.1.3#1`.
The trailing group states explicitly what may follow a bare DocID — anything
that is not an ASCII letter or digit, `.` or `#`. The `\.[^0-9A-Za-z.#]` and
`\.$` alternatives admit a sentence-ending full stop, so `see 8.1.` is matched
while `see 8.1.3` and `see 8.1..2` are not.

Before the keyword, `\b` alone is not enough either. `_` is a word character to
both engines, so `\b` finds nothing in `_see 8.1_`, which is ordinary Markdown
emphasis. The leading group is therefore `(\b|_)`: a word boundary, or an
underscore. It still refuses `oversee 8.1`. It was chosen over "any character
but an ASCII letter or digit" by measurement: that class is not matched against
a character outside the Basic Multilingual Plane by at least one GNU grep, so
`🔒see 8.1` would have been missed.

This is a pre-existing property of dotted identifiers, not a consequence of this
separator; a dotted-only grammar has the same defect and silently conflates a
document with its numeric siblings. Every pattern in the table above was
verified against a corpus containing `8.1`, `8.1.3`, `8.10` and `8.1.30`, in
both sentence-final and mid-sentence positions.

Where ripgrep is built with PCRE2, `-P` permits the clearer lookahead form:

```bash
rg -P -n "(?<![0-9A-Za-z])([Ss]ee|[Pp]er) 8\.1(?![0-9A-Za-z#])(?!\.[0-9A-Za-z.#])" docs
```

The default-engine patterns are given as the primary form because they need no
special build or flag.

## 3#6 - Migration

Mechanical, given that DocIDs are recoverable from filenames:

1. Build the DocID set from H1 headings across the corpus.
2. For each document, rewrite every sub-heading `## X.Y.Z - Title` as
   `## <DocID>#<remaining segments> - Title`, where `<DocID>` is this document's
   own DocID.
3. For each inline `see`/`per` reference, resolve the target against the DocID
   set by longest matching prefix; if segments remain after the matched DocID,
   join them with `#`.
4. Leave `## References` entries unchanged — they cite documents, not sections.
5. Run `ecr lint` and resolve what remains.

Step 3 is the only step requiring corpus-wide knowledge, and it is exactly the
operation that was previously ambiguous. It is well-defined during migration
because the DocID set is known.

Because migration needs corpus knowledge rather than a blind rewrite, it suits a
coding agent. See the README's *Using a coding agent to migrate* for the
recommended session structure: implement and review in separate same-family
sessions, then a final review by a model from a different family.

## 3#7 - Linter changes

| Component | Change |
|---|---|
| `IdentifierGrammar` | Parse `DocID ["#" SectionPath]`; `parseSectionId` splits on `#` rather than dropping the last dotted segment |
| `SectionHierarchyRule` | Require the `#` form in sub-headings; verify section path length equals heading depth − 1 |
| `InlineReferenceRule` | Reference pattern gains `(?:#\d+(?:\.\d+)*)?`; the "undeclared DocID" check reads the DocID as the text before `#` |
| `CorpusValidator` | Duplicate-SectionID check retained as a safety net; unresolved-target checks resolve without disambiguation |

## 3#8 - What this does not change

- DocID grammar and depth. DocIDs remain dot-separated numerics of any depth.
- `## References` entries, which cite DocIDs and never carry a section path.
- The four direction types and their semantics.
- Rule 1 (numbered H1), Rule 3 (`see`/`per` inline references) and Rule 4
  (mandatory References section).
- Separator characters in titles, which remain free-form: `-`, `–` and `—` are
  all accepted between an identifier and its title.

## References

- 1 - ECR - Structural Specification (authority - defines the identifier grammar this amendment changes)
- 2 - ECR - User Guide (dependency - the authoring rules this amendment restates for the new grammar)

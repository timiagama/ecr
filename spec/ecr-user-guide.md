# 2 - ECR - User Guide

This document defines the user-facing structural rules for **Explicit Constraint Referencing (ECR)** as applied to software documentation written in Markdown (see 1).

## 2#1 - What This Document Covers

- [What problem ECR solves](#23---what-problem-ecr-solves)
    
- [The four structural rules of ECR](#24---the-four-rules-of-ecr)
    
- [Direction semantics](#25---direction-semantics)
    
- [Corpus-wide validation requirements](#26---corpus-wide-rules)
    
- [What ECR does not do](#27---what-ecr-does-not-do)
    
- [Minimal compliant example](#28---minimal-compliant-example)
    
- [Migration strategy for existing software documentation](#211---migrating-existing-documentation-to-ecr)
    

This document describes **structure only**.

It does not define:

- Graph construction
    
- Traversal semantics
    
- Linting implementation details
    
- Runtime interpretation of constraints
    

Those concerns belong to consuming systems (see 2#9).

---

## 2#2 - User Specification

Explicit Constraint Referencing (ECR) is a structural convention for writing Markdown documentation so that constraint relationships between documents are explicit and machine-traversable.

ECR does not introduce a new markup language.  
It standardizes how existing Markdown is written so that interdependent constraints can be composed into a **Constraint Graph** and made legible to agentic systems.

This document defines the user-facing rules of ECR (see 1).

---

## 2#3 - What Problem ECR Solves

Software architectural documentation contains constraints that:

- govern other constraints
    
- reference other documents
    
- impose limits
    
- define contracts
    

Humans implicitly understand these relationships when reading documentation. Coding agents do not. And traditional Markdown documentation does not encode these relationships explicitly. 

As documentation scales, governance boundaries become implicit and unverifiable. Constraint relationships that exist in practice are not machine-auditable. 

ECR provides that structure by making constraint relationships explicit and consistently encoded so coding agents can see them.

ECR makes architectural authority, dependency, and contractual boundaries explicit and structurally enforceable.

---

## 2#4 - The Four Rules of ECR

ECR consists of four structural rules (see 1).

---

### 2#4.1 - Rule 1 — Every document has a numbered H1

Each document must begin with a numbered H1 heading:

```markdown
# 3.1 - Ingestion - Validation Rules
```

- The numeric prefix (`3.1`) is the **DocID**.
    
- DocIDs must be unique across the corpus.
    
- A dash separates the DocID from the title. A hyphen (`-`), en dash (`–`) or em dash (`—`) are all accepted.
    

The DocID is the document’s stable identity.

---

### 2#4.2 - Rule 2 — Sub-headings carry a SectionID

Every sub-heading carries a SectionID: the document’s DocID, the separator `#`, and a section path.

Example:

```markdown
# 3.1 - Ingestion - Validation Rules

## 3.1#1 - Mode-Aware Prompt Strategy

### 3.1#1.1 - Expert Mode Prompts
```

Rules:

- The identifier before the title is the DocID, `#`, then the section path.
    
- The number of section-path segments (after the `#`) must correspond to heading depth: one for `##`, two for `###`, and so on.
    
- A dash separates the SectionID from the title, as in the H1.
    
- Section numbers must not skip structural levels.
    

Each numbered heading defines a stable **SectionID**.

---

### 2#4.3 - Rule 3 — Inline references must use `see` or `per`

Inline references create section-level edges.

Valid forms:

```markdown
The validation logic is enforced per 3.1#2.
For orchestration details see 8.1#3.
```

Rules:

- Only `see X` and `per X` create graph edges.
    
- `X` must be a valid DocID or SectionID.
    
- Numeric references written in other forms (e.g., “defined in 3.1.2”) do not create edges.
    
- If referencing a section `X#Y`, its document `X` must be declared in the References section. References to your own document's sections need no declaration.
    

Inline references inside code blocks or inline code are ignored.

**NOTE:**
- References are not concerned with the physical location of the referenced document in the file system.
- They refer only to a unique document ID across the documentation corpus.
	

---

### 2#4.4 - Rule 4 — Every document must declare its external references

Every document must contain a `## References` section.

Example:

```markdown
## References

- 3.1 - Ingestion - Validation Rules (authority - defines validation logic enforced by this document)
- 8.1 - Workflow Orchestration Contract (constraint - defines retry semantics applied to this workflow)
```

Rules:

- The heading must be exactly `## References`.
    
- It must appear exactly once.
    
- It must be followed immediately by a list.
    
- Each entry must follow this structure:
    

```
- {DocID} - {Title} ({direction} - {explanation})
```

Allowed direction values:

- `authority`
    
- `dependency`
    
- `constraint`
    
- `contract`
    

The explanation must be non-empty text.

Each separator is a dash with a single space either side. As in headings, a hyphen, en dash or em dash are all accepted.

If the References section has no list, the document declares no external references. The linter reports this as information, not as an error.

**NOTE:**
- References are not concerned with the physical location of the referenced document in the file system.
- They refer only to a unique document ID across the documentation corpus.
	

---

## 2#5 - Direction Semantics

Each References entry defines a directed edge:

```
Current Document → Referenced Document
```

Direction labels describe the meaning of the relationship:

- **authority** — the referenced document governs this document
    
- **dependency** — this document relies on the referenced document
    
- **constraint** — the referenced document imposes restrictions
    
- **contract** — the referenced document defines structural obligations
    

Direction labels do not reverse edge direction. They type the relationship.

---

## 2#6 - Corpus-Wide Rules

When multiple documents are combined into a corpus:

- DocIDs must be globally unique.
    
- SectionIDs must be globally unique.
    
- Every referenced DocID must exist.
    
- Every inline referenced SectionID must exist.
    

Unresolved references invalidate ECR compliance.

Corpus-wide validation ensures that constraint relationships are globally resolvable, structurally consistent, and free from identifier ambiguity. This enables deterministic graph construction and eliminates undocumented cross-document dependencies.

A downstream Constraint Graph implementation MUST:

- Treat validated structural artefacts as authoritative.
    
- Rebuild all derived indices deterministically from nodes and edges.
    
- Preserve graph identity independent of metadata.
    
- Ensure that metadata absence does not constitute a structural error.
	

These guarantees ensure that software architectural boundaries remain mechanically verifiable by coding agents as systems evolve.

---

## 2#7 - What ECR Does Not Do

ECR does not:

- Enforce stylistic Markdown rules
    
- Define semantic evaluation logic
    
- Interpret precedence
    
- Evaluate constraint satisfaction
    

ECR defines structure only.

Semantic interpretation belongs to constraint graph engines and higher-level systems.

---

## 2#8 - Minimal Compliant Example

```markdown
# 5.1 - Reporting - Evaluation Strategy

## 5.1#1 - Acceptance Criteria

Validation requirements are enforced per 3.1#2.

## 5.1#2 - Evaluation Pipeline

Retry semantics are applied per 8.1#3.

## References

- 3.1 - Ingestion - Validation Rules (authority - defines validation criteria enforced by evaluation)
- 8.1 - Workflow Orchestration Contract (constraint - retry semantics applied to evaluation runs)
```

---

## 2#9 - Consuming an ECR Corpus

An ECR-compliant corpus is navigable with `grep` and nothing else. The
identifiers are exact and the edges are plain text on disk, so a coding agent
resolves a reference by searching for it rather than by querying a service. This
is the intended primary use, and it requires no software beyond what the agent
already has.

The linter is optional. It checks that a corpus holds to the rules and extracts
structural artefacts; it is not needed to read a corpus, only to validate one.

Larger corpora may warrant a constraint graph engine that ingests those
artefacts and answers questions `grep` becomes slow at: transitive closure,
cycle detection, and precomputed reverse edges. Such an engine is a scale
optimisation, not a prerequisite. Adopt it when corpus size makes repeated
full-corpus scans painful, not before.

Whatever consumes the corpus, the following hold:

- The graph contains DocIDs, SectionIDs and typed edges.
- Section content is not part of graph identity.
- Document titles and heading text are informational metadata. They MUST NOT
  participate in structural identity, edge derivation, canonical ordering, or
  equality comparison of graph structure. A consumer may persist them, separately
  from structural state.
- Where a consumer persists structural artefacts and metadata together, it MUST
  commit them atomically, so that no mixed structural state is observable.
- ECR does not define canonical ordering of nodes or edges. A consumer MUST
  derive a deterministic ordering from stable identifiers.

ECR makes constraint topology explicit, and explicit topology is already
traversable. Anything further is a matter of speed, not of possibility.

---


## 2#10 - Common Mistakes

This section highlights common authoring errors that prevent documents from being ECR-compliant or from producing correct graph edges.

---

### 2#10.1 - ❌ Omitting the Section Separator

A sub-heading carries a SectionID, which always contains `#`. Writing the
identifier as dotted segments is the single most common mistake when migrating
an older corpus.

Incorrect:

```markdown
# 3.1 - Ingestion

## 3.1.1 - Validation Rules
```

Correct:

```markdown
# 3.1 - Ingestion

## 3.1#1 - Validation Rules
```

Without the separator, `3.1.1` is indistinguishable from document `3.1.1`, and a
corpus that contains both will produce colliding identifiers that no reader or
tool can resolve.

The dash between an identifier and its title is a different matter: hyphen-minus
(`-`), en dash (`–`) and em dash (`—`) are all accepted, because the dash
carries no structural meaning. Pick one for consistency if you like, but a
mixture will not fail validation.

---


### 2#10.2 - ❌ Writing Natural Language Instead of `see` or `per`

Only the following forms create inline edges:

- `see X`
    
- `per X`
    

Incorrect:

```markdown
The validation logic is defined in 3.1.2.
```

This does **not** create a graph edge.

Correct:

```markdown
The validation logic is enforced per 3.1#2.
```

If you do not use `see` or `per`, the reference will be ignored.

---

### 2#10.3 - ❌ Forgetting to Declare Referenced Documents

If you write:

```markdown
See 3.1#2.
```

Then your document must contain:

```markdown
## References

- 3.1 - Ingestion - Validation Rules (authority - ...)
```

An inline reference cannot target a document the References section does not declare. When you lint the corpus, a reference to a document that exists but is not declared is an error.

**Numbers in ordinary prose.** `see` and `per` are also ordinary English: "100 requests per 60 seconds", "see 3 examples below". The linter reads these as references to DocIDs `60` and `3` and warns that they are undeclared. Because no such documents exist, they stay warnings and never fail validation. You can leave them as they are, or rephrase ("100 requests every 60 seconds") to silence them.

---

### 2#10.4 - ❌ Skipping Numbering Levels

Headings must carry a correctly formed SectionID.

Incorrect:

```markdown
# 3.1 - Title

### 3.1#1.1 - Subsection
```

Correct:

```markdown
# 3.1 - Title

## 3.1#1 - Section

### 3.1#1.1 - Subsection
```

The number of numeric segments must match heading depth.

---

### 2#10.5 - ❌ Duplicate DocIDs Across the Corpus

Each document must have a globally unique DocID.

Incorrect:

Two documents both begin with:

```markdown
# 3.1 - Something
```

This will invalidate the corpus.

---

### 2#10.6 - ❌ Duplicate SectionIDs Within a Document

Each numbered heading must be unique.

Incorrect:

```markdown
## 3.1#1 - Section A
## 3.1#1 - Section B
```

Section identifiers must not repeat.

---

### 2#10.7 - ❌ Malformed References Entries

Each References entry must follow this exact structure:

```
- {DocID} - {Title} ({direction} - {explanation})
```

Common mistakes:

- Missing parentheses
    
- Missing explanation
    
- Using a direction not in the allowed list
    
- Missing the spaces around a separator dash (`3.1-Title` rather than `3.1 - Title`)
    

Allowed direction values:

- `authority`
    
- `dependency`
    
- `constraint`
    
- `contract`
    

---

### 2#10.8 - ❌ Assuming Content Is Part of Graph Identity

ECR graphs are built from:

- DocIDs
    
- SectionIDs
    
- Typed edges
    

Editing section text does not affect graph identity.

This includes changes to:

- Document titles (H1 heading text)
- Section heading text (heading titles)

Only changes to DocIDs, SectionIDs, or references change the structural graph.

---

### 2#10.9 - ❌ Forgetting the `## References` Section Entirely

Every ECR document must include exactly one `## References` section.

The `## References` section defines document-level edges. Inline references (`see X`, `per X`) define section-level edges. Both are structural: missing either changes what can be represented and validated.

Even if a document references no other documents, it must still include:

```markdown
## References
```

The heading with no list beneath it is valid: it declares that the document has no external references, and the linter reports it as information rather than an error.

---

## 2#11 - Migrating Existing Documentation to ECR

Most teams adopting ECR already have an existing Markdown corpus.

This section describes a practical, low-risk migration strategy.

ECR can be adopted incrementally.

---

### 2#11.1 - Step 1 — Assign Stable Document IDs

Start by assigning a DocID to each document.

Add a numbered H1 to the top of every file:

```markdown
# 7.1 - Storage Layer
```

Guidelines:

- Choose a numbering scheme that reflects your architecture.
    
- Keep IDs stable once assigned.
    
- Do not reuse numbers.
    
- Do not change IDs casually — they form graph identity.
    

At this stage, do not modify internal headings or references.

---

### 2#11.2 - Step 2 — Normalize Heading Structure

For each document:

- Ensure there is exactly one H1.
    
- Ensure sub-headings use the `DocID#section-path` form.
    
- Ensure heading depth matches numbering depth.
    

Example conversion:

Before:

```markdown
## Storage Modes
```

After:

```markdown
## 7.1#1 - Storage Modes
```

Do this one document at a time.

Run the linter after each file.

---

### 2#11.3 - Step 3 — Introduce the References Section

Add a `## References` section to each document.

Start with the obvious references — documents the text already cites.

Example:

```markdown
## References

- 3.1 - Ingestion - Validation Rules (authority - defines validation behaviour implemented here)
```

Do not worry about perfection initially.

Focus on capturing major relationships first.

---

### 2#11.4 - Step 4 — Convert Natural Language References

Search for numeric cross-references:

- “defined in 3.1.2”
    
- “see section 8.1”
    
- “as described in 2.4”
    

Convert them to valid inline forms:

```markdown
per 3.1#2
see 8.1
```

Only `see` and `per` create edges.

If referencing a section such as `3.1#2`, ensure `3.1` appears in the References section.

---

### 2#11.5 - Step 5 — Resolve Linter Errors

Once the corpus is fully numbered:

- Fix duplicate DocIDs.
    
- Fix duplicate SectionIDs.
    
- Resolve missing referenced documents.
    
- Correct malformed References entries.
    

Run corpus-wide validation to ensure global uniqueness and resolution.

---

### 2#11.6 - Incremental vs Big-Bang Migration

Two strategies are possible:

#### 2#11.6.1 - Incremental Migration (Recommended)

- Convert one architectural layer at a time.
    
- Ensure internal consistency within that layer.
    
- Gradually extend ECR coverage outward.
    

This reduces risk and review overhead.

---

#### 2#11.6.2 - Big-Bang Migration

- Assign DocIDs to all documents.
    
- Normalize all headings.
    
- Add References sections everywhere.
    
- Convert all inline references.
    

Only recommended for small corpora.

---

### 2#11.7 - Using an LLM to Assist Migration

LLMs can accelerate migration when used carefully.

Recommended approach:

1. Select a single document.
    
2. Provide the model with:
    
    - The document text
        
    - The ECR rules
        
    - The target DocID
        
3. Ask the model to:
    
    - Normalize headings
        
    - Add a References section
        
    - Convert natural references to `see` / `per`
        

Review changes manually.

Do not migrate the entire corpus in one pass.  
Work layer by layer to prevent numbering drift.

---

### 2#11.8 - Maintaining Stability After Migration

After migration:

- Treat DocIDs as stable identities.
    
- Avoid renumbering.
    
- Add new sections by extending numbering.
    
- Add new documents with new DocIDs.
    
- Do not “reuse” retired IDs.
    

ECR relies on identifier stability.

---

### 2#11.9 - Common Migration Pitfalls

- Renumbering documents after adoption.
    
- Forgetting to declare newly referenced documents.
    
- Letting an LLM “optimize” numbering across files.
    
- Migrating too many files simultaneously.
    

Adopt gradually. Validate continuously.

---

## 2#12 - Why Migration Is Worth It

Once a corpus is ECR-compliant:

- Constraint relationships become explicit.
    
- Drift becomes detectable.
    
- Cross-document governance becomes traversable.
    
- Agentic systems can reason over structure deterministically.
    

Once ECR-compliant, a documentation corpus becomes structurally auditable. Constraint relationships are explicit, globally resolvable, and mechanically validated. This reduces architectural drift, improves cross-team governance, and enables deterministic reasoning over institutional knowledge by coding agents.

For software teams building agentic systems, this transforms documentation from passive reference material into enforceable structural infrastructure.

---

## 2#13 - Why These Rules Matter

ECR works because it removes ambiguity.

If constraint relationships are not written in the exact, structured form ECR defines, they cannot be reliably composed into a Constraint Graph.

ECR is strict by design.

That strictness enables deterministic traversal and reliable agent reasoning.

---

## References

- 1 - ECR - Structural Specification (authority - the formal structural specification for ECR)
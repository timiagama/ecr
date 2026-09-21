# 1 - ECR - Structural Specification

**Version:** 1.0.0

## 1#1 - Purpose

`@timiagama/ecr` is a structural linter. It is the reference implementation of the formal structural specification for **Explicit Constraint Referencing (ECR)**.

ECR exists to expose the otherwise hidden interdependent constraints within a document corpus.  

The linter exists to validate ECR-ready documents against ECR’s formal structural specification.

This implementation of ECR operates exclusively on Markdown documents.

Once validated by the linter, the ECR relationships within a corpus form an
explicit graph — one that a coding agent traverses directly, by searching the
raw Markdown with ordinary text search. Nothing sits between the documents and
the agent reading them: no server, no index, no embeddings.

The linter exists to give that traversal its guarantee. In a corpus that passes,
every identifier is unique and every reference resolves, so a search that finds
nothing can be trusted to mean that nothing is there.

The linter does not build graphs or perform file discovery. Its responsibilities are limited to:

- Validating Markdown documents against the ECR specification
	
- Extracting structured artefacts from valid documents
	
In other words, the linter provides the structural guarantees required for other systems to operate deterministically. It operates purely over `(uri, text)` inputs and produces structured diagnostics and extracted artefacts, where `uri` is an opaque, host-provided identifier for a document instance e.g.  `file:///.../docs/3.1-scenario-authoring.md`.

The linter is embedded by a **host**: any program that discovers documents,
feeds them in, and decides what to do with the results. A host is expected to be
a modest thing — a command-line tool, a CI job, an editor integration.

The package also ships a command-line tool, `ecr`. The CLI is a host in the sense above: it performs the file discovery the linter does not, feeds each document to the linter, and reports the result with an exit code suitable for CI. The constraints this specification places on the linter — no IO, no file discovery, no CI concerns — apply to the library API, not to the CLI built on it.
	

### 1#1.1 - Formal Specification Clarification

- ECR is not an independent markup language. It is a structural annotation layer applied to Markdown documents in accordance with ECR rules.
	
- The ECR grammar is therefore meaningful only in the context of an abstract syntax tree (AST) representing the underlying Markdown document.
	

---

## 1#2 - Why Explicit Constraint Referencing Exists

Coding agents and reasoning systems operate over visible text.

Architectural and institutional systems, however, are governed by constraints that are interdependent. Humans implicitly understand that:

- constraints reference other constraints
    
- some documents govern others
    
- contracts define obligations
    
- local sections are governed by external rules
    

Markdown does not encode this constraint topology explicitly. It flattens structure into prose, numbering conventions, and informal cross-references.

As documentation grows, constraint topology becomes illegible to agents. The result is not hallucination, but structural blindness:

- locally correct changes that violate global constraints
    
- failure to traverse governing authorities
    
- misapplication of precedence
    
- omission of cross-document obligations
    

ECR exists to make the implicit constraint graph explicit by requiring:

- stable document and section identifiers
    
- mandatory declaration of document-level references
    
- typed relationships between documents
    
- explicit inline references to governing sections
    

ECR does not add new information. It formalizes existing constraint topology so that agentic systems can traverse it deterministically.

---

## 1#3 - Architectural Scope

### 1#3.1 - Responsibilities

The linter is responsible for:

- parsing Markdown into an **Abstract Syntax Tree (AST)**
    
- validating ECR structural invariants per document
    
- extracting:
    
    - document identity
        
    - section hierarchy
        
    - typed document-level references
        
    - inline section-level references
        
- validating corpus-wide referential integrity **when provided the corpus inputs**:
    
    - duplicate DocIDs
        
    - duplicate SectionIDs
        
    - unresolved references
        

### 1#3.2 - Non-Goals

The linter is **not**:

- a Markdown style linter
    
- a formatting tool
    
- a documentation generator
    
- a graph builder
    
- a filesystem crawler
    
- a CI enforcement engine
    
- a governance or policy framework
    

File discovery belongs to the host environment.  
Traversing the graph belongs to whoever reads the corpus — an agent with a text
search needs nothing built first.  
CI integration belongs to downstream tooling.

The bundled `ecr` CLI is one such host and one such piece of downstream tooling (see 1#1): it discovers files and returns CI exit codes so that the linter itself does not have to.

---

## 1#4 - Design Rationale

### 1#4.1 - Why Markdown

ECR is embedded in Markdown because:

- Markdown is the de facto medium for architectural and operational documentation.
    
- It is human-native, diffable, and widely supported across repos and tooling.
    
- ECR constrains structure without introducing a new authoring surface.
    

ECR does not redefine Markdown. It defines structural invariants over Markdown ASTs.

### 1#4.2 - Why a Formal Structural Specification

ECR is formally specified to:

- prevent interpretation drift
    
- enable deterministic validation
    
- provide a stable contract between documentation and tooling
    
- support multiple host integrations
    

The grammar defines invariants over AST(M), not over raw Markdown text.

### 1#4.3 - Why AST Traversal Requires a Visitor Pattern

The linter validates documents by traversing the Markdown AST because ECR rules apply to specific node types and structural contexts.

Examples of rules that require structural traversal:

- inline references must be detected only in prose nodes and ignored inside code, inline code, HTML blocks, and link URLs
    
- section identity and hierarchy must be derived from heading nodes and maintained as heading depth changes
    
- the References section must be detected as a specific heading followed by a list of entries
    

The Visitor pattern provides a clean separation between traversal mechanics and rule logic while maintaining deterministic evaluation order.

---

## 1#5 - Tech Stack

The linter leverages mature components from the unified Markdown ecosystem:

- `unified` - the processing pipeline that hosts the parser
    
- `remark-parse` - Markdown → AST(M)
    
- `mdast-util-to-string` - extract plain text from AST nodes (e.g., headings)
    

No custom Markdown parser is implemented.

---

## 1#6 - Document Conventions (Non-Formal)

This section provides a human-readable description of ECR authoring conventions before the formal specification.

### 1#6.1 - Document Identity

Every document begins with a numbered H1 heading:

```
# 3.1 - Ingestion - Validation Rules
```

The number (`3.1`) is the document’s stable identity (DocID).

---

### 1#6.2 - Hierarchical Sub-Headings

All sub-headings are numbered relative to the H1 DocID:

```
# 3.1 - Ingestion - Validation Rules

## 3.1#1 - Mode-Aware Prompt Strategy

### 3.1#1.1 - Expert Mode Prompts

## 3.1#2 - Guardrail Stack

```

Each numbered heading defines a stable SectionID.

---

### 1#6.3 - Inline References

Inline references create section-level edges.

Valid forms:

```
The validation logic is defined per 3.1#2.
The retry semantics are enforced per 8.1#3.
For context assembly see 3.7#2.

```

Rules:

- Only `see X` and `per X` forms are valid.
    
- `X` must be numeric (DocID or SectionID).
    
- If referencing a section `X#Y`, its DocID `X` must be declared in the References section (unless `X` is the current document).
    
- Inline references are ignored inside code blocks and inline code.
    

---

### 1#6.4 - References Section (Mandatory)

Every document MUST include:

```
## References

```

Followed immediately by a list of referenced documents.

Example:

```
## References

- 3.1 - Ingestion - Validation Rules (authority - defines validation logic that evaluation must enforce)
- 8.1 - Workflow Orchestration Contract (constraint - retry semantics applied to orchestration)


```

Format:

```
- {DocID} - {title} ({direction} - {explanation})
```

Allowed direction values:

- authority
    
- dependency
    
- constraint
    
- contract
    

References define document-level edges and legitimize inline references.

---

### 1#6.5 - Minimal Compliant Document

```
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

## 1#7 - Direction Semantics

Direction labels appear only within References entries.

Edges are directed:

```
Current DocID → Target DocID

```

Direction labels describe semantic meaning:

- **authority** - the referenced document governs the current document
    
- **dependency** - the current document consumes the referenced document
    
- **constraint** - the referenced document imposes restrictions on the current document
    
- **contract** - the referenced document defines structural obligations
    

Direction labels do not alter graph direction.

---

## 1#8 - Visitor and State Model

### 1#8.1 - Visitor Pattern

The linter validates documents by traversing the Markdown Abstract Syntax Tree (AST) using a Visitor pattern.

Traversal is required because ECR rules apply to specific node types and structural contexts.

Examples:

- Heading nodes define SectionIDs and hierarchy.
    
- Text nodes may contain inline references.
    
- Code nodes must suppress inline reference detection.
    
- The References section must be detected structurally.
    

---

### 1#8.2 - Validation State

The linter maintains two internal state models during traversal.

#### 1#8.2.1 - ValidationState

Accumulates extracted artefacts:

- docId
    
- sections
    
- references
    
- inlineReferences
    
- diagnostics
    

#### 1#8.2.2 - CursorState

Tracks structural position:

- currentSectionId
    
- headingStack (depth-aware)
    
- inReferencesSection
    

The heading stack enables correct parent-child derivation across heading depth transitions.

State management is necessary to ensure deterministic evaluation and accurate edge attribution.

---

## 1#9 - ECR Formal Structural Specification

### 1#9.1 - AST Model

Let `M` be a valid Markdown document.  
Let `AST(M)` be its parsed Markdown **Abstract Syntax Tree (AST)**.

ECR compliance is defined as a predicate over `AST(M)`.

All validation operates on AST nodes, not raw text.

---

### 1#9.2 - Identity Definitions

#### 1#9.2.1 - DocID

```
DocID ::= Digit+ ("." Digit+)*
```

Examples:

```
1
3.1
7.12
2.4.3
```

#### 1#9.2.2 - SectionID

```
SectionPath ::= Digit+ ("." Digit+)*
SectionID   ::= DocID "#" SectionPath
```

A SectionID names a section of exactly one document: the DocID before the `#`
separator. The separator is mandatory.

Without it a dotted identifier has more than one legal reading. In a corpus
containing both a document `0.0` and a document `0.0.2`, the identifier
`0.0.2.1` would denote either section 1 of document `0.0.2` or section 2.1 of
document `0.0`, and both readings would occur. The separator removes the
ambiguity by construction, which is what makes SectionIDs globally unique and
reference resolution possible without a corpus index (see 3).

---

### 1#9.3 - Document Identity Rule

There MUST exist exactly one heading node in `AST(M)` such that:  **[ECR101]**

- `depth = 1`
    
- `toString(heading)` matches:
    

```
DocID " - " Title
```

Where:

- `DocID` conforms to the grammar above
    
- `Title` is any non-empty string
    
- `" - "` stands for any dash separator permitted by 1#9.4
    

The DocID extracted from the H1 heading defines the document identity.

---

### 1#9.4 - Section Structure Rules

For every heading node with `depth ≥ 2`:

1. The textual prefix MUST match a valid `SectionID`.
2. The `SectionID`’s DocID MUST equal the document’s `DocID`.
3. Let `d = heading depth`. The number of segments in the `SectionID`’s section
   path MUST equal:

```
d - 1
```

Where:

```
segments(X) ::= number of numeric components separated by "."
```

The document’s own DocID depth does not enter the calculation: an H2 carries a
one-segment section path whether the document is `1` or `2.4.3.9`.

Example:

```
DocID = 3.1

# 3.1 - Title        → depth = 1  → no section path
## 3.1#1 - Sec       → depth = 2  → section path "1"    → 1 segment
### 3.1#1.2 - Sub    → depth = 3  → section path "1.2"  → 2 segments
```

A heading that violates the depth-to-section-path rule is invalid.

4. For a heading of depth `d ≥ 3`, the section path without its last segment MUST equal the section path of its parent — the nearest preceding heading of depth `d - 1`. `3.1#2.1` sits under `3.1#2`, never under `3.1#1`. This is what makes a SectionID self-locating: its number alone says where in the document it lives.

A heading separates its identifier from its title with a dash:

```
DocID <dash> Title
SectionID <dash> Title
```

The dash MAY be a hyphen-minus (U+002D), an en dash (U+2013) or an em dash
(U+2014), with any surrounding whitespace. The variant carries no structural
meaning: identity is carried entirely by the identifier, so rejecting a variant
would fail documents that are perfectly navigable. Corpora are free to require
one variant for consistency, but that is a style concern, not a structural one.

---

### 1#9.5 - Inline Reference Rules

Inline references are detected only within `text` nodes whose ancestor chain does NOT include:

- code
    
- inlineCode
    
- html
    
- link (URL portion)
    

Valid inline reference forms are:

```
see TargetID
per TargetID
```

Where:

```
TargetID ::= DocID | SectionID
```

Rules:

1. `TargetID` MUST be numeric and conform to grammar.
    
2. The DocID of a `TargetID` is the `TargetID` itself if it is a DocID, or the text before the `#` if it is a SectionID (`X#Y`).
    
    - That DocID MUST appear in the References section, unless it is the current document’s own DocID.
        
3. Inline references MUST NOT target an undeclared document. No edge is extracted for an undeclared target. How the violation is reported depends on the form of the target, and on what the linter can know:
    
    - A SectionID target (`see 3.1#2`) is an ERROR. The `#` form never occurs in ordinary prose, so the target is certainly a reference and its declaration is missing.
        
    - A DocID target (`see 3.1`, `per 60`) is a WARNING within a single document. The words `see` and `per` followed by a number also occur in ordinary prose (`100 requests per 60 seconds`), and one document alone cannot tell such prose from a reference whose declaration is missing.
        
    - Across a corpus, an undeclared DocID target that is a document in the corpus is an ERROR: it is a real reference whose declaration, and with it the direction and explanation of the edge, is missing. One that names no document remains a WARNING.
        
4. The keyword and the `TargetID` MUST be adjacent plain text. Where inline formatting separates them — the `TargetID` begins a link, bold, italic or strikethrough span that directly follows the keyword, as in `see [8.1#3](…)` — the reference is invisible to a text search, so no edge is extracted and a WARNING is emitted.
    

---

### 1#9.6 - References Section Rules (Mandatory)

There MUST exist exactly one depth-2 heading node (`##`) whose text is:

```
References
```

The entries are the items of the list node that immediately follows this heading.

A References section with no list declares that the document has no external references. This is valid: the linter reports it as `info`, not as an error.

Each list item MUST match exactly:

```
TargetDocID " - " Title " (" Direction " - " Explanation ")"
```

Where:

`Title` is any non-empty string, each `" - "` stands for a separator as defined in rule 5, and

```
TargetDocID ::= DocID
Direction   ::= authority | dependency | constraint | contract
```

Rules:

1. Each `TargetDocID` MUST be unique within the References section.
2. Inline references to `X` or `X#Y` require that `X` appears as a `TargetDocID`, unless `X` is the current document's own DocID.
3. `Direction` MUST be one of the allowed enumeration values.
4. `Explanation` MUST be non-empty text.
5. Each separator is a single space, a dash, and a single space. The dash MAY be a hyphen-minus (U+002D), an en dash (U+2013) or an em dash (U+2014), as in headings (1#9.4); the variant carries no structural meaning.

Example:

```
- 3.1 - Ingestion - Validation Rules (authority - defines validation logic enforced by this document)
- 8.1 - Workflow Orchestration Contract (constraint - defines retry semantics applied to this workflow)
```


---

### 1#9.7 - Direction Label Semantics

Edges are always directed:

```
SourceDocID → TargetDocID
```

Direction labels define semantic meaning only:

- authority - TargetDocID governs SourceDocID
    
- dependency - SourceDocID consumes TargetDocID
    
- constraint - TargetDocID imposes restrictions on SourceDocID
    
- contract - TargetDocID defines structural obligations for SourceDocID
    

Direction does not reverse edge orientation.

---

### 1#9.8 - Per-Document Structural Invariants

Within a single document:

- Exactly one valid H1 DocID
    
- SectionIDs unique within document
    
- References section present exactly once
    
- All inline references syntactically valid
    
- No duplicate TargetDocID entries in References
    
Violation of any rule is an ERROR.

---

### 1#9.9 - Corpus-Wide Invariants

When validating a corpus of documents:

1. DocID MUST be globally unique.
    
2. SectionID MUST be globally unique across corpus.
    
3. Every TargetDocID in References MUST resolve to an existing DocID.
    
4. Every inline TargetID MUST resolve to an existing DocID or SectionID.
    
5. A References entry's `title` SHOULD match the title in the target document's H1. Where it does not, emit a WARNING whose diagnostic payload carries the canonical title.
    

Violation of rules 1–4 is an ERROR. Rule 5 is a WARNING only: titles are not part of graph identity (1#9.10), so a stale title never fails validation. It is a corpus-wide rule because the target's title is only known once the corpus is indexed.

---

### 1#9.10 - Graph Identity Model

The ECR graph consists solely of:

- Node identities:
    
    - DocID
        
    - SectionID
        
- Directed edges:
    
    - (SourceDocID → TargetDocID)
        
    - Typed by Direction
        
- Section-level inline references
    

The graph excludes:

- Document titles (H1 text)
    
- Section heading text (heading titles)

- Section content
    
- Line numbers
    
- File paths
    
- Formatting metadata
    

Although the linter extracts `title` fields for documents and sections, these are **metadata for display and diagnostics only**. They MUST NOT participate in node identity, edge identity, canonical ordering, or any equality comparison of graph structure.

Graph identity MUST remain stable under edits to document titles, section heading text, and section content, provided DocIDs, SectionIDs, and references remain unchanged.

---

## 1#10 - Output Schema (Normative)

This section defines the normative output schema produced by the linter. The schema mirrors the ECR formal structural specification and is host-agnostic: it reports what the linter found and assumes nothing about what the host does next.

### 1#10.0 - URI Semantics (Normative)

All linter APIs accept and return a `uri` string.

`uri` is an opaque, host-provided identifier for a document instance. It MUST be stable within the scope of a validation run and SHOULD be stable across runs when the underlying document is the same.

Examples include (but are not limited to):

* `file:///.../docs/3.1-scenario-authoring.md`
* `obsidian://vault/Architecture/3.1.md`
* an editor-internal URI provided by an LSP client

The linter treats `uri` as an identifier only:

* It is used to associate diagnostics with a source document.
* It is used by host environments to map extracted identifiers to concrete files.

`uri` is **not** part of ECR identity. Graph identity is defined solely by `DocID` and `SectionID`.

---

### 1#10.1 - Core Types

The linter operates over `(uri, text)` inputs and returns:

- structured diagnostics
    
- extracted structural artefacts
    

All identifiers are lexical identifiers defined by ECR:

- `DocID`
    
- `SectionID`
    

No section content or line numbers are part of the extracted graph artefacts.

---

### 1#10.2 - LintResult

A lint operation over a single Markdown document returns:

```ts
type LintResult = {
  input: {
    uri: string
    version?: number
  }

  ok: boolean
  diagnostics: Diagnostic[]

  extracted?: ExtractedDocument
}
```

Semantics:

- `ok = true` iff the document satisfies per-document ECR structural invariants.
    
- `extracted` is present only when a valid `DocID` is recovered and structural extraction succeeds sufficiently to produce stable identifiers.
    

---

### 1#10.3 - Diagnostic

Diagnostics are host-agnostic and can be mapped into LSP diagnostics or rendered in other UIs.

```ts
type Diagnostic = {
  severity: "error" | "warning" | "info"
  ruleId: string
  message: string

  uri: string

  range?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }

  docId?: string
  sectionId?: string

  data?: Record<string, unknown>
}
```

Notes:

- `range` is optional and depends on whether positional metadata is available from the Markdown parser.
    
- `docId` and `sectionId` provide structural context when determinable.
    

---

### 1#10.4 - ExtractedDocument

`ExtractedDocument` is the canonical structural representation of a single ECR document.

```ts
type ExtractedDocument = {
  docId: DocID
  title: string

  sections: SectionNode[]
  references: ReferenceEdge[]
  inlineReferences: InlineReferenceEdge[]
}
```

Constraints:

- `docId` is extracted from the H1 heading.
    
- `sections` includes the H1 as the root section node and all numbered headings thereafter.
    
- `references` ReferenceEdge[]  // each References list item yields (toDocId, title, direction, explanation) extracted verbatim from the `## References section`
    
- `inlineReferences` are extracted only from valid inline forms: `see TargetID` and `per TargetID`.
    
`title` is extracted for human/agent display and diagnostics. It is not part of ECR identity. Consumers may persist `title` as metadata and MUST treat graph structure as independent of title text.


---

### 1#10.5 - SectionNode

```ts
type SectionNode = {
  id: DocID | SectionID
  title: string

  headingDepth: number

  parentId?: DocID | SectionID
}
```

Constraints:

- The H1 node has `id = DocID`, `headingDepth = 1`, and no `parentId`.
    
- For headings of depth ≥ 2:
    
    - `id` MUST be a `SectionID`.
        
    - `parentId` MUST be the nearest preceding heading whose depth is exactly `headingDepth - 1`.
        
- `headingDepth` MUST align with the depth-to-segment rule in the formal specification.
    
Notes:

- `title` is extracted for human/agent display and diagnostics only.
- `title` MUST NOT be treated as part of ECR structural identity.
- Downstream consumers may persist `title` as metadata, but MUST keep it separately from the structural graph representation.
	

---

### 1#10.6 - ReferenceEdge

Each References section list item defines a document-level typed edge:

```ts
type ReferenceEdge = {
  fromDocId: DocID
  toDocId: DocID

  direction: "authority" | "dependency" | "constraint" | "contract"
  explanation: string

  title: string
}
```

Constraints:

- `fromDocId` is the current document’s DocID.
    
- `toDocId` is the TargetDocID from the References entry.
    
- `explanation` MUST be non-empty text.
    
- `title` MUST be non-empty text and MUST be extracted from the References entry.
    

---

### 1#10.7 - InlineReferenceEdge

Each inline reference defines a section-attributed edge:

```ts
type InlineReferenceEdge = {
  fromId: DocID | SectionID
  toId: DocID | SectionID

  kind: "see" | "per"
}
```

Constraints:

- `fromId` is the current section context in which the inline reference occurs:
    
    - the most recent heading identifier in document order at the time the reference is encountered
        
- `toId` is the referenced TargetID
    
- Inline references MUST NOT target an undeclared document:
    
    - if `toId` is `X` or `X#Y`, then `X` MUST appear in the References section of the current document, unless `X` is the current document’s own DocID; an undeclared target yields no edge, and is reported as described in 1#9.5 rule 3
        
- Every `toId` MUST resolve to an existing identifier in the corpus (DocID or SectionID).
	

---

### 1#10.8 - CorpusResult

When validating a corpus, the host supplies a set of documents. The linter returns corpus-wide diagnostics and an index suitable for graph construction.

```ts
type CorpusResult = {
  documents: Array<{
    uri: string
    result: LintResult
  }>

  index?: {
    docIds: Record<DocID, string>         // DocID -> uri
    sectionIds: Record<SectionID, string> // SectionID -> uri
  }

  diagnostics: Diagnostic[]
}
```

Constraints:

- Corpus-wide validation enforces:
    
    - global uniqueness of DocIDs and SectionIDs
        
    - resolution of References TargetDocIDs to existing DocIDs
        
    - resolution of inline TargetIDs to existing headings
        
    - agreement of References titles with their targets' H1 titles (warning only)
        

All corpus-wide failures are errors, except a References title mismatch, which is a warning (1#9.9 rule 5).

---

## 1#11 - Validation Algorithm Overview (Deterministic)

This section describes the deterministic two-pass validation strategy used by the linter.

### 1#11.1 - Pass 1: Per-Document Parse, Validate, Extract

For each input document `(uri, text)`:

1. Parse Markdown into `AST(M)`.
    
2. Extract the H1 `DocID` and title.
    
3. Traverse heading nodes to extract:
    
    - all section identifiers
        
    - parent-child relationships via heading depth
        
4. Locate the `## References` section and extract all `ReferenceEdge` entries.
    
5. Traverse prose text nodes to extract `InlineReferenceEdge` entries in valid `see/per` forms, excluding code/inlineCode/HTML/link URL contexts.
    
6. Emit per-document structural diagnostics.
    

If per-document structural invariants fail, the document is not considered valid for graph ingestion.

---

### 1#11.2 - Pass 2: Corpus-Wide Integrity Checks

Given the set of extracted documents:

1. Build a global index of `DocID -> uri`.
    
2. Build a global index of `SectionID -> uri`.
    
3. Validate global uniqueness:
    
    - duplicate DocIDs are errors
        
    - duplicate SectionIDs are errors
        
4. Resolve all `ReferenceEdge.toDocId` targets against the DocID index, and compare each resolved entry's `title` with the target's H1 title.
    
5. Resolve all `InlineReferenceEdge.toId` targets against the union of DocID and SectionID indexes.
    
6. Validate that each inline reference’s parent DocID is declared in References. For each undeclared target reported in Pass 1, emit an error if its DocID is in the DocID index (1#9.5 rule 3).
    

Emit corpus-wide diagnostics. Corpus-wide failures are errors; a title mismatch found in step 4 is a warning.

---

## 1#12 - Error Classification Philosophy

### 1#12.1 - Structural Errors (Always ERROR)

- missing or invalid H1 DocID
    
- invalid section numbering / hierarchy
    
- missing References section
    
- malformed References entries
    
- an inline reference to a SectionID (`X#Y`) whose DocID `X` is not declared in References
    

### 1#12.2 - Referential Integrity Errors (Always ERROR)

- duplicate DocID
    
- duplicate SectionID
    
- unresolved References targets
    
- unresolved inline targets
    
- an inline reference to a document in the corpus that the References section does not declare
    

### 1#12.3 - Advisory Findings (WARNING or INFO)

- a References entry whose title differs from its target's H1 title (WARNING)
    
- an inline `see`/`per` DocID target (no `#`) that is not declared, where no such document exists in the corpus or no corpus is available (WARNING)
    
- an inline reference whose identifier is wrapped in a link or formatting (WARNING)
    
- a References section with no entries (INFO)
    

These never fail validation.

---

## 1#13 - Public Interface Contract

The public API of the linter MUST:

- accept `(uri, text)` inputs
    
- return structured diagnostics
    
- return extracted structural artefacts
    
- remain host-agnostic
    

It MUST NOT:

- discover files
    
- perform IO
    
- build graphs
    
- persist state
    
- log, or write to the console: everything the linter has to report is in the result it returns, and a host that wants logs writes them around the call
    
- assume CLI or editor context
    

Host environments are responsible for:

- file enumeration
    
- aggregation across a corpus
    
- graph construction
    
- presentation of diagnostics
    

The bundled `ecr` CLI is such a host environment. It performs file enumeration and presents diagnostics; the library API it calls remains bound by the constraints above.

---

## 1#14 - Versioning

This document defines **ECR**.

Future versions may extend:

- direction labels
    
- validation rules
    
- structural constraints
    

Any backward compatibility expectations must be documented per version.

---

## References

- 3 - Design Rationale - The Section Separator (dependency - records why the section separator exists and what it replaced)


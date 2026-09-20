# TypeScript Engineering Standard

## 1. Purpose

This standard defines the engineering properties expected of TypeScript code.

It is designed for capable engineers and frontier coding models. It establishes required invariants, engineering principles, and defaults without prescribing routine implementation decisions that are better resolved from context.

### 1.1 Exercise Engineering Judgment

This standard is not a substitute for engineering judgment.

Where no explicit constraint applies, choose the solution that best fits:

- the existing codebase;
- the domain;
- the task;
- established TypeScript and Node.js practice; and
- the simplest design that remains robust and maintainable.

Do not mechanically apply a guideline when doing so would make the code less clear, less correct, or less maintainable.

### 1.2 Repository-Specific Requirements

Follow explicit repository architecture, conventions, configuration, and local engineering requirements.

Repository-specific requirements may specialize the defaults in this standard. They do not implicitly override its non-negotiable invariants unless an explicit project requirement documents the exception.

A repeated pattern in existing code is not necessarily an intentional current convention. Prefer documented or mechanically enforced repository requirements when they conflict with incidental or legacy patterns.

---

## 2. Core Engineering Principles

Code should optimize for:

- correctness;
- readability;
- maintainability;
- clear separation of concerns;
- small and deliberate public interfaces;
- explicit domain concepts and invariants;
- robustness at system boundaries; and
- minimal accidental complexity.

Prefer deep modules: hide implementation complexity behind interfaces that are simpler than the implementation they encapsulate.

Prefer code whose intent can be understood from its structure, types, and names rather than from explanatory commentary.

Correct compilation and passing tests are necessary but not sufficient. Completed code must also fit the relevant architecture, preserve its invariants, and remain understandable and maintainable.

---

## 3. Non-Negotiable Invariants

### 3.1 Preserve Type Safety

Do not resolve a type error by weakening the type system unless the domain genuinely requires a less constrained type.

Do not use type-system escape hatches to avoid modelling or fixing a type problem.

Where an unavoidable untyped or incorrectly typed boundary requires an escape hatch:

- contain it at that boundary;
- make the reason explicit;
- keep the unsafe surface as small as practical; and
- prefer mechanisms that fail when the exception is no longer required.

Prefer `unknown` and runtime narrowing over `any`.

Do not introduce unjustified assertions, non-null assertions, suppression directives, or unnecessarily broad types merely to satisfy the compiler.

### 3.2 Validate Runtime Boundaries

TypeScript types do not validate runtime data.

Validate and parse data when it crosses from an untrusted or independently evolving runtime source into the trusted application boundary.

Examples include:

- HTTP input;
- external API responses;
- deserialized data;
- files;
- environment variables;
- message queues;
- user-controlled input; and
- other systems whose runtime contract cannot be guaranteed by the local compiler.

Do not repeatedly revalidate data after it has entered a trusted, typed boundary unless the architecture requires it.

### 3.3 Do Not Hide Failures

Failures must remain visible to an appropriate owner.

Do not silently swallow errors or convert failures into apparently successful outcomes merely to simplify control flow.

Preserve enough information for failures to be diagnosed, including the original cause where appropriate.

### 3.4 Preserve Behavioural Protection

A change must not reduce the test suite's protection of existing supported behaviour unless that behaviour is intentionally being changed.

New or corrected behaviour must receive appropriate protection against regression.

### 3.5 Satisfy Repository Quality Gates

Completed code must satisfy all applicable repository-defined mechanical quality gates.

Quality gates are defined by the repository rather than by this generic standard.

---

## 4. TypeScript and Type Design

### 4.1 Use Types to Model the Domain

Types should express meaningful distinctions in the domain rather than merely describe JavaScript storage shapes.

Where states have different valid data or behaviour, model those distinctions explicitly.

Prefer representations that make invalid states difficult or impossible to construct.

### 4.2 Be Explicit at Important Boundaries

Use explicit types where they establish an important contract, particularly for:

- exported functions;
- public methods;
- public properties;
- external interfaces;
- callbacks crossing module boundaries;
- structures representing important domain concepts; and
- places where inference would obscure intent.

Within an implementation, prefer TypeScript inference when the inferred type is clear, precise, and stable.

Do not duplicate type information merely for verbosity.

### 4.3 Prefer `unknown` to `any`

Use `unknown` for values whose type has not yet been established.

Narrow or validate the value before use.

Use `any` only where loss of type information is unavoidable and deliberate.

### 4.4 Treat Type Assertions as Escape Hatches

An assertion tells the compiler something it cannot prove.

Prefer narrowing, validation, better modelling, or a better API over an assertion.

Do not use assertions to conceal uncertainty about runtime data.

### 4.5 Make Absence Explicit

Represent optionality and absence deliberately.

Do not interchange `undefined`, `null`, missing properties, empty strings, sentinel values, and other representations of absence without a domain reason.

### 4.6 Prefer Exhaustive Handling

When a finite set of states is known, model it so the compiler can help detect unhandled cases.

Discriminated unions are preferred where they make state transitions or variants clearer.

---

## 5. Functions, Modules, and Classes

### 5.1 Organize Around Responsibilities

A function or module should have a coherent responsibility.

Split code when doing so separates distinct concepts, isolates change, clarifies control flow, or improves testability.

Do not split cohesive logic merely to satisfy an arbitrary function size.

### 5.2 Keep Public Surfaces Small

Expose only what callers need.

Implementation details should remain private unless there is a clear reason to make them part of a public contract.

Avoid expanding public APIs for speculative future use.

### 5.3 Choose Abstractions for Their Semantics

Use functions, modules, classes, factories, or other abstractions according to the problem being modelled.

Classes are appropriate when identity, encapsulated state, lifecycle, invariants, or polymorphic behaviour justify them.

Functions and modules are often preferable for stateless transformations and orchestration.

Do not introduce an abstraction merely because a design pattern exists for the problem.

### 5.4 Prefer Immutability by Default

Prefer immutable data where mutation provides no meaningful benefit.

Use `readonly`, readonly collections, or immutable transformations where they make ownership and state changes clearer.

Use controlled mutation when it produces a simpler or materially more efficient design.

---

## 6. Dependencies and Existing Solutions

### 6.1 Prefer Proven Implementations Over Bespoke Commodity Code

Do not reinvent solved, general-purpose functionality merely because it is straightforward to implement.

Before implementing reusable commodity functionality, determine whether it is already provided by:

1. the language or runtime platform;
2. an existing project dependency; or
3. a mature, well-maintained package.

Prefer a battle-tested implementation when it materially reduces correctness risk, maintenance burden, security risk, or the likelihood of missing important edge cases.

Examples include established solutions for areas such as:

- schema validation;
- date and time handling;
- parsing established formats;
- cryptographic primitives;
- protocol implementations;
- retries and backoff;
- serialization;
- globbing; and
- command-line parsing.

### 6.2 Dependencies Must Still Earn Their Place

Do not add a dependency blindly.

Consider:

- maintenance status;
- API stability;
- ecosystem adoption;
- compatibility;
- security history;
- dependency footprint;
- licensing where relevant; and
- whether the required capability is substantial enough to justify another dependency.

Implement locally when the requirement is genuinely project-specific, trivial, or when a dependency would introduce more complexity or risk than it removes.

---

## 7. Error and Outcome Design

Distinguish between expected domain outcomes and exceptional failures.

Use the representation that makes the calling contract clearest.

Errors should retain useful diagnostic context.

When wrapping or translating an error:

- preserve the original cause where useful;
- add context that the lower layer could not know; and
- avoid duplicating identical logging at multiple layers.

Do not use exceptions as routine control flow when a normal outcome can be represented more clearly in the type system.

Do not return ambiguous sentinel values when the type can express the outcome directly.

---

## 8. Asynchronous Work and Resources

Make asynchronous behaviour explicit.

Avoid:

- floating promises;
- accidental sequential execution where safe concurrency is intended;
- uncontrolled concurrency;
- resources that are not reliably released; and
- asynchronous work whose failures cannot reach an appropriate owner.

Use timeouts, cancellation, concurrency limits, and cleanup when required by the behaviour of the subsystem rather than applying them mechanically everywhere.

Resource ownership should be clear.

The code responsible for acquiring a resource should either release it reliably or transfer ownership explicitly.

---

## 9. Naming and Readability

Names should communicate domain meaning and intent.

Prefer terminology already used consistently by the codebase and domain.

Avoid unexplained abbreviations and vague placeholders when a more precise name is available.

Names such as the following are often too weak when used without qualification:

- `data`;
- `result`;
- `manager`;
- `helper`;
- `utils`;
- `processor`.

Use control flow that a reader can follow without mentally decoding unnecessary cleverness.

Conciseness is valuable only when it also preserves clarity.

---

## 10. Documentation

Documentation should communicate information that the code and type system cannot adequately communicate themselves.

Document where useful:

- public contracts;
- non-obvious invariants;
- architectural decisions;
- important constraints;
- unusual edge cases;
- externally imposed behaviour;
- subtle failure semantics; and
- the reason behind a surprising implementation choice.

For published APIs, documentation is part of the consumer-facing contract where signatures and types alone do not adequately communicate correct use or behaviour.

Do not add comments or documentation that merely restate names, parameter types, return types, or obvious implementation steps.

Comments should explain **why** when the **what** is already evident from the code.

---

## 11. Testing

Tests should verify observable behaviour and important invariants rather than mirror implementation structure.

Test the paths where mistakes matter, including as appropriate:

- normal behaviour;
- boundary conditions;
- invalid runtime input;
- expected failures;
- state transitions;
- integration boundaries; and
- previously observed regressions.

A bug fix should normally include a regression test capable of demonstrating the previous failure.

Tests must be deterministic unless nondeterminism is itself the behaviour under test.

Mock where isolation is useful. Do not mock a dependency merely because it can be mocked.

Prefer tests that remain valid through reasonable internal refactoring.
# 0.2 - TypeScript Coding-Agent Contract

**Version:** 0.1

## 0.2#1 - Purpose

This contract governs how a coding agent should work when modifying a TypeScript repository.

The TypeScript Engineering Standard (see 0.1) defines the expected properties of the code.

This contract defines the agent's operating discipline while changing it.

Exercise engineering judgment. Do not substitute mechanical rule-following for understanding the task, repository, and surrounding code.

---

## 0.2#2 - Understand Before Changing

Before modifying code:

- understand the requested behaviour and relevant constraints;
- inspect the affected code and its relevant dependencies;
- identify established architecture and repository conventions where relevant;
- inspect existing tests for the behaviour being changed; and
- identify applicable repository instructions and engineering standards.

Read enough context to understand the change properly, but do not explore unrelated areas without a task-derived reason.

Do not assume that a familiar problem should be solved using a familiar pattern before understanding how the repository already approaches it.

Prefer explicit repository requirements over conventions inferred solely from repeated existing code. Existing code may contain legacy patterns that are no longer authoritative.

---

## 0.2#3 - Preserve Existing Intent

Treat established architecture, domain concepts, public contracts, tests, documented invariants, and explicit repository decisions as constraints unless the task requires them to change.

Prefer extending the existing design coherently over introducing a competing approach.

Do not reinterpret an established project decision merely because another design would also be reasonable.

If the requested change exposes a genuine conflict with an existing invariant or contract, resolve the conflict deliberately rather than silently working around it.

---

## 0.2#4 - Make the Smallest Coherent Change

Implement the complete change required by the task, including necessary supporting changes.

Avoid unrelated work.

Do not, without a task-derived reason:

- refactor unrelated code;
- rename unrelated concepts;
- broaden public APIs;
- change configuration;
- introduce dependencies;
- introduce or replace architectural patterns;
- reformat unrelated code; or
- normalize surrounding code merely because it could be improved.

"Smallest" does not mean minimizing lines changed.

Make whatever coherent structural change is necessary for a correct and maintainable solution.

When the requested change exposes a nearby structural problem that must be addressed for a correct solution, fix the relevant structure rather than layering a workaround on top of it.

---

## 0.2#5 - Prefer Existing Solutions Where Appropriate

Before implementing general-purpose functionality, determine whether the required capability is already provided by:

1. the language or runtime platform;
2. the repository;
3. an existing dependency; or
4. a mature, well-maintained package.

Do not create bespoke commodity infrastructure merely because it is easy to generate.

Apply the dependency principles in the TypeScript Engineering Standard (see 0.1#6) together with repository-specific constraints when deciding whether an additional dependency is preferable to a local implementation.

---

## 0.2#6 - Do Not Manufacture Success

Resolve failures at their cause.

Do not make a change appear successful by:

- weakening types;
- using unjustified type-system escape hatches;
- suppressing compiler or lint failures;
- deleting, weakening, bypassing, or rewriting valid tests merely to make an implementation pass;
- reducing meaningful behavioural protection;
- bypassing runtime validation;
- swallowing errors;
- disabling or weakening quality gates; or
- changing expected behaviour merely to match an incorrect implementation.

If an existing test, type, rule, or expectation is genuinely wrong and must change to satisfy the task, change it deliberately and consistently with the non-negotiable engineering invariants (per 0.1#3) and repository requirements.

---

## 0.2#7 - Verify the Change

Before considering a task complete:

1. inspect the resulting implementation as a whole;
2. confirm that it satisfies the requested behaviour;
3. confirm that relevant invariants remain intact;
4. inspect the final diff for unintended changes;
5. run all applicable repository-defined quality gates; and
6. resolve failures at their cause rather than suppressing them.

Verification must cover the behaviour changed, not merely successful compilation.

Use the repository's authoritative verification procedures. Completed code must satisfy the applicable repository quality gates per 0.1#3.5.

Do not claim that a check passed unless it was actually run successfully.

---

## 0.2#8 - Completion Report

Keep the completion report concise and factual.

State:

- what materially changed;
- what verification was performed; and
- any unresolved issue, limitation, or assumption that materially affects correctness.

Do not claim successful completion when required verification failed or could not be performed.

## References

- 0.1 - TypeScript Engineering Standard (authority - defines the engineering properties and invariants that changes made under this contract must satisfy)

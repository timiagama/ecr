# TypeScript Coding-Agent Contract

## 1. Purpose

This contract governs how a coding agent should work in this repository.

The **TypeScript Engineering Standard** defines the expected properties of the code. This contract defines the agent's operating discipline while changing it.

The agent is expected to exercise engineering judgment. Do not substitute mechanical rule-following for understanding the task, repository, and surrounding code.

---

## 2. Understand Before Changing

Before modifying code:

* understand the requested behaviour and relevant constraints;
* inspect the affected code and its immediate dependencies;
* identify the repository's established architecture and conventions where relevant;
* inspect existing tests for the behaviour being changed; and
* identify applicable repository instructions and engineering standards.

Read enough context to understand the change properly, but do not explore unrelated areas without a task-derived reason.

Do not assume that a familiar problem should be solved using a familiar pattern before understanding how this repository already approaches it.

---

## 3. Preserve Existing Intent

Treat established architecture, domain concepts, public contracts, tests, and documented invariants as constraints unless the task requires them to change.

Prefer extending the existing design coherently over introducing a competing approach.

Do not reinterpret an established project decision merely because another design would also be reasonable.

If the requested change exposes a genuine conflict with an existing invariant or contract, resolve the conflict deliberately rather than silently working around it.

---

## 4. Make the Smallest Coherent Change

Implement the complete change required by the task, including necessary supporting changes.

Avoid unrelated work.

Do not, without a task-derived reason:

* refactor unrelated code;
* rename unrelated concepts;
* broaden public APIs;
* change configuration;
* introduce dependencies;
* replace established patterns;
* reformat unrelated files; or
* clean up surrounding code merely because it could be improved.

"Smallest" does not mean minimizing lines changed. Make whatever coherent structural change is necessary for a correct and maintainable solution.

---

## 5. Prefer Existing Solutions Where Appropriate

Before implementing general-purpose functionality, determine whether the required capability is already provided by:

1. the platform;
2. the repository;
3. an existing dependency; or
4. a mature, well-maintained package.

Do not create bespoke commodity infrastructure merely because it is easy to generate.

Use engineering judgment when deciding whether adopting a dependency is preferable to a local implementation.

---

## 6. Do Not Manufacture Success

Resolve failures at their cause.

Do not make a change appear successful by:

* weakening types;
* suppressing compiler or lint errors;
* deleting or weakening valid tests;
* reducing meaningful test coverage;
* bypassing validation;
* swallowing errors;
* disabling quality gates; or
* changing expected behaviour merely to match an incorrect implementation.

If an existing test, type, or rule is genuinely wrong and must change to satisfy the task, change it deliberately and consistently with the engineering standard.

---

## 7. Verify the Change

Before considering the task complete:

* inspect the final diff;
* confirm the implementation satisfies the requested behaviour;
* check for unintended changes;
* run the applicable repository quality gates; and
* resolve any resulting failures.

Verification should cover the behaviour changed, not merely compilation.

Where the repository provides authoritative commands, use them rather than inventing alternative verification procedures.

---

## 8. Completion

A change is complete only when it is:

* correct;
* appropriately tested;
* consistent with the repository;
* compliant with the TypeScript Engineering Standard;
* free of unintended changes; and
* mechanically verified using the repository's applicable quality gates.

Report material limitations, unresolved failures, or assumptions that affect correctness.

Do not claim successful verification that was not actually performed.

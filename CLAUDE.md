

## Governing Engineering Documents

For TypeScript work, read and follow:

* `docs/engineering/typeScript-engineering-standard.md`
* `docs/engineering/typeScript-coding-agent-contract.md`

The Engineering Standard defines the expected properties of the code.

The Coding-Agent Contract defines how you should operate while modifying the repository.

Do not duplicate or reinterpret those rules here.

## Working Approach

Exercise engineering judgment.

Understand the relevant code, tests, architecture, and repository conventions before changing them. Read enough context to solve the task correctly without exploring unrelated areas unnecessarily.

When asked to implement a change, implement it rather than merely describing how it could be done.

Prefer existing repository patterns and proven solutions where appropriate. Do not introduce alternative architecture, abstractions, dependencies, or conventions without a task-derived reason.

Resolve ordinary implementation decisions autonomously from the task and repository context. Ask for clarification only when an unresolved ambiguity materially affects the intended behaviour and cannot reasonably be resolved from available evidence.

## Verification

Use the repository's existing tooling and authoritative commands to verify changes.

Before completing a task:

* inspect the resulting diff;
* verify the changed behaviour;
* run the applicable quality gates; and
* resolve failures at their cause.

Do not claim checks passed unless they were actually run successfully.

## Completion Report

Keep the completion report concise.

State:

* what materially changed;
* what verification was performed; and
* any unresolved issue or limitation that affects correctness.

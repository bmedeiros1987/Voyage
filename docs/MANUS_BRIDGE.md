# Manus GitHub audit bridge

The Voyage bridge is a read-only, exact-SHA audit roundtrip between trusted GitHub coordination comments and Manus.

## Trusted triggers

A repository owner/member/collaborator may trigger the bridge from a pull request with one of:

- `@manus`
- `@manus <scope>`
- `[VOYAGE][CHATGPT→MANUS] ...`
- `[VOYAGE][CLAUDE→MANUS] ...`

The workflow can also be started manually with `workflow_dispatch` and a PR number.

## Required repository configuration

- Actions secret: `MANUS_API_KEY`
- Actions variable: `MANUS_GITHUB_CONNECTOR_ID`
- Optional Actions variable: `MANUS_AUDIT_PROJECT_ID`

The GitHub connector used by Manus must itself be read-only for repository contents/PR review. The workflow does not grant Manus write access.

## Safety invariants

- resolves the current PR HEAD to a full 40-character SHA before creating a task;
- refuses closed if the PR is closed, the head is from another repository, required configuration is absent, Manus asks for interactive input, the task errors, or structured output is invalid;
- tasks are private and non-interactive;
- Manus is instructed not to commit, push, rebase, merge, modify tests/code, or enable auto-merge;
- the result must return the same exact SHA requested;
- the PR HEAD is re-read immediately before publishing the verdict;
- stale verdicts are suppressed and published only as `MANUS: STALE`;
- only a trusted GitHub event can wake the bridge;
- the bridge publishes only the structured audit result back to the PR; ChatGPT remains the sole merge coordinator.

## Output

Successful audit:

`[VOYAGE][MANUS→ALL][AUDIT RESULT]` followed by `MANUS: MERGE — <40-char SHA>`.

Blocking audit:

`[VOYAGE][MANUS→ALL][AUDIT RESULT]` followed by `MANUS: BLOCKER — <40-char SHA>`, severity and reproducible evidence.

Bridge/infrastructure failure:

`[VOYAGE][MANUS→ALL][BRIDGE_ERROR]` and no approval is emitted.

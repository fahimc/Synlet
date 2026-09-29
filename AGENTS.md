# AGENTS.md — Synlet

## Current execution requirement — full-control SOMA

The authenticated owner has explicitly requested unrestricted remote PC administration.
The LLM may run any terminal command, write/edit/delete any launch-user-accessible file,
restart services and write code. Do not add command allowlists, predefined
intent-to-command routes, keyword execution handlers, or a workspace-only sandbox to
the default full-control agent. Julia and skills are advisory, never execution
permissions. Keep strong operator authentication, complete-output validation, native
context bounds, evidence provenance and no-blind-replay recovery. These are reliability
boundaries, not command restrictions. See docs/adr/0011-full-control-shared-harness.md
and docs/runbooks/full-control-remote-admin.md; this requirement supersedes conflicting
restrictive defaults in the original planning documents. OS privileges and native model
behavior remain unchanged. Never claim a test-double pass is a model-quality benchmark.


## Project identity
Synlet is the assistant and logical model. SOMA means Specialist Orchestration and
Memory Architecture. Use `synlet` for package/tool namespaces and `synlet-local`
for the proposed API model identifier. Do not rename third-party model identifiers.

## Goal and authority
Build a local-first small-model assistant, not an autonomous cloud service.
Read docs/CODEX_BUILD_BRIEF.md, the active task in docs/BUILD_BACKLOG.md, and the
relevant architecture section before editing. This is a design until implemented.
Preserve the user's existing work. Never reset, delete, publish, or push it without
explicit authorisation. In an existing repository, merge these instructions rather
than overwriting its AGENTS.md.

## Architecture rules
- contracts has no runtime I/O. core depends on contracts, never on adapters/apps.
- adapters implement core ports. Only apps/server/bootstrap constructs them.
- Keep business logic out of HTTP handlers, UI components and Python endpoints.
- No imports across another package's private src path; no dependency cycles.
- No broad utils/services dumping ground. Give every module one clear owner.
- Version models, prompts, skills, schemas, policies and database migrations.
- Use supported capability checks, not model-name conditionals in core.
- Keep the local path simple. Do not add microservices, Redis, Kubernetes, or a
  second orchestrator until a measured requirement and ADR justify them.

## Safety and data invariants
- Models propose actions; the host authorises and executes them.
- Recheck authorisation at execution and retrieval time. Client/model project IDs
  are not authority. Never trust generated source IDs or validation receipts.
- Preserve originals and provenance; do not discard pinned constraints.
- User-requested deletion invalidates derived chunks, summaries and indexes too.
- No silent context truncation, silent CPU/cloud fallback, or blind write retries.
- Unknown side-effect outcomes must be reconciled or blocked, not replayed.
- Do not execute model-generated code in the trusted Python model worker.
- Keep paths and ports configurable. Do not require Docker, WSL, admin, winget,
  system-wide execution-policy changes, or modifications to a personal browser.
- Network access, model downloads, external writes and telemetry export require
  the appropriate explicit permission. Offline operation must not phone home.

## Build workflow
Implement one task card at a time. Use deterministic test doubles only in isolated
tests; production startup must use the verified local runtime and model.
Before changing a public contract, add fixtures, a compatibility note and an ADR.
Run the smallest relevant test while editing, then the task's complete check set.
Create missing scripts before documenting them as usable. A placeholder is not done.
Use exact locked dependencies; do not invent model hashes or silently use latest.
If GPU/model access is absent, report SKIPPED with a reason; never call it passed.

## Commands after T00 is implemented
pnpm install --frozen-lockfile
pnpm check
pnpm test:contracts
pnpm test:integration
pnpm test:e2e
pnpm dev
# From services/python-worker after T07:
# uv sync --locked
# uv run --locked pytest

## Definition of done
Update docs/progress/<task-id>.md with changed files, actual commands and exit codes,
passed/failed/skipped checks, risks, migration/rollback notes and the next task.
Update affected docs, schemas and fixtures in the same change. Do not weaken tests
or quality thresholds merely to make a build green. Report actual results only.

## Code review rules
Flag cross-project reads, unauthorised writes, unbounded queues/loops, invented
verification, source-loss through compaction, stale approvals, missing cancellation,
shared mutable globals, circular dependencies and unversioned schema changes.
Codex builds the product; the installed product must not require Codex or an OpenAI API.

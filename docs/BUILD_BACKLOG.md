# Synlet — Codex build backlog

Blueprint v0.2 · 28 September 2026. All cards start NOT_IMPLEMENTED.
Commands below are interfaces to implement, not evidence of an existing application.
T00 creates the root scripts; later tasks replace explicit NOT_IMPLEMENTED checks with real tests.
Do not turn an unimplemented check into a no-op success.

## T00 — Repository foundation

Status: NOT_IMPLEMENTED

Dependencies: None

Primary scope: apps/server, apps/web, contracts, core, adapters, testkit, scripts

### Build
Inspect the repository; create the workspace, strict TypeScript settings, package exports, root scripts, mock profile and dependency-boundary check. Pin exact toolchain versions after compatibility checks. Produce a health endpoint and minimal UI served through the gateway. Save this blueprint and merge AGENTS.md safely.

### Checks
pnpm check; pnpm test:contracts; pnpm dev:mock

### Exit condition
Windows and Linux CPU CI build without model weights. The mock UI shows MOCK prominently. Unknown config keys fail clearly. Cycles and forbidden imports fail CI. Existing user files remain unchanged.

### Deliver
A small runnable scaffold, toolchains.lock.json, lockfile, architecture ADR and progress report.

## T01 — Durable task core

Status: NOT_IMPLEMENTED

Dependencies: T00

Primary scope: core/domain, core/orchestration, storage adapter, HTTP routes

### Build
Implement authenticated task intake, schema validation, revision-checked state transitions, append-only event records, transactional outbox, bounded durable queue and replayable event stream. Add per-project/session ownership and deterministic fake model responses.

### Checks
pnpm test:unit; pnpm test:contracts; pnpm test:integration; pnpm check

### Exit condition
Duplicate idempotent intake creates one task; a key reused with a different request returns conflict. Crash/restart resumes the committed state. Simultaneous transitions cannot both commit. Cross-project task IDs are inaccessible.

### Deliver
Working create/status/events/cancel routes and migration 001 with fault-injection tests.

## T02 — Safe tool broker and approvals

Status: NOT_IMPLEMENTED

Dependencies: T01

Primary scope: core/policy, core/orchestration, tools adapters, approval UI

### Build
Add bounded read, expected-revision patch and calculator tools; use typed executable/argument lists, not a free shell by default. Persist action intent, hash-bound approval, execution receipt and result. Bind approval to actor, project, arguments, revision, expiry and policy version. Revalidate immediately before execution.

### Checks
pnpm test:security; pnpm test:integration; pnpm test:e2e; pnpm check

### Exit condition
Denied actions produce no side effect. Path traversal, Windows junction/symlink escapes and stale approvals are rejected. A crash after a possible write becomes outcome_unknown until reconciled; no automatic duplicate write. Tests must verify the actual process boundary, not just a UI dialog.

### Deliver
Approval screen, tool contract fixtures, action journal and recovery runbook.

## T03 — Source store and exact lookup

Status: NOT_IMPLEMENTED

Dependencies: T01

Primary scope: core/context, storage and retrieval adapters

### Build
Ingest text, conversation and code into immutable source revisions and structural chunks. Keep artifact bytes outside the database with atomic writes and hashes. Implement scoped FTS5 plus exact identifier lookup and context.search/read/expand. Add source deletion and dependent-record invalidation.

### Checks
pnpm test:contracts; pnpm test:integration; pnpm test:security; pnpm check

### Exit condition
Source IDs resolve to exact revisions/ranges. Deleted or unauthorised material cannot be retrieved from text, caches or indexes. Stale revisions are labelled and never silently treated as current. Large inputs are streamed and size-capped.

### Deliver
Source browser, fixture corpus, provenance tests and deletion/reindex runbook.

## T04 — Context packing and safe compaction

Status: NOT_IMPLEMENTED

Dependencies: T03

Primary scope: core/context and mock compactor adapter

### Build
Implement role-specific budgets, actual-tokenizer accounting through a port, pinned constraints, short working state, source-linked summaries, relevance/deduplication and bounded lookup rounds. Add exhaustive-scan mode with coverage tracking. Validate summary claims and fall back to source excerpts on invalid output.

### Checks
pnpm test:unit; pnpm test:integration; pnpm eval:mock; pnpm check

### Exit condition
No packet exceeds its configured allowance; generation and safety reserve stay available. Negations, numbers, corrections and failures survive required fixtures. Summaries do not invent source IDs or promote untrusted instructions. Failed compaction preserves the previous state and originals.

### Deliver
Context inspector showing before/after token counts, omissions and expandable evidence.

## T05 — Local inference and scheduler

Status: NOT_IMPLEMENTED

Dependencies: T02, T04

Primary scope: inference adapters, core/scheduling, server supervisor

### Build
Implement llama.cpp model adapter, native-template/tool parser, token counting, streaming, deadlines, cancellation and capabilities. Add immutable model registry and startup compatibility report. Implement one GPU lease at a time, measured memory admission, bounded queues, load/unload and visible degradation. Pin the runtime build; do not fork llama.cpp in v0.1.

### Checks
pnpm test:contracts; pnpm test:integration; pnpm test:security; pnpm smoke:models; pnpm bench:local

### Exit condition
Mock tests run on CPU CI. With authorised local weights, one text model completes a verified call. Truncated outputs cannot execute partial tools. Cancel stops owned workers or marks them unhealthy; it does not free GPU capacity before work stops. Missing hardware is SKIPPED, never passed.

### Deliver
First real controller path, per-role compatibility matrix and measured local baseline.

## T06 — Small-model skills and browser tools

Status: NOT_IMPLEMENTED

Dependencies: T05

Primary scope: skill registry, browser adapter, tool broker, UI

### Build
Add versioned runtime skill packs with schemas, prerequisites, bounded steps and completion checks. Expose only the chosen skill/tool set. Add visible Playwright browser sessions with dedicated profiles, DOM-first targeting, screenshots, domain policy and observation after consequential actions.

### Checks
pnpm test:contracts; pnpm test:security; pnpm test:e2e; pnpm check

### Exit condition
An owned fixture website can be inspected and tested. Browser/model output cannot widen permissions. Untrusted skill imports are inactive until reviewed. No personal browser profile is opened or debugging endpoint exposed. Authentication/CAPTCHA or uncertain high-impact actions stop for user intervention.

### Deliver
repo-fix, document-qa, math-check and browser-check skills with test fixtures.

## T07 — Router, embeddings and specialist onboarding

Status: NOT_IMPLEMENTED

Dependencies: T05; browser tests additionally need T06

Primary scope: Python worker, inference/retrieval adapters, model registry

### Build
Implement the isolated Python service for Julia and EmbeddingGemma; validate its finite decision outputs and batching semantics. Add compactor, vision, maths and code checkpoints one at a time behind capabilities. Use current artifacts only after pinning and testing; failing candidates stay disabled with explicit fallback. Add embedding-versioned hybrid search and reindex.

### Checks
pnpm test:contracts; pnpm test:integration; pnpm smoke:models; uv run --locked pytest (inside services/python-worker)

### Exit condition
TypeScript/Python agree on golden wire fixtures. Multiple decisions are explicitly batched or issued as separate calls; no unsupported Julia API is assumed. Each enabled specialist passes its own role tests, cancellation and context checks. Vision projector and coordinates are verified. Embedding versions never mix.

### Deliver
Enabled-role matrix with actual artifacts, licences, smoke results and specialist deltas.

## T08 — Quality and failure evaluation

Status: NOT_IMPLEMENTED

Dependencies: T06, T07

Primary scope: evals, tests, observability, reporting UI

### Build
Build the fixed holdouts and baseline comparisons described in section 09. Separate engineering fixtures from real-model evaluation. Record stage timings, queue/load/prefill/decode/tool/verify time, token budgets, source coverage and verified outcomes. Run crash, OOM, cancellation, missing-model and offline fault cases.

### Checks
pnpm eval:mock; pnpm eval:local; pnpm bench:local; pnpm test:security; pnpm check

### Exit condition
Every report says measured, estimated, mock or skipped; includes sample counts and runtime/model/prompt versions; and compares equivalent tools and budgets. Failed quality gates block promotion rather than being hidden or replaced with publisher scores.

### Deliver
Baseline report, regression thresholds, evidence labels and degradation matrix.

## T09 — Portable release and maintenance

Status: NOT_IMPLEMENTED

Dependencies: T08

Primary scope: server CLI, packaging, config migration, docs/runbooks

### Build
Create manifest-driven Windows release with separate program/model/data roots, hash validation, signed or trust-verified dependencies where available, licence notices, preflight checks and optional cached offline setup. Implement doctor, start/stop/status, consistent backup/restore, migration and version rollback. Never replace user data during update.

### Checks
pnpm check; pnpm test:e2e; pnpm test:release; pnpm package:local

### Exit condition
Clean Windows user account starts the package from a chosen path, including spaces/non-ASCII. No Docker/WSL/admin prerequisite. Mock mode works without weights; real mode names missing artifacts clearly. Backup/restore and approved rollback preserve task evidence. Offline startup makes no unexpected outbound calls.

### Deliver
Release bundle, checksums, dependency inventory, operator runbooks and release evidence.

## T10 — Optional worker-pool scale-out

Status: NOT_IMPLEMENTED

Dependencies: T09 and measured need

Primary scope: scheduler adapter, authenticated worker transport; storage adapters as justified

### Build
Keep the control plane API and core ports unchanged. Add authenticated registered workers, capability/resource discovery, scoped artifact transfer, fenced leases, heartbeats, fairness and bounded result payloads. Use SQLite only behind a single local host; introduce PostgreSQL/queue/vector adapters only when requirements justify them.

### Checks
pnpm test:contracts; pnpm test:integration; pnpm test:security; pnpm bench:pool

### Exit condition
Two workers never own the same live lease. Stale completions are fenced out; uncertain remote writes are not replayed. A lost worker does not strand the whole queue. Scaling improves measured throughput or queue wait without losing isolation or evidence. Pure local mode still passes.

### Deliver
Opt-in worker-pool profile, ADR, load report and failure/isolation tests.

## Parallel development rules
T02 and T03 may run in separate worktrees after T01 contracts are stable.
Thereafter, module-only work may proceed in parallel against frozen fixtures.
Assign one integration owner for contracts, migrations, lockfiles and bootstrap.
Do not have multiple Codex sessions change the same public interfaces concurrently.
Keep separate temporary databases, output folders, ports and test fixtures per worktree.
Merge sequentially and rerun integration checks. Parallel coding does not authorise
parallel GPU inference on the single-GPU local profile.

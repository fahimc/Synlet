# Synlet — Codex build brief

Blueprint v0.2 · 28 September 2026 · DESIGN / NOT IMPLEMENTED

## Product goal
Build one local assistant API and UI, backed by selectively invoked small models:
Julia-1 routing; MiniCPM5-2B controller; LFM2.5-VL-3B vision; Nanbeige4.1-3B maths;
K2-Horizon-3.7B code; Qwen3.5-0.8B compaction; EmbeddingGemma-300m semantic retrieval.
These are candidate providers, not hard-coded dependencies. Verify every artifact,
licence, revision, runtime and role test before enabling it. A disabled role must
remain visible as unavailable or use a documented, capability-compatible fallback.
Laya remains an optional router challenger; do not load both by default.

## First target
Windows 11, i9-11900K, RTX 3060 12 GB, 32 GB system RAM. No Docker or WSL requirement.
Run initially as a normal user with explicit paths. The system must work in mock
mode without GPU, cloud access or weights. Single-host defaults bind to loopback.
The runtime must not require Codex or an OpenAI account. Codex is the builder.

## Read in this order
1. Root AGENTS.md, then relevant module guidance.
2. The first unfinished card in docs/BUILD_BACKLOG.md and its dependency reports.
3. Relevant sections in docs/architecture/synlet-soma-architecture.html:
   13 modules, 14 contracts/data, 15 build guide, 16 backlog, 17 scale, 18 maintenance.
4. Matching ADRs, schemas and fixtures. Do not ingest unrelated repositories.

## Architectural decision
Use a modular monolith with a few isolated workers, not a service per role.
Node.js 24 LTS is the proposed baseline; resolve and record an exact tested patch.
Use strict TypeScript, pnpm workspaces, Fastify, a Vite/TypeScript web UI, SQLite/FTS5,
llama.cpp workers and an isolated Python worker. Select an exact Python version
from the supported ranges of the pinned Julia/embedding dependencies in T00/T07.
Do not assume a Python package works merely because its download succeeded.
Keep the existing explicit state-machine design; do not layer LangGraph over it.

contracts: canonical versioned JSON schemas, generated TS/Python types, fixtures.
core: pure domain decisions, orchestration/context/scheduling/policy using ports.
adapters: inference/storage/retrieval/tools/telemetry implementations of core ports.
apps/server: HTTP, CLI, supervisor and the only dependency-composition root.
apps/web: UI/API client only. services/python-worker: trusted model inference only.
Enforce imports and absence of cycles in CI. Use explicit constructor injection.

## State and execution
Persist task state, events and outbox atomically with optimistic revisions.
One active mutating task per session/workspace by default; readers remain bounded.
Use bounded persistent queues, leases, heartbeats and fencing tokens. Work may be
redelivered; do not claim exactly-once side effects. Store action intent before
execution, receipts afterward. Reconcile unknown outcomes before retrying a write.
Approval binds to action arguments/hash, actor, scope, expiry and policy version;
re-authorise immediately before execution. Denied actions do nothing.

## Context engine
Keep immutable original revisions, meaningful chunks and a compact task state.
Use hybrid keyword/exact/semantic retrieval within authorised scope. Token-budget
using the actual selected tokenizer/template, including tools, multimodal input,
generation reserve and safety margin. Persist omissions and source references.
Pinned user constraints remain intact. A summary is derived, not a new authority.
Summary failure falls back to retained state and original excerpts. Deletion must
invalidate derived material; reindex when embedding/version/parser changes.
Focused queries use retrieval; exhaustive questions require a coverage-tracked scan.
Never invent a GGUF router conversion or unsupported Julia multi-output API.

## Ports and protocols
Use the proposed interfaces in docs/architecture/ports.example.ts as the starting
contract. Turn them into canonical JSON-schema-backed types in T00/T01.
HTTP /api/v1 task API is canonical. /v1/chat/completions is a documented facade;
reject unsupported options. Resumable event streams use monotonic persisted IDs.
Worker request/response schemas are versioned and carry task/step/request IDs,
deadlines, model locks, lease/fence and approved source references. Workers have
no direct public exposure or shared SQLite connection across machines.

## User interface
Show chat, task timeline, queued/running/blocked status, approvals, source lookup,
context before/after counts, enabled model capabilities, cancellation and diagnostics.
Make MOCK, ESTIMATED, MEASURED, SKIPPED and unavailable capabilities unmistakable.
Use accessible responsive components. Never claim verified without host evidence.

## Build order
T00 scaffold -> T01 durable core -> T02 safe tools and T03 source lookup ->
T04 context -> T05 inference/scheduler -> T06 skills/browser -> T07 specialists ->
T08 evaluation -> T09 release. T10 scale-out is optional and evidence-triggered.
One task per Codex run by default. Parallel module work only after contracts freeze.
No stubs that report success; unsupported commands fail with NOT_IMPLEMENTED.

## Root commands to implement
pnpm check: formatting, lint, strict types, dependency boundaries, generated-contract
  drift and deterministic unit tests. Offline after dependencies are installed.
pnpm test:contracts: schema/adapter/TS-Python golden fixtures.
pnpm test:integration: real temporary SQLite and HTTP + fake inference; crash tests.
pnpm test:e2e: Playwright tests of UI and owned local fixture websites.
pnpm test:security: scope, traversal, stale approval, prompt injection, replay tests.
pnpm eval:mock: deterministic orchestration fixtures, never a model score.
pnpm smoke:models: authorised local runtime/checkpoint compatibility checks.
pnpm eval:local: quality holdouts against pinned actual models and fair baselines.
pnpm bench:local: measured cold/warm and stage timing, not publisher estimates.
pnpm test:release / pnpm package:local: clean-package and relocation tests.
pnpm dev:mock / pnpm dev:local: explicit modes, both with bounded permissions.
pnpm bench:pool: T10-only throughput/queue/isolation tests; unavailable before T10.

## Environment and reproducibility
Pin Node/pnpm, Python/uv, dependencies, SQLite engine, llama.cpp build, model hashes,
projectors, templates, prompts and skills. models.catalog.json is a candidate list;
models.lock.json is verified downloadable artifacts. Never put secrets in either.
Use pnpm install --frozen-lockfile after the bootstrap lockfile is committed.
Use uv sync --locked in services/python-worker after that project's lock exists.
Initial lockfile creation is explicit in T00/T07; never fabricate a lockfile.
Verify the actual SQLite engine incorporates current required fixes, not just the
binding package version. Do not place WAL databases on a shared network drive.

## Safety and deployment
Keep trusted model workers separate from generated code/test execution. A native
child process is not a sandbox. Untrusted code needs a restricted account or VM
with explicit filesystem/network boundaries. No arbitrary code in Julia's process.
No cloud fallback or tunnel by default. Install/update must not reset user data,
permissions, browser profiles or machine policy. Downloads require user approval,
licence handling, resumable validation and checksum verification.

## Evidence and definition of done
Every card needs a real end-to-end demonstration of its exit condition and passing
relevant tests. Missing GPU/model = SKIPPED with reason, not pass. Record commands,
exit codes, fixtures, runtime/model versions and report paths. Update docs/progress,
ADRs and runbooks. Quality targets in section 09 stay proposed until measured.
Package upgrades, schema migrations and model replacements need rollback procedures.
Do not push or publish work unless the user explicitly requests it.

## Initial acceptance demonstration
In mock mode: create a task, retrieve an earlier constraint, propose a sandbox file
patch, deny it (file unchanged), repeat with approval (one receipt), cancel another
task, restart the host and inspect the original evidence. Recover a duplicate request
without duplicating the task. Replace the fake inference adapter without core edits.
This proves wiring and safety mechanics, not model intelligence.

# Synlet

**Small models. Shared memory. One assistant.**

Synlet is a proposed local AI assistant powered by **SOMA — Specialist Orchestration and Memory Architecture**. SOMA coordinates small specialist models through adaptive routing, source-preserving indexed memory and verified tool execution behind one conversational interface.

> **Status: full-control SOMA harness; review remediation requires the recorded CI and local-model validation gates.** Synlet runs the architecture-selected
> Julia-1 router on CPU; MiniCPM5 controller, Nanbeige math specialist, LFM vision
> specialist and Qwen3.5 compactor through a pinned llama.cpp CUDA router; and
> EmbeddingGemma on CPU. Model and runtime files are SHA-256 locked, inference and
> retrieval are measured, and no cloud model or OpenAI account is required.

## Full-control operating contract

See [the full-control ADR](docs/adr/0011-full-control-shared-harness.md), [remote administration runbook](docs/runbooks/full-control-remote-admin.md), and [review remediation record](docs/progress/REVIEW_REMEDIATION.md). The LLM chooses arbitrary shell commands; there are no task-specific execution routes or command allowlists. Launch-user OS permissions still apply. Keep remote authentication enabled.

## Current runnable system

The default UI is a working Codex-style agent harness backed by the installed local
model roster. Julia-1 classifies finite capabilities, Qwen3.5-0.8B selects a
versioned skill without reasoning, and the reasoning-enabled MiniCPM5 controller can
consult enabled specialists, call configured
MCP servers, search the live web, drive a dedicated Edge profile, read and patch
workspace files, and run non-interactive host commands. Every route is persisted in
SQLite and appears in the chat as a live task-flow diagram while the run is active.

The lower-level authenticated task, approval, source, retrieval and context APIs remain
available. There is no production mock or cloud-model fallback.

```text
pnpm install --frozen-lockfile
pnpm check
pnpm test:contracts
pnpm test:integration
pnpm test:security
pnpm test:e2e
pnpm eval:local
pnpm smoke:models
pnpm test:live-agent
pnpm test:release
pnpm dev
```

Open <http://127.0.0.1:43127/> after startup and sign in with the private token in `runtime-data/operator-auth.json` (or your `SYNLET_AUTH_TOKEN`). The old static bearer is not used. The launcher verifies every enabled
runtime/model hash, starts the authenticated loopback-only multi-model llama.cpp router, waits
for model readiness, and then starts the Synlet gateway. Local state is stored under
`runtime-data/`. Stop with Ctrl+C. The optional T10 worker pool remains untriggered
until measurements justify it.

### Harness capabilities

- `command.run` executes PowerShell on Windows (or `/bin/sh` elsewhere), with an
  explicit working directory, bounded timeout and captured output. It is the full-host
  escape hatch requested for computer administration; use it with the same care as a
  local terminal.
- `browser.search`, `browser.inspect`, `browser.click` and `browser.type` provide
  generic live web search, navigation and form interaction.
  Browser activity uses a separate profile under `runtime-data/`.
- There are no task-specific time, CPU, news or similar semantic routes. The model
  decides how to use the generic shell and browser primitives from the user request
  and the observations it receives.
- MCP servers are configured in `config/mcp.servers.json`. The bundled stdio server
  provides `echo` and `runtime_info`, proving discovery and tool calls end to end.
- Runtime skills live under `skills/<name>/<version>/` and contribute bounded
  instructions, allowed tools and completion checks to the controller.
- The agent pipeline is Julia classification, Qwen3.5-0.8B skill selection, then the
  MiniCPM controller loop. Reasoning is disabled for Julia, the Qwen selection and
  Qwen compaction; it is enabled for MiniCPM and configured per specialist. Generation
  has one persisted task deadline and a token allowance derived from the remaining physical context, not an arbitrary answer-length ceiling.
- Every model trace node displays its exact model ID/version. Failed tools or rejected
  answers create a root-level recovery route that sends the original goal plus failure
  context back through Julia and Qwen before planning resumes. Julia capability labels
  advise rather than constrain which enabled specialists MiniCPM may call; the disabled K2 role uses MiniCPM as
  the bounded code-specialist fallback instead of exposing an unrelated specialist.
- Agent runs have persisted checkpoints; safe model work can resume, while interrupted tool outcomes require reconciliation rather than blind replay. `POST /api/v1/agent-runs` starts a run;
  `GET /api/v1/agent-runs` lists access-scoped session history, and the run plus its
  append-only graph are available from `/api/v1/agent-runs/:id` and
  `/api/v1/agent-runs/:id/events`. The UI restores the latest conversation after a
  reload and opens prior sessions from the sidebar.

The interface source of truth is `apps/web/ui/agent-harness.aui`; the build compiles it
deterministically to React with `@codedia/parser`.

With the local stack running, `pnpm test:live-agent` sends unassisted natural-language
questions about current time, CPU utilization and current UK headlines. It verifies
that the model discovers a generic shell/browser approach and grounds each answer in
real observations; the prompts do not name tools, commands or expected answers.

## Start here

| File | Purpose |
| --- | --- |
| [Architecture blueprint](docs/architecture/synlet-soma-architecture.html) | Complete illustrated solution, model roster, context engine, harness, interactive speed calculator, quality gates and build handbook. |
| [Codex starting prompt](CODEX_START_PROMPT.txt) | Give this prompt to Codex after opening the repository. |
| [Agent instructions](AGENTS.md) | Module boundaries, permissions and definition of done. |
| [Build brief](docs/CODEX_BUILD_BRIEF.md) | Implementation scope and non-negotiable requirements. |
| [Task backlog](docs/BUILD_BACKLOG.md) | Eleven sequenced task cards, T00–T10, with tests and exit conditions. |
| [Module map](docs/MODULE_MAP.md) | Package ownership and dependency rules. |
| [Proposed contracts](docs/architecture/ports.example.ts) | Example interfaces, not an installed library. |
| [Proposed configuration](docs/architecture/synlet.proposed.json) | Design configuration; pin and validate artifacts before loading models. |
| [Progress template](docs/progress/PROGRESS_TEMPLATE.md) | Record actual checks, risks and the next task. |
| [Original artifacts](archive/README.md) | All four original conversation files, retained unchanged for provenance. |

Clone the repository and open the architecture HTML in a browser. It is self-contained and works offline, including its diagrams, navigation, calculator and embedded Codex downloads. GitHub's source viewer does not execute its scripts. No GitHub Pages deployment is implied.

## First Codex run

Open this repository and supply the contents of `CODEX_START_PROMPT.txt`. Start with T00 when no implementation exists, implement one complete task at a time, and record actual verification results. The development commands become available only after their corresponding tasks have been implemented.

The installed runtime is local-only. Do not introduce cloud fallback, telemetry,
additional weights, publishing, or services without explicit permission.

## Design principles

- One modular monolith with explicit ports and replaceable adapters; distribute workers only when measurements justify it.
- Domain logic is independent of inference providers, databases, HTTP and UI.
- Small active contexts with retrievable originals, provenance, versioning and project-scoped permissions.
- Models propose tool actions; the host validates, authorises and executes them.
- Bounded loops, queues, retries and GPU jobs; cancellation and crash recovery are core requirements.
- Promote models and features using measured task success, resource usage and regression tests, not model names or publisher scores alone.

## Naming

**Synlet** is the assistant and logical model. **SOMA** is the architecture. Use `synlet` for project namespaces and `synlet-local` for the proposed public API model identifier. Do not rename third-party checkpoints. This handoff does not claim a single unified GGUF checkpoint.

Active documents use Synlet/SOMA. The archived originals retain the previous working title, Collective. Archived publishing instructions are historical: use the active repository instructions for current development.

## Target and exclusions

First target: Windows 11, RTX 3060 12GB, 32GB RAM. No Docker or WSL requirement. Paths and ports remain configurable.

The local checkout has a pinned llama.cpp CUDA runtime, CPU Python runtime and the
locked model roster under ignored artifact directories. Generated portable bundles
include the enabled artifacts and installed dependencies. Source control contains
their immutable provenance and hashes, not the multi-gigabyte binaries themselves.

K2-Horizon is downloaded but disabled: pinned upstream llama.cpp rejects its
`k2-horizon` architecture, while the publisher fork is not yet an acceptable stable
CUDA runtime. MiniCPM remains the architecture-defined code fallback until a compatible
runtime passes the same role tests.

`HANDOFF_FILES.sha256` records checksums for the imported documentation and original artifacts. Future edits legitimately change those hashes; update the manifest when publishing a new handoff.

# Synlet multi-model agent harness handoff

## Confirmed product requirements

- A real local Codex-style agent harness with skills, MCP, generic web/browser use,
  unrestricted current-user command execution and a live path diagram in chat.
- No production mocks, cloud fallback, intent-to-command lookup, or semantic routes such
  as `computer.status`, `news.search`, time, CPU or headlines.
- The model discovers the OS and installed command syntax through the shell. Platform
  guidance belongs in a versioned skill, not host routing code.
- Julia performs finite CPU capability classification without reasoning. Qwen3.5-0.8B
  is the first language-model stage and selects one versioned skill without reasoning.
  MiniCPM is the main controller with reasoning. Specialists advise but never execute
  tools. Qwen also performs non-thinking compaction. Model output has task timeouts but
  no guessed token ceiling.

## Implemented architecture

- Julia-1 CPU router (`a85b127321d5`) and EmbeddingGemma-300m CPU embeddings
  (`57c266a740f5`) run in one persistent line-delimited Python worker.
- The pinned llama.cpp b11237 CUDA multi-model router exposes MiniCPM5 controller,
  Nanbeige math, LFM2.5 vision plus projector, and Qwen3.5-0.8B compactor. GPU
  generation is host-serialized and at most two models are resident.
- K2-Horizon is downloaded but disabled with an explicit reason: upstream llama.cpp
  rejects `k2-horizon`; the publisher fork is pre-release with a reported CUDA
  correctness issue. MiniCPM is the architecture-defined code fallback.
- `AgentHarness` performs Julia capability classification, Qwen3.5-0.8B non-thinking
  skill selection, MiniCPM reasoning-enabled planning/review, optional bounded
  specialist consultation, generic tool execution, evidence enforcement and persisted
  append-only traces.
- Structured decisions use llama.cpp strict JSON Schema generated from the live tool
  catalog and each tool's real input schema. Tool names and arguments are not semantic
  routes or canned intent mappings. Invalid/unavailable proposals are recorded as failed
  trace nodes and fed back for bounded replanning instead of terminating the run.
- Every Julia, Qwen, MiniCPM, review and specialist trace node persists its exact model
  ID/version and the UI renders it as `MODEL · ...`. The top bar says SOMA plus the
  enabled-model count rather than implying Julia is the only active model.
- Tool failures, invalid decisions and rejected answers create a `Recovery route N`
  branch from the run root. The structured failure and original goal are sent back to
  Julia, then Qwen reselects the skill before MiniCPM resumes with prior observations.
  Recovery uses the 12-step run bound rather than a mis-selected skill's smaller bound.
- Julia capability labels now constrain the specialist roles exposed in MiniCPM's strict
  decision schema. The disabled K2 code role falls back to MiniCPM in a bounded code
  specialist call. This prevents Nanbeige math from being offered when Julia says
  `math=false` and `code=true`.
- `command.run` executes arbitrary non-interactive PowerShell or `/bin/sh` as the launch
  user with inherited filesystem/process/environment/network access. No allow-list or
  workspace boundary applies. Commands, cwd, platform, output and diagnostics are
  captured in the trace.
- Generic tools are `file.read`, `file.patch`, `calculator`, `command.run`, four browser
  tools, and dynamically discovered MCP tools. The skills endpoint derives availability
  from this real catalog.
- `host-shell/v1` requires a shell-neutral `pwd` probe first, then branches from the
  returned platform/shell metadata to installed syntax/provider discovery, bounded
  commands and evidence-backed completion. Its Windows/POSIX examples are model-readable
  methodology, not fixed runtime routes.
- The UI source is `apps/web/ui/agent-harness.aui`; the compiled React chat shows the
  live connected run/model/skill/tool/result graph beneath each agent response.
- Chat sessions are durable rather than browser-only. Scoped runs and their append-only
  traces remain in SQLite; `GET /api/v1/agent-runs` exposes bounded, newest-first session
  history. The UI restores the latest session after reload, groups recent runs by session,
  opens prior sessions from the sidebar, and gives each New task a fresh session ID.
  The AUI compilation step preserves dynamic history button actions instead of emitting
  the literal `item.action` string.
- Hybrid retrieval uses SQLite FTS plus version-scoped EmbeddingGemma vectors and
  reciprocal-rank fusion. Qwen compaction preserves and host-validates chunk IDs.
- A reasoning stream gets 30 seconds before generic recovery. On timeout the host calls
  llama.cpp `/models/unload` before retrying non-thinking, preventing an abandoned
  generation from occupying the serialized GPU queue. `stop-timeout = 5` is configured.

## Real artifacts and packaging

- All enabled artifact/projector SHA-256 values are in `config/models.lock.json` and
  verified at production startup. llama.cpp files are locked in `config/runtime.lock.json`.
- `releases/synlet-local/` is a 10.9 GB ignored portable bundle with exact Node 24.21.0,
  llama.cpp CUDA runtime, CPython 3.11.4, Python ML dependencies, enabled model files,
  app, UI, MCP server and operator CLI.
- The final manifest contains 36,212 hashed files. Doctor verifies every enabled model,
  projector, writable storage and real imports of Torch, Transformers,
  SentenceTransformers, Julia and the worker. Disabled K2 and old Qwen3-4B are omitted.
- `scripts/refresh-release-manifest.mjs` refreshes operator docs/CLI and the manifest
  without recopying the multi-gigabyte payload.

## Verification evidence (29 September 2026)

- `pnpm check`: pass; unit 5/5, including invalid-tool recovery and Qwen/MiniCPM model
  boundary assertions.
- Contracts 6/6, integration 8/8, security 4/4, browser/UI E2E 2/2: pass.
- Session-log regression: API validation/scope contract passes; SQLite persistence test
  verifies newest-first ordering, session filtering, trace recovery, result recovery and
  actor isolation. The expanded integration suite is 9/9.
- Python `uv run --locked pytest`: 4/4.
- Real role smoke: MiniCPM controller, Nanbeige math, LFM vision/projector and Qwen
  compactor all loaded and returned their role sentinels on pinned CUDA runtime.
- Real EmbeddingGemma: 768 dimensions, normalized vector; semantic paraphrase retrieved
  the correct source through the live API.
- Black-box live agent suite 3/3: natural questions for current time, CPU utilization
  and latest UK headlines. Tests name no tools/commands/answers, require successful
  generic observations, ground returned facts, and reject semantic shortcuts.
- Portable doctor: 15/15 checks. Release manifest/doctor relocation test passed from a
  path containing spaces and Unicode.
- Final `/health/ready` returns measured ready. `/api/v1/agent-tools` exposes 10 generic
  tools, including 2 MCP tools. `/api/v1/skills` reports all 5 skills enabled.
- Regression for the exact mobile prompt `whats the time`: completed in three controller
  steps after warm-up. Julia classified first, Qwen selected `host-shell`, MiniCPM ran
  the shell-neutral `pwd` probe, used the observed PowerShell host for the time command,
  and returned the exact successful observation. No failed trace nodes remained.
- Root cause of the photographed `Model proposed unavailable tool: id` failure: the
  controller prompt contained literal placeholder examples (`tool: id`, empty arguments,
  and placeholder answer text), and the host treated an unknown tool proposal as fatal.
  Literal examples were removed, strict catalog-derived response schemas were added,
  and invalid proposals now replan generically.
- Regression for the photographed `whats the cpu usage` failure: the original run did
  obtain `3.9066%` but failed because Qwen selected calculator-only `math-check`, the
  controller delegated to Nanbeige despite Julia `math=false`, and the five-step skill
  bound expired after valid shell evidence. After the fix, a real cold run completed
  with `CPU usage is 2%`; failed PowerShell attempts produced root-level recovery routes,
  no math specialist ran, and the final answer was grounded in successful `command.run`.

## Operational state

- Source app is intentionally left running at `http://127.0.0.1:43127/` from
  `pnpm dev:local`; current exec session at handoff was `73633`.
- Public access is live at `https://synlet.m8e.co.uk` through dedicated Cloudflare
  tunnel `synlet-local` (`c1071a25-dd95-4da8-b799-21f32bd5da8c`). DNS was explicitly
  corrected with `--config NUL` after the host default config initially targeted the
  older shared tunnel. The active connector session was `51058`.
- Never tunnel port 43127 directly: the UI bundle contains the local bearer token and
  the harness has unrestricted command execution. Tunnel traffic terminates at the
  Basic-auth/session-cookie proxy on `127.0.0.1:43129` (session `54842`). Credentials
  are random and stored only in ignored
  `runtime-data/cloudflare/basic-auth.json`. Anonymous/public verification returned
  401; authenticated UI and ten-tool API checks returned 200.
- Tunnel operations and restart/rotation instructions are in
  `docs/runbooks/cloudflare-tunnel.md`. Cloudflare Access is the preferred long-term
  replacement, but dashboard automation was unavailable during setup.
- The implementation and session-log recovery changes are intended for publication to
  `origin/main` under the user's explicit push authorization. Preserve the worktree until
  that publication is verified; do not reset it.
- The interactive dependency environment reports Node 24.19.0 warnings. The verified
  portable release embeds the required Node 24.21.0 runtime.
- First request after restart pays Julia's CPU cold load. After strict schema enforcement
  and the portable preflight correction, the exact warm time regression completed in
  roughly 16 seconds. Julia still assigned an unexpectedly high vision probability to
  the text-only time prompt; Qwen correctly selected `host-shell`, so this did not alter
  execution, but Julia threshold/calibration remains a measured quality follow-up.

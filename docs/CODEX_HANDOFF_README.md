# Synlet — Codex handoff kit v0.2

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


This repository contains an architecture document and implementation instructions.
It does NOT contain a working application, model weights, installers or benchmarks.

1. Open docs/architecture/synlet-soma-architecture.html in a browser.
2. Read AGENTS.md and preserve existing project instructions and unrelated work.
3. Give Codex CODEX_START_PROMPT.txt and start with the first unfinished task card.
4. The optional .agents/skills/synlet-build/SKILL.md is a development aid only.
5. Commands in the brief/backlog must be implemented by the corresponding tasks.
   They are not commands that this documentation-only repository can run today.

The model roster, performance calculator and source register are retained.
Build sections add module ownership, contracts, task cards, scaling and maintenance.
Speed values remain estimates; quality thresholds remain proposed acceptance gates.

Synlet is the assistant. SOMA means Specialist Orchestration and Memory Architecture.
The earlier working title was Collective; unchanged original artifacts are archived.

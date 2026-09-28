# Synlet

**Small models. Shared memory. One assistant.**

Synlet is a proposed local AI assistant powered by **SOMA — Specialist Orchestration and Memory Architecture**. SOMA coordinates small specialist models through adaptive routing, source-preserving indexed memory and verified tool execution behind one conversational interface.

> **Status: architecture and Codex build handoff, v0.2. Not an implemented assistant.** Model choices are candidates; speed figures are estimates and quality figures are acceptance targets, not measured results.

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

Use mock inference first. Do not download weights, call paid/cloud services, publish changes or install services without explicit permission.

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

This repository contains planning documents and build guidance, not model weights, a finished runtime, measured hardware benchmarks, secrets or an adopted software licence. Third-party model licences must be reviewed independently.

`HANDOFF_FILES.sha256` records checksums for the imported documentation and original artifacts. Future edits legitimately change those hashes; update the manifest when publishing a new handoff.

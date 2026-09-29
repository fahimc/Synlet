# Synlet — Module map

synlet/
  AGENTS.md                        # Short repository-wide build rules
  package.json                     # Exact packageManager + root scripts
  pnpm-workspace.yaml
  pnpm-lock.yaml
  tsconfig.base.json
  .agents/skills/synlet-build/  # Optional Codex development skill
    SKILL.md
  apps/
    server/src/                    # API, CLI, process supervisor, composition root
      bootstrap/                   # The ONLY place that selects adapters
      http/                        # Validation, authentication, responses
      cli/                         # doctor / start / stop / backup / benchmark
    web/ui/*.aui                   # Source-of-truth semantic UI screens
    web/src/                       # React host adapter and generated agent chat UI
  packages/
    contracts/                     # Canonical JSON schemas + generated types
      schemas/v1/
      generated/                   # Reproducible; never hand-edit
    core/src/
      domain/                      # Task state, IDs, budgets, errors
      ports/                       # Interfaces for all external effects
      orchestration/               # Durable bounded task/step machine
      context/                     # Retrieval, compaction, packet assembly
      scheduling/                  # Queues, resource admission, leases
      policy/                      # Scope, approval and retention decisions
    adapters/src/
      inference/                   # llama.cpp + Python model clients
      storage/                     # SQLite, file artifacts, migrations
      retrieval/                   # FTS5 + bounded vector search
      tools/                       # Files, calculator, browser, controlled shell
      mcp/                         # MCP stdio client connections and discovery
      observability/               # Redacted logging, tracing, measurements
    testkit/                       # Fake models, fake clock, fixtures, fault injection
  services/python-worker/
    pyproject.toml
    uv.lock
    src/synlet_worker/          # Julia + embeddings; no arbitrary tool code
    tests/
  skills/                          # Synlet runtime skills (NOT Codex skills)
    repo-fix/v1/{skill.json,SKILL.md,fixtures/}
  config/
    profiles/local-12gb.json
    runtime.lock.json              # Verified llama.cpp build, archives and files
    models.catalog.json            # Candidate identities and role preferences
    models.lock.json               # Verified revisions, files, hashes, licences
    toolchains.lock.json            # Tested Node / Python / runtimes / ABI
  tests/{unit,contracts,integration,e2e,security,performance}/
  evals/{fixtures,holdout,baselines}/
  scripts/                         # Cross-platform Node scripts; no bash dependency
  docs/
    architecture/synlet-soma-architecture.html
    CODEX_BUILD_BRIEF.md
    BUILD_BACKLOG.md
    MODULE_MAP.md
    DECISIONS.md                    # Small index of ADRs
    adr/                            # Architecture decisions + alternatives
    runbooks/                       # Recovery, upgrades, backup/restore, model onboarding
    progress/                       # One evidence report per build task
  releases/                        # Manifest-driven bundles; ignored generated output

# Not inside Git; resolve all roots from user configuration:
<chosen-data-root>/{db,artifacts,indexes,logs,backups,run}/
<chosen-model-root>/...
<approved-workspace>/...

Dependency rule: apps compose core and adapters; adapters implement core ports; core imports contracts only.
No deep imports across package private paths. Interfaces are not security boundaries: host policy and process/OS isolation still apply.

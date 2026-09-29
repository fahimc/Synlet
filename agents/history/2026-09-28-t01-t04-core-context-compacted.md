# T01–T04 durable core, tools, sources and context handoff

## Completed work

- Added schema-backed task, action, approval, source and context HTTP contracts.
- Added SQLite migrations and adapters for idempotent tasks, events, queue/outbox,
  approval journals/receipts and FTS5 source provenance.
- Added the bounded tool broker with action-hash verification, revision/scope/expiry
  checks, atomic workspace patches, junction/traversal rejection and one-shot
  `outcome_unknown` handling.
- Added atomic content-addressed source artifacts, exact/FTS lookup, chunk read and
  expansion, stale labels and source deletion/invalidation.
- Added bounded context packing with pinned constraints, reserves, coverage,
  omissions and validated source-preserving compaction fallback.
- Replaced the foundation page with a responsive MOCK task/source/context/approval
  console. Added ADR-0002, recovery/reindex runbooks and T01–T04 progress reports.

## Verification

On the available Windows host, commands ran through pnpm 11.19.0 / Node 24.19.0 and
reported the expected engine warning because the repository lock is Node 24.21.0 /
pnpm 11.28.1. The code itself uses the locked Node 24 APIs.

- `pnpm check`: exit 0.
- `pnpm test:contracts`: exit 0, 4/4.
- `pnpm test:integration`: exit 0, 7/7.
- `pnpm test:security`: exit 0, 4/4.
- `pnpm test:e2e`: exit 0, 1/1.
- `pnpm eval:mock`: exit 0, 2/2.
- Live `pnpm dev:mock` health/UI smoke: see the current T01–T04 progress evidence.

## Operational notes

The exFAT workspace workaround from the T00 handoff remains required. SQLite runtime
data is ignored under `runtime-data/`; do not place WAL files on a network share.
The UI uses the default loopback mock credential and the gateway binds to
`127.0.0.1`. No model, shell, cloud fallback or OS sandbox is claimed.

## Resume point

Start T05 only if requested: local inference and scheduler. Keep the current public
contracts stable or version schema changes. The working tree remains uncommitted;
no commit, push, release, download or external publication was authorised.

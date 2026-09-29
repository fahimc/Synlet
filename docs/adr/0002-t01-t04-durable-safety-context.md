# ADR-0002: Durable tasks, approval-bound tools and source context

Status: Accepted
Date: 2026-09-28

## Context

T01–T04 require crash-resilient task state, host-enforced tool safety, immutable
source provenance and bounded context construction while preserving the modular
boundary established in T00.

## Decision

- Use the Node 24 built-in SQLite binding with repository-owned, transactional
  migrations. Task intake, state events, queue records and outbox records commit
  together; state changes use optimistic revisions.
- Scope persisted records by actor and project. Return not-found across ownership
  boundaries to avoid leaking identifiers.
- Persist tool intent before execution. Approval decisions must present the exact
  canonical action hash and are bound to task revision, actor, project, policy
  version and expiry. Each action can be claimed and receipted once.
- Expose only bounded `file.read`, expected-hash `file.patch`, and a grammar-based
  calculator. Resolve real filesystem parents before writes and treat failure after
  a possible write as `outcome_unknown` without automatic replay.
- Store source bytes as content-addressed atomic files and provenance/chunks in
  SQLite FTS5. Retrieval always returns source, revision and chunk identifiers;
  stale revisions remain explicit.
- Build context through tokenizer, source-store and compactor ports. Reserve
  generation and safety capacity first, keep pinned constraints outside compaction,
  validate summary source references, and fall back to retained excerpts on invalid
  or failed compaction.

## Consequences

SQLite files must remain on a local disk rather than a network share. A process
that reports `outcome_unknown` requires operator reconciliation before any new
write. Current source ingestion accepts text through the bounded HTTP request and
streams it into the artifact store; binary parsers and revision-update routes are
future work. The deterministic mock tokenizer is evidence for orchestration logic,
not a claim about a production model tokenizer.

## Alternatives rejected

- In-memory queues cannot satisfy restart recovery or idempotency.
- UI-only confirmation does not enforce approval at the execution boundary.
- Arbitrary shell execution is too broad for the default local capability set.
- Database BLOB storage makes large-source streaming and independent artifact
  retention harder.
- Accepting unverified summaries could invent provenance or elevate source text to
  trusted instructions.

## Rollback

Stop the gateway, back up `runtime-data`, restore the prior application version,
and retain the SQLite/artifact directory for forward recovery. Schema migrations
are additive; do not downgrade a live database in place. For a full development
reset only, remove the explicitly configured `runtime-data` directory while the
gateway is stopped.

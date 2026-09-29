# T00 repository foundation handoff

## Purpose and confirmed requirements

Implement only the first unfinished Synlet card (T00) in mock mode. Preserve the
modular-monolith dependency direction, fail unknown config, make MOCK unmistakable,
use exact locks, and do not download models or publish changes.

## Completed work

- Created the pnpm/strict-TypeScript workspace, public package exports and project
  references for contracts, core, adapters, testkit, server and web.
- Added canonical v1 JSON Schemas with generated TS contracts and drift detection.
- Added a mock runtime adapter, pure health-domain function, loopback Fastify health
  routes and a Vite UI served by the gateway.
- Added strict config validation, dependency/cycle/private-import enforcement,
  deterministic tests, Windows/Linux CPU CI, exact dependency/toolchain locks and
  explicit failing placeholders for later-task commands.
- Recorded ADR-0001 and `docs/progress/T00.md`; marked T00 complete in the backlog.

## Verification

On Windows 11 with the exact locked Node 24.21.0 and pnpm 11.28.1:

- `pnpm check`: exit 0.
- `pnpm test:contracts`: exit 0, 4/4 tests.
- `pnpm dev:mock`: started on `127.0.0.1:43127`; `/health/ready` returned a ready
  MOCK response and `/` returned the MOCK UI. The long-running process was then
  stopped intentionally.
- `pnpm test:integration`: expected exit 2 / NOT_IMPLEMENTED (owned by T01).

The GitHub Actions Windows/Linux matrix is defined but has not run because no push
or publication was authorised.

## Compatibility and known issue

`I:` is exFAT, so pnpm cannot create its normal workspace/store junctions there.
Workspace packages have no package-manager workspace links; TypeScript resolves their
public names through project paths, then `scripts/materialize-workspace-packages.mjs`
copies built public packages into ignored `node_modules/@synlet`. The successful local
install used the locked pnpm CLI and an NTFS store. Do not hide this constraint or
change machine-wide link policy. The failed initial bootstrap also left a stale
project-registry reparse entry in the local pnpm cache; Windows error 649 prevented
its removal. It contains no repository data but may require a later cache repair.

## Resume point

Start T01 from `docs/BUILD_BACKLOG.md`. Re-run `pnpm check` and
`pnpm test:contracts`, then implement durable task intake/state/events/outbox/queue in
the existing core/adapter/server boundaries. The working tree is uncommitted; no push,
commit, release or model download occurred.

# T05–T09 runtime, browser, worker, evaluation and release handoff

## Completed work

- Added a capability/model lock, llama.cpp process adapter boundary, narrow chat
  facade, compatibility diagnostics and a bounded single-GPU fenced scheduler.
- Added four versioned runtime skills and Playwright Core browser automation using a
  dedicated profile, allow-listed domains, accessible targeting and post-action
  observation.
- Added v1 TypeScript/Python worker contracts, an isolated finite-routing/embedding
  worker, SQLite migration 004 and a version-isolated embedding index.
- Added evidence-labelled timings, fixed mock holdouts, degradation reporting and
  explicit local-model skips.
- Added a manifest-driven Windows mock bundle with exact Node 24.21.0, dependency and
  licence inventory, doctor/start/stop/status/backup/restore, hash checks and
  relocation tests. Added ADR-0003 and T05–T09 reports/runbooks.

## Verification

- `pnpm check`: exit 0, including 4/4 unit tests.
- `pnpm test:contracts`: exit 0, 6/6.
- `pnpm test:integration`: exit 0, 8/8.
- `pnpm test:security`: exit 0, 4/4.
- `pnpm test:e2e`: exit 0, 2/2, including real installed Edge via Playwright.
- `pnpm eval:mock`: exit 0, 2/2 orchestration and 3/3 fixed holdouts.
- `uv run --locked pytest` from `services/python-worker`: exit 0, 3/3.
- `pnpm test:release`: exit 0; 5,674 files hashed, exact bundled Node verified,
  doctor worked from a spaced/non-ASCII path, backup/restore preserved evidence.
- Live mock smoke: ready/MOCK; 8 model entries (one mock-enabled), four skills
  (three enabled with current host tools).
- `pnpm smoke:models` and `pnpm eval:local`: `SKIPPED`, not passed. RTX 3060 12GB is
  present, but no llama.cpp executable or authorised, hash-locked model was found.
- `pnpm bench:pool`: `SKIPPED`; T10 has no measured trigger.

An initially mistyped root-level uv command failed to locate the project; the required
command was rerun from `services/python-worker` and passed. This does not affect the
worker or lock.

## Compatibility and security notes

Playwright Core 1.63.0 was added exactly. The exFAT pnpm project-registry symlink bug
recurred during `pnpm add`; the dependency was integrity-verified and materialized as
a copy, while the root and virtual-store locks were reconciled. Standard `pnpm`
build/check commands pass again. Do not remove the T00 exFAT workaround.

No model weights, browser binaries, cloud calls, tunnel or personal browser profile
were used. Local mode intentionally exits 2 until model onboarding verifies exact
artifacts. Program, model and data roots remain separate.

## Resume point

T00–T09 are complete for the mock-capable product; model-dependent evidence is
explicitly skipped. T10 is `NOT_TRIGGERED`, not incomplete: implement it only after a
measured throughput or queue-wait requirement. No commit, push or release publication
was authorised; the working tree remains uncommitted and generated `reports/` and
`releases/` are ignored.

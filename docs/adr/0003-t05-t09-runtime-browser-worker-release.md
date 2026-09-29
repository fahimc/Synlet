# ADR-0003: Capability-gated local runtime and portable mock release

Status: Accepted
Date: 2026-09-28

## Decision

- Keep model identity and capability metadata in an immutable lock. A non-mock model
  cannot be enabled without an exact artifact path and SHA-256. Missing llama.cpp or
  weights is `SKIPPED`, never an implicit CPU/cloud fallback.
- Admit one local GPU lease at a time with bounded waiters and monotonically fenced
  leases. Cancellation removes queued work but does not release active capacity until
  the worker stops.
- Use Playwright Core with the installed browser, a dedicated profile, DOM-first
  targeting, an explicit domain allow-list and post-action observation. Personal
  browser profiles and debugging endpoints are never used.
- Runtime skills are versioned data with trusted status, bounded steps, fixed tools
  and completion checks. A missing host capability leaves a skill visible but
  disabled.
- Isolate finite routing and embedding inference behind a versioned line-delimited
  Python protocol. Batches are explicit and embedding indexes include the model
  version. Generated code never executes in this worker.
- Evidence reports must say `MOCK`, `MEASURED` or `SKIPPED` and include sample and
  runtime versions. Publisher results are not substituted for local measurements.
- Package a Windows mock release with Node 24.21.0, file hashes, dependency inventory,
  separate data/model roots and doctor/backup/restore commands. Updates do not replace
  data roots.

## Consequences

The current release is a verified mock runtime, not a real-model release. Model
onboarding remains an explicit operator workflow. Playwright Core is installed
without downloading a browser and uses the host's Edge installation. T10 remains
untriggered until a measured throughput or queue-wait problem justifies distribution.

## Rollback

Disable a capability in `config/models.lock.json`, restore the prior program bundle,
and keep the data root unchanged. For database changes, stop the service and restore
an operator-created backup. Browser profile state is disposable and separate from
personal profiles.

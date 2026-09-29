# ADR-0001: T00 modular TypeScript foundation

Status: Accepted
Date: 2026-09-28

## Context

Synlet needs a CPU-only foundation that keeps domain decisions independent from
HTTP, UI, inference and storage providers. The first milestone must run on Windows
and Linux without model weights, reject unknown configuration, and make dependency
rules executable.

## Decision

- Use a pnpm workspace with strict TypeScript project references and public package
  exports for `contracts`, `core`, `adapters`, `testkit`, `server` and `web`.
- Keep versioned JSON Schemas authoritative and generate TypeScript constants and
  types deterministically. Contract drift is a failing check.
- Compose the mock runtime only in `apps/server/src/bootstrap` and expose loopback
  Fastify health endpoints plus a Vite-built static UI through the same gateway.
- Enforce the allowed package dependency graph, reject private deep imports, and
  detect cycles with a repository-owned cross-platform Node script.
- Lock Node 24.21.0 LTS and pnpm 11.28.1 for CI. Later cards own Python, SQLite and
  llama.cpp locks.

## Alternatives rejected

- A service per model adds deployment and recovery complexity before measurements
  justify it.
- Framework-level dependency injection would add ambient container behaviour; the
  initial composition is explicit constructor/function wiring.
- A permissive configuration object would hide typos and unsafe defaults.
- No-op scripts for future tests would falsely report unimplemented gates as green.

## Consequences and migration cost

New packages must declare a stable public boundary and extend the dependency rule
map. Breaking contract changes require a schema version, fixtures, documentation
and migration notes. Replacing Fastify or Vite remains local to the application
edge but requires equivalent contract and smoke evidence.

## Evidence that would change this decision

Measured isolation or throughput needs may justify a worker transport after T09.
A supported toolchain incompatibility may move the exact Node or pnpm lock after
the Windows/Linux check matrix passes and rollback notes are recorded.

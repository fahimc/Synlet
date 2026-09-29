# ADR-0005: Local agent harness, MCP and live trace graph

## Status

Accepted — 2026-09-28.

## Decision

Add a bounded `AgentHarness` to core. The local model proposes one JSON decision per
step: call a host-advertised tool or return the final answer. The host owns the tool
catalog and executes proposals through adapters. Runs and append-only trace events are
persisted in SQLite and scoped to actor and project.

Use the official Model Context Protocol TypeScript client over stdio for configured MCP
servers. Ship a small real stdio server for installation and transport diagnostics.
Expose live search separately from persistent-profile Edge navigation. A full-host,
bounded command tool is available because this installation explicitly targets a local
computer agent; command, working directory, output and routing are recorded in the trace.

Author the chat screen in AUI and compile it deterministically to React. The chat polls
append-only trace events during a run and renders the latest state of each node as a
vertical process graph directly beneath the assistant message.

## Consequences

- The controller loop is capped at 12 steps and each model or command call has a timeout.
- Model responses are not capped by a guessed token allowance. Julia performs finite
  capability classification, Qwen3.5-0.8B performs the first language-model stage by
  selecting a versioned skill, and the main MiniCPM controller reasons. Julia, Qwen
  selection and Qwen compaction do not reason. A timed-out
  reasoning worker is unloaded before a non-thinking recovery attempt so it cannot
  occupy the serialized GPU queue indefinitely.
- MCP executables are selected from host configuration, never from model output.
- Browser automation uses a dedicated profile rather than the user's personal profile.
- Host commands are intentionally powerful. Loopback authentication and per-action trace
  visibility are audit controls, not an OS sandbox.
- The pre-existing approval-bound task API remains available for workflows that require
  explicit per-write authorization.
- The harness exposes generic primitives rather than semantic routes for anticipated
  questions. Time, CPU, news and similar requests must be solved by model-selected
  shell commands or generic browser operations; no intent-to-tool lookup encodes those
  paths. On Windows the shell primitive is unrestricted PowerShell with inherited host
  filesystem, process, environment and network access.
- Non-zero shell exits return their exit code, stdout and stderr as observations so the
  controller can diagnose and replan without a question-specific recovery path.
- A versioned portable host-shell skill tells the controller to discover the OS, shell,
  installed syntax and available providers before choosing platform-specific commands.
  This is model-readable methodology, not a host-side semantic route.
- A failed tool call is recorded as a failed trace node and returned to the controller as
  an observation, allowing bounded recovery instead of failing the entire run immediately.
- A failed tool call, invalid decision, or rejected answer also starts a recovery branch
  from the run root. Julia reclassifies the original goal plus structured failure,
  Qwen reselects the skill, and only specialists approved by Julia's current capability
  route are exposed to MiniCPM. Every model node persists its concrete model ID/version
  for the chat flow diagram.

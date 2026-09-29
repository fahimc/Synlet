# ADR 0011 — Full-control shared SOMA harness

Status: accepted design for the review remediation. Supersedes restrictive execution defaults in the original v0.2 blueprint for the owner's full-control profile.

## Owner requirement

Synlet manages the owner's PC remotely: it must run arbitrary terminal commands, write/edit/delete files, restart services, develop code, and inspect the actual results. The LLM decides the action and command. There must not be predefined natural-language-to-command routes, task-specific `time`/`CPU`/`news` handlers, command allowlists, forced keyword workflows, or a workspace-only sandbox in this profile.

## Decision

The default agent is a **full-control, single-operator harness**. Both `/api/v1/agent-runs` and `/v1/chat/completions` use the same AgentHarness, session memory, native token-accounting path, optional specialists, durable checkpoints and generic tool dispatcher.

`command.run` passes the model's command unchanged to the selected native shell. On Windows, PowerShell is the default and CMD is selectable. POSIX uses `/bin/sh`. The process inherits the launch user's environment, filesystem, process and network access. No semantic analysis chooses, substitutes or forbids commands. No secondary permission confirmation is inserted for authenticated full-control operations.

`file.read`, `file.write`, `file.patch` and `file.delete` support absolute paths and paths outside the workspace. `file.patch` has an expected-revision check to avoid accidentally overwriting a changed file. The model can deliberately use `file.write` when replacing current contents is intended. `image.open` reads actual pixels from accessible host paths. Generic browser and MCP tools remain available.

This is **not** automatic administrator/root privilege. OS permissions, UAC and service rights still apply. Running Synlet as an administrator gives its operator and models that same authority. Do not describe a native child process as an OS sandbox. Model weights are unchanged; the harness does not add a content/command filter, but this cannot guarantee that a model's native training never causes a refusal or error.

## What is not restricted

Command text, executable choice within the shell, host paths, coding tasks, file deletion, service commands, network calls and the choice of a recovery approach are not governed by predefined task routes. Generic tool schemas validate data shape, not acceptable command content. Julia and Qwen provide advice; Julia does not hide enabled specialists. Skills describe methods and never grant or remove OS permissions.

## What remains enforced

Strong operator authentication, server-owned identity, input shape, finite queues/deadlines, physical context limits, complete-generation validation, evidence provenance and process cleanup remain enforced. These are reliability/access boundaries, not command restrictions. Model output that is incomplete cannot trigger a command. An interrupted opaque command is not blindly replayed because its side effects may already have occurred. The operator can start a new request to inspect and reconcile the state and can still choose any command.

Only one full-control run mutates a host at a time. A generic shell is too powerful to classify safely as read-only merely from a model's label. This serial policy can later be replaced by explicit operator-owned isolated workers, not by pretending arbitrary commands are independent.

## Context and evidence

Original messages, source material and observations are stored by source ID. Prior session requirements are presented to new runs; original content is available through `context.search/read/expand/scan`. The compactor selects exact source lines, and the host reconstructs factual text. It is not permitted to invent source IDs or rewrite a negative constraint as a positive statement.

All model requests are finally counted with the runtime's native template/tokenizer. Multimodal requests use native zero-token prefill to count image tokens. If the backend cannot do that, the request fails clearly rather than claiming an exact estimate. Each request retains generation headroom; `maxOutputTokens=-1` means use remaining physical context, not unlimited context shifting. Long input briefs are explicitly marked as excerpts with recoverable originals.

Retrieval coverage, model-processed coverage and prompt inclusion are separate concepts. Exhaustive questions require visiting all pages; a database scan alone is not proof of analysis. A passing model self-review is labelled model critique, never independent verification. `verification.check` evaluates concrete assertions against original successful tool observations, while recording that the expected predicate is supplied by the model/operator.

## Recovery

The host persists intake/idempotency, original input, next step, observations, images and action intent. Safe model/context work can be reissued after restart within the original task deadline. A checkpoint interrupted during a tool action is marked outcome-unknown and is not automatically replayed. Final answers are checkpointed so a crash during completion does not restart the task. Legacy history without checkpoints is explicitly identified as non-resumable.

Cancellation requests stop owned process trees where possible and wait for shell termination. Browser cancellation closes the dedicated context. MCP cancellation closes the transport. External service/network effects are not assumed to be undone. Stale model workers that cannot confirm unloading quarantine the adapter instead of silently freeing usable capacity.

## Compatibility

The older manually driven task/approval API remains for backward compatibility; it is not the default chat execution path and its protected filesystem tests are not evidence that the full-control agent is sandboxed. T10 multi-user scale-out remains optional and is not claimed complete. Remote access must stay behind authenticated transport/proxy controls.

## Validation claims

Deterministic regression tests prove host behavior using explicit test doubles and owned temporary files. They do not establish model intelligence or RTX performance. Text sentinel tests are labelled load smoke tests. Model quality, multimodal interpretation and end-to-end speed require separately recorded runs on pinned real artifacts.

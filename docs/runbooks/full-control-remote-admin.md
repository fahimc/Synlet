# Synlet full-control remote administration

## Trust boundary

Anyone authenticated to the Synlet operator interface can issue commands with the rights of the account running Synlet. This includes editing/deleting accessible files, restarting permitted services, installing software, writing code and network access. There is no command allowlist or task-specific intent router. Treat the operator token like a remote terminal credential.

Keep the gateway bound to loopback. Tunnel through the authenticated proxy/Cloudflare Access, not the raw gateway. The gateway now has a randomly generated private bearer token stored in `<data-root>/operator-auth.json`, or a strong explicitly provided `SYNLET_AUTH_TOKEN`. No default bearer credential is embedded in the frontend. The browser asks for the token and keeps it in tab session storage. The remote proxy's login remains a separate outer boundary.

The old `Bearer synlet-local` credential is no longer valid by default. After updating, restart Synlet, read the private token locally, and sign in again. Do not commit or paste the token into issues, prompts, traces or shared screenshots. Existing operator data and model files are not replaced by this source update.

Authentication selects the server-configured actor and permitted project IDs. Supplying different `x-synlet-actor-id` or `x-synlet-project-id` headers does not impersonate another operator. The stock profile is single-operator, not a multi-tenant service.

## Launch and privileges

Use the existing `pnpm install --frozen-lockfile` / `pnpm dev` workflow after pulling the source. The model/runtime hashes still have to match the installed artifacts. Run as a normal account unless the required administration tasks genuinely require elevation. Elevation is an operator decision at launch; Synlet does not silently bypass OS protections. Commands requiring a different interactive desktop, credentials or UAC may need operator intervention.

PowerShell is the Windows default shell. A model may supply `shell: "cmd"` to run a CMD command. POSIX uses `/bin/sh`. Filesystem tools accept absolute paths; the workspace is a convenience default, not an isolation boundary. Revision-aware patching helps prevent accidental overwrite, while `file.write` deliberately permits replacement.

## Run identity and retries

For automated clients, provide an `Idempotency-Key`. Retries with the same key and identical request return the same run; reusing the key for different input is a conflict. UI sends a unique key per submitted message.

`POST /api/v1/agent-runs` is the asynchronous interface. Poll the run and persisted event stream, and cancel through the run's cancel endpoint. The non-streaming `/v1/chat/completions` facade invokes the same engine and preserves message roles; it does not secretly fall back to a controller-only call. Unsupported client tools/stream options are explicitly rejected.

## Cancellation and restart

A cancel request does not mean a service restart, file write or network request was rolled back. The trace records the requested cancellation and observed stop. If cancellation or a crash occurs during an opaque action, inspect the outcome-unknown record. Start a new request to check the actual machine state before deciding whether to repeat the action. No command is forbidden during reconciliation; automatic duplicate side effects are what the runtime prevents.

On host restart, safe checkpointed model work resumes within its original deadline. A legacy run without an execution checkpoint is not falsely advertised as resumable. Back up the SQLite store and artifacts together using the operator backup procedure before upgrading. Do not run two hosts against the same data store or expose SQLite on a network share.

## Vision

Images can be submitted as bounded PNG/JPEG/WebP data inputs through the agent/model API or obtained by the model through `image.open` and `browser.screenshot`. The vision specialist receives actual image content, not a path name masquerading as pixels. Remote image URLs are not implicitly fetched by the API; the agent can obtain remote content using its ordinary browser or unrestricted shell.

## Large outputs and memory

The complete captured observation is retained before prompt compaction. Terminal stdout/stderr capture is capped at 1 MiB per stream and explicitly labelled when truncated. For larger outputs, the model should redirect output to a file and read/process it in chunks with arbitrary shell commands. This is a resource limit, not a command filter.

Stored originals remain searchable when they leave the active prompt. Use context lookup for exact words, code, numbers and previous decisions. An extractive summary is a convenience index, not a new authoritative source. Deletion invalidates source lookup and derived indexes.

## Tests and quality

`pnpm check`, contract/integration/security/context suites, CPU Python contract checks and owned-browser E2E belong in CI. Full-control tests operate only on generated temporary fixture paths. They explicitly prove that files outside the fixture workspace are writable/deletable and arbitrary commands execute.

Live model and release tests require the actual installed runtime, models, browser and operator token. Set `SYNLET_LIVE_AUTH_TOKEN` before live tests. Old live time/CPU/news checks remain smoke tests, not rigorous quality benchmarks. Never treat a readiness sentinel, a model's own approval, or a green static build as evidence of general answer quality.

A release should record exact commit/model/runtime/prompt versions, sample counts, task success, routing recall, summary fidelity, actual image accuracy, source coverage, peak memory and cold/warm latency. Compare adaptive versus controller-only runs with the same tools and budgets. No hardware benchmark is fabricated by this remediation.

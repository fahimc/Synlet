# SOMA review remediation — evidence and operating contract

Date: 29 September 2026.

Status: ENGINEERING REMEDIATION IMPLEMENTED; WINDOWS/LINUX CPU VALIDATION PASSED. Live CUDA/model-quality acceptance and the user's deployed PC were not tested or changed by this remediation.

Original reviewed commit: `e648271686db5d207f44e96f35eef0685316589d`.
Validated implementation: `20e10a047b57abd4aa6ed36fe6791a210573194a`.
The final publishing commit only removes temporary preparation infrastructure, enables the equivalent permanent CI matrix and updates this evidence record; implementation/test sources are unchanged from that validated revision.

## Full-control requirement

The default chat and model API run one authenticated, LLM-driven full-control harness. The LLM can propose arbitrary PowerShell, CMD or POSIX shell commands, select the working directory, and read/write/edit/delete any file accessible to Synlet's launch account. The workspace is a convenience default, not a sandbox. Shell commands can manage services, processes, applications and code within the account's actual OS privileges.

There are no natural-language keyword handlers, predefined intent-to-command routes, command allowlists, default write-approval prompts or host-side content filters in this full-control execution path. Julia probabilities and selected skills are guidance, not authority to hide tools or specialists. The optional controller-only comparison changes model use, not permissions. Generic tools and independent test fixtures are not semantic execution routes.

Authentication, argument/schema validation, complete-generation checks, deadlines, bounded queues, physical context/VRAM limits, and unknown-effect reconciliation remain. They prevent malformed, truncated or duplicate actions; they do not select which legitimate shell commands the LLM may try. The legacy approval API remains explicitly separate. Full control does not bypass Windows/UAC/file ACLs, elevate automatically, alter model weights, guarantee a model will comply with every instruction, or make an interrupted side effect reversible.

## Review finding to implementation map

| Finding | Remediation | Regression evidence |
| --- | --- | --- |
| UI and model API used different engines | Both call AgentHarness; incoming message roles and images are preserved. | API contract and integration tests exercise the shared path. |
| Conversation was only visually persistent | Session memory archives user requests and assistant replies, with provenance and explicit trust labels. | Real Chromium login/send/follow-up/reload test inspects the inference request for earlier user and assistant content. |
| Context manager/lookup disconnected | AgentContext runs before every controller, selector, specialist and review request; lookup tools expose exact sources. | Multi-turn integration plus context packet tests. |
| Token counts omitted wrappers and used word estimates | Native apply-template/tokenize and native multimodal prefill count the completed request; the final packet is recounted. | Inference wire-contract test and packet-overhead regression. |
| Source-free or altered summaries accepted | The small compactor selects exact source lines; the host resolves and validates them. Empty, invented or altered citations fail closed to source excerpts. | Citation, negation, number and fallback regressions. |
| Exhaustive coverage overstated | Scanned, processed, included and omitted coverage are distinct; bounded source scans can be continued. | Context tests verify omissions and reject unsupported compaction. |
| Large inputs exceeded worker limits | Routing uses a bounded brief with retrievable originals; embeddings are sent in batches of at most 64, validated before source commit. | 102401-byte/65-chunk document becomes 64+1; embedding failure leaves no partial source. Python request-limit tests. |
| Vision model received only text | Image references/data reach the native multimodal adapter; screenshot observations can feed vision; image tokens are measured by the runtime. | Contract test verifies actual image-bearing requests, not a text readiness marker. Real model image accuracy remains unmeasured here. |
| Incomplete generation could execute tools | Explicit stop/completion is required. EOF, length termination, malformed decisions and invalid arguments cannot become completed tool actions. | Model-event and split-UTF-8 SSE regressions. |
| Durable logs were mistaken for durable execution | Step/checkpoint state and pending action intent are persisted; safe model continuation is recoverable, uncertain side effects are not automatically repeated. | Reopen/checkpoint/pending-action integration tests and idempotency tests. |
| Cancellation did not stop work | Shell process-tree termination is awaited; browser/MCP cancellation closes the relevant transport/context; GPU leases wait for confirmed stop or quarantine the runtime. | Actual shell cancellation, scheduler tests and ordered browser cleanup. No claim of reversing an already completed external write. |
| Approval service did not describe the main execution policy | Full-control is now explicit; every main-path tool outcome is journalled without introducing an allowlist. | Actual write/edit/delete outside the workspace, arbitrary shell/cwd and benign-stderr tests. |
| Client-supplied identity/shared static token | A private generated operator token or explicit environment token authenticates a server-bound principal. The UI prompts for the token. | Forged actor/project and API/browser authentication tests. |
| Routing blocked valid experts | Julia is advisory; enabled expert availability is separate. Skills do not narrow full-control permissions. | Harness routing/schema tests and controller-only comparison regression. |
| Model review presented as verification | Independent host observation checks produce explicit receipts; model review remains labelled critique, not proof of general correctness. | Successful-observation/exact-value verification regression. |
| Reasoning retries were silently downgraded | No silent thinking-to-non-thinking retry; effective modes and failures remain visible. A persisted total deadline bounds work. | Adapter/complete-event contract and harness trace tests. |
| CI omitted relevant suites and browser journey | Permanent Windows/Linux CI now includes integration, security, context, Python contracts and actual Chromium journeys. | Successful validation matrix below. |
| Weak quality oracles and no baseline | Smoke checks use exact answers. A shared-path evaluator uses independent exact-text/JSON/numeric oracles, private-suite support and an optional controller-only comparison. | False-positive, failed/skipped sample, and no-classifier baseline unit tests. Actual local ensemble/baseline scores have not been fabricated. |

## Executed validation

[Validation workflow and logs](https://github.com/fahimc/Synlet/actions/runs/36635308837) checked out implementation `20e10a047b57abd4aa6ed36fe6791a210573194a`, not merely the workflow-triggering parent.

- [Ubuntu job](https://github.com/fahimc/Synlet/actions/runs/36635308837/job/109634626798): PASS.
- [Windows job](https://github.com/fahimc/Synlet/actions/runs/36635308837/job/109634626831): PASS.

Both used Node 24.21.0 and pnpm 11.28.1. The Windows hosted runner was Windows Server 2025, not the user's Windows 11 desktop. Python contract tests used the selected 3.11 interpreter; no ML weights were needed. Browser tests used installed Chromium on each runner.

| Check | Ubuntu | Windows |
| --- | --- | --- |
| Formatting, lint, dependency boundaries, generated-contract drift, strict types | PASS | PASS |
| Unit tests | 15/15 | 15/15 |
| Contract tests | 7/7 | 7/7 |
| Integration tests | 13/13 | 13/13 |
| Security/full-control tests | 7/7 | 7/7 |
| Context regressions | 2/2 | 2/2 |
| Python contract tests | 4/4 | 4/4 |
| Browser/API end-to-end tests | 3/3 | 3/3 |
| Total test cases | 51 passed; 0 failed/skipped | 51 passed; 0 failed/skipped |

This is 51 cases run on two operating systems, not 102 unique scenarios. Inference doubles establish orchestration behaviour; actual temporary shell/file operations and real Chromium establish those host/browser behaviours. No destructive service restart or uncontrolled administration task was run on the user's PC.

## Live model acceptance still needs the installed hardware

Not executed in this environment: real Julia routing calibration, EmbeddingGemma semantic accuracy, Qwen compaction quality, MiniCPM tool decision quality, Nanbeige maths quality, LFM visual accuracy, CUDA cancellation/VRAM under the actual runtime, full-control service administration on the user's desktop, or portable-bundle rebuilding with the multi-gigabyte weights.

Use `pnpm smoke:models`, `pnpm eval:harness`, private task fixtures and matched adaptive/controller-only runs as described in [the evaluation runbook](../runbooks/model-evaluation.md). The bundled ten evaluation cases are public regression examples, not a private holdout or a general coding benchmark. Host assertions verify the specified observation conditions, not arbitrary answer truth. The work does not establish that several small models outperform a larger model.

## Upgrade and rollback

Stop the existing Synlet host before pulling and restarting. Back up the configured data directory first. Install from the lockfile, run the checks, then start normally. The UI now needs the private operator token from the configured data directory (`runtime-data/operator-auth.json` by default), or the explicit `SYNLET_AUTH_TOKEN`. The old static `synlet-local` bearer is no longer valid. Do not commit credentials or expose the unauthenticated inference server.

Keep the authenticated tunnel/proxy boundary; no deployed tunnel or PC service was changed here. See [full-control remote administration](../runbooks/full-control-remote-admin.md). Rollback requires the corresponding pre-upgrade program and database backup; do not assume an older binary safely understands new checkpoint data. Never automatically replay an interrupted shell or file mutation after rollback/restart.

The self-contained architecture HTML now exports the current AGENTS/build brief/start prompt and full-control proposed configuration. Archived original files remain historical and unchanged. The temporary patch-transfer files and preparation workflow are removed from the final tree.

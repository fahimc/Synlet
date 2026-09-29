# Production local runtime handoff

## Purpose and requirements

The user rejected the earlier mock-capable stopping point and required a complete,
usable local-LLM system with dependencies installed and no production mock path.
This instruction authorised downloading the runtime and model artifacts.

## Completed work

- Installed official llama.cpp b11237 (commit 14ebbd5f2) Windows CUDA 12.4 under
  ignored `runtime/llama/`, including its CUDA libraries.
- Installed official `Qwen/Qwen3-4B-GGUF` revision
  `bc640142c66e1fdd12af0bd68f40445458f3869b`, Q4_K_M, under ignored
  `model-weights/`. Its SHA-256 matches upstream LFS metadata:
  `7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5`.
- Added immutable model/runtime provenance locks. Startup verifies all recorded
  runtime files and the model before use.
- Replaced production synthetic inference with a persistent, API-key-protected
  loopback llama.cpp server. Durable tasks consume the real `ModelPort`, and the
  OpenAI facade reports measured evidence.
- Replaced synthetic worker routing/embeddings with authenticated local model calls.
  Embeddings are real 2,560-dimensional vectors and carry the locked model version.
- Removed selectable mock profiles, commands, reports and active-code labels. Tests
  use an injected test-only `ModelPort` that is not packaged or runtime-selectable.
- Updated the UI, launcher, CLI, docs, evaluations and portable packager. The release
  now bundles Node, llama.cpp/CUDA, Qwen weights and application dependencies.
- Fixed two production-size packaging defects: release hashes now stream files, and
  doctor uses access checks rather than reading a >2 GiB model into memory.

## Verification

- Real task API returned `FINAL_LOCAL_LLM_OK`; readiness was local/MEASURED.
- Raw llama.cpp server rejected an unauthenticated request with HTTP 401.
- `pnpm smoke:models`: passed, response `SYNLET_MODEL_READY`.
- `pnpm eval:local`: passed 3/3 fixed holdouts.
- `pnpm bench:local`: one measured full-server sample, 50 output tokens at 93.63
  tokens/s. Do not generalise a one-sample value into a latency distribution.
- Live Python worker: correct maths route and 2,560-dimensional embedding.
- Worker pytest: 3/3. `pnpm check`: 4/4 unit. Contracts: 6/6. Integration: 8/8.
  Security: 4/4. E2E: 2/2 including installed Edge.
- `pnpm test:release`: passed; 5,740 files hashed, Unicode/space relocation, doctor,
  backup and restore all verified.

## Operational state

`pnpm dev:local` is running in the current host session and serves the UI at
`http://127.0.0.1:43127/`. Ctrl+C stops both the gateway and owned model server.
Generated `reports/`, `releases/`, runtime binaries and weights are ignored. The
working tree remains uncommitted; no push or publication was authorised.

T10 remains `NOT_TRIGGERED`: the current single resident server is fast enough for
the measured workload and no queue/throughput evidence justifies a worker pool.

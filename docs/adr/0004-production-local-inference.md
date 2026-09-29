# ADR-0004: Production local inference and neural embeddings

Status: accepted
Date: 2026-09-28

## Decision

Run the official Qwen3-4B Q4_K_M GGUF through pinned llama.cpp b11237 CUDA 12.4 on
the target RTX 3060. Keep one API-key-protected llama.cpp server resident on
`127.0.0.1:43128`; the Synlet gateway remains the public local boundary on port 43127. The server provides both chat completions and mean-pooled 2,560-dimensional
embeddings. The Python worker uses those authenticated endpoints for finite routing
and embedding operations.

Production has no synthetic inference fallback. Startup verifies the model and
runtime hashes, waits for model readiness, and fails closed when verification or
health fails. Automated tests may inject a deterministic `ModelPort` test double,
but that adapter is not selectable by runtime configuration or packaged output.

## Rationale

A persistent server avoids reloading 2.5 GB of weights per task, provides structured
responses and token/timing usage, and reuses the same verified checkpoint for
controller, routing and retrieval embeddings. Loopback binding plus an internal API
key prevents unauthenticated browser-origin access to the raw model server.

## Consequences

The portable program root is several gigabytes and release hashing must stream large
files. The generative checkpoint is not a dedicated embedding model, so retrieval
quality remains an explicit evaluation concern even though the vectors are real and
versioned. Adding another specialist or embedding checkpoint still requires its own
licence, hash, role tests and measured benefit.

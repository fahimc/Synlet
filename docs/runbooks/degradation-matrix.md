# Degradation matrix

| Missing or failed capability | Evidence label | Behavior |
| --- | --- | --- |
| Local GGUF or llama.cpp | startup failure | Refuse startup; there is no silent substitute or cloud fallback. |
| Router inference | MEASURED failure | Stop routing and return the model/server error. |
| Embedding inference | MEASURED failure | Scoped FTS5 remains active; do not insert synthetic vectors. |
| Vision model/projector | SKIPPED | Vision is shown unavailable; text controller does not pretend to inspect images. |
| Browser authentication/CAPTCHA | unavailable | Stop and request user intervention; never bypass it. |
| GPU admission/OOM | MEASURED failure | Keep the lease until the worker stops, mark unhealthy, and expose queue/load evidence. |
| Compactor failure | MEASURED failure | Retain pinned state and original excerpts. |
| Possible tool write before crash | outcome_unknown | Block replay pending reconciliation. |

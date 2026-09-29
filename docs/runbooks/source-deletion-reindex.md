# Source deletion and reindex runbook

## Delete

Call `DELETE /api/v1/sources/:id` with the source owner's actor/project headers.
The transaction removes searchable chunks and marks the source deleted. The
content-addressed artifact is removed only when no live source references its hash.
Verify that get, FTS, exact lookup and chunk read all return no material afterward.

## Reindex

The current T03 API creates immutable source revisions and has no in-place reindex
endpoint. To change parser or index versions:

1. Ingest the original bytes as a new source/revision with the new implementation.
2. Validate exact lookup, FTS results and provenance against a fixture corpus.
3. Switch consumers to the new source ID only after validation.
4. Delete the old source through the API; do not directly remove artifacts or FTS
   rows.

If deletion or indexing is interrupted, stop the gateway, back up the local data
root, restart to complete committed SQLite recovery, and rerun read-only validation.

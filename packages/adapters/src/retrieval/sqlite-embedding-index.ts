import { DomainError, type AccessContext } from "@synlet/core";

import type { SynletDatabase } from "../storage/database.js";

type Row = Record<string, string | number | null>;

function cosine(left: readonly number[], right: readonly number[]): number {
  if (left.length !== right.length || left.length === 0)
    throw new DomainError("INVALID_OUTPUT", "Embedding dimensions differ");
  let dot = 0;
  let leftNorm = 0;
  let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += (left[index] ?? 0) * (right[index] ?? 0);
    leftNorm += (left[index] ?? 0) ** 2;
    rightNorm += (right[index] ?? 0) ** 2;
  }
  if (leftNorm === 0 || rightNorm === 0) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}

export class SqliteEmbeddingIndex {
  constructor(private readonly database: SynletDatabase) {}

  upsert(
    chunkId: string,
    modelVersion: string,
    vector: readonly number[],
    access: AccessContext,
  ): void {
    if (
      !modelVersion ||
      vector.length < 1 ||
      vector.length > 4096 ||
      vector.some((value) => !Number.isFinite(value))
    ) {
      throw new DomainError("INVALID_OUTPUT", "Invalid embedding");
    }
    const owned = this.database.connection
      .prepare(
        "SELECT 1 FROM chunks c JOIN sources s ON s.source_id = c.source_id WHERE c.chunk_id = ? AND c.project_id = ? AND s.actor_id = ? AND s.deleted_at IS NULL",
      )
      .get(chunkId, access.projectId, access.actorId);
    if (!owned) throw new DomainError("NOT_FOUND", "Chunk not found");
    this.database.connection
      .prepare(
        `INSERT INTO embeddings(chunk_id, project_id, model_version, dimensions, vector_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chunk_id, model_version) DO UPDATE SET vector_json = excluded.vector_json, dimensions = excluded.dimensions, created_at = excluded.created_at`,
      )
      .run(
        chunkId,
        access.projectId,
        modelVersion,
        vector.length,
        JSON.stringify(vector),
        new Date().toISOString(),
      );
  }

  search(
    modelVersion: string,
    query: readonly number[],
    limit: number,
    access: AccessContext,
  ): readonly { chunkId: string; score: number }[] {
    const rows = this.database.connection
      .prepare(
        `SELECT e.* FROM embeddings e JOIN chunks c ON c.chunk_id = e.chunk_id JOIN sources s ON s.source_id = c.source_id
      WHERE e.project_id = ? AND e.model_version = ? AND e.dimensions = ? AND s.actor_id = ? AND s.deleted_at IS NULL`,
      )
      .all(
        access.projectId,
        modelVersion,
        query.length,
        access.actorId,
      ) as Row[];
    return rows
      .map((row) => ({
        chunkId: String(row.chunk_id),
        score: cosine(query, JSON.parse(String(row.vector_json)) as number[]),
      }))
      .sort((left, right) => right.score - left.score)
      .slice(0, Math.min(Math.max(limit, 0), 100));
  }

  invalidateVersion(modelVersion: string, access: AccessContext): number {
    return Number(
      this.database.connection
        .prepare(
          "DELETE FROM embeddings WHERE project_id = ? AND model_version = ?",
        )
        .run(access.projectId, modelVersion).changes,
    );
  }
}

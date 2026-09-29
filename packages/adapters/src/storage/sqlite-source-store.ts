import {
  DomainError,
  type AccessContext,
  type RetrievedChunk,
  type SourceRef,
  type SourceStorePort,
  type StoredSource,
} from "@synlet/core";

import type { SynletDatabase } from "./database.js";

type Row = Record<string, string | number | null>;

function sourceFromRow(row: Row): StoredSource {
  return {
    sourceId: String(row.source_id),
    revision: String(row.current_revision ?? row.revision),
    title: String(row.title),
    kind: String(row.kind) as StoredSource["kind"],
    artifactHash: String(row.artifact_hash),
    bytes: Number(row.bytes),
    createdAt: String(row.created_at),
    deleted: row.deleted_at !== null,
  };
}

function chunkFromRow(row: Row): RetrievedChunk {
  return {
    ref: {
      sourceId: String(row.source_id),
      revision: String(row.revision),
      chunkId: String(row.chunk_id),
    },
    title: String(row.title),
    text: String(row.text),
    ordinal: Number(row.ordinal),
    stale: String(row.revision) !== String(row.current_revision),
  };
}

const chunkSelect = `SELECT c.*, s.title, s.current_revision FROM chunks c
  JOIN sources s ON s.source_id = c.source_id`;

export class SqliteSourceStore implements SourceStorePort {
  constructor(private readonly database: SynletDatabase) {}

  async add(
    input: {
      readonly source: StoredSource;
      readonly chunks: readonly {
        readonly chunkId: string;
        readonly ordinal: number;
        readonly text: string;
      }[];
    },
    access: AccessContext,
  ): Promise<StoredSource> {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO sources(source_id, project_id, actor_id, title, kind, current_revision, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        input.source.sourceId,
        access.projectId,
        access.actorId,
        input.source.title,
        input.source.kind,
        input.source.revision,
        input.source.createdAt,
      );
      db.prepare(
        `INSERT INTO source_revisions(source_id, revision, artifact_hash, bytes, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        input.source.sourceId,
        input.source.revision,
        input.source.artifactHash,
        input.source.bytes,
        input.source.createdAt,
      );
      for (const chunk of input.chunks) {
        db.prepare(
          `INSERT INTO chunks(chunk_id, source_id, revision, project_id, ordinal, text)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).run(
          chunk.chunkId,
          input.source.sourceId,
          input.source.revision,
          access.projectId,
          chunk.ordinal,
          chunk.text,
        );
        db.prepare(
          "INSERT INTO chunks_fts(chunk_id, project_id, text) VALUES (?, ?, ?)",
        ).run(chunk.chunkId, access.projectId, chunk.text);
      }
      db.exec("COMMIT");
      return input.source;
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async get(
    sourceId: string,
    access: AccessContext,
  ): Promise<StoredSource | undefined> {
    const row = this.database.connection
      .prepare(
        `SELECT s.*, r.artifact_hash, r.bytes FROM sources s JOIN source_revisions r
         ON r.source_id = s.source_id AND r.revision = s.current_revision
         WHERE s.source_id = ? AND s.project_id = ? AND s.actor_id = ? AND s.deleted_at IS NULL`,
      )
      .get(sourceId, access.projectId, access.actorId) as Row | undefined;
    return row ? sourceFromRow(row) : undefined;
  }

  async search(query: string, limit: number, access: AccessContext) {
    const terms = query.match(/[\p{L}\p{N}_]+/gu)?.slice(0, 32) ?? [];
    if (!terms.length) return [];
    const phrase = terms.map(term => `"${term.replaceAll('"', '""')}"`).join(" OR ");
    const rows = this.database.connection
      .prepare(
        `${chunkSelect} JOIN chunks_fts f ON f.chunk_id = c.chunk_id
         WHERE chunks_fts MATCH ? AND f.project_id = ? AND s.actor_id = ?
         AND s.deleted_at IS NULL ORDER BY bm25(chunks_fts) LIMIT ?`,
      )
      .all(
        phrase,
        access.projectId,
        access.actorId,
        Math.min(limit, 100),
      ) as Row[];
    return rows.map(chunkFromRow);
  }

  async exact(identifier: string, limit: number, access: AccessContext) {
    const rows = this.database.connection
      .prepare(
        `${chunkSelect} WHERE c.project_id = ? AND s.actor_id = ? AND s.deleted_at IS NULL
         AND instr(c.text, ?) > 0 ORDER BY c.source_id, c.ordinal LIMIT ?`,
      )
      .all(
        access.projectId,
        access.actorId,
        identifier,
        Math.min(limit, 100),
      ) as Row[];
    return rows.map(chunkFromRow);
  }

  async read(ref: SourceRef, access: AccessContext): Promise<RetrievedChunk> {
    const row = this.database.connection
      .prepare(
        `${chunkSelect} WHERE c.source_id = ? AND c.revision = ? AND c.chunk_id = ?
         AND c.project_id = ? AND s.actor_id = ? AND s.deleted_at IS NULL`,
      )
      .get(
        ref.sourceId,
        ref.revision,
        ref.chunkId ?? "",
        access.projectId,
        access.actorId,
      ) as Row | undefined;
    if (!row) throw new DomainError("NOT_FOUND", "Source reference not found");
    return chunkFromRow(row);
  }

  async readByChunkIds(
    chunkIds: readonly string[],
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]> {
    const statement = this.database.connection.prepare(
      `${chunkSelect} WHERE c.chunk_id = ? AND c.project_id = ? AND s.actor_id = ?
       AND s.deleted_at IS NULL AND c.revision = s.current_revision`,
    );
    return chunkIds.flatMap((chunkId) => {
      const row = statement.get(chunkId, access.projectId, access.actorId) as
        Row | undefined;
      return row ? [chunkFromRow(row)] : [];
    });
  }

  async expand(ref: SourceRef, radius: number, access: AccessContext) {
    const center = await this.read(ref, access);
    const rows = this.database.connection
      .prepare(
        `${chunkSelect} WHERE c.source_id = ? AND c.revision = ? AND c.project_id = ?
         AND s.actor_id = ? AND s.deleted_at IS NULL AND c.ordinal BETWEEN ? AND ?
         ORDER BY c.ordinal`,
      )
      .all(
        ref.sourceId,
        ref.revision,
        access.projectId,
        access.actorId,
        center.ordinal - radius,
        center.ordinal + radius,
      ) as Row[];
    return rows.map(chunkFromRow);
  }

  async scanAll(access: AccessContext) {
    const rows = this.database.connection
      .prepare(
        `${chunkSelect} WHERE c.project_id = ? AND s.actor_id = ? AND s.deleted_at IS NULL
         AND c.revision = s.current_revision ORDER BY c.source_id, c.ordinal LIMIT 10000`,
      )
      .all(access.projectId, access.actorId) as Row[];
    return rows.map(chunkFromRow);
  }

  async delete(
    sourceId: string,
    now: string,
    access: AccessContext,
  ): Promise<StoredSource> {
    const source = await this.get(sourceId, access);
    if (!source) throw new DomainError("NOT_FOUND", "Source not found");
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const chunkRows = db
        .prepare("SELECT chunk_id FROM chunks WHERE source_id = ?")
        .all(sourceId) as Row[];
      for (const row of chunkRows) {
        const hasEmbeddings = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='embeddings'").get();
        if (hasEmbeddings) db.prepare("DELETE FROM embeddings WHERE chunk_id=?").run(String(row.chunk_id));
        db.prepare("DELETE FROM chunks_fts WHERE chunk_id = ?").run(
          String(row.chunk_id),
        );
      }
      db.prepare("DELETE FROM chunks WHERE source_id = ?").run(sourceId);
      db.prepare(
        "UPDATE sources SET deleted_at = ? WHERE source_id = ? AND project_id = ? AND actor_id = ?",
      ).run(now, sourceId, access.projectId, access.actorId);
      db.exec("COMMIT");
      return { ...source, deleted: true };
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async artifactReferenceCount(hash: string): Promise<number> {
    const row = this.database.connection
      .prepare(
        `SELECT count(*) AS count FROM source_revisions r JOIN sources s ON s.source_id = r.source_id
         WHERE r.artifact_hash = ? AND s.deleted_at IS NULL`,
      )
      .get(hash) as Row;
    return Number(row.count);
  }
}

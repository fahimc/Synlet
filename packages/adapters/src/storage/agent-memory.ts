import {
  DomainError,
  type AccessContext,
  type AgentInput,
  type AgentMemoryPort,
  type AgentRunRecord,
  type Observation,
  type RetrievedChunk,
  type SourceService,
  type SourceStorePort,
} from "@synlet/core";
import type { SynletDatabase } from "./database.js";
type Row = Record<string, string | number | null>;
export class SqliteAgentMemory implements AgentMemoryPort {
  constructor(
    private readonly database: SynletDatabase,
    private readonly sources: SourceService,
    private readonly store: SourceStorePort,
  ) {
    database.connection.exec(`CREATE TABLE IF NOT EXISTS agent_memory (
      item_key TEXT NOT NULL, project_id TEXT NOT NULL, actor_id TEXT NOT NULL,
      session_id TEXT NOT NULL, run_id TEXT NOT NULL, kind TEXT NOT NULL,
      source_id TEXT NOT NULL, created_at TEXT NOT NULL,
      PRIMARY KEY(item_key, project_id, actor_id));
      CREATE INDEX IF NOT EXISTS agent_memory_session ON agent_memory(project_id,actor_id,session_id,kind);`);
  }
  private async ingest(
    key: string,
    kind: string,
    text: string,
    run: AgentRunRecord,
    access: AccessContext,
  ): Promise<string> {
    const db = this.database.connection;
    const row = db
      .prepare(
        "SELECT m.source_id FROM agent_memory m JOIN sources s ON s.source_id=m.source_id WHERE m.item_key=? AND m.project_id=? AND m.actor_id=? AND s.deleted_at IS NULL",
      )
      .get(key, access.projectId, access.actorId) as Row | undefined;
    if (row) return String(row.source_id);
    const source = await this.sources.ingest(
      { title: `${kind}: ${key}`, kind: "conversation", content: text },
      access,
    );
    db.prepare(
      "INSERT OR REPLACE INTO agent_memory VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    ).run(
      key,
      access.projectId,
      access.actorId,
      run.sessionId,
      run.runId,
      kind,
      source.sourceId,
      new Date().toISOString(),
    );
    return source.sourceId;
  }
  async remember(
    run: AgentRunRecord,
    input: AgentInput,
    access: AccessContext,
  ): Promise<string> {
    const messages =
      input.messages
        ?.map((m) => `${m.role.toUpperCase()}: ${m.content}`)
        .join("\n\n") ?? "";
    return this.ingest(
      `request-${run.runId}`,
      "user-request",
      `${messages}\n\nCURRENT USER REQUEST:\n${input.prompt}`.trim(),
      run,
      access,
    );
  }
  async answer(
    run: AgentRunRecord,
    text: string,
    access: AccessContext,
  ): Promise<void> {
    await this.ingest(
      `answer-${run.runId}`,
      "assistant-answer",
      `ASSISTANT OUTPUT (not a user instruction or independently verified fact):\n${text}`,
      run,
      access,
    );
  }
  async history(
    run: AgentRunRecord,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]> {
    const rows = this.database.connection
      .prepare(
        `SELECT c.chunk_id FROM chunks c JOIN sources s ON s.source_id=c.source_id JOIN agent_memory m ON m.source_id=s.source_id
      WHERE m.project_id=? AND m.actor_id=? AND m.session_id=? AND m.run_id<>? AND m.kind IN ('user-request','assistant-answer') AND s.deleted_at IS NULL AND c.revision=s.current_revision
      ORDER BY m.created_at DESC, c.ordinal LIMIT 64`,
      )
      .all(access.projectId, access.actorId, run.sessionId, run.runId) as Row[];
    return this.store.readByChunkIds(
      rows.map((r) => String(r.chunk_id)),
      access,
    );
  }
  async evidence(
    run: AgentRunRecord,
    observation: Observation,
    access: AccessContext,
  ): Promise<void> {
    await this.ingest(
      observation.id,
      "observation",
      `OBSERVATION ID: ${observation.id}\nTOOL: ${observation.tool}\nARGUMENTS: ${JSON.stringify(observation.arguments)}\nORIGINAL RESULT:\n${JSON.stringify(observation.result)}`,
      run,
      access,
    );
  }
  async search(query: string, access: AccessContext) {
    // Exact IDs/error strings take precedence; semantic matching supplements rather than replaces them.
    const rows = this.database.connection
      .prepare(
        "SELECT c.chunk_id FROM chunks c JOIN sources s ON s.source_id=c.source_id WHERE c.project_id=? AND s.actor_id=? AND s.deleted_at IS NULL AND c.revision=s.current_revision AND (c.chunk_id=? OR s.source_id=?) ORDER BY c.ordinal LIMIT 20",
      )
      .all(access.projectId, access.actorId, query, query) as Row[];
    if (rows.length)
      return this.store.readByChunkIds(
        rows.map((row) => String(row.chunk_id)),
        access,
      );
    const exact = await this.sources.exact(query, access);
    const ranked = await this.sources.search(query, access);
    return [
      ...new Map([...exact, ...ranked].map((c) => [c.ref.chunkId, c])).values(),
    ].slice(0, 20);
  }
  async read(chunkId: string, access: AccessContext): Promise<RetrievedChunk> {
    const chunks = await this.store.readByChunkIds([chunkId], access);
    if (!chunks[0])
      throw new DomainError(
        "NOT_FOUND",
        "Chunk is missing, deleted or outside the authorised scope",
      );
    return chunks[0];
  }
  async expand(chunkId: string, access: AccessContext) {
    const chunk = await this.read(chunkId, access);
    return this.store.expand(chunk.ref, 1, access);
  }
  async scan(cursor: number, limit: number, access: AccessContext) {
    const db = this.database.connection;
    const where =
      "FROM chunks c JOIN sources s ON s.source_id=c.source_id WHERE c.project_id=? AND s.actor_id=? AND s.deleted_at IS NULL AND c.revision=s.current_revision";
    const count = db
      .prepare(`SELECT count(*) AS count ${where}`)
      .get(access.projectId, access.actorId) as Row;
    const rows = db
      .prepare(
        `SELECT c.chunk_id ${where} ORDER BY s.created_at, c.source_id, c.ordinal LIMIT ? OFFSET ?`,
      )
      .all(access.projectId, access.actorId, limit, cursor) as Row[];
    const total = Number(count.count);
    return {
      chunks: await this.store.readByChunkIds(
        rows.map((r) => String(r.chunk_id)),
        access,
      ),
      nextCursor: cursor + rows.length < total ? cursor + rows.length : null,
      total,
    };
  }
}

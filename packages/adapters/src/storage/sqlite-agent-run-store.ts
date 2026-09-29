import {
  DomainError,
  type AccessContext,
  type AgentRunRecord,
  type AgentRunStatus,
  type AgentRunStorePort,
  type AgentTraceEvent,
  type Json,
} from "@synlet/core";

import type { SynletDatabase } from "./database.js";

type Row = Record<string, string | number | bigint | Uint8Array | null>;

function runFrom(row: Row): AgentRunRecord {
  return {
    runId: String(row.run_id),
    projectId: String(row.project_id),
    actorId: String(row.actor_id),
    sessionId: String(row.session_id),
    prompt: String(row.prompt),
    status: String(row.status) as AgentRunStatus,
    ...(row.result === null ? {} : { result: String(row.result) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

function eventFrom(row: Row): AgentTraceEvent {
  return {
    sequence: Number(row.sequence),
    runId: String(row.run_id),
    nodeId: String(row.node_id),
    ...(row.parent_node_id === null
      ? {}
      : { parentNodeId: String(row.parent_node_id) }),
    kind: String(row.kind) as AgentTraceEvent["kind"],
    label: String(row.label),
    status: String(row.status) as AgentTraceEvent["status"],
    data: JSON.parse(String(row.data_json)) as Json,
    createdAt: String(row.created_at),
  };
}

export class SqliteAgentRunStore implements AgentRunStorePort {
  constructor(private readonly database: SynletDatabase) {}

  async create(
    input: AgentRunRecord,
    access: AccessContext,
  ): Promise<AgentRunRecord> {
    if (
      input.projectId !== access.projectId ||
      input.actorId !== access.actorId
    ) {
      throw new DomainError(
        "POLICY_DENIED",
        "Agent run scope does not match access context",
      );
    }
    this.database.connection
      .prepare(
        `
      INSERT INTO agent_runs(run_id, project_id, actor_id, session_id, prompt, status, result, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        input.runId,
        input.projectId,
        input.actorId,
        input.sessionId,
        input.prompt,
        input.status,
        input.result ?? null,
        input.createdAt,
        input.updatedAt,
      );
    return input;
  }

  async get(
    runId: string,
    access: AccessContext,
  ): Promise<AgentRunRecord | undefined> {
    const row = this.database.connection
      .prepare(
        `
      SELECT * FROM agent_runs WHERE run_id = ? AND project_id = ? AND actor_id = ?
    `,
      )
      .get(runId, access.projectId, access.actorId) as Row | undefined;
    return row ? runFrom(row) : undefined;
  }

  async list(
    access: AccessContext,
    options: { readonly sessionId?: string; readonly limit: number },
  ): Promise<readonly AgentRunRecord[]> {
    const rows = options.sessionId
      ? this.database.connection
          .prepare(
            `
      SELECT * FROM agent_runs
      WHERE project_id = ? AND actor_id = ? AND session_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `,
          )
          .all(
            access.projectId,
            access.actorId,
            options.sessionId,
            options.limit,
          )
      : this.database.connection
          .prepare(
            `
      SELECT * FROM agent_runs
      WHERE project_id = ? AND actor_id = ?
      ORDER BY created_at DESC, rowid DESC LIMIT ?
    `,
          )
          .all(access.projectId, access.actorId, options.limit);
    return (rows as Row[]).map(runFrom);
  }

  async append(
    event: Omit<AgentTraceEvent, "sequence">,
    access: AccessContext,
  ): Promise<AgentTraceEvent> {
    if (!(await this.get(event.runId, access)))
      throw new DomainError("NOT_FOUND", "Agent run not found");
    const result = this.database.connection
      .prepare(
        `
      INSERT INTO agent_trace_events(run_id, node_id, parent_node_id, kind, label, status, data_json, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
      )
      .run(
        event.runId,
        event.nodeId,
        event.parentNodeId ?? null,
        event.kind,
        event.label,
        event.status,
        JSON.stringify(event.data),
        event.createdAt,
      );
    return { ...event, sequence: Number(result.lastInsertRowid) };
  }

  async events(
    runId: string,
    afterSequence: number,
    access: AccessContext,
  ): Promise<readonly AgentTraceEvent[]> {
    if (!(await this.get(runId, access)))
      throw new DomainError("NOT_FOUND", "Agent run not found");
    return (
      this.database.connection
        .prepare(
          `
      SELECT * FROM agent_trace_events WHERE run_id = ? AND sequence > ? ORDER BY sequence LIMIT 512
    `,
        )
        .all(runId, afterSequence) as Row[]
    ).map(eventFrom);
  }

  async finish(
    runId: string,
    status: Exclude<AgentRunStatus, "running">,
    result: string,
    now: string,
    access: AccessContext,
  ): Promise<AgentRunRecord> {
    const update = this.database.connection
      .prepare(
        `
      UPDATE agent_runs SET status = ?, result = ?, updated_at = ?
      WHERE run_id = ? AND project_id = ? AND actor_id = ? AND status = 'running'
    `,
      )
      .run(status, result, now, runId, access.projectId, access.actorId);
    if (Number(update.changes) === 0) {
      const existing = await this.get(runId, access);
      if (existing) return existing;
      throw new DomainError("NOT_FOUND", "Agent run not found");
    }
    const completed = await this.get(runId, access);
    if (!completed)
      throw new DomainError("NOT_FOUND", "Agent run not found after update");
    return completed;
  }
}

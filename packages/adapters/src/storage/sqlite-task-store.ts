import {
  DomainError,
  type AccessContext,
  type Json,
  type TaskEventRecord,
  type TaskRecord,
  type TaskStatus,
  type TaskStorePort,
} from "@synlet/core";

import type { SynletDatabase } from "./database.js";

type Row = Record<string, string | number | null>;

function taskFromRow(row: Row): TaskRecord {
  return {
    taskId: String(row.task_id),
    projectId: String(row.project_id),
    actorId: String(row.actor_id),
    sessionId: String(row.session_id),
    prompt: String(row.prompt),
    status: String(row.status) as TaskStatus,
    revision: Number(row.revision),
    ...(row.result === null ? {} : { result: String(row.result) }),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
  };
}

export class SqliteTaskStore implements TaskStorePort {
  constructor(private readonly database: SynletDatabase) {}

  async intake(
    input: {
      readonly taskId: string;
      readonly requestHash: string;
      readonly idempotencyKey: string;
      readonly sessionId: string;
      readonly prompt: string;
      readonly now: string;
      readonly maxPending: number;
    },
    access: AccessContext,
  ) {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db
        .prepare(
          "SELECT * FROM tasks WHERE project_id = ? AND actor_id = ? AND idempotency_key = ?",
        )
        .get(access.projectId, access.actorId, input.idempotencyKey) as
        Row | undefined;
      if (existing) {
        db.exec("COMMIT");
        return existing.request_hash === input.requestHash
          ? ({ kind: "duplicate", task: taskFromRow(existing) } as const)
          : ({ kind: "conflict" } as const);
      }
      const pending = db
        .prepare(
          "SELECT count(*) AS count FROM tasks WHERE project_id = ? AND status IN ('queued','running','cancel_requested')",
        )
        .get(access.projectId) as Row;
      if (Number(pending.count) >= input.maxPending) {
        db.exec("COMMIT");
        return { kind: "capacity" } as const;
      }
      db.prepare(
        `INSERT INTO tasks(task_id, project_id, actor_id, session_id, prompt, request_hash,
          idempotency_key, status, revision, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'queued', 0, ?, ?)`,
      ).run(
        input.taskId,
        access.projectId,
        access.actorId,
        input.sessionId,
        input.prompt,
        input.requestHash,
        input.idempotencyKey,
        input.now,
        input.now,
      );
      db.prepare(
        "INSERT INTO task_events(task_id, type, data_json, created_at) VALUES (?, 'task.created', '{}', ?)",
      ).run(input.taskId, input.now);
      db.prepare(
        "INSERT INTO durable_queue(task_id, state, created_at, updated_at) VALUES (?, 'pending', ?, ?)",
      ).run(input.taskId, input.now, input.now);
      const row = db
        .prepare("SELECT * FROM tasks WHERE task_id = ?")
        .get(input.taskId) as Row;
      db.exec("COMMIT");
      return { kind: "created", task: taskFromRow(row) } as const;
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async get(
    taskId: string,
    access: AccessContext,
  ): Promise<TaskRecord | undefined> {
    const row = this.database.connection
      .prepare(
        "SELECT * FROM tasks WHERE task_id = ? AND project_id = ? AND actor_id = ?",
      )
      .get(taskId, access.projectId, access.actorId) as Row | undefined;
    return row ? taskFromRow(row) : undefined;
  }

  async commit(
    input: {
      readonly taskId: string;
      readonly expectedRevision: number;
      readonly nextStatus: TaskStatus;
      readonly result?: string;
      readonly eventType: string;
      readonly eventData: Json;
      readonly outbox: readonly Json[];
      readonly now: string;
    },
    access: AccessContext,
  ): Promise<TaskRecord> {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db
        .prepare(
          `UPDATE tasks SET status = ?, revision = revision + 1, result = ?, updated_at = ?
           WHERE task_id = ? AND project_id = ? AND actor_id = ? AND revision = ?`,
        )
        .run(
          input.nextStatus,
          input.result ?? null,
          input.now,
          input.taskId,
          access.projectId,
          access.actorId,
          input.expectedRevision,
        );
      if (updated.changes !== 1) {
        const exists = db
          .prepare(
            "SELECT 1 FROM tasks WHERE task_id = ? AND project_id = ? AND actor_id = ?",
          )
          .get(input.taskId, access.projectId, access.actorId);
        db.exec("ROLLBACK");
        throw new DomainError(
          exists ? "STALE_REVISION" : "NOT_FOUND",
          exists ? "Task revision is stale" : "Task not found",
        );
      }
      db.prepare(
        "INSERT INTO task_events(task_id, type, data_json, created_at) VALUES (?, ?, ?, ?)",
      ).run(
        input.taskId,
        input.eventType,
        JSON.stringify(input.eventData),
        input.now,
      );
      for (const payload of input.outbox) {
        db.prepare(
          "INSERT INTO outbox(task_id, payload_json, created_at) VALUES (?, ?, ?)",
        ).run(input.taskId, JSON.stringify(payload), input.now);
      }
      const queueState =
        input.nextStatus === "running"
          ? "leased"
          : input.nextStatus === "queued"
            ? "pending"
            : "done";
      db.prepare(
        "UPDATE durable_queue SET state = ?, fencing_token = fencing_token + 1, updated_at = ? WHERE task_id = ?",
      ).run(queueState, input.now, input.taskId);
      const row = db
        .prepare("SELECT * FROM tasks WHERE task_id = ?")
        .get(input.taskId) as Row;
      db.exec("COMMIT");
      return taskFromRow(row);
    } catch (error: unknown) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  async events(
    taskId: string,
    afterSequence: number,
    limit: number,
    access: AccessContext,
  ): Promise<readonly TaskEventRecord[]> {
    if (!(await this.get(taskId, access)))
      throw new DomainError("NOT_FOUND", "Task not found");
    const rows = this.database.connection
      .prepare(
        "SELECT * FROM task_events WHERE task_id = ? AND sequence > ? ORDER BY sequence LIMIT ?",
      )
      .all(taskId, afterSequence, Math.min(Math.max(limit, 1), 256)) as Row[];
    return rows.map((row) => ({
      sequence: Number(row.sequence),
      taskId: String(row.task_id),
      type: String(row.type),
      data: JSON.parse(String(row.data_json)) as Json,
      createdAt: String(row.created_at),
    }));
  }
}

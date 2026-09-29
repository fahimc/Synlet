import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";

const migrations = [
  {
    version: 1,
    sql: `
      CREATE TABLE tasks (
        task_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        request_hash TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        status TEXT NOT NULL,
        revision INTEGER NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        UNIQUE(project_id, actor_id, idempotency_key)
      );
      CREATE TABLE task_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        type TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE TABLE outbox (
        outbox_id INTEGER PRIMARY KEY AUTOINCREMENT,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        payload_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        delivered_at TEXT
      );
      CREATE TABLE durable_queue (
        task_id TEXT PRIMARY KEY REFERENCES tasks(task_id),
        state TEXT NOT NULL,
        fencing_token INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE INDEX task_events_task_sequence ON task_events(task_id, sequence);
      CREATE INDEX tasks_scope ON tasks(project_id, actor_id, session_id);
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE actions (
        action_id TEXT PRIMARY KEY,
        approval_id TEXT NOT NULL UNIQUE,
        task_id TEXT NOT NULL REFERENCES tasks(task_id),
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        task_revision INTEGER NOT NULL,
        tool_id TEXT NOT NULL,
        arguments_json TEXT NOT NULL,
        action_hash TEXT NOT NULL,
        status TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        execution_started INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL
      );
      CREATE TABLE approvals (
        approval_id TEXT PRIMARY KEY REFERENCES actions(approval_id),
        decision TEXT,
        decided_at TEXT,
        actor_id TEXT NOT NULL,
        project_id TEXT NOT NULL,
        policy_version TEXT NOT NULL
      );
      CREATE TABLE receipts (
        receipt_id TEXT PRIMARY KEY,
        action_id TEXT NOT NULL UNIQUE REFERENCES actions(action_id),
        status TEXT NOT NULL,
        result_json TEXT,
        created_at TEXT NOT NULL
      );
      CREATE INDEX actions_scope_status ON actions(project_id, actor_id, status);
    `,
  },
  {
    version: 3,
    sql: `
      CREATE TABLE sources (
        source_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        title TEXT NOT NULL,
        kind TEXT NOT NULL,
        current_revision TEXT NOT NULL,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      );
      CREATE TABLE source_revisions (
        source_id TEXT NOT NULL REFERENCES sources(source_id),
        revision TEXT NOT NULL,
        artifact_hash TEXT NOT NULL,
        bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(source_id, revision)
      );
      CREATE TABLE chunks (
        chunk_id TEXT PRIMARY KEY,
        source_id TEXT NOT NULL,
        revision TEXT NOT NULL,
        project_id TEXT NOT NULL,
        ordinal INTEGER NOT NULL,
        text TEXT NOT NULL,
        FOREIGN KEY(source_id, revision) REFERENCES source_revisions(source_id, revision)
      );
      CREATE VIRTUAL TABLE chunks_fts USING fts5(
        chunk_id UNINDEXED,
        project_id UNINDEXED,
        text,
        tokenize='unicode61'
      );
      CREATE INDEX chunks_source_revision_ordinal ON chunks(source_id, revision, ordinal);
      CREATE INDEX sources_scope ON sources(project_id, actor_id, deleted_at);
    `,
  },
  {
    version: 4,
    sql: `
      CREATE TABLE embeddings (
        chunk_id TEXT NOT NULL REFERENCES chunks(chunk_id) ON DELETE CASCADE,
        project_id TEXT NOT NULL,
        model_version TEXT NOT NULL,
        dimensions INTEGER NOT NULL,
        vector_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        PRIMARY KEY(chunk_id, model_version)
      );
      CREATE INDEX embeddings_scope_version ON embeddings(project_id, model_version);
    `,
  },
  {
    version: 5,
    sql: `
      CREATE TABLE agent_runs (
        run_id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        session_id TEXT NOT NULL,
        prompt TEXT NOT NULL,
        status TEXT NOT NULL,
        result TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE agent_trace_events (
        sequence INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL REFERENCES agent_runs(run_id),
        node_id TEXT NOT NULL,
        parent_node_id TEXT,
        kind TEXT NOT NULL,
        label TEXT NOT NULL,
        status TEXT NOT NULL,
        data_json TEXT NOT NULL,
        created_at TEXT NOT NULL
      );
      CREATE INDEX agent_runs_scope ON agent_runs(project_id, actor_id, session_id, created_at);
      CREATE INDEX agent_trace_run_sequence ON agent_trace_events(run_id, sequence);
    `,
  },
];

export class SynletDatabase {
  readonly connection: DatabaseSync;

  constructor(path: string) {
    if (path !== ":memory:")
      mkdirSync(dirname(resolve(path)), { recursive: true });
    this.connection = new DatabaseSync(path);
    this.connection.exec(
      "PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;",
    );
    if (path !== ":memory:") this.connection.exec("PRAGMA journal_mode = WAL;");
    this.migrate();
  }

  private migrate(): void {
    this.connection.exec(
      "CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);",
    );
    const applied = new Set(
      this.connection
        .prepare("SELECT version FROM schema_migrations")
        .all()
        .map(
          (row: Record<string, string | number | bigint | Uint8Array | null>) =>
            Number(row.version),
        ),
    );
    for (const migration of migrations) {
      if (applied.has(migration.version)) continue;
      this.connection.exec("BEGIN IMMEDIATE");
      try {
        this.connection.exec(migration.sql);
        this.connection
          .prepare(
            "INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)",
          )
          .run(migration.version, new Date().toISOString());
        this.connection.exec("COMMIT");
      } catch (error: unknown) {
        this.connection.exec("ROLLBACK");
        throw error;
      }
    }
  }

  close(): void {
    this.connection.close();
  }
}

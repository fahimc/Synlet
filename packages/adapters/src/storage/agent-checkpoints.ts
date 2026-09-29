import { createHash } from "node:crypto";
import { DomainError, type AccessContext, type AgentRunRecord, type AgentCheckpointPort, type RunCheckpoint } from "@synlet/core";
import type { SynletDatabase } from "./database.js";
import { SqliteAgentRunStore } from "./sqlite-agent-run-store.js";

type Row = Record<string, string | number | null>;
/** Additive v1 migration; existing task and source tables are retained. */
export class SqliteAgentCheckpoints implements AgentCheckpointPort {
  constructor(private readonly database: SynletDatabase) {
    database.connection.exec(`CREATE TABLE IF NOT EXISTS agent_checkpoints (
      run_id TEXT PRIMARY KEY REFERENCES agent_runs(run_id), project_id TEXT NOT NULL,
      actor_id TEXT NOT NULL, request_key TEXT NOT NULL, request_hash TEXT NOT NULL,
      state_json TEXT NOT NULL, updated_at TEXT NOT NULL,
      UNIQUE(project_id, actor_id, request_key));
      CREATE INDEX IF NOT EXISTS agent_checkpoint_scope ON agent_checkpoints(project_id, actor_id);`);
  }
  async begin(run: AgentRunRecord, state: RunCheckpoint, access: AccessContext, maxPending: number) {
    if (run.projectId !== access.projectId || run.actorId !== access.actorId) throw new DomainError("POLICY_DENIED", "Run identity does not match authenticated scope");
    const db = this.database.connection;
    const key = state.input.idempotencyKey ?? run.runId;
    const payload = { ...state.input, idempotencyKey: undefined };
    const hash = createHash("sha256").update(JSON.stringify(payload)).digest("hex");
    db.exec("BEGIN IMMEDIATE");
    try {
      const existing = db.prepare("SELECT run_id, request_hash FROM agent_checkpoints WHERE project_id=? AND actor_id=? AND request_key=?").get(access.projectId, access.actorId, key) as Row | undefined;
      if (existing) {
        if (existing.request_hash !== hash) throw new DomainError("CONFLICT", "Idempotency key reused with different input");
        db.exec("COMMIT");
        const previous = await new SqliteAgentRunStore(this.database).get(String(existing.run_id), access);
        if (!previous) throw new DomainError("CONFLICT", "Checkpoint has no corresponding run");
        return { run: previous, duplicate: true };
      }
      const count = db.prepare("SELECT count(*) AS count FROM agent_runs WHERE status='running'").get() as Row;
      if (Number(count.count) >= maxPending) throw new DomainError("RESOURCE_EXHAUSTED", "Durable agent queue is full");
      db.prepare("INSERT INTO agent_runs(run_id,project_id,actor_id,session_id,prompt,status,result,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)").run(run.runId, access.projectId, access.actorId, run.sessionId, run.prompt, run.status, run.result ?? null, run.createdAt, run.updatedAt);
      db.prepare("INSERT INTO agent_checkpoints VALUES (?, ?, ?, ?, ?, ?, ?)").run(run.runId, access.projectId, access.actorId, key, hash, JSON.stringify(state), run.updatedAt);
      db.exec("COMMIT"); return { run, duplicate: false };
    } catch (error) { try { db.exec("ROLLBACK"); } catch { /* transaction may already be committed on duplicate lookup */ } throw error; }
  }
  async load(runId: string, access: AccessContext): Promise<RunCheckpoint | undefined> {
    const row = this.database.connection.prepare("SELECT state_json FROM agent_checkpoints WHERE run_id=? AND project_id=? AND actor_id=?").get(runId, access.projectId, access.actorId) as Row | undefined;
    return row ? JSON.parse(String(row.state_json)) as RunCheckpoint : undefined;
  }
  async save(runId: string, state: RunCheckpoint, access: AccessContext): Promise<void> {
    const result = this.database.connection.prepare("UPDATE agent_checkpoints SET state_json=?, updated_at=? WHERE run_id=? AND project_id=? AND actor_id=?").run(JSON.stringify(state), new Date().toISOString(), runId, access.projectId, access.actorId);
    if (Number(result.changes) !== 1) throw new DomainError("NOT_FOUND", "Checkpoint not found in authorised scope");
  }
  async recover() {
    const db = this.database.connection;
    // Historical releases persisted display history but no resumable execution state.
    db.prepare("UPDATE agent_runs SET status='failed', result='Interrupted legacy run: no checkpoint exists; inspect machine state before retrying.' WHERE status='running' AND run_id NOT IN (SELECT run_id FROM agent_checkpoints)").run();
    const rows = db.prepare("SELECT c.run_id, c.project_id, c.actor_id, c.state_json FROM agent_checkpoints c JOIN agent_runs r ON r.run_id=c.run_id WHERE r.status='running' ORDER BY r.created_at, r.rowid").all() as Row[];
    const result: { run: AgentRunRecord; access: AccessContext; checkpoint: RunCheckpoint }[] = [];
    for (const row of rows) {
      const access = { projectId: String(row.project_id), actorId: String(row.actor_id), policyVersion: "full-control/v1" };
      const run = await new SqliteAgentRunStore(this.database).get(String(row.run_id), access);
      if (run) result.push({ run, access, checkpoint: JSON.parse(String(row.state_json)) as RunCheckpoint });
    }
    return result;
  }
}

import {
  DomainError,
  type AccessContext,
  type ActionJournalPort,
  type ActionRecord,
  type Json,
  type ToolReceipt,
} from "@synlet/core";

import type { SynletDatabase } from "./database.js";

type Row = Record<string, string | number | null>;

function actionFromRow(row: Row): ActionRecord {
  return {
    actionId: String(row.action_id),
    approvalId: String(row.approval_id),
    taskId: String(row.task_id),
    taskRevision: Number(row.task_revision),
    toolId: String(row.tool_id),
    arguments: JSON.parse(String(row.arguments_json)) as Json,
    actionHash: String(row.action_hash),
    status: String(row.status) as ActionRecord["status"],
    expiresAt: String(row.expires_at),
  };
}

export class SqliteActionJournal implements ActionJournalPort {
  constructor(private readonly database: SynletDatabase) {}

  async create(
    action: ActionRecord,
    access: AccessContext,
  ): Promise<ActionRecord> {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      db.prepare(
        `INSERT INTO actions(action_id, approval_id, task_id, project_id, actor_id,
          policy_version, task_revision, tool_id, arguments_json, action_hash, status,
          expires_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
      ).run(
        action.actionId,
        action.approvalId,
        action.taskId,
        access.projectId,
        access.actorId,
        access.policyVersion,
        action.taskRevision,
        action.toolId,
        JSON.stringify(action.arguments),
        action.actionHash,
        action.expiresAt,
        new Date().toISOString(),
      );
      db.prepare(
        "INSERT INTO approvals(approval_id, actor_id, project_id, policy_version) VALUES (?, ?, ?, ?)",
      ).run(
        action.approvalId,
        access.actorId,
        access.projectId,
        access.policyVersion,
      );
      db.exec("COMMIT");
      return action;
    } catch (error: unknown) {
      db.exec("ROLLBACK");
      throw error;
    }
  }

  async getByApproval(
    approvalId: string,
    access: AccessContext,
  ): Promise<ActionRecord | undefined> {
    const row = this.database.connection
      .prepare(
        `SELECT * FROM actions WHERE approval_id = ? AND project_id = ? AND actor_id = ?
         AND policy_version = ?`,
      )
      .get(
        approvalId,
        access.projectId,
        access.actorId,
        access.policyVersion,
      ) as Row | undefined;
    return row ? actionFromRow(row) : undefined;
  }

  async listPending(access: AccessContext): Promise<readonly ActionRecord[]> {
    const rows = this.database.connection
      .prepare(
        `SELECT * FROM actions WHERE project_id = ? AND actor_id = ? AND policy_version = ?
         AND status = 'pending' ORDER BY created_at LIMIT 100`,
      )
      .all(access.projectId, access.actorId, access.policyVersion) as Row[];
    return rows.map(actionFromRow);
  }

  async decide(
    approvalId: string,
    decision: "allow" | "deny",
    now: string,
    access: AccessContext,
  ): Promise<ActionRecord> {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const updated = db
        .prepare(
          `UPDATE approvals SET decision = ?, decided_at = ? WHERE approval_id = ?
           AND actor_id = ? AND project_id = ? AND policy_version = ? AND decision IS NULL`,
        )
        .run(
          decision,
          now,
          approvalId,
          access.actorId,
          access.projectId,
          access.policyVersion,
        );
      if (updated.changes !== 1) {
        db.exec("ROLLBACK");
        throw new DomainError(
          "CONFLICT",
          "Approval was already decided or is out of scope",
        );
      }
      db.prepare("UPDATE actions SET status = ? WHERE approval_id = ?").run(
        decision === "allow" ? "approved" : "denied",
        approvalId,
      );
      const row = db
        .prepare("SELECT * FROM actions WHERE approval_id = ?")
        .get(approvalId) as Row;
      db.exec("COMMIT");
      return actionFromRow(row);
    } catch (error: unknown) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }

  async claim(
    actionId: string,
    now: string,
    access: AccessContext,
  ): Promise<ActionRecord> {
    const db = this.database.connection;
    const updated = db
      .prepare(
        `UPDATE actions SET execution_started = 1 WHERE action_id = ? AND project_id = ?
         AND actor_id = ? AND policy_version = ? AND status = 'approved'
         AND execution_started = 0 AND expires_at > ?`,
      )
      .run(
        actionId,
        access.projectId,
        access.actorId,
        access.policyVersion,
        now,
      );
    if (updated.changes !== 1) {
      throw new DomainError(
        "POLICY_DENIED",
        "Action is stale, expired, or already attempted",
      );
    }
    const row = db
      .prepare("SELECT * FROM actions WHERE action_id = ?")
      .get(actionId) as Row;
    return actionFromRow(row);
  }

  async receipt(
    receipt: ToolReceipt,
    access: AccessContext,
  ): Promise<ToolReceipt> {
    const db = this.database.connection;
    db.exec("BEGIN IMMEDIATE");
    try {
      const action = db
        .prepare(
          "SELECT * FROM actions WHERE action_id = ? AND project_id = ? AND actor_id = ?",
        )
        .get(receipt.actionId, access.projectId, access.actorId) as
        Row | undefined;
      if (!action) throw new DomainError("NOT_FOUND", "Action not found");
      db.prepare(
        `INSERT INTO receipts(receipt_id, action_id, status, result_json, created_at)
         VALUES (?, ?, ?, ?, ?)`,
      ).run(
        receipt.receiptId,
        receipt.actionId,
        receipt.status,
        receipt.result === undefined ? null : JSON.stringify(receipt.result),
        new Date().toISOString(),
      );
      db.prepare("UPDATE actions SET status = ? WHERE action_id = ?").run(
        receipt.status === "outcome_unknown" ? "outcome_unknown" : "executed",
        receipt.actionId,
      );
      db.exec("COMMIT");
      return receipt;
    } catch (error: unknown) {
      if (db.isTransaction) db.exec("ROLLBACK");
      throw error;
    }
  }
}

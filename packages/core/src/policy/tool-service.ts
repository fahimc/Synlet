import type { ApprovalDecisionRequest } from "@synlet/contracts";

import { DomainError, type AccessContext, type Json } from "../domain/types.js";
import type {
  ActionJournalPort,
  ClockPort,
  HashPort,
  IdPort,
  TaskStorePort,
  ToolAdapterPort,
  ToolReceipt,
} from "../ports/index.js";

export interface ProposedAction {
  readonly actionId: string;
  readonly approvalId: string;
  readonly actionHash: string;
  readonly expiresAt: string;
  readonly status: "pending";
}

export class OutcomeUnknownError extends Error {
  override readonly name = "OutcomeUnknownError";
}

export class ToolService {
  constructor(
    private readonly tasks: TaskStorePort,
    private readonly journal: ActionJournalPort,
    private readonly tools: ToolAdapterPort,
    private readonly ids: IdPort,
    private readonly hashes: HashPort,
    private readonly clock: ClockPort,
  ) {}

  async propose(
    taskId: string,
    toolId: string,
    arguments_: Json,
    access: AccessContext,
  ): Promise<ProposedAction> {
    const task = await this.tasks.get(taskId, access);
    if (!task) throw new DomainError("NOT_FOUND", "Task not found");
    const now = this.clock.now();
    const expiresAt = new Date(Date.parse(now) + 15 * 60_000).toISOString();
    const actionId = this.ids.next("action");
    const approvalId = this.ids.next("approval");
    const actionHash = await this.hashes.canonical({
      taskId,
      taskRevision: task.revision,
      toolId,
      arguments: arguments_,
      actorId: access.actorId,
      projectId: access.projectId,
      policyVersion: access.policyVersion,
    });
    await this.journal.create(
      {
        actionId,
        approvalId,
        taskId,
        taskRevision: task.revision,
        toolId,
        arguments: arguments_,
        actionHash,
        status: "pending",
        expiresAt,
      },
      access,
    );
    return { actionId, approvalId, actionHash, expiresAt, status: "pending" };
  }

  listPending(access: AccessContext) {
    return this.journal.listPending(access);
  }

  async decide(
    approvalId: string,
    request: ApprovalDecisionRequest,
    access: AccessContext,
  ): Promise<ToolReceipt> {
    const action = await this.journal.getByApproval(approvalId, access);
    if (!action) throw new DomainError("NOT_FOUND", "Approval not found");
    if (request.actionHash !== action.actionHash) {
      throw new DomainError(
        "POLICY_DENIED",
        "Approval does not match the proposed action",
      );
    }
    const now = this.clock.now();
    if (Date.parse(action.expiresAt) <= Date.parse(now)) {
      throw new DomainError("POLICY_DENIED", "Approval has expired");
    }
    const task = await this.tasks.get(action.taskId, access);
    if (!task) throw new DomainError("NOT_FOUND", "Task not found");
    if (task.revision !== action.taskRevision) {
      throw new DomainError(
        "STALE_REVISION",
        "Approval is bound to a stale task revision",
      );
    }
    await this.journal.decide(approvalId, request.decision, now, access);
    if (request.decision === "deny") {
      return await this.journal.receipt(
        {
          receiptId: this.ids.next("receipt"),
          actionId: action.actionId,
          status: "denied",
        },
        access,
      );
    }
    await this.journal.claim(action.actionId, now, access);
    try {
      const result = await this.tools.execute(action.toolId, action.arguments);
      return await this.journal.receipt(
        {
          receiptId: this.ids.next("receipt"),
          actionId: action.actionId,
          status: "ok",
          result,
        },
        access,
      );
    } catch (error: unknown) {
      const status =
        error instanceof OutcomeUnknownError ? "outcome_unknown" : "failed";
      return this.journal.receipt(
        {
          receiptId: this.ids.next("receipt"),
          actionId: action.actionId,
          status,
          result: {
            message:
              error instanceof Error ? error.message : "Tool execution failed",
          },
        },
        access,
      );
    }
  }
}

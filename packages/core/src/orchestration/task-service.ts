import type { TaskCreateRequest, TaskResponse } from "@synlet/contracts";

import {
  DomainError,
  type AccessContext,
  type TaskRecord,
} from "../domain/types.js";
import type {
  ClockPort,
  HashPort,
  IdPort,
  ModelPort,
  TaskStorePort,
} from "../ports/index.js";

export interface TaskServiceOptions {
  readonly maxPending: number;
  readonly modelId: string;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
}

function response(task: TaskRecord): TaskResponse {
  return {
    taskId: task.taskId,
    sessionId: task.sessionId,
    status: task.status,
    revision: task.revision,
    prompt: task.prompt,
    ...(task.result === undefined ? {} : { result: task.result }),
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

export class TaskService {
  constructor(
    private readonly store: TaskStorePort,
    private readonly model: ModelPort,
    private readonly ids: IdPort,
    private readonly hashes: HashPort,
    private readonly clock: ClockPort,
    private readonly options: TaskServiceOptions,
  ) {}

  async create(
    request: TaskCreateRequest,
    idempotencyKey: string,
    access: AccessContext,
  ): Promise<TaskResponse> {
    const result = await this.store.intake(
      {
        taskId: this.ids.next("task"),
        requestHash: await this.hashes.canonical(request),
        idempotencyKey,
        sessionId: request.sessionId,
        prompt: request.prompt,
        now: this.clock.now(),
        maxPending: this.options.maxPending,
      },
      access,
    );
    if (result.kind === "conflict") {
      throw new DomainError(
        "CONFLICT",
        "Idempotency key was reused with different input",
      );
    }
    if (result.kind === "capacity") {
      throw new DomainError(
        "RESOURCE_EXHAUSTED",
        "The durable task queue is full",
      );
    }
    let task = result.task;
    if (request.execution === "immediate" && task.status === "queued") {
      task = await this.run(task, access);
    }
    return response(task);
  }

  async run(task: TaskRecord, access: AccessContext): Promise<TaskRecord> {
    const running = await this.store.commit(
      {
        taskId: task.taskId,
        expectedRevision: task.revision,
        nextStatus: "running",
        eventType: "task.running",
        eventData: {},
        outbox: [
          {
            type: "model.generate",
            taskId: task.taskId,
            modelId: this.options.modelId,
          },
        ],
        now: this.clock.now(),
      },
      access,
    );
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const output: string[] = [];
    let inputTokens = 0;
    let outputTokens = 0;
    try {
      for await (const event of this.model.generate(
        {
          requestId: running.taskId,
          modelId: this.options.modelId,
          prompt: running.prompt,
          maxOutputTokens: this.options.maxOutputTokens,
          deadlineUtc: new Date(
            Date.now() + this.options.timeoutMs,
          ).toISOString(),
          allowedTools: [],
        },
        controller.signal,
      )) {
        if (event.type === "text_delta") output.push(event.text);
        if (event.type === "done") {
          inputTokens = event.inputTokens;
          outputTokens = event.outputTokens;
        }
        if (event.type === "error") {
          throw new DomainError("INVALID_OUTPUT", event.message);
        }
      }
      const text = output.join("").trim();
      if (!text)
        throw new DomainError("INVALID_OUTPUT", "The model returned no text");
      return await this.store.commit(
        {
          taskId: running.taskId,
          expectedRevision: running.revision,
          nextStatus: "completed",
          result: text,
          eventType: "task.completed",
          eventData: {
            evidence: "MEASURED",
            modelId: this.options.modelId,
            inputTokens,
            outputTokens,
          },
          outbox: [],
          now: this.clock.now(),
        },
        access,
      );
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Model execution failed";
      await this.store.commit(
        {
          taskId: running.taskId,
          expectedRevision: running.revision,
          nextStatus: "failed",
          eventType: "task.failed",
          eventData: { modelId: this.options.modelId, message },
          outbox: [],
          now: this.clock.now(),
        },
        access,
      );
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }

  async get(taskId: string, access: AccessContext): Promise<TaskResponse> {
    const task = await this.store.get(taskId, access);
    if (!task) throw new DomainError("NOT_FOUND", "Task not found");
    return response(task);
  }

  async cancel(taskId: string, access: AccessContext): Promise<TaskResponse> {
    const task = await this.store.get(taskId, access);
    if (!task) throw new DomainError("NOT_FOUND", "Task not found");
    if (task.status === "cancelled" || task.status === "cancel_requested")
      return response(task);
    if (task.status === "completed" || task.status === "failed") {
      throw new DomainError("CONFLICT", `Cannot cancel a ${task.status} task`);
    }
    const nextStatus =
      task.status === "running" ? "cancel_requested" : "cancelled";
    return response(
      await this.store.commit(
        {
          taskId,
          expectedRevision: task.revision,
          nextStatus,
          eventType: `task.${nextStatus}`,
          eventData: {},
          outbox: [],
          now: this.clock.now(),
        },
        access,
      ),
    );
  }

  events(taskId: string, after: number, access: AccessContext) {
    return this.store.events(taskId, after, 256, access);
  }
}

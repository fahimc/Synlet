import { DomainError } from "../domain/types.js";
import type {
  ModelCapabilities,
  ModelEvent,
  ModelPort,
  ModelRequest,
} from "../ports/index.js";
import type { LocalGpuScheduler } from "./local-gpu-scheduler.js";

/** Serializes GPU generation behind a host-owned, cancellation-aware lease. */
export class ScheduledModelPort implements ModelPort {
  constructor(
    private readonly inner: ModelPort,
    private readonly scheduler: LocalGpuScheduler,
    private readonly memoryByModel: ReadonlyMap<string, number>,
  ) {}

  capabilities(modelId: string): Promise<ModelCapabilities> {
    return this.inner.capabilities(modelId);
  }

  async countInput(modelId: string, prompt: string): Promise<number> {
    return this.countRequest(
      {
        requestId: "count",
        modelId,
        prompt,
        maxOutputTokens: -1,
        deadlineUtc: new Date(Date.now() + 30000).toISOString(),
        allowedTools: [],
      },
      AbortSignal.timeout(30000),
    );
  }
  async countRequest(
    request: ModelRequest,
    signal: AbortSignal,
  ): Promise<number> {
    const memoryMiB = this.memoryByModel.get(request.modelId);
    if (!memoryMiB)
      throw new DomainError("CAPABILITY_UNAVAILABLE", "No admission profile");
    const lease = await this.scheduler.acquire(
      {
        taskId: request.requestId,
        modelId: request.modelId,
        memoryMiB,
        deadlineUtc: request.deadlineUtc,
      },
      signal,
    );
    try {
      return this.inner.countRequest
        ? await this.inner.countRequest(request, signal)
        : await this.inner.countInput(request.modelId, request.prompt);
    } finally {
      this.scheduler.release(lease);
    }
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const memoryMiB = this.memoryByModel.get(request.modelId);
    if (!memoryMiB)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `No GPU admission profile is locked for ${request.modelId}`,
      );
    const lease = await this.scheduler.acquire(
      {
        taskId: request.requestId,
        modelId: request.modelId,
        memoryMiB,
        deadlineUtc: request.deadlineUtc,
      },
      signal,
    );
    try {
      yield* this.inner.generate(request, signal);
    } finally {
      this.scheduler.release(lease);
    }
  }
}

import { DomainError } from "../domain/types.js";
import type { ClockPort, GpuLease, IdPort } from "../ports/index.js";

export interface GpuRequest {
  readonly taskId: string;
  readonly modelId: string;
  readonly memoryMiB: number;
  readonly deadlineUtc: string;
}

interface PendingRequest {
  readonly request: GpuRequest;
  readonly signal: AbortSignal;
  readonly resolve: (lease: GpuLease) => void;
  readonly reject: (error: Error) => void;
}

export class LocalGpuScheduler {
  private active: GpuLease | undefined;
  private readonly queue: PendingRequest[] = [];
  private fencingToken = 0;

  constructor(
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly totalMemoryMiB: number,
    private readonly maxQueue: number,
  ) {}

  acquire(request: GpuRequest, signal: AbortSignal): Promise<GpuLease> {
    if (request.memoryMiB <= 0 || request.memoryMiB > this.totalMemoryMiB) {
      return Promise.reject(
        new DomainError(
          "RESOURCE_EXHAUSTED",
          "Model does not fit admitted GPU memory",
        ),
      );
    }
    if (signal.aborted)
      return Promise.reject(new DomainError("CANCELLED", "Request cancelled"));
    if (!this.active && this.queue.length === 0)
      return Promise.resolve(this.makeLease(request));
    if (this.queue.length >= this.maxQueue) {
      return Promise.reject(
        new DomainError("RESOURCE_EXHAUSTED", "GPU queue is full"),
      );
    }
    return new Promise<GpuLease>((resolve, reject) => {
      const pending = { request, signal, resolve, reject };
      this.queue.push(pending);
      signal.addEventListener(
        "abort",
        () => {
          const index = this.queue.indexOf(pending);
          if (index >= 0) this.queue.splice(index, 1);
          reject(
            new DomainError("CANCELLED", "Request cancelled while queued"),
          );
        },
        { once: true },
      );
    });
  }

  release(lease: GpuLease): void {
    if (
      this.active?.leaseId !== lease.leaseId ||
      this.active.fencingToken !== lease.fencingToken
    ) {
      throw new DomainError("STALE_REVISION", "GPU lease is stale");
    }
    this.active = undefined;
    this.dispatch();
  }

  snapshot(): {
    readonly active?: GpuLease;
    readonly queued: number;
    readonly capacityMiB: number;
  } {
    return {
      ...(this.active ? { active: this.active } : {}),
      queued: this.queue.length,
      capacityMiB: this.totalMemoryMiB,
    };
  }

  private makeLease(request: GpuRequest): GpuLease {
    const lease: GpuLease = {
      leaseId: this.ids.next("lease"),
      fencingToken: ++this.fencingToken,
      taskId: request.taskId,
      modelId: request.modelId,
      memoryMiB: request.memoryMiB,
      acquiredAt: this.clock.now(),
    };
    this.active = lease;
    return lease;
  }

  private dispatch(): void {
    while (!this.active && this.queue.length > 0) {
      const pending = this.queue.shift();
      if (!pending) return;
      if (pending.signal.aborted) continue;
      if (
        Date.parse(pending.request.deadlineUtc) <= Date.parse(this.clock.now())
      ) {
        pending.reject(
          new DomainError("TIMEOUT", "GPU request deadline expired"),
        );
        continue;
      }
      pending.resolve(this.makeLease(pending.request));
    }
  }
}

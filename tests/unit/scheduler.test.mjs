import assert from "node:assert/strict";
import test from "node:test";

import { LocalGpuScheduler } from "../../packages/core/dist/index.js";

const clock = { now: () => "2026-09-28T12:00:00.000Z" };
let id = 0;
const ids = { next: (prefix) => `${prefix}-${++id}` };
const request = (taskId) => ({
  taskId,
  modelId: "model",
  memoryMiB: 4096,
  deadlineUtc: "2026-09-28T12:01:00.000Z",
});

test("local GPU scheduler grants one fenced lease and queues bounded work", async () => {
  const scheduler = new LocalGpuScheduler(ids, clock, 12_288, 1);
  const first = await scheduler.acquire(
    request("first"),
    new AbortController().signal,
  );
  const secondPromise = scheduler.acquire(
    request("second"),
    new AbortController().signal,
  );
  await assert.rejects(
    scheduler.acquire(request("third"), new AbortController().signal),
    (error) => error?.code === "RESOURCE_EXHAUSTED",
  );
  assert.equal(scheduler.snapshot().queued, 1);
  scheduler.release(first);
  const second = await secondPromise;
  assert.ok(second.fencingToken > first.fencingToken);
  assert.throws(
    () => scheduler.release(first),
    (error) => error?.code === "STALE_REVISION",
  );
  scheduler.release(second);
});

test("queued cancellation does not free an active lease", async () => {
  const scheduler = new LocalGpuScheduler(ids, clock, 12_288, 2);
  const active = await scheduler.acquire(
    request("active"),
    new AbortController().signal,
  );
  const queuedAbort = new AbortController();
  const queued = scheduler.acquire(request("queued"), queuedAbort.signal);
  queuedAbort.abort();
  await assert.rejects(queued, (error) => error?.code === "CANCELLED");
  assert.equal(scheduler.snapshot().active?.leaseId, active.leaseId);
  scheduler.release(active);
});

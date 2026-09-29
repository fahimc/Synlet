import assert from "node:assert/strict";
import test from "node:test";

import {
  SqliteAgentRunStore,
  SynletDatabase,
} from "../../packages/adapters/dist/index.js";

const access = {
  projectId: "project-a",
  actorId: "actor-a",
  policyVersion: "policy/v1",
};

function record(runId, sessionId, createdAt, overrides = {}) {
  return {
    runId,
    projectId: access.projectId,
    actorId: access.actorId,
    sessionId,
    prompt: `prompt ${runId}`,
    status: "completed",
    result: `result ${runId}`,
    createdAt,
    updatedAt: createdAt,
    ...overrides,
  };
}

test("agent session logs persist in order and remain access scoped", async (context) => {
  const database = new SynletDatabase(":memory:");
  context.after(() => database.close());
  const store = new SqliteAgentRunStore(database);

  await store.create(
    record("run-1", "session-a", "2026-09-29T10:00:00.000Z"),
    access,
  );
  await store.create(
    record("run-2", "session-a", "2026-09-29T10:01:00.000Z"),
    access,
  );
  await store.create(
    record("run-3", "session-b", "2026-09-29T10:02:00.000Z"),
    access,
  );
  await store.append(
    {
      runId: "run-2",
      nodeId: "trace-1",
      kind: "result",
      label: "Answer",
      status: "completed",
      data: { summary: "persisted evidence" },
      createdAt: "2026-09-29T10:01:01.000Z",
    },
    access,
  );

  assert.deepEqual(
    (await store.list(access, { limit: 2 })).map((run) => run.runId),
    ["run-3", "run-2"],
  );
  const restoredSession = await store.list(access, {
    sessionId: "session-a",
    limit: 10,
  });
  assert.deepEqual(
    restoredSession.map((run) => run.runId),
    ["run-2", "run-1"],
  );
  assert.equal(restoredSession[0].result, "result run-2");
  assert.equal((await store.events("run-2", 0, access)).length, 1);
  assert.deepEqual(
    await store.list({ ...access, actorId: "actor-b" }, { limit: 10 }),
    [],
  );
});

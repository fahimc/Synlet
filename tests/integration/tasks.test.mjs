import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  SqliteTaskStore,
  SynletDatabase,
} from "../../packages/adapters/dist/index.js";
import { createServer } from "../../apps/server/dist/index.js";
import {
  authHeaders,
  testProfile,
  testServices,
} from "../fixtures/test-profile.mjs";

async function temporaryServer() {
  const root = await mkdtemp(join(tmpdir(), "synlet-task-"));
  const databasePath = join(root, "synlet.sqlite");
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    services: testServices({
      databasePath,
      dataRoot: join(root, "data"),
      workspaceRoot: join(root, "workspace"),
    }),
  });
  return { app, root, databasePath };
}

function createRequest(app, key, body, projectId = "project-a") {
  return app.inject({
    method: "POST",
    url: "/api/v1/tasks",
    headers: { ...authHeaders(projectId), "idempotency-key": key },
    payload: body,
  });
}

test("idempotent intake, replayable events, cancellation, and ownership", async (context) => {
  const { app, root } = await temporaryServer();
  context.after(async () => {
    await app.close();
    await rm(root, { force: true, recursive: true });
  });

  const request = {
    sessionId: "session-a",
    prompt: "Remember 42",
    execution: "immediate",
  };
  const first = await createRequest(app, "same-key", request);
  const duplicate = await createRequest(app, "same-key", request);
  assert.equal(first.statusCode, 200);
  assert.equal(duplicate.statusCode, 200);
  assert.equal(first.json().taskId, duplicate.json().taskId);
  assert.equal(first.json().status, "completed");
  assert.match(first.json().result, /^TEST:/u);

  const conflict = await createRequest(app, "same-key", {
    ...request,
    prompt: "Changed",
  });
  assert.equal(conflict.statusCode, 409);
  assert.equal(conflict.json().code, "CONFLICT");

  const hidden = await app.inject({
    method: "GET",
    url: `/api/v1/tasks/${first.json().taskId}`,
    headers: authHeaders("project-b"),
  });
  assert.equal(hidden.statusCode, 404);

  const events = await app.inject({
    method: "GET",
    url: `/api/v1/tasks/${first.json().taskId}/events?after=0`,
    headers: authHeaders(),
  });
  assert.equal(events.statusCode, 200);
  assert.match(events.body, /event: task\.created/u);
  assert.match(events.body, /event: task\.completed/u);

  const queued = await createRequest(app, "cancel-key", {
    sessionId: "session-a",
    prompt: "Wait",
    execution: "deferred",
  });
  const cancelled = await app.inject({
    method: "POST",
    url: `/api/v1/tasks/${queued.json().taskId}/cancel`,
    headers: authHeaders(),
  });
  assert.equal(cancelled.statusCode, 200);
  assert.equal(cancelled.json().status, "cancelled");
});

test("committed state survives restart", async (context) => {
  const { app, root, databasePath } = await temporaryServer();
  const created = await createRequest(app, "restart-key", {
    sessionId: "session-restart",
    prompt: "Persist me",
    execution: "deferred",
  });
  await app.close();

  const restarted = await createServer({
    profile: testProfile,
    authToken: "test-token",
    services: testServices({
      databasePath,
      dataRoot: join(root, "data"),
      workspaceRoot: join(root, "workspace"),
    }),
  });
  context.after(async () => {
    await restarted.close();
    await rm(root, { force: true, recursive: true });
  });
  const fetched = await restarted.inject({
    method: "GET",
    url: `/api/v1/tasks/${created.json().taskId}`,
    headers: authHeaders(),
  });
  assert.equal(fetched.statusCode, 200);
  assert.equal(fetched.json().prompt, "Persist me");
  assert.equal(fetched.json().status, "queued");
});

test("optimistic revisions allow only one simultaneous transition", async () => {
  const database = new SynletDatabase(":memory:");
  const store = new SqliteTaskStore(database);
  const access = {
    actorId: "actor-a",
    projectId: "project-a",
    policyVersion: "policy/v1",
  };
  const intake = await store.intake(
    {
      taskId: "task-race",
      requestHash: "hash",
      idempotencyKey: "race",
      sessionId: "session",
      prompt: "race",
      now: "2026-09-28T00:00:00.000Z",
      maxPending: 16,
    },
    access,
  );
  assert.equal(intake.kind, "created");
  const transition = () =>
    store.commit(
      {
        taskId: "task-race",
        expectedRevision: 0,
        nextStatus: "running",
        eventType: "task.running",
        eventData: {},
        outbox: [],
        now: "2026-09-28T00:00:01.000Z",
      },
      access,
    );
  const results = await Promise.allSettled([transition(), transition()]);
  assert.equal(results.filter((item) => item.status === "fulfilled").length, 1);
  assert.equal(results.filter((item) => item.status === "rejected").length, 1);
  database.close();
});

import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "../../apps/server/dist/index.js";
import {
  SqliteAgentCheckpoints,
  SqliteAgentRunStore,
  SynletDatabase,
} from "../../packages/adapters/dist/index.js";
import {
  authHeaders,
  testProfile,
  testServices,
} from "../fixtures/test-profile.mjs";

async function wait(app, id) {
  for (let i = 0; i < 300; i++) {
    const r = (
      await app.inject({
        method: "GET",
        url: `/api/v1/agent-runs/${id}`,
        headers: authHeaders(),
      })
    ).json();
    if (r.status !== "running") return r;
    await new Promise((r) => setTimeout(r, 10));
  }
  assert.fail("run did not finish");
}

test("two-turn agent and model facade share memory and authenticated execution", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-memory-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const requests = [];
  const base = testServices();
  const original = base.model;
  const model = {
    ...original,
    async *generate(request, signal) {
      requests.push(request);
      yield* original.generate(request, signal);
    },
  };
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    principal: { actorId: "actor-a", projectIds: ["project-a"] },
    services: testServices({
      model,
      databasePath: join(root, "data.sqlite"),
      dataRoot: join(root, "data"),
    }),
  });
  t.after(() => app.close());
  const start = await app.inject({
    method: "POST",
    url: "/api/v1/agent-runs",
    headers: { ...authHeaders(), "idempotency-key": "first" },
    payload: {
      sessionId: "shared-session",
      prompt: "Keep port 43127 and never delete the original files.",
    },
  });
  assert.equal(start.statusCode, 202);
  assert.equal((await wait(app, start.json().runId)).status, "completed");
  const retry = await app.inject({
    method: "POST",
    url: "/api/v1/agent-runs",
    headers: { ...authHeaders(), "idempotency-key": "first" },
    payload: {
      sessionId: "shared-session",
      prompt: "Keep port 43127 and never delete the original files.",
    },
  });
  assert.equal(retry.json().runId, start.json().runId);
  const conflict = await app.inject({
    method: "POST",
    url: "/api/v1/agent-runs",
    headers: { ...authHeaders(), "idempotency-key": "first" },
    payload: { sessionId: "shared-session", prompt: "different" },
  });
  assert.equal(conflict.statusCode, 409);
  const index = requests.length;
  const second = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...authHeaders(), "idempotency-key": "second" },
    payload: {
      model: "synlet-local",
      sessionId: "shared-session",
      messages: [
        { role: "system", content: "Preserve role semantics." },
        { role: "user", content: "Now implement that." },
      ],
    },
  });
  assert.equal(second.statusCode, 200, second.body);
  assert.match(second.json().id, /^run_/u);
  const plan = requests
    .slice(index)
    .find((r) => r.requestId.includes("-plan-"));
  assert.ok(plan);
  assert.match(plan.prompt, /43127/u);
  assert.match(plan.prompt, /never delete the original files/u);
  assert.equal(plan.messages[0].role, "system");
  assert.equal(plan.messages[0].content, "Preserve role semantics.");
  assert.match(plan.prompt, /context\.search/u);
  assert.match(plan.prompt, /context\.read/u);
  const denied = await app.inject({
    method: "GET",
    url: "/api/v1/agent-runs",
    headers: authHeaders("project-b", "actor-b"),
  });
  assert.equal(denied.statusCode, 403);
});

test("durable checkpoint stores action intent and preserves unknown outcomes across reopen", async (t) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-recovery-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const path = join(root, "state.sqlite");
  const access = {
    projectId: "p",
    actorId: "a",
    policyVersion: "full-control/v1",
  };
  let db = new SynletDatabase(path);
  let checkpoints = new SqliteAgentCheckpoints(db);
  const run = {
    runId: "run-safe",
    projectId: "p",
    actorId: "a",
    sessionId: "s",
    prompt: "arbitrary task",
    status: "running",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  const state = {
    input: { sessionId: "s", prompt: run.prompt, idempotencyKey: "id1" },
    deadlineUtc: new Date(Date.now() + 60000).toISOString(),
    nextStep: 3,
    phase: "action_pending",
    observations: [],
    images: [],
    pendingAction: {
      id: "action1",
      tool: "command.run",
      arguments: { command: "any command" },
    },
  };
  await checkpoints.begin(run, state, access, 16);
  db.close();
  db = new SynletDatabase(path);
  checkpoints = new SqliteAgentCheckpoints(db);
  t.after(() => db.close());
  const recovered = await checkpoints.recover();
  assert.equal(recovered.length, 1);
  assert.equal(recovered[0].checkpoint.pendingAction.id, "action1");
  const { AgentHarness } = await import("../../packages/core/dist/index.js");
  const harness = new AgentHarness(
    new SqliteAgentRunStore(db),
    {},
    {},
    {},
    async () => [],
    { next: () => "unused" },
    { now: () => new Date().toISOString() },
    {
      modelId: "unused",
      selectorModelId: "unused",
      maxSteps: 12,
      maxOutputTokens: -1,
      timeoutMs: 60000,
      reasoning: "enabled",
      specialists: [],
    },
    { checkpoints },
  );
  await harness.recover();
  const stopped = await harness.get(run.runId, access);
  assert.equal(stopped.status, "failed");
  assert.match(stopped.result, /OUTCOME_UNKNOWN/u);
  await harness.close();
});

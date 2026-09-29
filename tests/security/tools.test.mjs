import assert from "node:assert/strict";
import {
  access,
  lstat,
  mkdtemp,
  readFile,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { createServer } from "../../apps/server/dist/index.js";
import {
  authHeaders,
  testProfile,
  testServices,
} from "../fixtures/test-profile.mjs";

const emptySha256 =
  "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";

async function fixture(context, overrides = {}) {
  const root = await mkdtemp(join(tmpdir(), "synlet-tools-"));
  const workspace = join(root, "workspace");
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    services: testServices({
      databasePath: join(root, "synlet.sqlite"),
      dataRoot: join(root, "data"),
      workspaceRoot: workspace,
      ...overrides,
    }),
  });
  context.after(async () => {
    await app.close();
    await rm(root, { force: true, recursive: true });
  });
  return { app, root, workspace };
}

async function task(app, key = crypto.randomUUID()) {
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/tasks",
    headers: { ...authHeaders(), "idempotency-key": key },
    payload: { sessionId: "tools", prompt: "tool test", execution: "deferred" },
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

async function propose(app, taskId, toolId, args) {
  const response = await app.inject({
    method: "POST",
    url: `/api/v1/tasks/${taskId}/actions`,
    headers: authHeaders(),
    payload: { toolId, arguments: args },
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

function decide(app, proposal, decision = "allow") {
  return app.inject({
    method: "POST",
    url: `/api/v1/approvals/${proposal.approvalId}/decision`,
    headers: authHeaders(),
    payload: { decision, actionHash: proposal.actionHash },
  });
}

test("denial has no side effect and approval executes exactly once", async (context) => {
  const { app, workspace } = await fixture(context);
  const firstTask = await task(app, "deny-task");
  const denied = await propose(app, firstTask.taskId, "file.patch", {
    path: "proof.txt",
    content: "denied",
    expectedSha256: emptySha256,
  });
  const deniedReceipt = await decide(app, denied, "deny");
  assert.equal(deniedReceipt.statusCode, 200);
  assert.equal(deniedReceipt.json().status, "denied");
  await assert.rejects(access(join(workspace, "proof.txt")));

  const secondTask = await task(app, "allow-task");
  const approved = await propose(app, secondTask.taskId, "file.patch", {
    path: "proof.txt",
    content: "approved once",
    expectedSha256: emptySha256,
  });
  const receipt = await decide(app, approved);
  assert.equal(receipt.statusCode, 200);
  assert.equal(receipt.json().status, "ok");
  assert.equal(
    await readFile(join(workspace, "proof.txt"), "utf8"),
    "approved once",
  );

  const replay = await decide(app, approved);
  assert.equal(replay.statusCode, 409);
  assert.equal(
    await readFile(join(workspace, "proof.txt"), "utf8"),
    "approved once",
  );

  const staleFileRevision = await propose(
    app,
    secondTask.taskId,
    "file.patch",
    {
      path: "proof.txt",
      content: "must not overwrite",
      expectedSha256: "0".repeat(64),
    },
  );
  const staleFileReceipt = await decide(app, staleFileRevision);
  assert.equal(staleFileReceipt.json().status, "failed");
  assert.equal(
    await readFile(join(workspace, "proof.txt"), "utf8"),
    "approved once",
  );
});

test("action hash, task revision, scope, and path remain bound", async (context) => {
  const { app, root, workspace } = await fixture(context);
  const created = await task(app, "stale-task");
  const stale = await propose(app, created.taskId, "file.patch", {
    path: "stale.txt",
    content: "must not happen",
    expectedSha256: emptySha256,
  });

  const forged = await app.inject({
    method: "POST",
    url: `/api/v1/approvals/${stale.approvalId}/decision`,
    headers: authHeaders(),
    payload: { decision: "allow", actionHash: "0".repeat(64) },
  });
  assert.equal(forged.statusCode, 403);

  await app.inject({
    method: "POST",
    url: `/api/v1/tasks/${created.taskId}/cancel`,
    headers: authHeaders(),
  });
  const staleDecision = await decide(app, stale);
  assert.equal(staleDecision.statusCode, 409);
  await assert.rejects(access(join(workspace, "stale.txt")));

  const scoped = await app.inject({
    method: "GET",
    url: "/api/v1/approvals",
    headers: authHeaders("project-b"),
  });
  assert.deepEqual(scoped.json(), []);

  const traversalTask = await task(app, "traversal-task");
  const traversal = await propose(app, traversalTask.taskId, "file.patch", {
    path: "../escaped.txt",
    content: "escape",
    expectedSha256: emptySha256,
  });
  const traversalReceipt = await decide(app, traversal);
  assert.equal(traversalReceipt.json().status, "failed");
  await assert.rejects(access(join(root, "escaped.txt")));
});

test("symlink escapes are rejected at the actual filesystem boundary", async (context) => {
  const { app, root, workspace } = await fixture(context);
  const outside = join(root, "outside");
  await access(workspace).catch(async () => {
    const { mkdir } = await import("node:fs/promises");
    await mkdir(workspace, { recursive: true });
  });
  const { mkdir } = await import("node:fs/promises");
  await mkdir(outside, { recursive: true });
  try {
    await symlink(outside, join(workspace, "link"), "junction");
  } catch (error) {
    if (error?.code === "EPERM")
      return context.skip("junction creation is not permitted");
    throw error;
  }
  assert.equal((await lstat(join(workspace, "link"))).isSymbolicLink(), true);
  const created = await task(app, "junction-task");
  const proposal = await propose(app, created.taskId, "file.patch", {
    path: "link/escape.txt",
    content: "escape",
    expectedSha256: emptySha256,
  });
  const receipt = await decide(app, proposal);
  assert.equal(receipt.json().status, "failed");
  await assert.rejects(access(join(outside, "escape.txt")));
});

test("a possible write is outcome_unknown and cannot be replayed", async (context) => {
  const { app, workspace } = await fixture(context, { failAfterWrite: true });
  const created = await task(app, "unknown-task");
  const proposal = await propose(app, created.taskId, "file.patch", {
    path: "unknown.txt",
    content: "possibly written",
    expectedSha256: emptySha256,
  });
  const receipt = await decide(app, proposal);
  assert.equal(receipt.statusCode, 200);
  assert.equal(receipt.json().status, "outcome_unknown");
  assert.equal(
    await readFile(join(workspace, "unknown.txt"), "utf8"),
    "possibly written",
  );
  assert.equal((await decide(app, proposal)).statusCode, 409);
});

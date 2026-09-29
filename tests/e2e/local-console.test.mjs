import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
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

test("local console serves its controls and completes the acceptance journey", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-e2e-"));
  const workspace = join(root, "workspace");
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    services: testServices({
      databasePath: join(root, "synlet.sqlite"),
      dataRoot: join(root, "data"),
      workspaceRoot: workspace,
    }),
  });
  context.after(async () => {
    await app.close();
    await rm(root, { force: true, recursive: true });
  });

  const page = await app.inject({ method: "GET", url: "/" });
  assert.equal(page.statusCode, 200);
  for (const marker of [
    "Synlet Codex",
    "local Codex agent harness",
    'id="root"',
  ])
    assert.match(page.body, new RegExp(marker, "u"));

  const headers = authHeaders();
  const sourceResponse = await app.inject({
    method: "POST",
    url: "/api/v1/sources",
    headers,
    payload: {
      title: "constraint",
      kind: "text",
      content: "The limit is 42, not 41.",
    },
  });
  assert.equal(sourceResponse.statusCode, 200);
  const taskResponse = await app.inject({
    method: "POST",
    url: "/api/v1/tasks",
    headers: { ...headers, "idempotency-key": "e2e-task" },
    payload: { sessionId: "e2e", prompt: "patch proof", execution: "deferred" },
  });
  const taskId = taskResponse.json().taskId;

  const propose = (content) =>
    app.inject({
      method: "POST",
      url: `/api/v1/tasks/${taskId}/actions`,
      headers,
      payload: {
        toolId: "file.patch",
        arguments: { path: "proof.txt", content, expectedSha256: emptySha256 },
      },
    });
  const denied = (await propose("denied")).json();
  const denyReceipt = await app.inject({
    method: "POST",
    url: `/api/v1/approvals/${denied.approvalId}/decision`,
    headers,
    payload: { decision: "deny", actionHash: denied.actionHash },
  });
  assert.equal(denyReceipt.json().status, "denied");
  await assert.rejects(access(join(workspace, "proof.txt")));

  const allowed = (await propose("approved")).json();
  const allowReceipt = await app.inject({
    method: "POST",
    url: `/api/v1/approvals/${allowed.approvalId}/decision`,
    headers,
    payload: { decision: "allow", actionHash: allowed.actionHash },
  });
  assert.equal(allowReceipt.json().status, "ok");
  assert.equal(
    await readFile(join(workspace, "proof.txt"), "utf8"),
    "approved",
  );

  const packetResponse = await app.inject({
    method: "POST",
    url: "/api/v1/context/build",
    headers,
    payload: {
      query: "limit",
      role: "controller",
      exhaustive: true,
      pinnedConstraints: ["Never write without approval"],
    },
  });
  assert.equal(packetResponse.statusCode, 200);
  assert.match(
    packetResponse.json().packet.messages[0].content,
    /Never write without approval/u,
  );
  assert.match(packetResponse.json().packet.messages[1].content, /42, not 41/u);
});

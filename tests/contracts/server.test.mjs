import assert from "node:assert/strict";
import { resolve } from "node:path";
import test from "node:test";

import { createServer } from "../../apps/server/dist/index.js";
import { testProfile, testServices } from "../fixtures/test-profile.mjs";
import { authHeaders } from "../fixtures/test-profile.mjs";

test("gateway serves measured local health and the local UI", async (context) => {
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    principal: { actorId: "actor-a", projectIds: ["project-a"] },
    services: testServices({ databasePath: ":memory:" }),
    webRoot: resolve("apps/web/dist"),
  });
  context.after(async () => app.close());

  const health = await app.inject({ method: "GET", url: "/health/ready" });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), {
    service: "synlet",
    version: "0.0.0",
    status: "ok",
    readiness: "ready",
    mode: "local",
    evidenceLabel: "MEASURED",
  });

  const ui = await app.inject({ method: "GET", url: "/" });
  assert.equal(ui.statusCode, 200);
  assert.match(ui.body, /<title>Synlet Codex<\/title>/);
  assert.match(ui.body, /Synlet local Codex agent harness/);

  const sessionLogs = await app.inject({
    method: "GET",
    url: "/api/v1/agent-runs?limit=20",
    headers: authHeaders(),
  });
  assert.equal(sessionLogs.statusCode, 200);
  assert.deepEqual(sessionLogs.json(), []);

  const invalidLimit = await app.inject({
    method: "GET",
    url: "/api/v1/agent-runs?limit=501",
    headers: authHeaders(),
  });
  assert.equal(invalidLimit.statusCode, 400);
});

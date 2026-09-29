import assert from "node:assert/strict";
import test from "node:test";

import { createServer } from "../../apps/server/dist/index.js";
import {
  authHeaders,
  testProfile,
  testServices,
} from "../fixtures/test-profile.mjs";

test("chat facade accepts its narrow contract and rejects unsupported options", async (context) => {
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    principal: { actorId: "actor-a", projectIds: ["project-a"] },
    services: testServices({ databasePath: ":memory:" }),
  });
  context.after(async () => app.close());
  const accepted = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...authHeaders(), "idempotency-key": "chat-1" },
    payload: {
      model: "synlet-local",
      messages: [{ role: "user", content: "hello" }],
      stream: false,
    },
  });
  assert.equal(accepted.statusCode, 200);
  assert.equal(accepted.json().execution_mode, "full-control");
  assert.match(accepted.json().id, /^run_/u);
  assert.match(accepted.json().choices[0].message.content, /^TEST:/u);
  const rejected = await app.inject({
    method: "POST",
    url: "/v1/chat/completions",
    headers: { ...authHeaders(), "idempotency-key": "chat-2" },
    payload: {
      model: "synlet-local",
      messages: [{ role: "user", content: "hello" }],
      stream: true,
    },
  });
  assert.equal(rejected.statusCode, 400);
  assert.equal(rejected.json().code, "UNSUPPORTED_OPTION");
});

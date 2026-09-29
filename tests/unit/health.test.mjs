import assert from "node:assert/strict";
import test from "node:test";

import { createHealthResponse } from "../../packages/core/dist/index.js";
import { FakeRuntimeIdentity } from "../../packages/testkit/dist/index.js";

test("core creates an honestly labelled measured health response", () => {
  assert.deepEqual(createHealthResponse(new FakeRuntimeIdentity(), "ready"), {
    service: "synlet",
    version: "0.0.0",
    status: "ok",
    readiness: "ready",
    mode: "local",
    evidenceLabel: "MEASURED",
  });
});

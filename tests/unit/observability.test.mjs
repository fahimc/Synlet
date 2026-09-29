import assert from "node:assert/strict";
import test from "node:test";

import { StageTimer } from "../../packages/adapters/dist/index.js";

test("stage measurements are explicitly labelled and bounded to the action", async () => {
  const measured = await new StageTimer().measure("verify", async () => 42);
  assert.equal(measured.result, 42);
  assert.equal(measured.measurement.evidence, "MEASURED");
  assert.ok(measured.measurement.durationMs >= 0);
});

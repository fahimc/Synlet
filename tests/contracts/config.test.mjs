import assert from "node:assert/strict";
import test from "node:test";

import { parseRuntimeProfile } from "../../apps/server/dist/index.js";
import { testProfile } from "../fixtures/test-profile.mjs";

const validProfile = testProfile;

test("runtime profile accepts the locked local shape", () => {
  assert.deepEqual(parseRuntimeProfile(validProfile), validProfile);
});

test("runtime profile rejects unknown keys clearly", () => {
  assert.throws(
    () => parseRuntimeProfile({ ...validProfile, surprise: true }),
    /Invalid runtime profile:.*additional properties/i,
  );
});

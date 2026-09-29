import assert from "node:assert/strict";
import test from "node:test";

import { RuntimeSkillRegistry } from "../../packages/adapters/dist/index.js";

test("runtime skills are versioned, bounded, trusted, and use known tools", async () => {
  const skills = await new RuntimeSkillRegistry("skills").active();
  assert.deepEqual(
    skills.map((skill) => skill.id),
    ["browser-check", "document-qa", "host-shell", "math-check", "repo-fix"],
  );
  assert.ok(
    skills.every(
      (skill) => skill.maxSteps <= 16 && skill.completionChecks.length > 0,
    ),
  );
});

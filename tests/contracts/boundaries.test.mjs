import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { analyzeWorkspace } from "../../scripts/lib/dependency-boundaries.mjs";

async function addPackage(root, folder, name, source) {
  const directory = join(root, "packages", folder);
  await mkdir(join(directory, "src"), { recursive: true });
  await writeFile(join(directory, "package.json"), JSON.stringify({ name }));
  await writeFile(join(directory, "src", "index.ts"), source);
}

test("boundary checker rejects forbidden imports and cycles", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-boundaries-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  await addPackage(
    root,
    "core",
    "@synlet/core",
    'export { value } from "@synlet/adapters/src/private.js";',
  );
  await addPackage(
    root,
    "adapters",
    "@synlet/adapters",
    'export { value } from "@synlet/core";',
  );

  const violations = await analyzeWorkspace(root);
  assert.ok(
    violations.some((item) => item.includes("deep-imports private path")),
  );
  assert.ok(violations.some((item) => item.includes("may not depend")));
  assert.ok(violations.some((item) => item.includes("dependency cycle")));
});

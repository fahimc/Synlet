import { rm } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const roots = [
  "apps/server/dist",
  "apps/web/dist",
  "packages/contracts/dist",
  "packages/core/dist",
  "packages/adapters/dist",
  "packages/testkit/dist",
];

for (const relativePath of roots) {
  await rm(resolve(process.cwd(), relativePath), {
    force: true,
    recursive: true,
  });
}

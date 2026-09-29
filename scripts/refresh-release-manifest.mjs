import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { cp, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { relative, resolve, sep } from "node:path";

const repositoryRoot = resolve(".");
const releaseRoot = resolve("releases/synlet-local");
if (!releaseRoot.startsWith(`${resolve("releases")}${sep}`))
  throw new Error("Unsafe release target");

for (const path of [
  "README.md",
  "THIRD_PARTY_NOTICES.md",
  "scripts/synlet-cli.mjs",
])
  await cp(resolve(repositoryRoot, path), resolve(releaseRoot, path), {
    force: true,
  });

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile() && entry.name !== "release-manifest.json")
      output.push(path);
  }
  return output;
}

async function describe(path) {
  const information = await stat(path);
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  return {
    path: relative(releaseRoot, path).replaceAll("\\", "/"),
    bytes: information.size,
    sha256: hasher.digest("hex"),
  };
}

const paths = await files(releaseRoot);
const manifestFiles = new Array(paths.length);
let next = 0;
await Promise.all(
  Array.from({ length: 16 }, async () => {
    for (;;) {
      const index = next;
      next += 1;
      if (index >= paths.length) return;
      manifestFiles[index] = await describe(paths[index]);
    }
  }),
);
manifestFiles.sort((left, right) => left.path.localeCompare(right.path));

const previous = JSON.parse(
  await readFile(resolve(releaseRoot, "release-manifest.json"), "utf8"),
);
await writeFile(
  resolve(releaseRoot, "release-manifest.json"),
  `${JSON.stringify({ ...previous, createdAt: new Date().toISOString(), files: manifestFiles }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Refreshed ${releaseRoot} with ${manifestFiles.length} hashed files.\n`,
);

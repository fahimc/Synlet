import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  cp,
  mkdir,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, parse, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";

const repositoryRoot = resolve(".");
const releaseRoot = resolve("releases/synlet-local");
if (!releaseRoot.startsWith(`${resolve("releases")}${sep}`))
  throw new Error("Unsafe release target");
await rm(releaseRoot, { recursive: true, force: true });
await mkdir(releaseRoot, { recursive: true });

const runtimeCandidates = [
  process.env.SYNLET_NODE_RUNTIME,
  process.execPath,
  resolve(
    parse(repositoryRoot).root,
    "Projects/portable-ai-person/runtimes/windows-x64/node/node-v24.21.0-win-x64/node.exe",
  ),
].filter((value) => typeof value === "string");
const nodeRuntime = runtimeCandidates.find((candidate) => {
  const result = spawnSync(candidate, ["-p", "process.version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return result.status === 0 && result.stdout.trim() === "v24.21.0";
});
if (!nodeRuntime)
  throw new Error(
    "Node 24.21.0 runtime not found. Set SYNLET_NODE_RUNTIME to the exact executable.",
  );

const pythonCandidates = [
  process.env.SYNLET_PYTHON_RUNTIME,
  resolve("services/python-worker/.venv/Scripts/python.exe"),
  "C:/Python311/python.exe",
].filter((value) => typeof value === "string");
const pythonExecutable = pythonCandidates.find((candidate) => {
  const result = spawnSync(candidate, ["--version"], {
    encoding: "utf8",
    windowsHide: true,
  });
  return (
    result.status === 0 &&
    `${result.stdout}${result.stderr}`.trim() === "Python 3.11.4"
  );
});
if (!pythonExecutable)
  throw new Error(
    "Python 3.11.4 runtime not found. Set SYNLET_PYTHON_RUNTIME to the exact executable.",
  );
const pythonProbe = spawnSync(
  pythonExecutable,
  ["-c", "import sys; print(sys.base_prefix)"],
  { encoding: "utf8", windowsHide: true },
);
if (pythonProbe.status !== 0)
  throw new Error(
    `Unable to locate Python base runtime: ${pythonProbe.stderr}`,
  );
const pythonBase = resolve(pythonProbe.stdout.trim());

async function copy(source, destination) {
  await mkdir(dirname(resolve(releaseRoot, destination)), { recursive: true });
  await cp(resolve(repositoryRoot, source), resolve(releaseRoot, destination), {
    recursive: true,
    dereference: true,
    force: true,
  });
}

async function copyAbsolute(source, destination, options = {}) {
  await mkdir(dirname(resolve(releaseRoot, destination)), { recursive: true });
  await cp(resolve(source), resolve(releaseRoot, destination), {
    recursive: true,
    dereference: true,
    force: true,
    ...options,
  });
}

for (const [source, destination] of [
  ["apps/server/dist", "apps/server/dist"],
  ["apps/web/dist", "apps/web/dist"],
  ["config", "config"],
  ["docs/runbooks", "docs/runbooks"],
  ["node_modules", "node_modules"],
  ["scripts/synlet-cli.mjs", "scripts/synlet-cli.mjs"],
  ["scripts/start-local.mjs", "scripts/start-local.mjs"],
  [
    "scripts/authenticated-tunnel-proxy.mjs",
    "scripts/authenticated-tunnel-proxy.mjs",
  ],
  ["scripts/synlet-mcp-server.mjs", "scripts/synlet-mcp-server.mjs"],
  ["scripts/lib/local-model.mjs", "scripts/lib/local-model.mjs"],
  ["runtime/llama", "runtime/llama"],
  ["services/python-worker/src", "services/python-worker/src"],
  ["README.md", "README.md"],
  ["THIRD_PARTY_NOTICES.md", "THIRD_PARTY_NOTICES.md"],
])
  await copy(source, destination);

const modelLock = JSON.parse(
  await readFile(resolve(repositoryRoot, "config/models.lock.json"), "utf8"),
);
const copiedModelPaths = new Set();
for (const model of modelLock.models.filter((entry) => entry.enabled)) {
  const paths = [model.artifactPath, model.projectorPath].filter(Boolean);
  for (const path of paths) {
    const source = resolve(repositoryRoot, path);
    const destination = path.replaceAll("\\", "/");
    const copySource = model.provider === "python" ? dirname(source) : source;
    const copyDestination =
      model.provider === "python"
        ? dirname(destination).replaceAll("\\", "/")
        : destination;
    if (copiedModelPaths.has(copyDestination)) continue;
    copiedModelPaths.add(copyDestination);
    await copyAbsolute(copySource, copyDestination);
  }
}

for (const name of [
  "python.exe",
  "python3.dll",
  "python311.dll",
  "vcruntime140.dll",
  "vcruntime140_1.dll",
  "LICENSE.txt",
])
  await copyAbsolute(resolve(pythonBase, name), `runtime/python/${name}`);
await copyAbsolute(resolve(pythonBase, "DLLs"), "runtime/python/DLLs");
await copyAbsolute(resolve(pythonBase, "Lib"), "runtime/python/Lib", {
  filter: (source) =>
    !resolve(source).startsWith(resolve(pythonBase, "Lib/site-packages")),
});
await copyAbsolute(
  resolve(repositoryRoot, "services/python-worker/.venv/Lib/site-packages"),
  "runtime/python/Lib/site-packages",
);
await cp(nodeRuntime, resolve(releaseRoot, "runtime/node.exe"), {
  force: true,
});

const releaseProfilePath = resolve(
  releaseRoot,
  "config/profiles/local-12gb.json",
);
const releaseProfile = JSON.parse(await readFile(releaseProfilePath, "utf8"));
releaseProfile.paths = {
  ...releaseProfile.paths,
  dataRoot: "data",
  workspaceRoot: "data/workspace",
  pythonExecutable: "runtime/python/python.exe",
};
await writeFile(
  releaseProfilePath,
  `${JSON.stringify(releaseProfile, null, 2)}\n`,
  "utf8",
);
await writeFile(
  resolve(releaseRoot, "start.cmd"),
  '@echo off\r\n"%~dp0runtime\\node.exe" "%~dp0scripts\\synlet-cli.mjs" start --root "%~dp0"\r\n',
  "utf8",
);

async function files(root) {
  const output = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = resolve(root, entry.name);
    if (entry.isDirectory()) output.push(...(await files(path)));
    else if (entry.isFile()) output.push(path);
  }
  return output;
}

const inventory = [];
for (const path of await files(resolve(releaseRoot, "node_modules"))) {
  if (path.endsWith(`${sep}package.json`)) {
    const value = JSON.parse(await readFile(path, "utf8"));
    if (value.name && value.version)
      inventory.push({
        name: value.name,
        version: value.version,
        license: value.license ?? "SEE_PACKAGE",
      });
  }
}
inventory.sort((left, right) =>
  `${left.name}@${left.version}`.localeCompare(
    `${right.name}@${right.version}`,
  ),
);
await writeFile(
  resolve(releaseRoot, "dependency-inventory.json"),
  `${JSON.stringify({ schemaVersion: "synlet.dependencies/v1", packages: inventory }, null, 2)}\n`,
  "utf8",
);

const manifestFiles = [];
for (const path of await files(releaseRoot)) {
  const information = await stat(path);
  const hasher = createHash("sha256");
  for await (const chunk of createReadStream(path)) hasher.update(chunk);
  const hash = hasher.digest("hex");
  manifestFiles.push({
    path: relative(releaseRoot, path).replaceAll("\\", "/"),
    bytes: information.size,
    sha256: hash,
  });
}
manifestFiles.sort((left, right) => left.path.localeCompare(right.path));
await writeFile(
  resolve(releaseRoot, "release-manifest.json"),
  `${JSON.stringify({ schemaVersion: "synlet.release/v1", version: "1.0.0-local", evidence: "MEASURED", createdAt: new Date().toISOString(), programRoot: ".", defaultDataRoot: "data", modelRoot: "model-weights", files: manifestFiles }, null, 2)}\n`,
  "utf8",
);
process.stdout.write(
  `Created ${releaseRoot} with ${manifestFiles.length} hashed files.\n`,
);

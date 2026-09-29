import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";

async function renameWithRetry(source, destination) {
  for (let attempt = 0; ; attempt += 1) {
    try {
      await rename(source, destination);
      return;
    } catch (error) {
      if (attempt >= 20 || (error?.code !== "EPERM" && error?.code !== "EBUSY"))
        throw error;
      await delay(250);
    }
  }
}

async function run(node, arguments_) {
  return new Promise((resolveResult) => {
    const child = spawn(node, arguments_, { windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.once("close", (code) => resolveResult({ code, stdout, stderr }));
  });
}

test("release manifest hashes are complete and doctor works from a spaced unicode path", async (context) => {
  const source = resolve("releases/synlet-local");
  const manifest = JSON.parse(
    await readFile(resolve(source, "release-manifest.json"), "utf8"),
  );
  assert.equal(manifest.evidence, "MEASURED");
  assert.ok(manifest.files.length > 10);
  await access(resolve(source, "scripts/synlet-mcp-server.mjs"));
  for (const entry of manifest.files.slice(0, 50)) {
    const hasher = createHash("sha256");
    for await (const chunk of createReadStream(resolve(source, entry.path)))
      hasher.update(chunk);
    assert.equal(hasher.digest("hex"), entry.sha256);
  }
  const root = await mkdtemp(join(tmpdir(), "Synlet ü release "));
  context.after(async () => rm(root, { recursive: true, force: true }));
  const relocated = resolve("releases/Synlet ü portable release");
  await rm(relocated, { recursive: true, force: true });
  await renameWithRetry(source, relocated);
  let releaseRestored = false;
  context.after(async () => {
    if (
      !releaseRestored &&
      (await access(relocated).then(
        () => true,
        () => false,
      ))
    ) {
      await renameWithRetry(relocated, source);
    }
  });
  const node = resolve(relocated, "runtime/node.exe");
  const version = await new Promise((resolveVersion) => {
    const child = spawn(node, ["-p", "process.version"], { windowsHide: true });
    let stdout = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.once("close", () => resolveVersion(stdout.trim()));
  });
  assert.equal(version, "v24.21.0");
  const cli = resolve(relocated, "scripts/synlet-cli.mjs");
  const result = await run(node, [
    cli,
    "doctor",
    "--root",
    relocated,
    "--data",
    join(root, "data"),
  ]);
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).ok, true);

  const dataRoot = join(root, "data");
  const backupRoot = join(root, "backup");
  await mkdir(join(dataRoot, "db"), { recursive: true });
  await writeFile(join(dataRoot, "db", "synlet.sqlite"), "evidence-v1");
  const backedUp = await run(node, [
    cli,
    "backup",
    "--root",
    relocated,
    "--data",
    dataRoot,
    "--output",
    backupRoot,
  ]);
  assert.equal(backedUp.code, 0, backedUp.stderr);
  await writeFile(join(dataRoot, "db", "synlet.sqlite"), "changed");
  const restored = await run(node, [
    cli,
    "restore",
    "--root",
    relocated,
    "--data",
    dataRoot,
    "--backup",
    backupRoot,
    "--confirm",
  ]);
  assert.equal(restored.code, 0, restored.stderr);
  assert.equal(
    await readFile(join(dataRoot, "db", "synlet.sqlite"), "utf8"),
    "evidence-v1",
  );
  await renameWithRetry(relocated, source);
  releaseRestored = true;
});

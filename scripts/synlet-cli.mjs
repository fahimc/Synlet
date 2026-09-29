import {
  access,
  cp,
  mkdir,
  open,
  readFile,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

function option(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

function safeDataPath(value) {
  const path = resolve(value);
  const relation = relative(resolve(path, ".."), path);
  if (!isAbsolute(path) || path === resolve(path, "..") || relation === "")
    throw new Error("Unsafe data path");
  return path;
}

const command = process.argv[2] ?? "doctor";
const root = resolve(option("root", resolve(import.meta.dirname, "..")));
const dataRoot = safeDataPath(option("data", resolve(root, "data")));
const runRoot = resolve(dataRoot, "run");
const pidPath = resolve(runRoot, "synlet.pid");

async function doctor() {
  const checks = [];
  for (const [name, path] of [
    ["node", resolve(root, "runtime/node.exe")],
    ["server", resolve(root, "apps/server/dist/main.js")],
    ["profile", resolve(root, "config/profiles/local-12gb.json")],
    ["llama-server", resolve(root, "runtime/llama/llama-server.exe")],
    ["python", resolve(root, "runtime/python/python.exe")],
    [
      "python-worker",
      resolve(root, "services/python-worker/src/synlet_worker/worker.py"),
    ],
  ]) {
    checks.push({
      name,
      status: await access(path).then(
        () => "ok",
        () => "missing",
      ),
    });
  }
  const modelLock = JSON.parse(
    await readFile(resolve(root, "config/models.lock.json"), "utf8"),
  );
  for (const model of modelLock.models.filter((entry) => entry.enabled)) {
    for (const [kind, path, expected] of [
      ["artifact", model.artifactPath, model.sha256],
      ["projector", model.projectorPath, model.projectorSha256],
    ]) {
      if (!path) continue;
      const hash = createHash("sha256");
      const status = await (async () => {
        try {
          for await (const chunk of createReadStream(resolve(root, path)))
            hash.update(chunk);
          return hash.digest("hex") === expected ? "ok" : "hash-mismatch";
        } catch {
          return "missing";
        }
      })();
      checks.push({ name: `${model.modelId}-${kind}`, status });
    }
  }
  const pythonProbe = spawnSync(
    resolve(root, "runtime/python/python.exe"),
    [
      "-c",
      "import torch, transformers, sentence_transformers, julia, synlet_worker.worker; print('ready')",
    ],
    {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
      env: {
        ...process.env,
        PYTHONPATH: resolve(root, "services/python-worker/src"),
      },
    },
  );
  checks.push({
    name: "python-dependencies",
    status:
      pythonProbe.status === 0 && pythonProbe.stdout.trim() === "ready"
        ? "ok"
        : "unavailable",
  });
  await mkdir(dataRoot, { recursive: true });
  const probe = await open(resolve(dataRoot, ".write-test"), "w");
  await probe.close();
  await rm(resolve(dataRoot, ".write-test"), { force: true });
  checks.push({ name: "data-writable", status: "ok" });
  const ok = checks.every((check) => check.status === "ok");
  process.stdout.write(
    `${JSON.stringify({ evidence: "MEASURED", ok, checks }, null, 2)}\n`,
  );
  if (!ok) process.exitCode = 1;
}

async function start() {
  await doctor();
  if (process.exitCode) return;
  await mkdir(runRoot, { recursive: true });
  const child = spawn(
    resolve(root, "runtime/node.exe"),
    [resolve(root, "scripts/start-local.mjs")],
    {
      cwd: root,
      detached: true,
      stdio: "ignore",
      windowsHide: true,
      env: { ...process.env, SYNLET_DATA_ROOT: dataRoot },
    },
  );
  child.unref();
  await writeFile(pidPath, String(child.pid), "utf8");
  process.stdout.write(`Started Synlet PID ${child.pid}.\n`);
}

async function stop() {
  const pid = Number(await readFile(pidPath, "utf8"));
  if (!Number.isSafeInteger(pid) || pid <= 0)
    throw new Error("Invalid PID file");
  process.kill(pid, "SIGTERM");
  await rm(pidPath, { force: true });
  process.stdout.write(`Stop requested for PID ${pid}.\n`);
}

async function status() {
  const pid = Number(await readFile(pidPath, "utf8").catch(() => "0"));
  let running = false;
  if (pid > 0) {
    try {
      process.kill(pid, 0);
      running = true;
    } catch {
      running = false;
    }
  }
  process.stdout.write(
    `${JSON.stringify({ running, ...(pid > 0 ? { pid } : {}) })}\n`,
  );
}

async function backup() {
  const output = safeDataPath(
    option(
      "output",
      resolve(
        dataRoot,
        "backups",
        new Date().toISOString().replaceAll(":", "-"),
      ),
    ),
  );
  await mkdir(dirname(output), { recursive: true });
  await cp(dataRoot, output, {
    recursive: true,
    filter: (source) =>
      !resolve(source).startsWith(resolve(dataRoot, "backups")),
  });
  process.stdout.write(`Backup created at ${output}.\n`);
}

async function restore() {
  if (!process.argv.includes("--confirm"))
    throw new Error("Restore requires --confirm");
  const backupRoot = safeDataPath(option("backup", ""));
  await readFile(resolve(backupRoot, "db/synlet.sqlite"));
  const preserved = `${dataRoot}.before-restore-${Date.now()}`;
  try {
    await rename(dataRoot, preserved);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  await cp(backupRoot, dataRoot, { recursive: true });
  process.stdout.write(
    `Restored ${dataRoot}; previous data retained at ${preserved}.\n`,
  );
}

const commands = { doctor, start, stop, status, backup, restore };
const action = commands[command];
if (!action) throw new Error(`Unknown command: ${command}`);
await action();

import { spawn } from "node:child_process";
import { resolve } from "node:path";

import {
  startLocalModelServer,
  stopLocalModelServer,
} from "./lib/local-model.mjs";

const profilePath = resolve("config/profiles/local-12gb.json");
const modelServer = await startLocalModelServer(profilePath);
const app = spawn(
  process.execPath,
  ["apps/server/dist/main.js", "--config", profilePath],
  { stdio: "inherit", windowsHide: true },
);
let stopping = false;
async function stop(signal = "SIGTERM") {
  if (stopping) return;
  stopping = true;
  if (app.exitCode === null) app.kill(signal);
  await stopLocalModelServer(modelServer);
}
process.once("SIGINT", () => void stop("SIGINT"));
process.once("SIGTERM", () => void stop("SIGTERM"));
process.exitCode = await new Promise((resolveExit) =>
  app.once("exit", (code) => resolveExit(code ?? 1)),
);
await stopLocalModelServer(modelServer);

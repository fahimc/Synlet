import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access, readFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import { resolve } from "node:path";

export async function sha256(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function loadLocalModel(
  profilePath = "config/profiles/local-12gb.json",
) {
  const profile = JSON.parse(await readFile(resolve(profilePath), "utf8"));
  const lock = JSON.parse(
    await readFile(resolve(profile.paths.modelsLock), "utf8"),
  );
  const runtimeLock = JSON.parse(
    await readFile(resolve(profile.paths.runtimeLock), "utf8"),
  );
  const models = lock.models.filter(
    (candidate) => candidate.enabled && candidate.provider === "llama.cpp",
  );
  const model = models.find((candidate) => candidate.role === "controller");
  if (!model) throw new Error("No enabled llama.cpp controller is locked");
  const executable = resolve(profile.paths.llamaExecutable);
  await access(executable);
  const verifiedModels = [];
  for (const candidate of models) {
    const artifact = resolve(candidate.artifactPath);
    await access(artifact);
    const actual = await sha256(artifact);
    if (actual !== candidate.sha256)
      throw new Error(
        `Model hash mismatch for ${candidate.modelId}: expected ${candidate.sha256}, got ${actual}`,
      );
    let projector;
    if (candidate.projectorPath || candidate.projectorSha256) {
      if (!candidate.projectorPath || !candidate.projectorSha256)
        throw new Error(`Incomplete projector lock for ${candidate.modelId}`);
      projector = resolve(candidate.projectorPath);
      await access(projector);
      const projectorActual = await sha256(projector);
      if (projectorActual !== candidate.projectorSha256)
        throw new Error(
          `Projector hash mismatch for ${candidate.modelId}: expected ${candidate.projectorSha256}, got ${projectorActual}`,
        );
    }
    verifiedModels.push({
      ...candidate,
      artifact,
      artifactSha256: actual,
      ...(projector ? { projector } : {}),
    });
  }
  for (const file of runtimeLock.runtime.files) {
    const runtimeHash = await sha256(resolve(file.path));
    if (runtimeHash !== file.sha256)
      throw new Error(`Runtime hash mismatch for ${file.path}`);
  }
  return {
    profile,
    model,
    executable,
    artifact: resolve(model.artifactPath),
    artifactSha256: model.sha256,
    models: verifiedModels,
    runtime: runtimeLock.runtime,
  };
}

async function health(baseUrl, apiKey) {
  return fetch(`${baseUrl}/health`, {
    headers: { authorization: `Bearer ${apiKey}` },
  })
    .then((response) => response.ok)
    .catch(() => false);
}

export async function startLocalModelServer(
  profilePath = "config/profiles/local-12gb.json",
) {
  const local = await loadLocalModel(profilePath);
  const baseUrl = local.profile.inference.baseUrl;
  const apiKey = local.profile.inference.apiKey;
  if (await health(baseUrl, apiKey))
    return { ...local, baseUrl, apiKey, owned: false };
  const url = new URL(baseUrl);
  const child = spawn(
    local.executable,
    [
      "--host",
      url.hostname,
      "--port",
      url.port,
      "--models-preset",
      resolve("config/models.router.ini"),
      "--models-max",
      "1",
      "--parallel",
      "1",
      "--api-key",
      apiKey,
    ],
    { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
  );
  let diagnostics = "";
  for (const stream of [child.stdout, child.stderr]) {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      diagnostics = `${diagnostics}${chunk}`.slice(-16_384);
    });
  }
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null)
      throw new Error(
        `llama.cpp server exited ${child.exitCode}: ${diagnostics}`,
      );
    if (await health(baseUrl, apiKey))
      return { ...local, baseUrl, apiKey, child, owned: true };
    await new Promise((resolveWait) => setTimeout(resolveWait, 250));
  }
  child.kill("SIGKILL");
  throw new Error(`llama.cpp server did not become ready: ${diagnostics}`);
}

export async function stopLocalModelServer(server) {
  if (!server.owned || !server.child || server.child.exitCode !== null) return;
  server.child.kill("SIGTERM");
  await Promise.race([
    new Promise((resolveExit) => server.child.once("exit", resolveExit)),
    new Promise((resolveWait) => setTimeout(resolveWait, 5_000)),
  ]);
  if (server.child.exitCode === null) server.child.kill("SIGKILL");
}

export async function completeLocal(server, prompt, options = {}) {
  const started = performance.now();
  const response = await fetch(`${server.baseUrl}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${server.apiKey}`,
    },
    body: JSON.stringify({
      model: options.modelId ?? server.model.modelId,
      messages: [
        {
          role: "system",
          content:
            "You are Synlet, a private local-first assistant running on the user's computer. Be accurate and concise. Never invent a physical location, identity, action, or source.",
        },
        { role: "user", content: prompt },
      ],
      max_tokens: options.maxTokens ?? 128,
      temperature: 0.2,
      seed: 42,
      stream: false,
      chat_template_kwargs: { enable_thinking: false },
    }),
  });
  if (!response.ok) {
    const diagnostic = await response.text().catch(() => "");
    throw new Error(
      `llama.cpp server returned HTTP ${response.status}: ${diagnostic.slice(0, 4096)}`,
    );
  }
  const body = await response.json();
  const text = body.choices?.[0]?.message?.content?.trim();
  if (!text)
    throw new Error(
      `llama.cpp returned no assistant content: ${JSON.stringify(body.choices?.[0] ?? {}).slice(0, 4096)}`,
    );
  return {
    ...server,
    text,
    usage: body.usage,
    timings: body.timings,
    elapsedMs: performance.now() - started,
  };
}

export async function generateLocal(prompt, options = {}) {
  const server = await startLocalModelServer(options.profilePath);
  try {
    return await completeLocal(server, prompt, options);
  } finally {
    await stopLocalModelServer(server);
  }
}

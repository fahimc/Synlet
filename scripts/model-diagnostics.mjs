import {
  completeLocal,
  startLocalModelServer,
  stopLocalModelServer,
} from "./lib/local-model.mjs";

const server = await startLocalModelServer();
try {
  const checks = [];
  for (const model of server.models) {
    process.stderr.write(`Checking ${model.modelId} (${model.role})...\n`);
    const marker = `SYNLET_${model.role.toUpperCase()}_READY`;
    const result = await completeLocal(
      server,
      `Reply with exactly: ${marker}`,
      { maxTokens: 512, modelId: model.modelId },
    );
    if (!result.text.includes(marker))
      throw new Error(`${model.modelId} did not return its readiness marker`);
    checks.push({
      modelId: model.modelId,
      role: model.role,
      artifactSha256: model.sha256,
      elapsedMs: Number(result.elapsedMs.toFixed(1)),
      response: result.text,
    });
  }
  process.stdout.write(
    `${JSON.stringify(
      {
        schemaVersion: "synlet.compatibility/v1",
        evidence: "MEASURED",
        ready: true,
        runtime: `${server.runtime.name}-${server.runtime.platform}`,
        checks,
      },
      null,
      2,
    )}\n`,
  );
} catch (error) {
  process.stderr.write(
    `CAPABILITY_UNAVAILABLE: ${error instanceof Error ? error.message : String(error)}\n`,
  );
  process.exitCode = 2;
} finally {
  await stopLocalModelServer(server);
}

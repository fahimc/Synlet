import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { access } from "node:fs/promises";
import { spawn } from "node:child_process";

import {
  DomainError,
  type ModelEvent,
  type ModelPort,
  type ModelRequest,
} from "@synlet/core";

import type { LockedModel } from "./model-registry.js";

async function sha256(path: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) {
    if (!Buffer.isBuffer(chunk))
      throw new DomainError(
        "INVALID_OUTPUT",
        "Artifact stream returned non-binary data",
      );
    hash.update(chunk);
  }
  return hash.digest("hex");
}

export class LlamaCliAdapter implements ModelPort {
  constructor(
    private readonly executable: string,
    private readonly models: readonly LockedModel[],
  ) {}

  async verify(): Promise<
    readonly {
      modelId: string;
      status: "ready" | "unavailable";
      reason?: string;
    }[]
  > {
    const executableAvailable = await access(this.executable).then(
      () => true,
      () => false,
    );
    return Promise.all(
      this.models.map(async (model) => {
        if (!executableAvailable)
          return {
            modelId: model.modelId,
            status: "unavailable" as const,
            reason: "llama.cpp executable missing",
          };
        if (!model.enabled || !model.artifactPath || !model.sha256)
          return {
            modelId: model.modelId,
            status: "unavailable" as const,
            reason: model.reason ?? "model disabled or unlocked",
          };
        const actual = await sha256(model.artifactPath).catch(() => undefined);
        return actual === model.sha256
          ? { modelId: model.modelId, status: "ready" as const }
          : {
              modelId: model.modelId,
              status: "unavailable" as const,
              reason: "artifact missing or hash mismatch",
            };
      }),
    );
  }

  async capabilities(modelId: string) {
    const model = this.model(modelId);
    return model.capabilities;
  }

  async countInput(_modelId: string, prompt: string): Promise<number> {
    return prompt.trim().split(/\s+/u).filter(Boolean).length;
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const model = this.model(request.modelId);
    if (!model.enabled || !model.artifactPath || !model.sha256) {
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Model ${model.modelId} is disabled`,
      );
    }
    if (request.allowedTools.length > 0 && !model.capabilities.tools) {
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "Selected model does not support native tools",
      );
    }
    if (Date.parse(request.deadlineUtc) <= Date.now())
      throw new DomainError("TIMEOUT", "Model deadline expired");
    const child = spawn(
      this.executable,
      [
        "-m",
        model.artifactPath,
        "-p",
        request.prompt,
        "-n",
        String(request.maxOutputTokens),
        "--ctx-size",
        String(Math.min(model.capabilities.maxContextTokens, 16_384)),
        "-ngl",
        "99",
        "--temp",
        "0.2",
        "--seed",
        "42",
        "--single-turn",
        "--simple-io",
        "--no-display-prompt",
      ],
      { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
    );
    const exit = new Promise<number | null>((resolveExit) =>
      child.once("close", resolveExit),
    );
    const abort = () => child.kill("SIGTERM");
    signal.addEventListener("abort", abort, { once: true });
    let stderr = "";
    let outputText = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      stderr = `${stderr}${chunk}`.slice(-4096);
    });
    try {
      child.stdout.setEncoding("utf8");
      for await (const chunk of child.stdout) {
        if (signal.aborted)
          throw new DomainError(
            Date.parse(request.deadlineUtc) <= Date.now()
              ? "TIMEOUT"
              : "CANCELLED",
            Date.parse(request.deadlineUtc) <= Date.now()
              ? "Model deadline expired"
              : "Model request cancelled",
          );
        const text = String(chunk);
        outputText += text;
        yield { type: "text_delta", text };
      }
      const exitCode = await exit;
      if (signal.aborted)
        throw new DomainError(
          Date.parse(request.deadlineUtc) <= Date.now()
            ? "TIMEOUT"
            : "CANCELLED",
          Date.parse(request.deadlineUtc) <= Date.now()
            ? "Model deadline expired"
            : "Model request cancelled",
        );
      if (exitCode !== 0)
        throw new DomainError(
          "INVALID_OUTPUT",
          `llama.cpp exited ${exitCode}: ${stderr}`,
        );
      yield {
        type: "done",
        finish: "stop",
        inputTokens: await this.countInput(model.modelId, request.prompt),
        outputTokens: outputText.trim().split(/\s+/u).filter(Boolean).length,
      };
    } finally {
      signal.removeEventListener("abort", abort);
      if (child.exitCode === null) child.kill("SIGKILL");
    }
  }

  private model(modelId: string): LockedModel {
    const model = this.models.find(
      (candidate) => candidate.modelId === modelId,
    );
    if (!model)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Unknown model: ${modelId}`,
      );
    return model;
  }
}

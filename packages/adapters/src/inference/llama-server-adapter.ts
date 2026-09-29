import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";

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

interface CompletionResponse {
  readonly choices?: readonly {
    readonly finish_reason?: string;
    readonly message?: {
      readonly content?: string;
      readonly reasoning_content?: string;
    };
  }[];
  readonly usage?: {
    readonly prompt_tokens?: number;
    readonly completion_tokens?: number;
  };
}

export class LlamaServerAdapter implements ModelPort {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly models: readonly LockedModel[],
  ) {}

  async verify(): Promise<
    readonly {
      modelId: string;
      status: "ready" | "unavailable";
      reason?: string;
    }[]
  > {
    const headers = { authorization: `Bearer ${this.apiKey}` };
    const healthy = await fetch(`${this.baseUrl}/health`, {
      headers,
    })
      .then((response) => response.ok)
      .catch(() => false);
    const exposed = healthy
      ? await fetch(`${this.baseUrl}/v1/models`, { headers })
          .then(async (response) => {
            if (!response.ok) return new Set<string>();
            const body = (await response.json()) as {
              data?: readonly { id?: string }[];
            };
            return new Set(
              (body.data ?? [])
                .map((entry) => entry.id)
                .filter((id): id is string => typeof id === "string"),
            );
          })
          .catch(() => new Set<string>())
      : new Set<string>();
    return Promise.all(
      this.models.map(async (model) => {
        if (!model.enabled || !model.artifactPath || !model.sha256)
          return {
            modelId: model.modelId,
            status: "unavailable" as const,
            reason: model.reason ?? "model disabled or unlocked",
          };
        const actual = await sha256(model.artifactPath).catch(() => undefined);
        if (actual !== model.sha256)
          return {
            modelId: model.modelId,
            status: "unavailable" as const,
            reason: "artifact missing or hash mismatch",
          };
        if (model.projectorPath && model.projectorSha256) {
          const projectorHash = await sha256(model.projectorPath).catch(
            () => undefined,
          );
          if (projectorHash !== model.projectorSha256)
            return {
              modelId: model.modelId,
              status: "unavailable" as const,
              reason: "projector missing or hash mismatch",
            };
        }
        return healthy && exposed.has(model.modelId)
          ? { modelId: model.modelId, status: "ready" as const }
          : {
              modelId: model.modelId,
              status: "unavailable" as const,
              reason: healthy
                ? "model is not exposed by the llama.cpp router"
                : "llama.cpp server is not ready",
            };
      }),
    );
  }

  async capabilities(modelId: string) {
    return this.model(modelId).capabilities;
  }

  async countInput(_modelId: string, prompt: string): Promise<number> {
    return prompt.trim().split(/\s+/u).filter(Boolean).length;
  }

  async *generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent> {
    const model = this.model(request.modelId);
    if (Date.parse(request.deadlineUtc) <= Date.now())
      throw new DomainError("TIMEOUT", "Model deadline expired");
    const complete = async (
      reasoning: ModelRequest["reasoning"],
      attemptTimeoutMs: number,
    ): Promise<CompletionResponse> => {
      const attemptSignal = AbortSignal.any([
        signal,
        AbortSignal.timeout(attemptTimeoutMs),
      ]);
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: attemptSignal,
        body: JSON.stringify({
          model: model.modelId,
          messages: [
            {
              role: "system",
              content:
                "You are Synlet, a private local-first assistant running on the user's computer. Be accurate and concise, always emit the requested final response, and never invent a physical location, identity, action, or source.",
            },
            { role: "user", content: request.prompt },
          ],
          ...(request.maxOutputTokens > 0
            ? { max_tokens: request.maxOutputTokens }
            : {}),
          temperature: 0,
          seed: 42,
          stream: true,
          stream_options: { include_usage: true },
          ...(request.responseSchema
            ? {
                response_format: {
                  type: "json_schema",
                  json_schema: {
                    name: "synlet_response",
                    strict: true,
                    schema: request.responseSchema,
                  },
                },
              }
            : request.responseFormat === "json"
              ? { response_format: { type: "json_object" } }
              : {}),
          ...(reasoning && reasoning !== "auto"
            ? {
                chat_template_kwargs: {
                  enable_thinking: reasoning === "enabled",
                },
              }
            : {}),
        }),
      }).catch((error: unknown) => {
        if (signal.aborted)
          throw new DomainError(
            Date.parse(request.deadlineUtc) <= Date.now()
              ? "TIMEOUT"
              : "CANCELLED",
            "Model request was interrupted",
          );
        if (attemptSignal.aborted)
          throw new DomainError(
            "TIMEOUT",
            "Model attempt exceeded its bounded response time",
          );
        throw error;
      });
      if (!response.ok) {
        const diagnostic = await response.text().catch(() => "");
        throw new DomainError(
          "INVALID_OUTPUT",
          `llama.cpp server returned HTTP ${response.status}: ${diagnostic.slice(0, 4096)}`,
        );
      }
      return readCompletionStream(response).catch((error: unknown) => {
        if (signal.aborted)
          throw new DomainError(
            Date.parse(request.deadlineUtc) <= Date.now()
              ? "TIMEOUT"
              : "CANCELLED",
            "Model request was interrupted",
          );
        if (attemptSignal.aborted)
          throw new DomainError(
            "TIMEOUT",
            "Model attempt exceeded its bounded response time",
          );
        throw error;
      });
    };
    const remainingMs = () =>
      Math.max(1_000, Date.parse(request.deadlineUtc) - Date.now());
    let body: CompletionResponse;
    try {
      body = await complete(
        request.reasoning,
        request.reasoning === "enabled"
          ? Math.min(30_000, remainingMs())
          : remainingMs(),
      );
    } catch (error: unknown) {
      if (
        request.reasoning !== "enabled" ||
        !(error instanceof DomainError) ||
        error.code !== "TIMEOUT"
      )
        throw error;
      await this.unloadModel(model.modelId);
      body = await complete("disabled", remainingMs());
    }
    let text = body.choices?.[0]?.message?.content?.trim();
    if (!text && request.reasoning === "enabled") {
      body = await complete("disabled", remainingMs());
      text = body.choices?.[0]?.message?.content?.trim();
    }
    if (!text)
      throw new DomainError(
        "INVALID_OUTPUT",
        `llama.cpp returned no final text (finish=${body.choices?.[0]?.finish_reason ?? "unknown"}, reasoning=${Boolean(body.choices?.[0]?.message?.reasoning_content)})`,
      );
    yield { type: "text_delta", text };
    yield {
      type: "done",
      finish: body.choices?.[0]?.finish_reason === "length" ? "length" : "stop",
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
    };
  }

  private model(modelId: string): LockedModel {
    const model = this.models.find(
      (candidate) => candidate.modelId === modelId && candidate.enabled,
    );
    if (!model)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Unknown or disabled model: ${modelId}`,
      );
    return model;
  }

  private async unloadModel(modelId: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}/models/unload`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      signal: AbortSignal.timeout(15_000),
      body: JSON.stringify({ model: modelId }),
    }).catch((error: unknown) => {
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Timed-out model worker could not be unloaded: ${error instanceof Error ? error.message : String(error)}`,
      );
    });
    if (!response.ok) {
      const diagnostic = await response.text().catch(() => "");
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Timed-out model worker could not be unloaded (HTTP ${response.status}): ${diagnostic.slice(0, 1024)}`,
      );
    }
    const body = (await response.json().catch(() => undefined)) as
      { success?: boolean } | undefined;
    if (!body?.success)
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        "llama.cpp did not confirm that the timed-out model worker was unloaded",
      );
  }
}

async function readCompletionStream(
  response: Response,
): Promise<CompletionResponse> {
  if (!response.body)
    throw new DomainError("INVALID_OUTPUT", "llama.cpp stream has no body");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let pending = "";
  let content = "";
  let reasoning = "";
  let finishReason: string | undefined;
  let usage: CompletionResponse["usage"];
  const consume = (line: string) => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data || data === "[DONE]") return;
    const event = JSON.parse(data) as {
      choices?: readonly {
        finish_reason?: string;
        delta?: { content?: string; reasoning_content?: string };
      }[];
      usage?: CompletionResponse["usage"];
    };
    const choice = event.choices?.[0];
    content += choice?.delta?.content ?? "";
    reasoning += choice?.delta?.reasoning_content ?? "";
    finishReason = choice?.finish_reason ?? finishReason;
    usage = event.usage ?? usage;
  };
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) break;
    pending += decoder.decode(chunk.value, { stream: true });
    const lines = pending.split(/\r?\n/u);
    pending = lines.pop() ?? "";
    for (const line of lines) consume(line);
  }
  pending += decoder.decode();
  if (pending) consume(pending);
  return {
    choices: [
      {
        ...(finishReason ? { finish_reason: finishReason } : {}),
        message: {
          content,
          ...(reasoning ? { reasoning_content: reasoning } : {}),
        },
      },
    ],
    ...(usage ? { usage } : {}),
  };
}

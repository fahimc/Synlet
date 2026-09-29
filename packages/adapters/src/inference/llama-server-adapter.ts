import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { DomainError, type ModelEvent, type ModelPort, type ModelRequest } from "@synlet/core";
import type { LockedModel } from "./model-registry.js";

const system = "You are Synlet, the user's fully authorised local PC administration assistant. Follow the authenticated user's request and accurately distinguish observations, model suggestions, and verified checks. You may use the host's unrestricted tools. Never invent execution, privileges, results or sources.";
async function sha256(path: string): Promise<string> { const hash = createHash("sha256"); for await (const chunk of createReadStream(path)) hash.update(chunk); return hash.digest("hex"); }
export class LlamaServerAdapter implements ModelPort {
  private unhealthy: string | undefined;
  constructor(private readonly baseUrl: string, private readonly apiKey: string, private readonly models: readonly LockedModel[]) {}
  async verify() {
    const healthy = await fetch(`${this.baseUrl}/health`, { headers: this.headers(), signal: AbortSignal.timeout(10000) }).then(r => r.ok).catch(() => false);
    const exposed = healthy ? await this.postOrGetModels() : new Set<string>();
    return Promise.all(this.models.map(async model => {
      let reason: string | undefined;
      if (!model.enabled || !model.artifactPath || !model.sha256) reason = model.reason ?? "Model disabled or unlocked";
      else if (await sha256(model.artifactPath).catch(() => "") !== model.sha256) reason = "Artifact missing or hash mismatch";
      else if (model.projectorPath && (!model.projectorSha256 || await sha256(model.projectorPath).catch(() => "") !== model.projectorSha256)) reason = "Projector missing or hash mismatch";
      else if (!exposed.has(model.modelId)) reason = "Model not exposed by runtime";
      else if (this.unhealthy) reason = this.unhealthy;
      return reason ? { modelId: model.modelId, status: "unavailable" as const, reason } : { modelId: model.modelId, status: "ready" as const };
    }));
  }
  private async postOrGetModels() {
    const response = await fetch(`${this.baseUrl}/v1/models`, { headers: this.headers(), signal: AbortSignal.timeout(10000) });
    if (!response.ok) return new Set<string>();
    const data = await response.json() as { data?: readonly { id: string }[] };
    return new Set((data.data ?? []).map(m => m.id));
  }
  async capabilities(modelId: string) { return this.model(modelId).capabilities; }
  async countInput(modelId: string, prompt: string): Promise<number> {
    return this.countRequest({ requestId: "token-count", modelId, prompt, maxOutputTokens: -1, deadlineUtc: new Date(Date.now() + 30000).toISOString(), allowedTools: [] }, AbortSignal.timeout(30000));
  }
  async countRequest(request: ModelRequest, signal: AbortSignal): Promise<number> {
    if (this.unhealthy) throw new DomainError("CAPABILITY_UNAVAILABLE", this.unhealthy);
    signal.throwIfAborted();
    const model = this.model(request.modelId);
    if (request.images?.length && !model.capabilities.image) throw new DomainError("CAPABILITY_UNAVAILABLE", "Selected model does not accept image inputs");
    const formatted = await this.post("/apply-template", { model: request.modelId, messages: this.messages(request), ...this.thinking(request) }, signal) as { prompt?: unknown };
    if (typeof formatted.prompt !== "string") throw new DomainError("CAPABILITY_UNAVAILABLE", "Runtime did not expose a native chat template for token accounting");
    if (request.images?.length) {
      // Native multimodal prefill measures visual tokens; a character estimate is never called exact.
      try {
      const result = await this.post("/completion", { model: request.modelId, prompt: { prompt_string: formatted.prompt, multimodal_data: request.images.map(i => i.dataUrl.replace(/^data:image\/[a-zA-Z0-9.+-]+;base64,/u, "")) }, n_predict: 0, n_keep: -1, stream: false, cache_prompt: true }, signal) as { tokens_evaluated?: unknown; truncated?: boolean };
      if (result.truncated || typeof result.tokens_evaluated !== "number" || !Number.isSafeInteger(result.tokens_evaluated)) throw new DomainError("CONTEXT_LIMIT", "Runtime could not safely measure the complete multimodal input");
      return result.tokens_evaluated;
      } catch (error) {
        try { await this.unload(model.modelId); }
        catch (stopError) { this.unhealthy = `Multimodal prefill stop unconfirmed; runtime quarantined: ${String(stopError)}`; }
        if (this.unhealthy) throw new DomainError("CAPABILITY_UNAVAILABLE", this.unhealthy);
        throw error;
      }
    }
    const result = await this.post("/tokenize", { model: request.modelId, content: formatted.prompt, add_special: false, parse_special: true }, signal) as { tokens?: unknown };
    if (!Array.isArray(result.tokens)) throw new DomainError("INVALID_OUTPUT", "Runtime tokenizer returned no token IDs");
    return result.tokens.length;
  }
  async *generate(request: ModelRequest, signal: AbortSignal): AsyncIterable<ModelEvent> {
    if (this.unhealthy) throw new DomainError("CAPABILITY_UNAVAILABLE", this.unhealthy);
    const model = this.model(request.modelId);
    const left = Date.parse(request.deadlineUtc) - Date.now();
    if (left <= 0) throw new DomainError("TIMEOUT", "Task deadline expired");
    const combined = AbortSignal.any([signal, AbortSignal.timeout(left)]);
    let sent = false;
    try {
      const inputTokens = await this.countRequest(request, combined);
      const capacity = model.capabilities.maxContextTokens - inputTokens - 256;
      if (capacity < 1) throw new DomainError("CONTEXT_LIMIT", "Input leaves no generation space; no context shifting or truncation is allowed");
      const maxTokens = request.maxOutputTokens > 0 ? Math.min(request.maxOutputTokens, capacity) : capacity;
      sent = true;
      const response = await fetch(`${this.baseUrl}/v1/chat/completions`, {
        method: "POST", headers: this.headers(), signal: combined,
        body: JSON.stringify({ model: model.modelId, messages: this.messages(request), max_tokens: maxTokens, n_keep: -1,
          temperature: 0, seed: 42, stream: true, stream_options: { include_usage: true }, ...this.thinking(request),
          ...(request.responseSchema ? { response_format: { type: "json_schema", json_schema: { name: "synlet_response", strict: true, schema: request.responseSchema } } } : request.responseFormat === "json" ? { response_format: { type: "json_object" } } : {}),
        }),
      });
      if (!response.ok) throw new DomainError("INVALID_OUTPUT", `llama.cpp HTTP ${response.status}: ${(await response.text()).slice(0, 2048)}`);
      yield* completionEvents(response, inputTokens);
      sent = false;
    } catch (error) {
      if (sent) {
        // Await confirmed stop before ScheduledModelPort releases its lease.
        try { await this.unload(model.modelId); }
        catch (stopError) { this.unhealthy = `Worker stop could not be confirmed; runtime quarantined until restart: ${String(stopError)}`; }
      }
      if (this.unhealthy) throw new DomainError("CAPABILITY_UNAVAILABLE", this.unhealthy);
      if (combined.aborted) throw new DomainError(signal.aborted ? "CANCELLED" : "TIMEOUT", "Generation stopped; worker unload confirmed");
      throw error;
    }
  }
  private messages(request: ModelRequest) {
    return [ { role: "system", content: system }, ...(request.messages ?? []),
      { role: "user", content: request.images?.length ? [{ type: "text", text: request.prompt }, ...request.images.map(image => ({ type: "image_url", image_url: { url: image.dataUrl } }))] : request.prompt },
    ];
  }
  private thinking(request: ModelRequest) { return request.reasoning && request.reasoning !== "auto" ? { chat_template_kwargs: { enable_thinking: request.reasoning === "enabled" } } : {}; }
  private headers() { return { "content-type": "application/json", authorization: `Bearer ${this.apiKey}` }; }
  private async post(path: string, body: unknown, signal: AbortSignal): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${path}`, { method: "POST", headers: this.headers(), body: JSON.stringify(body), signal });
    if (!response.ok) throw new DomainError("CAPABILITY_UNAVAILABLE", `Runtime ${path} failed: ${response.status} ${(await response.text()).slice(0, 1024)}`);
    return response.json();
  }
  private model(modelId: string): LockedModel {
    const model = this.models.find(m => m.modelId === modelId && m.enabled);
    if (!model) throw new DomainError("CAPABILITY_UNAVAILABLE", `Unknown or disabled model: ${modelId}`);
    return model;
  }
  private async unload(modelId: string): Promise<void> {
    const result = await this.post("/models/unload", { model: modelId }, AbortSignal.timeout(15000)) as { success?: boolean };
    if (result.success !== true) throw new Error("Runtime did not confirm worker unload");
  }
}

export async function* completionEvents(response: Response, fallbackInput: number): AsyncIterable<ModelEvent> {
  if (!response.body) throw new DomainError("INVALID_OUTPUT", "Missing model stream");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let finish: string | undefined;
  let done = false;
  let size = 0;
  let inputTokens = fallbackInput;
  let outputTokens = 0;
  const parse = (line: string): ModelEvent | undefined => {
    if (!line.startsWith("data:")) return;
    const data = line.slice(5).trim();
    if (!data) return;
    if (data === "[DONE]") { done = true; return; }
    if (done) throw new DomainError("INVALID_OUTPUT", "Payload after stream terminator");
    const event = JSON.parse(data) as { error?: unknown; choices?: readonly { finish_reason?: string | null; delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
    if (event.error) throw new DomainError("INVALID_OUTPUT", "Model stream reported an error");
    const choice = event.choices?.[0];
    if (choice?.finish_reason) finish = choice.finish_reason;
    inputTokens = event.usage?.prompt_tokens ?? inputTokens;
    outputTokens = event.usage?.completion_tokens ?? outputTokens;
    if (choice?.delta?.content) return { type: "text_delta", text: choice.delta.content };
  };
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > 16 * 1024 * 1024) throw new DomainError("RESOURCE_EXHAUSTED", "Model stream exceeds byte budget");
      buffer += decoder.decode(next.value, { stream: true });
      const lines = buffer.split(/\r?\n/u); buffer = lines.pop() ?? "";
      for (const line of lines) { const event = parse(line); if (event) yield event; }
    }
    buffer += decoder.decode();
    if (buffer) { const event = parse(buffer); if (event) yield event; }
    if (!done || finish !== "stop") throw new DomainError("INVALID_OUTPUT", `Incomplete model stream (finish=${finish ?? "missing"}, terminator=${done})`);
    yield { type: "done", finish: "stop", inputTokens, outputTokens };
  } finally { await reader.cancel().catch(() => undefined); reader.releaseLock(); }
}

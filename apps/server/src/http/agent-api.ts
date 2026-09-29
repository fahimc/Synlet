import { randomUUID } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { DomainError, type AccessContext, type AgentInput, type ChatMessage, type ImageInput } from "@synlet/core";
import type { ServerServices } from "../bootstrap/services.js";

type Access = (request: FastifyRequest, reply: FastifyReply) => AccessContext | undefined;
function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DomainError("INVALID_OUTPUT", "Expected an object");
  return value as Record<string, unknown>;
}
export function parseImages(value: unknown): readonly ImageInput[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > 2) throw new DomainError("INVALID_OUTPUT", "At most two images per request");
  return value.map((item, index) => {
    const entry = record(item);
    if (typeof entry.dataUrl !== "string" || entry.dataUrl.length > 12 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/u.test(entry.dataUrl)) throw new DomainError("INVALID_OUTPUT", "Images must be bounded PNG/JPEG/WebP base64 data URLs; remote image URLs are not fetched implicitly");
    const data = Buffer.from(entry.dataUrl.slice(entry.dataUrl.indexOf(",") + 1), "base64");
    const png = data.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]));
    const jpeg = data[0] === 255 && data[1] === 216;
    const webp = data.toString("ascii", 0, 4) === "RIFF" && data.toString("ascii", 8, 12) === "WEBP";
    if (data.length > 8 * 1024 * 1024 || !(png || jpeg || webp)) throw new DomainError("INVALID_OUTPUT", "Invalid image signature or size");
    return { id: `input-image-${index}`, dataUrl: entry.dataUrl };
  });
}
export function installAgentApi(app: FastifyInstance, services: ServerServices, accessFor: Access): void {
  app.post("/api/v1/agent-runs", async (request, reply) => {
    const access = accessFor(request, reply); if (!access) return;
    const body = record(request.body);
    if (typeof body.sessionId !== "string" || !body.sessionId || body.sessionId.length > 128 || typeof body.prompt !== "string" || !body.prompt.trim() || Buffer.byteLength(body.prompt) > 1024 * 1024) return reply.code(400).send({ code: "INVALID_REQUEST", message: "Valid sessionId and nonempty prompt up to 1 MiB are required" });
    const key = request.headers["idempotency-key"];
    if (key !== undefined && (typeof key !== "string" || !key || key.length > 256)) return reply.code(400).send({ code: "INVALID_REQUEST", message: "Invalid idempotency key" });
    const input: AgentInput = { sessionId: body.sessionId, prompt: body.prompt, images: parseImages(body.images), ...(typeof key === "string" ? { idempotencyKey: key } : {}) };
    return reply.code(202).send(await services.agent.start(input, access));
  });
  app.post("/v1/chat/completions", async (request, reply) => {
    const access = accessFor(request, reply); if (!access) return;
    const body = record(request.body);
    const allowed = new Set(["model", "messages", "stream", "sessionId"]);
    if (Object.keys(body).some(key => !allowed.has(key)) || body.model !== "synlet-local" || body.stream === true) return reply.code(400).send({ code: "UNSUPPORTED_OPTION", message: "Supported: model=synlet-local, messages, stream=false, optional sessionId. Host tools run inside the same agent harness; client-supplied tools and streaming are not implemented." });
    if (!Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > 64) return reply.code(400).send({ code: "INVALID_REQUEST", message: "messages required" });
    const images: ImageInput[] = [];
    const messages: ChatMessage[] = [];
    for (const item of body.messages) {
      const message = record(item);
      if (!["system", "developer", "user", "assistant"].includes(String(message.role))) throw new DomainError("INVALID_OUTPUT", "Unsupported message role");
      let text = "";
      if (typeof message.content === "string") text = message.content;
      else if (Array.isArray(message.content)) {
        for (const part of message.content) {
          const entry = record(part);
          if (entry.type === "text" && typeof entry.text === "string") text += entry.text;
          else if (entry.type === "image_url") {
            const image = record(entry.image_url);
            images.push(...parseImages([{ dataUrl: image.url }]));
          } else throw new DomainError("INVALID_OUTPUT", "Unsupported message content");
        }
      } else throw new DomainError("INVALID_OUTPUT", "Invalid message content");
      messages.push({ role: message.role as ChatMessage["role"], content: text });
    }
    const latest = messages.at(-1);
    if (!latest || latest.role !== "user" || (!latest.content.trim() && !images.length) || images.length > 2 || Buffer.byteLength(messages.map(m => m.content).join("")) > 1024 * 1024) throw new DomainError("INVALID_OUTPUT", "Expected a bounded final user message");
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string" || !key || key.length > 256) return reply.code(400).send({ code: "INVALID_REQUEST", message: "Idempotency-Key required" });
    const sessionId = typeof body.sessionId === "string" && body.sessionId.length <= 128 ? body.sessionId : `api-${randomUUID()}`;
    // Stable default session ID across retries with the same request key.
    const input: AgentInput = { sessionId: body.sessionId === undefined ? `api-${key}`.slice(0, 128) : sessionId, prompt: latest.content || "Interpret the attached image.", messages: messages.slice(0, -1), images, idempotencyKey: key };
    let run = await services.agent.start(input, access);
    while (run.status === "running") { await new Promise(resolveWait => setTimeout(resolveWait, 50)); run = await services.agent.get(run.runId, access); }
    if (run.status !== "completed") return reply.code(run.status === "cancelled" ? 409 : 502).send({ code: "AGENT_NOT_COMPLETED", runId: run.runId, status: run.status, message: run.result });
    return { id: run.runId, object: "chat.completion", model: "synlet-local", choices: [{ index: 0, finish_reason: "stop", message: { role: "assistant", content: run.result ?? "" } }], execution_mode: "full-control", evidence: "See persisted trace; model critique is not independent verification" };
  });
}

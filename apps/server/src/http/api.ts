import type {
  ActionProposalRequest,
  ApprovalDecisionRequest,
  ContextBuildRequest,
  SourceCreateRequest,
  TaskCreateRequest,
} from "@synlet/contracts";
import {
  actionProposalRequestSchema,
  approvalDecisionRequestSchema,
  contextBuildRequestSchema,
  sourceCreateRequestSchema,
  taskCreateRequestSchema,
} from "@synlet/contracts";
import { DomainError, type AccessContext, type SourceRef } from "@synlet/core";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

import type { ServerServices } from "../bootstrap/services.js";

function requestSchema(schema: unknown): Record<string, unknown> {
  const compatible = { ...(schema as Record<string, unknown>) };
  delete compatible.$schema;
  delete compatible.$id;
  return compatible;
}

function accessFor(
  request: FastifyRequest,
  reply: FastifyReply,
  authToken: string,
): AccessContext | undefined {
  if (request.headers.authorization !== `Bearer ${authToken}`) {
    void reply
      .code(401)
      .send({ code: "UNAUTHENTICATED", message: "Bearer token required" });
    return undefined;
  }
  const actorId = request.headers["x-synlet-actor-id"];
  const projectId = request.headers["x-synlet-project-id"];
  if (
    typeof actorId !== "string" ||
    typeof projectId !== "string" ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(actorId) ||
    !/^[a-zA-Z0-9_-]{1,128}$/u.test(projectId)
  ) {
    void reply.code(400).send({
      code: "INVALID_ACCESS_CONTEXT",
      message: "Valid actor and project headers are required",
    });
    return undefined;
  }
  return { actorId, projectId, policyVersion: "policy/v1" };
}

function statusFor(error: DomainError): number {
  if (error.code === "NOT_FOUND") return 404;
  if (error.code === "POLICY_DENIED") return 403;
  if (error.code === "RESOURCE_EXHAUSTED" || error.code === "CONTEXT_LIMIT")
    return 413;
  if (error.code === "CAPABILITY_UNAVAILABLE") return 503;
  if (error.code === "TIMEOUT") return 504;
  if (error.code === "CANCELLED") return 409;
  if (error.code === "CONFLICT" || error.code === "STALE_REVISION") return 409;
  return 400;
}

export function installErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof DomainError) {
      void reply
        .code(statusFor(error))
        .send({ code: error.code, message: error.message });
      return;
    }
    if (
      typeof error === "object" &&
      error !== null &&
      "validation" in error &&
      error.validation
    ) {
      const message =
        error instanceof Error ? error.message : "Request validation failed";
      void reply.code(400).send({ code: "INVALID_REQUEST", message });
      return;
    }
    void reply
      .code(500)
      .send({ code: "INTERNAL", message: "Internal server error" });
  });
}

export function installApi(
  app: FastifyInstance,
  services: ServerServices,
  authToken: string,
): void {
  app.post("/api/v1/agent-runs", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const body = request.body as { sessionId?: unknown; prompt?: unknown };
    if (
      typeof body.sessionId !== "string" ||
      body.sessionId.length < 1 ||
      body.sessionId.length > 128 ||
      typeof body.prompt !== "string" ||
      body.prompt.trim().length < 1 ||
      body.prompt.length > 32_768
    ) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "sessionId and prompt are required",
      });
    }
    return reply
      .code(202)
      .send(
        await services.agent.start(
          { sessionId: body.sessionId, prompt: body.prompt },
          access,
        ),
      );
  });
  app.get("/api/v1/agent-runs", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const query = request.query as { sessionId?: unknown; limit?: unknown };
    const sessionId = query.sessionId;
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (
      (sessionId !== undefined &&
        (typeof sessionId !== "string" ||
          sessionId.length < 1 ||
          sessionId.length > 128)) ||
      !Number.isSafeInteger(limit) ||
      limit < 1 ||
      limit > 500
    ) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "sessionId must be valid and limit must be between 1 and 500",
      });
    }
    return services.agent.list(access, {
      ...(typeof sessionId === "string" ? { sessionId } : {}),
      limit,
    });
  });
  app.get("/api/v1/agent-runs/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.agent.get((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/agent-runs/:id/events", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const after = Number((request.query as { after?: string }).after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "after must be a sequence number",
      });
    }
    return services.agent.events(
      (request.params as { id: string }).id,
      after,
      access,
    );
  });
  app.post("/api/v1/agent-runs/:id/cancel", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.agent.cancel((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/agent-tools", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.agentTools.catalog();
  });
  app.post(
    "/api/v1/tasks",
    { schema: { body: requestSchema(taskCreateRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken);
      if (!access) return;
      const key = request.headers["idempotency-key"];
      if (typeof key !== "string" || key.length < 1 || key.length > 256) {
        return reply.code(400).send({
          code: "INVALID_REQUEST",
          message: "Idempotency-Key required",
        });
      }
      return services.tasks.create(
        request.body as TaskCreateRequest,
        key,
        access,
      );
    },
  );
  app.post("/v1/chat/completions", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const body = request.body as {
      model?: unknown;
      messages?: unknown;
      stream?: unknown;
      tools?: unknown;
    };
    if (
      body.model !== "synlet-local" ||
      body.stream === true ||
      body.tools !== undefined
    ) {
      return reply.code(400).send({
        code: "UNSUPPORTED_OPTION",
        message:
          "The facade supports model=synlet-local, non-streaming text messages, and no tools",
      });
    }
    if (
      !Array.isArray(body.messages) ||
      body.messages.length < 1 ||
      body.messages.length > 64
    ) {
      return reply
        .code(400)
        .send({ code: "INVALID_REQUEST", message: "messages are required" });
    }
    const content: string[] = [];
    for (const item of body.messages as unknown[]) {
      if (
        typeof item !== "object" ||
        item === null ||
        !("content" in item) ||
        typeof item.content !== "string"
      ) {
        return reply.code(400).send({
          code: "INVALID_REQUEST",
          message: "only text message content is supported",
        });
      }
      content.push(item.content);
    }
    const key = request.headers["idempotency-key"];
    if (typeof key !== "string") {
      return reply
        .code(400)
        .send({ code: "INVALID_REQUEST", message: "Idempotency-Key required" });
    }
    const task = await services.tasks.create(
      {
        sessionId: "openai-facade",
        prompt: content.join("\n"),
        execution: "immediate",
      },
      key,
      access,
    );
    return {
      id: task.taskId,
      object: "chat.completion",
      model: "synlet-local",
      evidence: "MEASURED",
      choices: [
        {
          index: 0,
          finish_reason: "stop",
          message: { role: "assistant", content: task.result ?? "" },
        },
      ],
    };
  });
  app.get("/api/v1/tasks/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.tasks.get((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/tasks/:id/events", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const after = Number((request.query as { after?: string }).after ?? 0);
    if (!Number.isSafeInteger(after) || after < 0) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "after must be a sequence number",
      });
    }
    const events = await services.tasks.events(
      (request.params as { id: string }).id,
      after,
      access,
    );
    return reply
      .type("text/event-stream; charset=utf-8")
      .send(
        events
          .map(
            (event) =>
              `id: ${event.sequence}\nevent: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`,
          )
          .join(""),
      );
  });
  app.post("/api/v1/tasks/:id/cancel", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.tasks.cancel((request.params as { id: string }).id, access);
  });
  app.post(
    "/api/v1/tasks/:id/actions",
    { schema: { body: requestSchema(actionProposalRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken);
      if (!access) return;
      const body = request.body as ActionProposalRequest;
      return services.tools.propose(
        (request.params as { id: string }).id,
        body.toolId,
        body.arguments,
        access,
      );
    },
  );
  app.get("/api/v1/approvals", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.tools.listPending(access);
  });
  app.get("/api/v1/models", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.models.list().map((model) => ({
      modelId: model.modelId,
      role: model.role,
      provider: model.provider,
      enabled: model.enabled,
      capabilities: model.capabilities,
      evidence: model.enabled ? "MEASURED" : "UNAVAILABLE",
      ...(model.reason ? { reason: model.reason } : {}),
    }));
  });
  app.get("/api/v1/skills", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const availableTools = new Set(
      (await services.agentTools.catalog()).map((tool) => tool.id),
    );
    return (await services.skills.load()).map((skill) => ({
      ...skill,
      enabled:
        skill.trusted && skill.tools.every((tool) => availableTools.has(tool)),
      ...(skill.tools.some((tool) => !availableTools.has(tool))
        ? { unavailableReason: "A required host capability is not configured" }
        : {}),
    }));
  });
  app.post(
    "/api/v1/approvals/:id/decision",
    { schema: { body: requestSchema(approvalDecisionRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken);
      if (!access) return;
      return services.tools.decide(
        (request.params as { id: string }).id,
        request.body as ApprovalDecisionRequest,
        access,
      );
    },
  );
  app.post(
    "/api/v1/sources",
    { schema: { body: requestSchema(sourceCreateRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken);
      if (!access) return;
      return services.sources.ingest(
        request.body as SourceCreateRequest,
        access,
      );
    },
  );
  app.get("/api/v1/sources/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.sources.get((request.params as { id: string }).id, access);
  });
  app.delete("/api/v1/sources/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    return services.sources.delete(
      (request.params as { id: string }).id,
      access,
    );
  });
  app.post("/api/v1/context/search", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const body = request.body as { query?: unknown; exact?: unknown };
    if (
      typeof body.query !== "string" ||
      body.query.length < 1 ||
      body.query.length > 4096
    ) {
      return reply
        .code(400)
        .send({ code: "INVALID_REQUEST", message: "query is required" });
    }
    return body.exact === true
      ? services.sources.exact(body.query, access)
      : services.sources.search(body.query, access);
  });
  app.get("/api/v1/sources/:id/chunks/:chunkId", async (request, reply) => {
    const access = accessFor(request, reply, authToken);
    if (!access) return;
    const parameters = request.params as { id: string; chunkId: string };
    const query = request.query as { revision?: string; radius?: string };
    if (!query.revision) {
      return reply
        .code(400)
        .send({ code: "INVALID_REQUEST", message: "revision is required" });
    }
    const ref: SourceRef = {
      sourceId: parameters.id,
      revision: query.revision,
      chunkId: parameters.chunkId,
    };
    if (query.radius === undefined) return services.sources.read(ref, access);
    const radius = Number(query.radius);
    if (!Number.isSafeInteger(radius) || radius < 0 || radius > 8) {
      return reply.code(400).send({
        code: "INVALID_REQUEST",
        message: "radius must be 0 through 8",
      });
    }
    return services.sources.expand(ref, radius, access);
  });
  app.post(
    "/api/v1/context/build",
    { schema: { body: requestSchema(contextBuildRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken);
      if (!access) return;
      return services.context.build(
        request.body as ContextBuildRequest,
        access,
      );
    },
  );
}

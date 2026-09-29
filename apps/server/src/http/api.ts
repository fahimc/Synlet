import { timingSafeEqual } from "node:crypto";
import type { OperatorPrincipal } from "../bootstrap/operator-auth.js";
import { installAgentApi } from "./agent-api.js";
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
  principal: OperatorPrincipal,
): AccessContext | undefined {
  const supplied = Buffer.from(request.headers.authorization ?? "");
  const expected = Buffer.from(`Bearer ${authToken}`);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  ) {
    void reply
      .code(401)
      .send({ code: "UNAUTHENTICATED", message: "Bearer token required" });
    return undefined;
  }
  const requestedActor = request.headers["x-synlet-actor-id"];
  const requestedProject = request.headers["x-synlet-project-id"];
  if (
    (requestedActor !== undefined && requestedActor !== principal.actorId) ||
    (requestedProject !== undefined &&
      (typeof requestedProject !== "string" ||
        !principal.projectIds.includes(requestedProject)))
  ) {
    void reply
      .code(403)
      .send({
        code: "POLICY_DENIED",
        message:
          "Caller headers cannot change the authenticated operator scope",
      });
    return undefined;
  }
  const projectId =
    typeof requestedProject === "string"
      ? requestedProject
      : principal.projectIds[0];
  if (!projectId) {
    void reply
      .code(403)
      .send({
        code: "POLICY_DENIED",
        message: "Operator has no configured project",
      });
    return undefined;
  }
  return {
    actorId: principal.actorId,
    projectId,
    policyVersion: "full-control/v1",
  };
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
  principal: OperatorPrincipal,
): void {
  installAgentApi(app, services, (request, reply) =>
    accessFor(request, reply, authToken, principal),
  );
  app.get("/api/v1/agent-runs", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
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
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.agent.get((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/agent-runs/:id/events", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
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
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.agent.cancel((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/agent-tools", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.agentTools.catalog();
  });
  app.post(
    "/api/v1/tasks",
    { schema: { body: requestSchema(taskCreateRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken, principal);
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
  app.get("/api/v1/tasks/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.tasks.get((request.params as { id: string }).id, access);
  });
  app.get("/api/v1/tasks/:id/events", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
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
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.tasks.cancel((request.params as { id: string }).id, access);
  });
  app.post(
    "/api/v1/tasks/:id/actions",
    { schema: { body: requestSchema(actionProposalRequestSchema) } },
    async (request, reply) => {
      const access = accessFor(request, reply, authToken, principal);
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
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.tools.listPending(access);
  });
  app.get("/api/v1/models", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.models.list().map((model) => ({
      modelId: model.modelId,
      role: model.role,
      provider: model.provider,
      enabled: model.enabled,
      capabilities: model.capabilities,
      evidence: model.enabled ? "CONFIGURED_NOT_ROLE_VALIDATED" : "UNAVAILABLE",
      ...(model.reason ? { reason: model.reason } : {}),
    }));
  });
  app.get("/api/v1/skills", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
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
      const access = accessFor(request, reply, authToken, principal);
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
      const access = accessFor(request, reply, authToken, principal);
      if (!access) return;
      return services.sources.ingest(
        request.body as SourceCreateRequest,
        access,
      );
    },
  );
  app.get("/api/v1/sources/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.sources.get((request.params as { id: string }).id, access);
  });
  app.delete("/api/v1/sources/:id", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
    if (!access) return;
    return services.sources.delete(
      (request.params as { id: string }).id,
      access,
    );
  });
  app.post("/api/v1/context/search", async (request, reply) => {
    const access = accessFor(request, reply, authToken, principal);
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
    const access = accessFor(request, reply, authToken, principal);
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
      const access = accessFor(request, reply, authToken, principal);
      if (!access) return;
      return services.context.build(
        request.body as ContextBuildRequest,
        access,
      );
    },
  );
}

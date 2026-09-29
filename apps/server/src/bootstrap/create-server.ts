import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import { ProfileRuntimeIdentity } from "@synlet/adapters";
import { healthResponseSchema, type RuntimeProfile } from "@synlet/contracts";
import { createHealthResponse } from "@synlet/core";
import Fastify, { type FastifyInstance } from "fastify";

import { installApi, installErrorHandler } from "../http/api.js";
import { createServices, type ServiceOverrides } from "./services.js";

export interface CreateServerOptions {
  readonly profile: RuntimeProfile;
  readonly webRoot?: string;
  readonly authToken?: string;
  readonly services?: ServiceOverrides;
}

export async function createServer(
  options: CreateServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: options.profile.limits.maxSourceBytes + 16 * 1024,
  });
  const runtime = new ProfileRuntimeIdentity(options.profile.ui.evidenceLabel);
  const services = await createServices(options.profile, options.services);
  installErrorHandler(app);
  installApi(app, services, options.authToken ?? "synlet-local");
  app.addHook("onClose", async () => {
    await services.capabilityRouter.close?.();
    await services.agentTools.close?.();
    services.database.close();
  });

  app.get(
    "/health/live",
    { schema: { response: { 200: healthResponseSchema } } },
    () => createHealthResponse(runtime, "live"),
  );
  app.get(
    "/health/ready",
    { schema: { response: { 200: healthResponseSchema } } },
    () => createHealthResponse(runtime, "ready"),
  );

  await app.register(fastifyStatic, {
    root: options.webRoot ?? resolve(process.cwd(), "apps/web/dist"),
    wildcard: false,
  });

  return app;
}

import { operatorToken, type OperatorPrincipal } from "./operator-auth.js";
import { resolve } from "node:path";

import fastifyStatic from "@fastify/static";
import { ProfileRuntimeIdentity, acquireHostLock } from "@synlet/adapters";
import { healthResponseSchema, type RuntimeProfile } from "@synlet/contracts";
import { createHealthResponse } from "@synlet/core";
import Fastify, { type FastifyInstance } from "fastify";

import { installApi, installErrorHandler } from "../http/api.js";
import { createServices, type ServiceOverrides } from "./services.js";

export interface CreateServerOptions {
  readonly profile: RuntimeProfile;
  readonly webRoot?: string;
  readonly authToken?: string;
  readonly principal?: OperatorPrincipal;
  readonly services?: ServiceOverrides;
}

export async function createServer(
  options: CreateServerOptions,
): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: Math.max(
      options.profile.limits.maxSourceBytes + 16 * 1024,
      24 * 1024 * 1024,
    ),
  });
  const runtime = new ProfileRuntimeIdentity(options.profile.ui.evidenceLabel);
  const services = await createServices(options.profile, options.services);
  installErrorHandler(app);
  installApi(
    app,
    services,
    options.authToken ??
      (await operatorToken(
        resolve(options.services?.dataRoot ?? options.profile.paths.dataRoot),
      )),
    options.principal ?? {
      actorId: "local-user",
      projectIds: ["local-project"],
    },
  );
  const releaseHost = options.services?.model
    ? async () => undefined
    : await acquireHostLock(
        resolve(options.services?.dataRoot ?? options.profile.paths.dataRoot),
      );
  await services.agent.recover();
  app.addHook("onClose", async () => {
    await services.agent.close();
    await services.capabilityRouter.close?.();
    await services.agentTools.close?.();
    services.database.close();
    await releaseHost();
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

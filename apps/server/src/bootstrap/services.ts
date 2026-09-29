import { resolve } from "node:path";

import {
  DeterministicTokenizer,
  AgentToolRouter,
  FileArtifactStore,
  LlamaServerAdapter,
  McpClientManager,
  ModelSourcePreservingCompactor,
  PlaywrightBrowserAdapter,
  RandomIds,
  ModelRegistry,
  PythonCapabilityRouter,
  SafeToolAdapter,
  RuntimeSkillRegistry,
  Sha256Hashes,
  SqliteActionJournal,
  SqliteAgentRunStore,
  SqliteSourceStore,
  SqliteEmbeddingIndex,
  SqliteTaskStore,
  SynletDatabase,
  SystemClock,
} from "@synlet/adapters";
import type { RuntimeProfile } from "@synlet/contracts";
import {
  ContextEngine,
  AgentHarness,
  DomainError,
  LocalGpuScheduler,
  ScheduledModelPort,
  SourceService,
  TaskService,
  ToolService,
  type ModelPort,
  type AgentCapabilityRouterPort,
  type AgentToolPort,
} from "@synlet/core";

export interface ServiceOverrides {
  readonly databasePath?: string;
  readonly dataRoot?: string;
  readonly workspaceRoot?: string;
  readonly failAfterWrite?: boolean;
  readonly model?: ModelPort;
  readonly modelId?: string;
}

export interface ServerServices {
  readonly database: SynletDatabase;
  readonly tasks: TaskService;
  readonly tools: ToolService;
  readonly sources: SourceService;
  readonly context: ContextEngine;
  readonly models: ModelRegistry;
  readonly skills: RuntimeSkillRegistry;
  readonly agent: AgentHarness;
  readonly agentTools: AgentToolPort;
  readonly capabilityRouter: AgentCapabilityRouterPort;
}

export async function createServices(
  profile: RuntimeProfile,
  overrides: ServiceOverrides = {},
): Promise<ServerServices> {
  const dataRoot = resolve(overrides.dataRoot ?? profile.paths.dataRoot);
  const workspaceRoot = resolve(
    overrides.workspaceRoot ?? profile.paths.workspaceRoot,
  );
  const database = new SynletDatabase(
    overrides.databasePath ?? resolve(dataRoot, "db", "synlet.sqlite"),
  );
  const clock = new SystemClock();
  const ids = new RandomIds();
  const hashes = new Sha256Hashes();
  const taskStore = new SqliteTaskStore(database);
  const sourceStore = new SqliteSourceStore(database);
  const tokenizer = new DeterministicTokenizer();
  const artifactStore = new FileArtifactStore(resolve(dataRoot, "artifacts"));
  const models = await ModelRegistry.load(resolve(profile.paths.modelsLock));
  if (!overrides.model) await models.verifyArtifacts();
  const controller = models.enabledFor("controller");
  if (!controller)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "No enabled controller model is configured",
    );
  const firstLlm = models.enabledFor("compactor");
  if (!firstLlm)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      "No enabled first-stage Qwen model is configured",
    );
  const localModel = new LlamaServerAdapter(
    profile.inference.baseUrl,
    profile.inference.apiKey,
    models
      .list()
      .filter((entry) => entry.provider === "llama.cpp")
      .map((entry) => ({
        ...entry,
        ...(entry.artifactPath
          ? { artifactPath: resolve(entry.artifactPath) }
          : {}),
        ...(entry.projectorPath
          ? { projectorPath: resolve(entry.projectorPath) }
          : {}),
      })),
  );
  const model: ModelPort =
    overrides.model ??
    new ScheduledModelPort(
      localModel,
      new LocalGpuScheduler(
        ids,
        clock,
        profile.scheduler.gpuMemoryMiB,
        profile.scheduler.maxPendingInferenceJobs,
      ),
      new Map(
        models
          .list()
          .filter((entry) => entry.enabled && entry.provider === "llama.cpp")
          .map((entry) => [entry.modelId, entry.memoryMiB]),
      ),
    );
  if (!overrides.model) {
    const verification = await localModel.verify();
    const selected = verification.find(
      (entry) => entry.modelId === controller.modelId,
    );
    if (selected?.status !== "ready")
      throw new DomainError(
        "CAPABILITY_UNAVAILABLE",
        `Controller ${controller.modelId} is unavailable: ${selected?.reason ?? "verification failed"}`,
      );
  }
  const safeTools = new SafeToolAdapter(workspaceRoot, {
    maxReadBytes: profile.limits.maxToolReadBytes,
    ...(overrides.failAfterWrite === undefined
      ? {}
      : { failAfterWrite: overrides.failAfterWrite }),
  });
  const skills = new RuntimeSkillRegistry(resolve("skills"));
  const agentTools = new AgentToolRouter(
    safeTools,
    new PlaywrightBrowserAdapter(
      resolve(profile.paths.browserExecutable),
      resolve(dataRoot, "browser-profile"),
      { allowedDomains: ["*"], maxTextChars: 32_000, headless: false },
    ),
    new McpClientManager(resolve("config/mcp.servers.json")),
    process.cwd(),
  );
  const capabilityRouter = new PythonCapabilityRouter(
    resolve(profile.paths.pythonExecutable),
    resolve("services/python-worker"),
    {
      SYNLET_JULIA_MODEL_ROOT: resolve("model-weights/Julia-1"),
      SYNLET_EMBEDDING_MODEL_ROOT: resolve("model-weights/EmbeddingGemma-300m"),
      PYTHONPATH: resolve("services/python-worker/src"),
      JULIA_CPU_THREADS: "4",
    },
    ["-m", "synlet_worker.worker"],
  );
  const embedding = models.enabledFor("embedding");
  const sources = embedding
    ? new SourceService(
        sourceStore,
        artifactStore,
        ids,
        clock,
        profile.limits.maxSourceBytes,
        capabilityRouter,
        new SqliteEmbeddingIndex(database),
      )
    : new SourceService(
        sourceStore,
        artifactStore,
        ids,
        clock,
        profile.limits.maxSourceBytes,
      );
  const codeSpecialist = models.enabledFor("code");
  const specialists = [
    {
      role: "code" as const,
      modelId: codeSpecialist?.modelId ?? controller.modelId,
      reasoning:
        codeSpecialist?.reasoning ?? controller.reasoning ?? ("auto" as const),
    },
    ...(["math", "vision"] as const).flatMap((role) => {
      const selected = models.enabledFor(role);
      return selected
        ? [
            {
              role,
              modelId: selected.modelId,
              reasoning: selected.reasoning ?? ("auto" as const),
            },
          ]
        : [];
    }),
  ];
  const agent = new AgentHarness(
    new SqliteAgentRunStore(database),
    model,
    agentTools,
    capabilityRouter,
    async () => (await skills.active()).map((skill) => ({ ...skill })),
    ids,
    clock,
    {
      modelId: overrides.modelId ?? controller.modelId,
      selectorModelId: overrides.model
        ? (overrides.modelId ?? firstLlm.modelId)
        : firstLlm.modelId,
      maxSteps: 12,
      maxOutputTokens: -1,
      timeoutMs: 300_000,
      reasoning: controller.reasoning ?? "auto",
      specialists,
    },
  );
  return {
    database,
    tasks: new TaskService(taskStore, model, ids, hashes, clock, {
      maxPending: profile.limits.maxPendingTasks,
      modelId: overrides.modelId ?? controller.modelId,
      maxOutputTokens: -1,
      timeoutMs: 300_000,
    }),
    tools: new ToolService(
      taskStore,
      new SqliteActionJournal(database),
      safeTools,
      ids,
      hashes,
      clock,
    ),
    sources,
    context: new ContextEngine(
      sourceStore,
      tokenizer,
      new ModelSourcePreservingCompactor(model, firstLlm.modelId, 300_000),
      {
        maxLookupRounds: profile.context.maxLookupRounds,
        maxInputTokens: profile.context.defaultInputTokens,
        generationReserveTokens: profile.context.generationReserveTokens,
        safetyTokens: profile.context.safetyTokens,
      },
    ),
    models,
    skills,
    agent,
    agentTools,
    capabilityRouter,
  };
}

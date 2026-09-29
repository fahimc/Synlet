import { DomainError, type AccessContext, type Json } from "../domain/types.js";
import type {
  AgentRunRecord,
  AgentRunStorePort,
  AgentCapabilityRoute,
  AgentCapabilityRouterPort,
  AgentSkill,
  AgentToolDefinition,
  AgentToolPort,
  ClockPort,
  IdPort,
  ModelPort,
} from "../ports/index.js";

type AgentDecision =
  | {
      readonly type: "tool";
      readonly tool: string;
      readonly arguments: Json;
      readonly summary: string;
      readonly skillId?: string;
    }
  | {
      readonly type: "answer";
      readonly content: string;
      readonly summary: string;
    }
  | {
      readonly type: "delegate";
      readonly role: "code" | "math" | "vision";
      readonly task: string;
      readonly summary: string;
    }
  | {
      readonly type: "invalid";
      readonly output: string;
      readonly summary: string;
    };

interface SkillRoute {
  readonly skill?: AgentSkill;
  readonly reason: string;
  readonly route: AgentCapabilityRoute;
}

export interface AgentHarnessOptions {
  readonly modelId: string;
  readonly selectorModelId: string;
  readonly maxSteps: number;
  readonly maxOutputTokens: number;
  readonly timeoutMs: number;
  readonly reasoning: "disabled" | "enabled" | "auto";
  readonly specialists: readonly {
    readonly role: "code" | "math" | "vision";
    readonly modelId: string;
    readonly reasoning: "disabled" | "enabled" | "auto";
  }[];
}

export class AgentHarness {
  private readonly active = new Map<string, AbortController>();

  constructor(
    private readonly runs: AgentRunStorePort,
    private readonly model: ModelPort,
    private readonly tools: AgentToolPort,
    private readonly capabilityRouter: AgentCapabilityRouterPort,
    private readonly skills: () => Promise<readonly AgentSkill[]>,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly options: AgentHarnessOptions,
  ) {}

  async start(
    request: { readonly sessionId: string; readonly prompt: string },
    access: AccessContext,
  ): Promise<AgentRunRecord> {
    const now = this.clock.now();
    const run = await this.runs.create(
      {
        runId: this.ids.next("run"),
        projectId: access.projectId,
        actorId: access.actorId,
        sessionId: request.sessionId,
        prompt: request.prompt,
        status: "running",
        createdAt: now,
        updatedAt: now,
      },
      access,
    );
    const controller = new AbortController();
    this.active.set(run.runId, controller);
    void this.execute(run, access, controller).finally(() => {
      this.active.delete(run.runId);
    });
    return run;
  }

  async get(runId: string, access: AccessContext): Promise<AgentRunRecord> {
    const run = await this.runs.get(runId, access);
    if (!run) throw new DomainError("NOT_FOUND", "Agent run not found");
    return run;
  }

  list(
    access: AccessContext,
    options: { readonly sessionId?: string; readonly limit: number },
  ) {
    return this.runs.list(access, options);
  }

  events(runId: string, after: number, access: AccessContext) {
    return this.runs.events(runId, after, access);
  }

  async cancel(runId: string, access: AccessContext): Promise<AgentRunRecord> {
    const run = await this.get(runId, access);
    if (run.status !== "running") return run;
    this.active.get(runId)?.abort();
    return this.runs.finish(
      runId,
      "cancelled",
      "Cancelled by the user.",
      this.clock.now(),
      access,
    );
  }

  private async execute(
    run: AgentRunRecord,
    access: AccessContext,
    controller: AbortController,
  ): Promise<void> {
    const rootId = this.ids.next("trace");
    const transcript: { tool: string; arguments: Json; result: Json }[] = [];
    let previousNode = rootId;
    let recoveryCount = 0;
    try {
      await this.trace(
        run.runId,
        rootId,
        undefined,
        "run",
        "Agent run",
        "running",
        { prompt: run.prompt },
        access,
      );
      const [catalog, skills] = await Promise.all([
        this.tools.catalog(),
        this.skills(),
      ]);
      const routeNode = this.ids.next("trace");
      await this.trace(
        run.runId,
        routeNode,
        rootId,
        "model",
        "Route capabilities (Julia-1)",
        "running",
        { modelId: "julia-1", reasoning: "disabled" },
        access,
      );
      const capabilityRoute = await this.routeCapabilities(
        run,
        controller.signal,
      );
      await this.trace(
        run.runId,
        routeNode,
        rootId,
        "model",
        "Route capabilities (Julia-1)",
        "completed",
        {
          modelId: "julia-1",
          modelVersion: capabilityRoute.modelVersion,
          capabilities: capabilityRoute.capabilities,
          probabilities: capabilityRoute.probabilities,
        },
        access,
      );
      previousNode = routeNode;
      const selectSkillNode = this.ids.next("trace");
      await this.trace(
        run.runId,
        selectSkillNode,
        routeNode,
        "model",
        `Select skill (${this.options.selectorModelId})`,
        "running",
        {
          modelId: this.options.selectorModelId,
          reasoning: "disabled",
        },
        access,
      );
      let skillRoute = await this.selectSkill(
        run,
        skills,
        capabilityRoute,
        controller.signal,
      );
      await this.trace(
        run.runId,
        selectSkillNode,
        routeNode,
        "model",
        `Select skill (${this.options.selectorModelId})`,
        "completed",
        {
          modelId: this.options.selectorModelId,
          skillId: skillRoute.skill?.id ?? null,
          reason: skillRoute.reason,
          reasoning: "disabled",
        },
        access,
      );
      previousNode = selectSkillNode;
      if (skillRoute.skill) {
        const skillNode = this.ids.next("trace");
        await this.trace(
          run.runId,
          skillNode,
          selectSkillNode,
          "skill",
          skillRoute.skill.title,
          "completed",
          {
            skillId: skillRoute.skill.id,
            version: skillRoute.skill.version,
          },
          access,
        );
        previousNode = skillNode;
      }
      const stepLimit = this.options.maxSteps;
      for (let step = 1; step <= stepLimit; step += 1) {
        if (controller.signal.aborted)
          throw new DomainError("CANCELLED", "Agent run was cancelled");
        const modelNode = this.ids.next("trace");
        await this.trace(
          run.runId,
          modelNode,
          previousNode,
          "model",
          `Plan step ${step}`,
          "running",
          {
            step,
            modelId: this.options.modelId,
            reasoning: this.options.reasoning,
          },
          access,
        );
        const decision = await this.plan(
          run,
          catalog,
          skillRoute.skill,
          skillRoute.route,
          transcript,
          controller.signal,
        );
        await this.trace(
          run.runId,
          modelNode,
          previousNode,
          "model",
          `Plan step ${step}`,
          decision.type === "invalid" ? "failed" : "completed",
          {
            step,
            modelId: this.options.modelId,
            reasoning: this.options.reasoning,
            decision: decision.type,
            summary: decision.summary,
            ...(decision.type === "tool" ? { tool: decision.tool } : {}),
            ...(decision.type === "delegate" ? { role: decision.role } : {}),
          },
          access,
        );
        if (decision.type === "invalid") {
          const failure: Json = {
            error: true,
            code: "INVALID_DECISION",
            message:
              "Controller output did not satisfy the required decision schema. Return one valid tool, delegate, or answer decision.",
            output: decision.output,
          };
          transcript.push({
            tool: "harness.invalid-model-output",
            arguments: {},
            result: failure,
          });
          recoveryCount += 1;
          ({ skillRoute, previousNode } = await this.rerouteAfterFailure(
            run,
            rootId,
            modelNode,
            failure,
            skills,
            recoveryCount,
            access,
            controller.signal,
          ));
          continue;
        }
        if (decision.type === "answer") {
          const reviewNode = this.ids.next("trace");
          await this.trace(
            run.runId,
            reviewNode,
            modelNode,
            "model",
            "Verify completion",
            "running",
            {
              step,
              modelId: this.options.modelId,
              reasoning: this.options.reasoning,
            },
            access,
          );
          const activeSkill = skillRoute.skill;
          const successfulSkillEvidence =
            !activeSkill ||
            transcript.some(
              (entry) =>
                activeSkill.tools.includes(entry.tool) &&
                !isFailedObservation(entry.result),
            );
          if (!successfulSkillEvidence) {
            const feedback =
              "The selected skill has no successful tool observation yet; follow its workflow before answering.";
            await this.trace(
              run.runId,
              reviewNode,
              modelNode,
              "model",
              "Verify completion",
              "failed",
              {
                accepted: false,
                modelId: this.options.modelId,
                feedback,
                requiresMoreEvidence: true,
              },
              access,
            );
            transcript.push({
              tool: "harness.answer-review",
              arguments: { proposedAnswer: decision.content },
              result: {
                accepted: false,
                feedback,
                requiresMoreEvidence: true,
              },
            });
            recoveryCount += 1;
            ({ skillRoute, previousNode } = await this.rerouteAfterFailure(
              run,
              rootId,
              reviewNode,
              {
                error: true,
                code: "ANSWER_REJECTED",
                feedback,
                proposedAnswer: decision.content,
              },
              skills,
              recoveryCount,
              access,
              controller.signal,
            ));
            continue;
          }
          const review = await this.reviewAnswer(
            run,
            skillRoute.skill,
            transcript,
            decision.content,
            controller.signal,
          );
          await this.trace(
            run.runId,
            reviewNode,
            modelNode,
            "model",
            "Verify completion",
            review.accepted ? "completed" : "failed",
            {
              accepted: review.accepted,
              modelId: this.options.modelId,
              feedback: review.feedback,
              requiresMoreEvidence: review.requiresMoreEvidence,
            },
            access,
          );
          if (!review.accepted) {
            transcript.push({
              tool: "harness.answer-review",
              arguments: { proposedAnswer: decision.content },
              result: {
                accepted: false,
                feedback: review.feedback,
                requiresMoreEvidence: review.requiresMoreEvidence,
              },
            });
            recoveryCount += 1;
            ({ skillRoute, previousNode } = await this.rerouteAfterFailure(
              run,
              rootId,
              reviewNode,
              {
                error: true,
                code: "ANSWER_REJECTED",
                feedback: review.feedback,
                requiresMoreEvidence: review.requiresMoreEvidence,
                proposedAnswer: decision.content,
              },
              skills,
              recoveryCount,
              access,
              controller.signal,
            ));
            continue;
          }
          const resultNode = this.ids.next("trace");
          await this.trace(
            run.runId,
            resultNode,
            reviewNode,
            "result",
            "Final response",
            "completed",
            { content: decision.content },
            access,
          );
          await this.trace(
            run.runId,
            rootId,
            undefined,
            "run",
            "Agent run",
            "completed",
            { steps: step },
            access,
          );
          await this.runs.finish(
            run.runId,
            "completed",
            decision.content,
            this.clock.now(),
            access,
          );
          return;
        }
        if (decision.type === "delegate") {
          const specialist = this.options.specialists.find(
            (candidate) =>
              candidate.role === decision.role &&
              skillRoute.route.capabilities[candidate.role],
          );
          if (!specialist)
            throw new DomainError(
              "CAPABILITY_UNAVAILABLE",
              `The ${decision.role} specialist is not enabled`,
            );
          const specialistNode = this.ids.next("trace");
          await this.trace(
            run.runId,
            specialistNode,
            modelNode,
            "model",
            `${decision.role} specialist`,
            "running",
            { modelId: specialist.modelId, task: decision.task },
            access,
          );
          const specialistResult = await this.runSpecialist(
            run,
            specialist,
            decision.task,
            transcript,
            controller.signal,
          );
          await this.trace(
            run.runId,
            specialistNode,
            modelNode,
            "model",
            `${decision.role} specialist`,
            "completed",
            { modelId: specialist.modelId, result: specialistResult },
            access,
          );
          transcript.push({
            tool: `specialist.${decision.role}`,
            arguments: { task: decision.task },
            result: compactObservation({
              modelId: specialist.modelId,
              text: specialistResult,
            }),
          });
          previousNode = specialistNode;
          continue;
        }
        if (!catalog.some((entry) => entry.id === decision.tool)) {
          const toolNode = this.ids.next("trace");
          const result: Json = {
            error: true,
            code: "UNAVAILABLE_TOOL",
            message: `Tool "${decision.tool}" is not available. Choose one exact tool id from availableToolIds.`,
            availableToolIds: catalog.map((entry) => entry.id),
          };
          await this.trace(
            run.runId,
            toolNode,
            modelNode,
            "tool",
            decision.tool,
            "failed",
            { arguments: decision.arguments, result },
            access,
          );
          transcript.push({
            tool: "harness.invalid-tool-proposal",
            arguments: {
              proposedTool: decision.tool,
              proposedArguments: decision.arguments,
            },
            result,
          });
          recoveryCount += 1;
          ({ skillRoute, previousNode } = await this.rerouteAfterFailure(
            run,
            rootId,
            toolNode,
            result,
            skills,
            recoveryCount,
            access,
            controller.signal,
          ));
          continue;
        }
        const parent = modelNode;
        const toolNode = this.ids.next("trace");
        await this.trace(
          run.runId,
          toolNode,
          parent,
          "tool",
          decision.tool,
          "running",
          { arguments: decision.arguments },
          access,
        );
        let result: Json;
        try {
          const repeatedFailure = transcript.find(
            (entry) =>
              entry.tool === decision.tool &&
              JSON.stringify(entry.arguments) ===
                JSON.stringify(decision.arguments) &&
              isFailedObservation(entry.result),
          );
          if (repeatedFailure) {
            throw new DomainError(
              "INVALID_OUTPUT",
              `An identical action already failed. Choose a different approach using the original diagnostic: ${JSON.stringify(repeatedFailure.result).slice(0, 8192)}`,
            );
          }
          result = await this.tools.execute(
            decision.tool,
            decision.arguments,
            controller.signal,
          );
          const failed = isFailedObservation(result);
          await this.trace(
            run.runId,
            toolNode,
            parent,
            "tool",
            decision.tool,
            failed ? "failed" : "completed",
            { result },
            access,
          );
        } catch (error: unknown) {
          const message =
            error instanceof Error ? error.message : "Tool execution failed";
          result = { error: true, message };
          await this.trace(
            run.runId,
            toolNode,
            parent,
            "tool",
            decision.tool,
            "failed",
            { result },
            access,
          );
        }
        transcript.push({
          tool: decision.tool,
          arguments: decision.arguments,
          result: compactObservation(result),
        });
        if (isFailedObservation(result)) {
          recoveryCount += 1;
          ({ skillRoute, previousNode } = await this.rerouteAfterFailure(
            run,
            rootId,
            toolNode,
            result,
            skills,
            recoveryCount,
            access,
            controller.signal,
          ));
        } else {
          previousNode = toolNode;
        }
      }
      throw new DomainError(
        "RESOURCE_EXHAUSTED",
        `Agent exceeded its ${stepLimit}-step bound`,
      );
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "Agent run failed";
      const status = controller.signal.aborted ? "cancelled" : "failed";
      await this.trace(
        run.runId,
        this.ids.next("trace"),
        previousNode,
        "error",
        status === "cancelled" ? "Cancelled" : "Run failed",
        "failed",
        { message },
        access,
      ).catch(() => undefined);
      await this.trace(
        run.runId,
        rootId,
        undefined,
        "run",
        "Agent run",
        "failed",
        { message },
        access,
      ).catch(() => undefined);
      await this.runs
        .finish(run.runId, status, message, this.clock.now(), access)
        .catch(() => undefined);
    }
  }

  private async rerouteAfterFailure(
    run: AgentRunRecord,
    rootId: string,
    failedNodeId: string,
    failure: Json,
    skills: readonly AgentSkill[],
    attempt: number,
    access: AccessContext,
    signal: AbortSignal,
  ): Promise<{ skillRoute: SkillRoute; previousNode: string }> {
    const recoveryNode = this.ids.next("trace");
    const routingGoal = [
      `ORIGINAL USER GOAL:\n${run.prompt}`,
      `FAILED ATTEMPT ${attempt}:\n${JSON.stringify(failure)}`,
      "Reclassify the capabilities and skill needed to recover from this failure and still fulfill the original goal. Preserve useful observations, do not repeat the failed approach, and do not treat the failure itself as task completion.",
    ].join("\n\n");
    await this.trace(
      run.runId,
      recoveryNode,
      rootId,
      "run",
      `Recovery route ${attempt}`,
      "running",
      { attempt, triggeredBy: failedNodeId, failure },
      access,
    );
    const routeNode = this.ids.next("trace");
    await this.trace(
      run.runId,
      routeNode,
      recoveryNode,
      "model",
      "Reclassify capabilities (Julia-1)",
      "running",
      {
        modelId: "julia-1",
        reasoning: "disabled",
        triggeredBy: failedNodeId,
      },
      access,
    );
    const capabilityRoute = await this.routeCapabilities(
      run,
      signal,
      routingGoal,
      `recovery-${attempt}`,
    );
    await this.trace(
      run.runId,
      routeNode,
      recoveryNode,
      "model",
      "Reclassify capabilities (Julia-1)",
      "completed",
      {
        modelId: "julia-1",
        modelVersion: capabilityRoute.modelVersion,
        capabilities: capabilityRoute.capabilities,
        probabilities: capabilityRoute.probabilities,
        triggeredBy: failedNodeId,
      },
      access,
    );
    const selectSkillNode = this.ids.next("trace");
    await this.trace(
      run.runId,
      selectSkillNode,
      routeNode,
      "model",
      `Reselect skill (${this.options.selectorModelId})`,
      "running",
      {
        modelId: this.options.selectorModelId,
        reasoning: "disabled",
        triggeredBy: failedNodeId,
      },
      access,
    );
    const skillRoute = await this.selectSkill(
      run,
      skills,
      capabilityRoute,
      signal,
      routingGoal,
      `recovery-${attempt}`,
    );
    await this.trace(
      run.runId,
      selectSkillNode,
      routeNode,
      "model",
      `Reselect skill (${this.options.selectorModelId})`,
      "completed",
      {
        modelId: this.options.selectorModelId,
        skillId: skillRoute.skill?.id ?? null,
        reason: skillRoute.reason,
        reasoning: "disabled",
        triggeredBy: failedNodeId,
      },
      access,
    );
    let previousNode = selectSkillNode;
    if (skillRoute.skill) {
      const skillNode = this.ids.next("trace");
      await this.trace(
        run.runId,
        skillNode,
        selectSkillNode,
        "skill",
        skillRoute.skill.title,
        "completed",
        {
          skillId: skillRoute.skill.id,
          version: skillRoute.skill.version,
          recoveryAttempt: attempt,
        },
        access,
      );
      previousNode = skillNode;
    }
    await this.trace(
      run.runId,
      recoveryNode,
      rootId,
      "run",
      `Recovery route ${attempt}`,
      "completed",
      {
        attempt,
        triggeredBy: failedNodeId,
        failure,
        skillId: skillRoute.skill?.id ?? null,
        capabilities: skillRoute.route.capabilities,
      },
      access,
    );
    return { skillRoute, previousNode };
  }

  private async routeCapabilities(
    run: AgentRunRecord,
    signal: AbortSignal,
    goal = run.prompt,
    requestSuffix = "initial",
  ): Promise<AgentCapabilityRoute> {
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    return this.capabilityRouter.route(
      {
        requestId: `${run.runId}-capability-route-${requestSuffix}`,
        taskId: run.runId,
        goal,
        deadlineUtc: new Date(
          Date.now() + this.options.timeoutMs,
        ).toISOString(),
      },
      combined,
    );
  }

  private async selectSkill(
    run: AgentRunRecord,
    skills: readonly AgentSkill[],
    route: AgentCapabilityRoute,
    signal: AbortSignal,
    goal = run.prompt,
    requestSuffix = "initial",
  ): Promise<SkillRoute> {
    const prompt = [
      "Select at most one versioned skill methodology for this user goal. This is a finite selection step, not task execution.",
      'Return ONLY JSON: {"skillId":"available-id-or-null","reason":"brief semantic reason"}. Select by the supplied descriptions, not keyword memorization. A skill guides the later controller but never changes permissions.',
      `ROUTING GOAL AND CONTEXT:\n${goal}`,
      `JULIA CAPABILITY ADVICE:\n${JSON.stringify(route)}`,
      `AVAILABLE SKILLS:\n${JSON.stringify(
        skills.map((skill) => ({
          id: skill.id,
          title: skill.title,
          description: skill.description,
          completionChecks: skill.completionChecks,
        })),
      )}`,
    ].join("\n\n");
    const output: string[] = [];
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    for await (const event of this.model.generate(
      {
        requestId: `${run.runId}-skill-selection-${requestSuffix}`,
        modelId: this.options.selectorModelId,
        prompt,
        maxOutputTokens: this.options.maxOutputTokens,
        deadlineUtc: new Date(
          Date.now() + this.options.timeoutMs,
        ).toISOString(),
        allowedTools: [],
        responseFormat: "json",
        responseSchema: {
          type: "object",
          properties: {
            skillId: {
              enum: [null, ...skills.map((skill) => skill.id)],
            },
            reason: { type: "string" },
          },
          required: ["skillId", "reason"],
          additionalProperties: false,
        },
        reasoning: "disabled",
      },
      combined,
    )) {
      if (event.type === "text_delta") output.push(event.text);
      if (event.type === "error")
        throw new DomainError("INVALID_OUTPUT", event.message);
    }
    const raw = output.join("").trim();
    const objectText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    try {
      const value = JSON.parse(objectText) as Record<string, unknown>;
      const reason =
        typeof value.reason === "string"
          ? value.reason
          : "First-stage Qwen skill selection";
      if (typeof value.skillId === "string") {
        const skill = skills.find(
          (candidate) => candidate.id === value.skillId,
        );
        if (skill) return { skill, route, reason };
      }
      if (value.skillId === null || value.skillId === "null")
        return { route, reason };
    } catch {
      // Invalid selection falls through to the generic controller.
    }
    return {
      route,
      reason:
        "No valid skill selection was returned; the generic controller remains available.",
    };
  }

  private async plan(
    run: AgentRunRecord,
    catalog: readonly AgentToolDefinition[],
    activeSkill: AgentSkill | undefined,
    capabilityRoute: AgentCapabilityRoute,
    transcript: readonly { tool: string; arguments: Json; result: Json }[],
    signal: AbortSignal,
  ): Promise<AgentDecision> {
    const availableToolIds = catalog.map((tool) => tool.id);
    const availableSpecialists = this.options.specialists.filter(
      (specialist) => capabilityRoute.capabilities[specialist.role],
    );
    const prompt = [
      "You are the controller of a real local computer agent. Choose exactly one next action.",
      'Return ONLY one JSON object. For a tool action, include type="tool", tool=<one exact AVAILABLE TOOL ID>, arguments=<a JSON object satisfying that tool inputSchema>, summary=<a brief reason>, and optionally skillId=<the active skill id>. The tool field must exactly match one value in AVAILABLE TOOL IDS; placeholders such as "id" or invented tool names are invalid. An empty arguments object is valid only when the selected tool inputSchema has no required fields.',
      'For a specialist action, include type="delegate", role=<one enabled code, math, or vision role>, task=<the concrete bounded question plus necessary context>, and summary=<a brief reason>. Specialists advise; they do not execute host tools or finish the user request.',
      'For a final action, include type="answer", content=<the actual user-facing answer grounded in OBSERVATIONS>, and summary=<a brief explanation of why the goal is complete>. Do not emit field descriptions, angle-bracket notation, or instruction examples as values.',
      "The ACTIVE SKILL is mandatory when selected: on the first plan step execute its first workflow instruction, then follow the remaining workflow and satisfy every completion check before answering. Never claim an action succeeded unless its result appears in OBSERVATIONS. Use tools for current, external, or computer-state facts instead of memory. An observation with error:true, ok:false, a non-zero exitCode, or missing requested data is a failed attempt and does not satisfy the goal. Match the exact requested quantity, units, subject, and output shape rather than substituting related information. Search results are discovery: when they contain only directories or links instead of requested content, continue searching or inspect/retrieve a source. Treat harness.answer-review feedback as an unmet completion condition and correct it. If the latest answer review has requiresMoreEvidence:true, the next action must gather evidence with a tool rather than propose another answer. Prefer inspecting before changing.",
      `USER GOAL:\n${run.prompt}`,
      `AVAILABLE TOOL IDS:\n${JSON.stringify(availableToolIds)}`,
      `TOOLS:\n${JSON.stringify(catalog)}`,
      `ENABLED SPECIALISTS FOR THIS JULIA ROUTE:\n${JSON.stringify(availableSpecialists)}`,
      `JULIA CAPABILITY ADVICE:\n${JSON.stringify(capabilityRoute)}`,
      `ACTIVE SKILL:\n${JSON.stringify(activeSkill ?? null)}`,
      `OBSERVATIONS:\n${JSON.stringify(transcript.slice(-8))}`,
    ].join("\n\n");
    const output: string[] = [];
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    for await (const event of this.model.generate(
      {
        requestId: `${run.runId}-${transcript.length + 1}`,
        modelId: this.options.modelId,
        prompt,
        maxOutputTokens: this.options.maxOutputTokens,
        deadlineUtc: new Date(
          Date.now() + this.options.timeoutMs,
        ).toISOString(),
        allowedTools: catalog.map((tool) => tool.id),
        responseFormat: "json",
        responseSchema: decisionSchema(
          catalog,
          availableSpecialists.map((specialist) => specialist.role),
        ),
        reasoning: this.options.reasoning,
      },
      combined,
    )) {
      if (event.type === "text_delta") output.push(event.text);
      if (event.type === "error")
        throw new DomainError("INVALID_OUTPUT", event.message);
    }
    const raw = output.join("").trim();
    const objectText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    try {
      const value = JSON.parse(objectText) as Record<string, unknown>;
      if (value.type === "answer" && typeof value.content === "string") {
        return {
          type: "answer",
          content: value.content,
          summary:
            typeof value.summary === "string"
              ? value.summary
              : "Model completed the task",
        };
      }
      if (
        value.type === "delegate" &&
        (value.role === "code" ||
          value.role === "math" ||
          value.role === "vision") &&
        typeof value.task === "string"
      ) {
        return {
          type: "delegate",
          role: value.role,
          task: value.task,
          summary:
            typeof value.summary === "string"
              ? value.summary
              : `Consult ${value.role} specialist`,
        };
      }
      if (
        value.type === "tool" &&
        typeof value.tool === "string" &&
        value.arguments !== undefined
      ) {
        return {
          type: "tool",
          tool: value.tool,
          arguments: value.arguments as Json,
          summary:
            typeof value.summary === "string"
              ? value.summary
              : "Model selected a tool",
          ...(typeof value.skillId === "string"
            ? { skillId: value.skillId }
            : {}),
        };
      }
    } catch {
      // A text-only local model can still answer directly if it declines the JSON envelope.
    }
    return {
      type: "invalid",
      output: raw.slice(0, 8_192),
      summary: "Controller output did not match the decision schema",
    };
  }

  private async runSpecialist(
    run: AgentRunRecord,
    specialist: {
      readonly role: "code" | "math" | "vision";
      readonly modelId: string;
      readonly reasoning: "disabled" | "enabled" | "auto";
    },
    task: string,
    transcript: readonly { tool: string; arguments: Json; result: Json }[],
    signal: AbortSignal,
  ): Promise<string> {
    const prompt = [
      `You are the ${specialist.role} specialist in a local agent architecture.`,
      "Answer only the bounded delegated task. State assumptions and uncertainty. Do not claim to execute host tools, modify state, or complete the overall user request. Return evidence or a recommendation to the controller.",
      `OVERALL USER GOAL:\n${run.prompt}`,
      `DELEGATED TASK:\n${task}`,
      `RELEVANT OBSERVATIONS:\n${JSON.stringify(transcript.slice(-6))}`,
    ].join("\n\n");
    const output: string[] = [];
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    for await (const event of this.model.generate(
      {
        requestId: `${run.runId}-specialist-${specialist.role}-${transcript.length + 1}`,
        modelId: specialist.modelId,
        prompt,
        maxOutputTokens: this.options.maxOutputTokens,
        deadlineUtc: new Date(
          Date.now() + this.options.timeoutMs,
        ).toISOString(),
        allowedTools: [],
        reasoning: specialist.reasoning,
      },
      combined,
    )) {
      if (event.type === "text_delta") output.push(event.text);
      if (event.type === "error")
        throw new DomainError("INVALID_OUTPUT", event.message);
    }
    const result = output.join("").trim();
    if (!result)
      throw new DomainError(
        "INVALID_OUTPUT",
        `${specialist.role} specialist returned no text`,
      );
    return result;
  }

  private async reviewAnswer(
    run: AgentRunRecord,
    activeSkill: AgentSkill | undefined,
    transcript: readonly { tool: string; arguments: Json; result: Json }[],
    proposedAnswer: string,
    signal: AbortSignal,
  ): Promise<{
    readonly accepted: boolean;
    readonly requiresMoreEvidence: boolean;
    readonly feedback: string;
  }> {
    const prompt = [
      "You are the strict completion verifier for a general-purpose computer agent.",
      'Return ONLY JSON with these fields: {"accepted":boolean,"requiresMoreEvidence":boolean,"feedback":"brief reason or what remains missing"}. Evaluate the current proposed answer independently using all observations. Set requiresMoreEvidence true only when the observations genuinely lack facts needed to fulfill the goal. Set it false when the needed facts are already present and the answer merely selected the wrong subset, exceeded the requested scope, omitted available relevant facts, or used the wrong formatting. A previous review is feedback, not evidence and not a permanent lock.',
      "Accept only when the proposed answer directly fulfills the user's exact request, every current or external claim is supported by a successful observation, and every ACTIVE SKILL completion check is visibly satisfied. Check subject, requested quantity, units, freshness, output shape, and completeness. Blank fields are unknown, not zero; tabular values belong only to their aligned columns; cumulative quantities are not current rates; related specifications are not measurements; source or directory lists are not substitutes for requested source content. Failed observations do not support an answer. Do not accept an inability claim merely because one command, property, source, or approach failed. In particular, malformed command syntax while an unrestricted shell remains available is not evidence that the overall capability is unavailable. Accept inability only when observations establish an actual capability or authorization block after reasonable alternatives. If rejecting, set requiresMoreEvidence true when a completion check or evidence requirement is unmet, state that the goal remains unmet, and describe the gap without prescribing a specific tool or command.",
      `USER GOAL:\n${run.prompt}`,
      `ACTIVE SKILL:\n${JSON.stringify(activeSkill ?? null)}`,
      `OBSERVATIONS:\n${JSON.stringify(transcript.slice(-8))}`,
      `PROPOSED ANSWER:\n${proposedAnswer}`,
    ].join("\n\n");
    const output: string[] = [];
    const timeout = AbortSignal.timeout(this.options.timeoutMs);
    const combined = AbortSignal.any([signal, timeout]);
    for await (const event of this.model.generate(
      {
        requestId: `${run.runId}-review-${transcript.length + 1}`,
        modelId: this.options.modelId,
        prompt,
        maxOutputTokens: this.options.maxOutputTokens,
        deadlineUtc: new Date(
          Date.now() + this.options.timeoutMs,
        ).toISOString(),
        allowedTools: [],
        responseFormat: "json",
        responseSchema: {
          type: "object",
          properties: {
            accepted: { type: "boolean" },
            requiresMoreEvidence: { type: "boolean" },
            feedback: { type: "string" },
          },
          required: ["accepted", "requiresMoreEvidence", "feedback"],
          additionalProperties: false,
        },
        reasoning: this.options.reasoning,
      },
      combined,
    )) {
      if (event.type === "text_delta") output.push(event.text);
      if (event.type === "error")
        throw new DomainError("INVALID_OUTPUT", event.message);
    }
    const raw = output.join("").trim();
    const objectText = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    try {
      const value = JSON.parse(objectText) as Record<string, unknown>;
      if (typeof value.accepted === "boolean") {
        return {
          accepted: value.accepted,
          requiresMoreEvidence:
            typeof value.requiresMoreEvidence === "boolean"
              ? value.requiresMoreEvidence
              : !value.accepted,
          feedback:
            typeof value.feedback === "string"
              ? value.feedback
              : value.accepted
                ? "Answer satisfies the goal"
                : "Answer does not yet satisfy the goal",
        };
      }
    } catch {
      // A malformed review is not evidence that the proposed answer is complete.
    }
    return {
      accepted: false,
      requiresMoreEvidence: true,
      feedback:
        "Completion review was invalid; re-check the goal and evidence.",
    };
  }

  private trace(
    runId: string,
    nodeId: string,
    parentNodeId: string | undefined,
    kind: "run" | "model" | "skill" | "tool" | "result" | "error",
    label: string,
    status: "running" | "completed" | "failed",
    data: Json,
    access: AccessContext,
  ) {
    return this.runs.append(
      {
        runId,
        nodeId,
        ...(parentNodeId ? { parentNodeId } : {}),
        kind,
        label,
        status,
        data,
        createdAt: this.clock.now(),
      },
      access,
    );
  }
}

function isFailedObservation(value: Json): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const observation = value as Record<string, Json>;
  return (
    observation.error === true ||
    observation.ok === false ||
    (typeof observation.exitCode === "number" && observation.exitCode !== 0)
  );
}

function compactObservation(value: Json): Json {
  if (typeof value === "string") {
    if (value.length <= 12_000) return value;
    return `${value.slice(0, 9_000)}\n...[tool output truncated for model context; full output remains in the trace]...\n${value.slice(-3_000)}`;
  }
  if (Array.isArray(value)) {
    const retained = value.slice(0, 40).map(compactObservation);
    return value.length > retained.length
      ? [
          ...retained,
          `[${value.length - retained.length} additional items omitted from model context]`,
        ]
      : retained;
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        compactObservation(child),
      ]),
    );
  }
  return value;
}

function decisionSchema(
  catalog: readonly AgentToolDefinition[],
  specialistRoles: readonly ("code" | "math" | "vision")[],
): Json {
  const toolDecisions = catalog.map((tool) => ({
    type: "object",
    properties: {
      type: { enum: ["tool"] },
      tool: { enum: [tool.id] },
      arguments: tool.inputSchema,
      summary: { type: "string" },
      skillId: { type: "string" },
    },
    required: ["type", "tool", "arguments", "summary"],
    additionalProperties: false,
  }));
  const delegateDecisions =
    specialistRoles.length > 0
      ? [
          {
            type: "object",
            properties: {
              type: { enum: ["delegate"] },
              role: { enum: [...specialistRoles] },
              task: { type: "string" },
              summary: { type: "string" },
            },
            required: ["type", "role", "task", "summary"],
            additionalProperties: false,
          },
        ]
      : [];
  return {
    oneOf: [
      ...toolDecisions,
      ...delegateDecisions,
      {
        type: "object",
        properties: {
          type: { enum: ["answer"] },
          content: { type: "string" },
          summary: { type: "string" },
        },
        required: ["type", "content", "summary"],
        additionalProperties: false,
      },
    ],
  };
}

import assert from "node:assert/strict";
import test from "node:test";

import { AgentHarness } from "../../packages/core/dist/index.js";

test("agent harness feeds an unavailable tool proposal back for replanning", async () => {
  const runs = new MemoryAgentRunStore();
  const prompts = [];
  const requests = [];
  const routeRequests = [];
  const executed = [];
  const model = {
    async capabilities() {
      return {
        text: true,
        image: false,
        tools: false,
        structuredOutput: true,
        maxContextTokens: 4096,
      };
    },
    async countInput(_modelId, prompt) {
      return prompt.length;
    },
    async *generate(request, signal) {
      signal.throwIfAborted();
      requests.push(request);
      prompts.push(request.prompt);
      let text;
      if (request.requestId.includes("-skill-selection-")) {
        text = '{"skillId":null,"reason":"generic task"}';
      } else if (request.requestId.includes("-review-")) {
        text =
          '{"accepted":true,"requiresMoreEvidence":false,"feedback":"grounded"}';
      } else if (request.prompt.includes('"tool":"command.run"')) {
        text =
          '{"type":"answer","content":"Observed result","summary":"complete"}';
      } else if (request.prompt.includes("harness.invalid-tool-proposal")) {
        text =
          '{"type":"tool","tool":"command.run","arguments":{"command":"portable probe"},"summary":"retry with a catalog tool"}';
      } else {
        text =
          '{"type":"tool","tool":"id","arguments":{},"summary":"bad placeholder proposal"}';
      }
      yield { type: "text_delta", text };
      yield { type: "done", finish: "stop", inputTokens: 1, outputTokens: 1 };
    },
  };
  const harness = new AgentHarness(
    runs,
    model,
    {
      async catalog() {
        return [
          {
            id: "command.run",
            title: "Run command",
            description: "Execute a command through the host shell",
            inputSchema: { type: "object" },
            source: "host",
          },
        ];
      },
      async execute(toolId, arguments_) {
        executed.push({ toolId, arguments: arguments_ });
        return { exitCode: 0, stdout: "observed" };
      },
    },
    {
      async route(request) {
        routeRequests.push(request);
        return {
          modelVersion: "test-router",
          capabilities: { code: true, math: false, vision: false },
          probabilities: { code: 0.9, math: 0.1, vision: 0 },
        };
      },
    },
    async () => [],
    new IncrementingIds(),
    { now: () => new Date().toISOString() },
    {
      modelId: "test-controller",
      selectorModelId: "qwen3.5-0.8b-test",
      maxSteps: 4,
      maxOutputTokens: 4096,
      timeoutMs: 5_000,
      reasoning: "enabled",
      specialists: [
        {
          role: "code",
          modelId: "test-controller",
          reasoning: "enabled",
        },
        {
          role: "math",
          modelId: "test-math",
          reasoning: "enabled",
        },
      ],
    },
  );
  const access = { projectId: "project-a", actorId: "actor-a" };
  const started = await harness.start(
    { sessionId: "session-a", prompt: "Inspect the current system" },
    access,
  );
  const completed = await waitForFinishedRun(runs, started.runId, access);
  const events = await runs.events(started.runId, 0, access);

  assert.equal(completed.status, "completed", completed.result);
  assert.equal(completed.result, "Observed result");
  assert.equal(routeRequests.length, 2);
  assert.match(routeRequests[1].goal, /UNAVAILABLE_TOOL/u);
  assert.match(routeRequests[1].goal, /ORIGINAL USER GOAL/u);
  const selectionRequest = requests.find((request) =>
    request.requestId.includes("-skill-selection-"),
  );
  assert.equal(selectionRequest.modelId, "qwen3.5-0.8b-test");
  assert.equal(selectionRequest.reasoning, "disabled");
  assert.ok(
    requests
      .filter(
        (request) =>
          !request.requestId.includes("-skill-selection-") &&
          !request.requestId.includes("-review-"),
      )
      .every((request) => request.modelId === "test-controller"),
  );
  assert.deepEqual(executed, [
    { toolId: "command.run", arguments: { command: "portable probe" } },
  ]);
  assert.ok(
    events.some(
      (event) =>
        event.kind === "tool" &&
        event.label === "id" &&
        event.status === "failed" &&
        event.data.result.code === "UNAVAILABLE_TOOL",
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === "run" &&
        event.label === "Recovery route 1" &&
        event.status === "completed" &&
        event.data.triggeredBy,
    ),
  );
  assert.ok(
    events.some(
      (event) =>
        event.kind === "model" &&
        event.label.startsWith("Plan step") &&
        event.data.modelId === "test-controller",
    ),
  );
  const planningPrompt = prompts.find((prompt) =>
    prompt.includes("AVAILABLE TOOL IDS"),
  );
  assert.ok(planningPrompt);
  assert.match(planningPrompt, /AVAILABLE TOOL IDS:\n\["command\.run",/u);
  assert.doesNotMatch(planningPrompt, /"tool":"id"/u);
  assert.doesNotMatch(planningPrompt, /"final user-facing answer"/u);
  assert.doesNotMatch(planningPrompt, /"why complete"/u);
  const planningRequest = requests.find((request) =>
    request.prompt.includes("AVAILABLE TOOL IDS"),
  );
  const decisionContract = JSON.stringify(planningRequest.responseSchema);
  assert.match(decisionContract, /"code"/u);
  assert.match(decisionContract, /"math"/u); // Router advice cannot hide enabled capabilities.
});

class IncrementingIds {
  value = 0;

  next(prefix) {
    this.value += 1;
    return `${prefix}_${this.value}`;
  }
}

class MemoryAgentRunStore {
  runs = new Map();
  traceEvents = [];

  async create(run) {
    this.runs.set(run.runId, run);
    return run;
  }

  async get(runId) {
    return this.runs.get(runId);
  }

  async list(_access, options) {
    return [...this.runs.values()]
      .filter(
        (run) => !options.sessionId || run.sessionId === options.sessionId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
      .slice(0, options.limit);
  }

  async append(event) {
    const recorded = { ...event, sequence: this.traceEvents.length + 1 };
    this.traceEvents.push(recorded);
    return recorded;
  }

  async events(runId, afterSequence) {
    return this.traceEvents.filter(
      (event) => event.runId === runId && event.sequence > afterSequence,
    );
  }

  async finish(runId, status, result, now) {
    const current = this.runs.get(runId);
    const finished = { ...current, status, result, updatedAt: now };
    this.runs.set(runId, finished);
    return finished;
  }
}

async function waitForFinishedRun(runs, runId, access) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const run = await runs.get(runId, access);
    if (run?.status !== "running") return run;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.fail("Agent run did not finish");
}

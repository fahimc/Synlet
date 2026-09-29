export const testProfile = {
  schemaVersion: "synlet.profile/v1",
  mode: "local",
  server: { host: "127.0.0.1", port: 43127 },
  inference: {
    baseUrl: "http://127.0.0.1:43128",
    apiKey: "synlet-internal-local",
  },
  ui: { evidenceLabel: "MEASURED" },
  paths: {
    dataRoot: "runtime-data",
    workspaceRoot: "runtime-data/workspace",
    modelRoot: "model-weights",
    modelsLock: "config/models.lock.json",
    runtimeLock: "config/runtime.lock.json",
    llamaExecutable: "runtime/llama/llama-server.exe",
    pythonExecutable: "services/python-worker/.venv/Scripts/python.exe",
    browserExecutable:
      "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  },
  limits: {
    maxPendingTasks: 16,
    maxSourceBytes: 1024 * 1024,
    maxToolReadBytes: 64 * 1024,
  },
  context: {
    maxLookupRounds: 3,
    defaultInputTokens: 4096,
    generationReserveTokens: 512,
    safetyTokens: 256,
  },
  scheduler: {
    gpuMemoryMiB: 12_288,
    maxPendingInferenceJobs: 16,
  },
};

export const testModel = {
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
    return prompt.split(/\s+/u).filter(Boolean).length;
  },
  async *generate(request, signal) {
    signal.throwIfAborted();
    let text = `TEST: ${request.prompt}`;
    if (request.requestId.includes("-skill-selection-")) text = JSON.stringify({skillId:null,reason:"test fixture"});
    else if (request.requestId.includes("-review-")) text = JSON.stringify({accepted:true,requiresMoreEvidence:false,feedback:"test fixture only"});
    else if (request.responseSchema?.oneOf) text = JSON.stringify({type:"answer",content:"TEST: scripted response",summary:"test fixture only"});
    else if (request.requestId.startsWith("compact-")) {
      const lines=JSON.parse(request.prompt.slice(request.prompt.lastIndexOf("\n\n")+2));
      text=JSON.stringify({lineIds:lines.slice(0,1).map(line=>line.id)});
    }
    yield { type: "text_delta", text };
    yield {
      type: "done",
      finish: "stop",
      inputTokens: request.prompt.split(/\s+/u).filter(Boolean).length,
      outputTokens: text.split(/\s+/u).filter(Boolean).length,
    };
  },
};

export function testServices(overrides = {}) {
  return { model: testModel, modelId: "qwen3-4b-q4-k-m",
    capabilityRouter: { route: async () => ({modelVersion:"TEST_ONLY",capabilities:{code:false,math:false,vision:false},probabilities:{code:0,math:0,vision:0}}) },
    agentTools: {catalog:async()=>[],execute:async()=>{throw Error("No fake tools enabled")}},
    ...overrides };
}

export function authHeaders(projectId = "project-a", actorId = "actor-a") {
  return {
    authorization: "Bearer test-token",
    "x-synlet-project-id": projectId,
    "x-synlet-actor-id": actorId,
  };
}

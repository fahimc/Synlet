import type {
  AccessContext,
  ChatMessage,
  ImageInput,
  Json,
  RetrievedChunk,
  SourceRef,
  TaskEventRecord,
  TaskRecord,
  TaskStatus,
} from "../domain/types.js";

export interface ClockPort {
  now(): string;
}

export interface IdPort {
  next(prefix: string): string;
}

export interface HashPort {
  canonical(value: unknown): Promise<string>;
}

export interface TaskStorePort {
  intake(
    input: {
      readonly taskId: string;
      readonly requestHash: string;
      readonly idempotencyKey: string;
      readonly sessionId: string;
      readonly prompt: string;
      readonly now: string;
      readonly maxPending: number;
    },
    access: AccessContext,
  ): Promise<
    | { readonly kind: "created"; readonly task: TaskRecord }
    | { readonly kind: "duplicate"; readonly task: TaskRecord }
    | { readonly kind: "conflict" }
    | { readonly kind: "capacity" }
  >;
  get(taskId: string, access: AccessContext): Promise<TaskRecord | undefined>;
  commit(
    input: {
      readonly taskId: string;
      readonly expectedRevision: number;
      readonly nextStatus: TaskStatus;
      readonly result?: string;
      readonly eventType: string;
      readonly eventData: Json;
      readonly outbox: readonly Json[];
      readonly now: string;
    },
    access: AccessContext,
  ): Promise<TaskRecord>;
  events(
    taskId: string,
    afterSequence: number,
    limit: number,
    access: AccessContext,
  ): Promise<readonly TaskEventRecord[]>;
}

export interface ActionRecord {
  readonly actionId: string;
  readonly approvalId: string;
  readonly taskId: string;
  readonly taskRevision: number;
  readonly toolId: string;
  readonly arguments: Json;
  readonly actionHash: string;
  readonly status:
    "pending" | "denied" | "approved" | "executed" | "outcome_unknown";
  readonly expiresAt: string;
}

export interface ToolReceipt {
  readonly receiptId: string;
  readonly actionId: string;
  readonly status: "ok" | "denied" | "failed" | "outcome_unknown";
  readonly result?: Json;
}

export interface ActionJournalPort {
  create(input: ActionRecord, access: AccessContext): Promise<ActionRecord>;
  getByApproval(
    approvalId: string,
    access: AccessContext,
  ): Promise<ActionRecord | undefined>;
  listPending(access: AccessContext): Promise<readonly ActionRecord[]>;
  decide(
    approvalId: string,
    decision: "allow" | "deny",
    now: string,
    access: AccessContext,
  ): Promise<ActionRecord>;
  claim(
    actionId: string,
    now: string,
    access: AccessContext,
  ): Promise<ActionRecord>;
  receipt(receipt: ToolReceipt, access: AccessContext): Promise<ToolReceipt>;
}

export interface ToolAdapterPort {
  execute(
    toolId: string,
    arguments_: Json,
    signal?: AbortSignal,
  ): Promise<Json>;
}

export interface AgentToolDefinition {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: Json;
  readonly source: "host" | "browser" | "mcp";
}

export interface AgentToolPort {
  catalog(): Promise<readonly AgentToolDefinition[]>;
  execute(
    toolId: string,
    arguments_: Json,
    signal?: AbortSignal,
  ): Promise<Json>;
  close?(): Promise<void>;
}

export interface AgentSkill {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly maxSteps: number;
  readonly tools: readonly string[];
  readonly completionChecks: readonly string[];
  readonly instructions: string;
}

export interface AgentCapabilityRoute {
  readonly modelVersion: string;
  readonly capabilities: {
    readonly code: boolean;
    readonly math: boolean;
    readonly vision: boolean;
  };
  readonly probabilities: {
    readonly code: number;
    readonly math: number;
    readonly vision: number;
  };
}

export interface AgentCapabilityRouterPort {
  route(
    request: {
      readonly requestId: string;
      readonly taskId: string;
      readonly goal: string;
      readonly hasImages?: boolean;
      readonly deadlineUtc: string;
    },
    signal: AbortSignal,
  ): Promise<AgentCapabilityRoute>;
  close?(): Promise<void>;
}

export interface EmbeddingPort {
  embed(
    request: {
      readonly purpose?: "query" | "document";
      readonly requestId: string;
      readonly taskId: string;
      readonly inputs: readonly string[];
      readonly deadlineUtc: string;
    },
    signal: AbortSignal,
  ): Promise<{
    readonly modelVersion: string;
    readonly vectors: readonly (readonly number[])[];
  }>;
}

export interface SemanticIndexPort {
  upsert(
    chunkId: string,
    modelVersion: string,
    vector: readonly number[],
    access: AccessContext,
  ): void;
  search(
    modelVersion: string,
    query: readonly number[],
    limit: number,
    access: AccessContext,
  ): readonly { readonly chunkId: string; readonly score: number }[];
}

export type AgentRunStatus = "running" | "completed" | "failed" | "cancelled";

export interface AgentRunRecord {
  readonly runId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly status: AgentRunStatus;
  readonly result?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface AgentTraceEvent {
  readonly sequence: number;
  readonly runId: string;
  readonly nodeId: string;
  readonly parentNodeId?: string;
  readonly kind: "run" | "model" | "skill" | "tool" | "result" | "error";
  readonly label: string;
  readonly status: "running" | "completed" | "failed";
  readonly data: Json;
  readonly createdAt: string;
}

export interface AgentRunStorePort {
  create(input: AgentRunRecord, access: AccessContext): Promise<AgentRunRecord>;
  list(
    access: AccessContext,
    options: { readonly sessionId?: string; readonly limit: number },
  ): Promise<readonly AgentRunRecord[]>;
  get(
    runId: string,
    access: AccessContext,
  ): Promise<AgentRunRecord | undefined>;
  append(
    event: Omit<AgentTraceEvent, "sequence">,
    access: AccessContext,
  ): Promise<AgentTraceEvent>;
  events(
    runId: string,
    afterSequence: number,
    access: AccessContext,
  ): Promise<readonly AgentTraceEvent[]>;
  finish(
    runId: string,
    status: Exclude<AgentRunStatus, "running">,
    result: string,
    now: string,
    access: AccessContext,
  ): Promise<AgentRunRecord>;
}

export interface StoredSource {
  readonly sourceId: string;
  readonly revision: string;
  readonly title: string;
  readonly kind: "text" | "conversation" | "code";
  readonly artifactHash: string;
  readonly bytes: number;
  readonly createdAt: string;
  readonly deleted: boolean;
}

export interface SourceStorePort {
  add(
    input: {
      readonly source: StoredSource;
      readonly chunks: readonly {
        readonly chunkId: string;
        readonly ordinal: number;
        readonly text: string;
      }[];
    },
    access: AccessContext,
  ): Promise<StoredSource>;
  get(
    sourceId: string,
    access: AccessContext,
  ): Promise<StoredSource | undefined>;
  search(
    query: string,
    limit: number,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  exact(
    identifier: string,
    limit: number,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  read(ref: SourceRef, access: AccessContext): Promise<RetrievedChunk>;
  readByChunkIds(
    chunkIds: readonly string[],
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  expand(
    ref: SourceRef,
    radius: number,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  scanAll(access: AccessContext): Promise<readonly RetrievedChunk[]>;
  delete(
    sourceId: string,
    now: string,
    access: AccessContext,
  ): Promise<StoredSource>;
  artifactReferenceCount(hash: string): Promise<number>;
}

export interface ArtifactPort {
  writeText(
    content: string,
    maxBytes: number,
  ): Promise<{ readonly hash: string; readonly bytes: number }>;
  delete(hash: string): Promise<void>;
}

export interface TokenizerPort {
  countMessages?(messages: readonly { readonly role: "system" | "user"; readonly content: string }[]): number | Promise<number>;
  count(text: string): number | Promise<number>;
}

export interface CompactorPort {
  summarize(
    chunks: readonly RetrievedChunk[],
    maxTokens: number,
  ): Promise<{ readonly text: string; readonly sources: readonly SourceRef[] }>;
}

export type ModelRole =
  | "router"
  | "controller"
  | "code"
  | "math"
  | "vision"
  | "compactor"
  | "embedding";

export interface ModelCapabilities {
  readonly text: boolean;
  readonly image: boolean;
  readonly tools: boolean;
  readonly structuredOutput: boolean;
  readonly maxContextTokens: number;
}

export type ModelEvent =
  | { readonly type: "text_delta"; readonly text: string }
  | {
      readonly type: "tool_proposal";
      readonly callId: string;
      readonly name: string;
      readonly arguments: Json;
    }
  | {
      readonly type: "done";
      readonly finish: "stop" | "tool_calls" | "length";
      readonly inputTokens: number;
      readonly outputTokens: number;
    }
  | { readonly type: "error"; readonly code: string; readonly message: string };

export interface ModelRequest {
  readonly taskId?: string;
  readonly messages?: readonly ChatMessage[];
  readonly images?: readonly ImageInput[];
  readonly requestId: string;
  readonly modelId: string;
  readonly prompt: string;
  readonly maxOutputTokens: number;
  readonly deadlineUtc: string;
  readonly allowedTools: readonly string[];
  readonly responseFormat?: "text" | "json";
  readonly responseSchema?: Json;
  readonly reasoning?: "disabled" | "enabled" | "auto";
}

export interface ModelPort {
  countRequest?(request: ModelRequest, signal: AbortSignal): Promise<number>;
  capabilities(modelId: string): Promise<ModelCapabilities>;
  countInput(modelId: string, prompt: string): Promise<number>;
  generate(
    request: ModelRequest,
    signal: AbortSignal,
  ): AsyncIterable<ModelEvent>;
}

export interface GpuLease {
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly taskId: string;
  readonly modelId: string;
  readonly memoryMiB: number;
  readonly acquiredAt: string;
}

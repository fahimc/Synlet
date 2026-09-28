// Proposed source: packages/core/src/ports/index.ts
// Wire shapes belong in contracts/schemas/v1; generate TS/Python types from them.
// Illustrative interface declarations: no implementation is supplied here.
export type Json = null | boolean | number | string | Json[] |
  { [key: string]: Json };
export type Role = "controller" | "code" | "math" | "vision" | "compactor";
export type ErrorCode = "CONTEXT_LIMIT" | "CAPABILITY_UNAVAILABLE" |
  "POLICY_DENIED" | "STALE_REVISION" | "TIMEOUT" | "CANCELLED" |
  "RESOURCE_EXHAUSTED" | "OUTCOME_UNKNOWN" | "INVALID_OUTPUT";

// Created by authenticated host code; never deserialise this from model output.
export interface AccessContext {
  readonly actorId: string;
  readonly projectId: string;
  readonly policyVersion: string;
}
export interface SourceRef {
  readonly sourceId: string;
  readonly revision: string;
  readonly chunkId?: string;
}
export interface TaskPacket {
  readonly taskId: string;
  readonly stepId: string;
  readonly role: Role;
  readonly messages: readonly Json[];
  readonly evidence: readonly SourceRef[];
  readonly tools: readonly Json[]; // Trusted host-selected schemas only
  readonly budget: {
    readonly maxInputTokens: number;
    readonly maxOutputTokens: number;
    readonly safetyTokens: number;
  };
}
export type ModelEvent =
  | { type: "text_delta"; text: string }
  | { type: "tool_proposal"; callId: string; name: string; arguments: Json }
  | { type: "done"; finish: "stop" | "tool_calls" | "length";
      inputTokens: number; outputTokens: number }
  | { type: "error"; code: ErrorCode; message: string };

export interface ModelPort {
  capabilities(modelId: string): Promise<Readonly<{
    text: boolean; image: boolean; tools: boolean;
    structuredOutput: boolean; maxContextTokens: number;
  }>>;
  countInput(modelId: string, packet: TaskPacket): Promise<number>;
  generate(request: Readonly<{
    modelId: string; packet: TaskPacket;
    deadlineUtc: string; requestId: string;
  }>, signal: AbortSignal): AsyncIterable<ModelEvent>;
}
export interface ContextPort {
  build(input: Readonly<{
    taskId: string; role: Role; inputCap: number;
  }>, access: AccessContext, signal: AbortSignal): Promise<TaskPacket>;
  search(query: string, maxTokens: number, access: AccessContext,
    signal: AbortSignal): Promise<readonly SourceRef[]>;
  read(ref: SourceRef, maxTokens: number, access: AccessContext,
    signal: AbortSignal): Promise<string>;
}
export interface TaskStorePort {
  // Atomic compare-and-set + events + outbox; implementation rejects stale revision.
  commit(input: Readonly<{
    taskId: string; expectedRevision: number; nextState: Json;
    events: readonly Json[]; outbox: readonly Json[];
  }>, access: AccessContext): Promise<{ revision: number }>;
}
export interface ToolBrokerPort {
  // Broker validates arguments, scope, policy and approval BEFORE execution.
  execute(input: Readonly<{
    taskId: string; stepId: string; toolId: string; arguments: Json;
    expectedRevision?: string; approvalId?: string; idempotencyKey: string;
  }>, access: AccessContext, signal: AbortSignal): Promise<Readonly<{
    status: "ok" | "denied" | "failed" | "outcome_unknown";
    receiptId: string; resultRef?: SourceRef;
  }>>;
}
export interface Lease {
  readonly leaseId: string;
  readonly fencingToken: number;
  readonly workerId: string;
  readonly expiresUtc: string;
}
export interface SchedulerPort {
  acquire(request: Readonly<{
    taskId: string; modelId: string; maxContextTokens: number;
    priority: "interactive" | "maintenance"; deadlineUtc: string;
  }>, signal: AbortSignal): Promise<Lease>;
  release(lease: Lease): Promise<void>;
}

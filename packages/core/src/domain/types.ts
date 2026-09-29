export type Json =
  | null
  | boolean
  | number
  | string
  | readonly Json[]
  | { readonly [key: string]: Json };

export interface AccessContext {
  readonly actorId: string;
  readonly projectId: string;
  readonly policyVersion: string;
}

export type TaskStatus =
  | "queued"
  | "running"
  | "completed"
  | "cancel_requested"
  | "cancelled"
  | "blocked"
  | "failed";

export interface TaskRecord {
  readonly taskId: string;
  readonly projectId: string;
  readonly actorId: string;
  readonly sessionId: string;
  readonly prompt: string;
  readonly status: TaskStatus;
  readonly revision: number;
  readonly result?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface TaskEventRecord {
  readonly sequence: number;
  readonly taskId: string;
  readonly type: string;
  readonly data: Json;
  readonly createdAt: string;
}

export class DomainError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "CONFLICT"
      | "STALE_REVISION"
      | "RESOURCE_EXHAUSTED"
      | "POLICY_DENIED"
      | "INVALID_OUTPUT"
      | "CONTEXT_LIMIT"
      | "OUTCOME_UNKNOWN"
      | "CAPABILITY_UNAVAILABLE"
      | "TIMEOUT"
      | "CANCELLED",
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

export interface SourceRef {
  readonly sourceId: string;
  readonly revision: string;
  readonly chunkId?: string;
}

export interface RetrievedChunk {
  readonly ref: SourceRef;
  readonly title: string;
  readonly text: string;
  readonly ordinal: number;
  readonly stale: boolean;
}

export interface ChatMessage {
  readonly role: "system" | "developer" | "user" | "assistant";
  readonly content: string;
}
export interface ImageInput {
  readonly id: string;
  readonly dataUrl: string;
}

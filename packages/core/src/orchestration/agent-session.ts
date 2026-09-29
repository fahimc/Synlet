import type {
  AccessContext,
  Json,
  RetrievedChunk,
  ChatMessage,
  ImageInput,
} from "../domain/types.js";
import type { AgentRunRecord, ModelRequest } from "../ports/index.js";

export interface AgentInput {
  readonly sessionId: string;
  readonly prompt: string;
  readonly idempotencyKey?: string;
  readonly messages?: readonly ChatMessage[];
  readonly images?: readonly ImageInput[];
}
export interface Observation {
  readonly id: string;
  readonly tool: string;
  readonly arguments: Json;
  readonly result: Json;
}
export interface RunCheckpoint {
  readonly input: AgentInput;
  readonly deadlineUtc: string;
  readonly nextStep: number;
  readonly finalAnswer?: string;
  readonly phase: "ready" | "model" | "action_pending" | "terminal";
  readonly observations: readonly Observation[];
  readonly images: readonly ImageInput[];
  readonly pendingAction?:
    | { readonly id: string; readonly tool: string; readonly arguments: Json }
    | undefined;
}
/** Storage only. The harness owns transitions and the no-replay decision. */
export interface AgentCheckpointPort {
  begin(
    run: AgentRunRecord,
    checkpoint: RunCheckpoint,
    access: AccessContext,
    maxPending: number,
  ): Promise<{ run: AgentRunRecord; duplicate: boolean }>;
  load(
    runId: string,
    access: AccessContext,
  ): Promise<RunCheckpoint | undefined>;
  save(
    runId: string,
    checkpoint: RunCheckpoint,
    access: AccessContext,
  ): Promise<void>;
  recover(): Promise<
    readonly {
      run: AgentRunRecord;
      access: AccessContext;
      checkpoint: RunCheckpoint;
    }[]
  >;
}
/** Every stored original is scoped. This port never grants shell permissions. */
export interface AgentMemoryPort {
  remember(
    run: AgentRunRecord,
    input: AgentInput,
    access: AccessContext,
  ): Promise<string>;
  history(
    run: AgentRunRecord,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  evidence(
    run: AgentRunRecord,
    observation: Observation,
    access: AccessContext,
  ): Promise<void>;
  search(
    query: string,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  read(chunkId: string, access: AccessContext): Promise<RetrievedChunk>;
  expand(
    chunkId: string,
    access: AccessContext,
  ): Promise<readonly RetrievedChunk[]>;
  scan(
    cursor: number,
    limit: number,
    access: AccessContext,
  ): Promise<{
    chunks: readonly RetrievedChunk[];
    nextCursor: number | null;
    total: number;
  }>;
}
export interface ModelPacket extends ModelRequest {
  readonly taskId?: string;
  readonly images?: readonly ImageInput[];
  readonly messages?: readonly ChatMessage[];
}

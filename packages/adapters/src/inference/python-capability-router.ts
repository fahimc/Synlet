import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface, type Interface } from "node:readline";

import {
  DomainError,
  type AgentCapabilityRoute,
  type AgentCapabilityRouterPort,
  type EmbeddingPort,
  type Json,
} from "@synlet/core";

interface WorkerResponse {
  readonly schemaVersion: "synlet.worker/v1";
  readonly requestId: string;
  readonly status: "ok" | "error" | "cancelled";
  readonly modelVersion: string;
  readonly outputs: readonly string[];
}

interface PendingRequest {
  readonly resolve: (value: WorkerResponse) => void;
  readonly reject: (error: Error) => void;
  readonly removeAbort: () => void;
}

export class PythonCapabilityRouter
  implements AgentCapabilityRouterPort, EmbeddingPort
{
  private child: ChildProcessWithoutNullStreams | undefined;
  private lines: Interface | undefined;
  private readonly pending = new Map<string, PendingRequest>();
  private diagnostics = "";

  constructor(
    private readonly executable: string,
    private readonly workerRoot: string,
    private readonly environment: Readonly<Record<string, string>> = {},
    private readonly launchArgs: readonly string[] = [
      "run",
      "--locked",
      "python",
      "-m",
      "synlet_worker.worker",
    ],
  ) {}

  async route(
    request: {
      readonly requestId: string;
      readonly taskId: string;
      readonly goal: string;
      readonly hasImages?: boolean;
      readonly deadlineUtc: string;
    },
    signal: AbortSignal,
  ): Promise<AgentCapabilityRoute> {
    signal.throwIfAborted();
    const remainingMs = Date.parse(request.deadlineUtc) - Date.now();
    if (remainingMs <= 0) throw new DomainError("TIMEOUT", "Worker deadline expired");
    signal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);
    const child = this.ensureStarted();
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request.requestId);
        reject(
          new DomainError("CANCELLED", "Capability routing was cancelled"),
        );
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(request.requestId, {
        resolve,
        reject,
        removeAbort: () => signal.removeEventListener("abort", abort),
      });
      const payload = {
        schemaVersion: "synlet.worker/v1",
        requestId: request.requestId,
        taskId: request.taskId,
        stepId: "route",
        deadlineUtc: request.deadlineUtc,
        operation: "route",
        inputs: [JSON.stringify({ goal: request.goal, hasImages: request.hasImages === true })],
      };
      child.stdin.write(`${JSON.stringify(payload)}\n`, (error) => {
        if (!error) return;
        const pending = this.pending.get(request.requestId);
        this.pending.delete(request.requestId);
        pending?.removeAbort();
        reject(error);
      });
    });
    if (response.status !== "ok" || response.outputs.length !== 1)
      throw new DomainError(
        "INVALID_OUTPUT",
        response.outputs[0] ?? "Capability router returned no decision",
      );
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.outputs[0] ?? "");
    } catch {
      throw new DomainError(
        "INVALID_OUTPUT",
        "Capability router returned malformed JSON",
      );
    }
    return parseRoute(parsed, response.modelVersion);
  }

  async embed(
    request: {
      readonly requestId: string;
      readonly taskId: string;
      readonly inputs: readonly string[];
      readonly purpose?: "query" | "document";
      readonly deadlineUtc: string;
    },
    signal: AbortSignal,
  ): Promise<{
    readonly modelVersion: string;
    readonly vectors: readonly (readonly number[])[];
  }> {
    signal.throwIfAborted();
    const remainingMs = Date.parse(request.deadlineUtc) - Date.now();
    if (remainingMs <= 0) throw new DomainError("TIMEOUT", "Worker deadline expired");
    signal = AbortSignal.any([signal, AbortSignal.timeout(remainingMs)]);
    const child = this.ensureStarted();
    const response = await new Promise<WorkerResponse>((resolve, reject) => {
      const abort = () => {
        this.pending.delete(request.requestId);
        reject(new DomainError("CANCELLED", "Embedding was cancelled"));
      };
      signal.addEventListener("abort", abort, { once: true });
      this.pending.set(request.requestId, {
        resolve,
        reject,
        removeAbort: () => signal.removeEventListener("abort", abort),
      });
      child.stdin.write(
        `${JSON.stringify({
          schemaVersion: "synlet.worker/v1",
          requestId: request.requestId,
          taskId: request.taskId,
          stepId: "embed",
          deadlineUtc: request.deadlineUtc,
          operation: "embed",
          inputs: request.inputs.map(text => JSON.stringify({ text, kind: request.purpose ?? "document" })),
        })}\n`,
        (error) => {
          if (!error) return;
          const pending = this.pending.get(request.requestId);
          this.pending.delete(request.requestId);
          pending?.removeAbort();
          reject(error);
        },
      );
    });
    if (
      response.status !== "ok" ||
      response.outputs.length !== request.inputs.length
    )
      throw new DomainError(
        "INVALID_OUTPUT",
        response.outputs[0] ?? "Embedding worker returned no vectors",
      );
    const vectors = response.outputs.map((output) => {
      const parsed: unknown = JSON.parse(output);
      if (
        !Array.isArray(parsed) ||
        parsed.length === 0 ||
        parsed.some(
          (value) => typeof value !== "number" || !Number.isFinite(value),
        )
      )
        throw new DomainError("INVALID_OUTPUT", "Embedding vector is invalid");
      return parsed as number[];
    });
    return { modelVersion: response.modelVersion, vectors };
  }

  async close(): Promise<void> {
    this.lines?.close();
    this.child?.kill();
    this.child = undefined;
    this.lines = undefined;
  }

  private ensureStarted(): ChildProcessWithoutNullStreams {
    if (this.child?.exitCode === null) return this.child;
    const child = spawn(this.executable, this.launchArgs, {
      cwd: this.workerRoot,
      windowsHide: true,
      env: { ...process.env, ...this.environment },
    });
    this.child = child;
    this.lines = createInterface({ input: child.stdout });
    this.lines.on("line", (line) => this.receive(line));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => {
      this.diagnostics = `${this.diagnostics}${chunk}`.slice(-16_384);
    });
    child.on("exit", (code) => {
      const message = `Capability router exited ${code ?? "unexpectedly"}: ${this.diagnostics}`;
      for (const pending of this.pending.values()) {
        pending.removeAbort();
        pending.reject(new DomainError("CAPABILITY_UNAVAILABLE", message));
      }
      this.pending.clear();
      this.child = undefined;
      this.lines = undefined;
    });
    child.on("error", (error) => {
      for (const pending of this.pending.values()) {
        pending.removeAbort();
        pending.reject(error);
      }
      this.pending.clear();
    });
    return child;
  }

  private receive(line: string): void {
    let response: WorkerResponse;
    try {
      response = JSON.parse(line) as WorkerResponse;
    } catch {
      this.diagnostics =
        `${this.diagnostics}\nInvalid worker output: ${line}`.slice(-16_384);
      return;
    }
    const pending = this.pending.get(response.requestId);
    if (!pending) return;
    this.pending.delete(response.requestId);
    pending.removeAbort();
    pending.resolve(response);
  }
}

function parseRoute(
  value: unknown,
  modelVersion: string,
): AgentCapabilityRoute {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new DomainError(
      "INVALID_OUTPUT",
      "Capability route is not an object",
    );
  const route = value as Record<string, Json>;
  const capabilities = parseBooleanMap(route.capabilities);
  const probabilities = parseProbabilityMap(route.probabilities);
  if (
    typeof capabilities.code !== "boolean" ||
    typeof capabilities.math !== "boolean" ||
    typeof capabilities.vision !== "boolean" ||
    typeof probabilities.code !== "number" ||
    typeof probabilities.math !== "number" ||
    typeof probabilities.vision !== "number"
  )
    throw new DomainError("INVALID_OUTPUT", "Capability route is incomplete");
  return {
    modelVersion,
    capabilities: {
      code: capabilities.code,
      math: capabilities.math,
      vision: capabilities.vision,
    },
    probabilities: {
      code: probabilities.code,
      math: probabilities.math,
      vision: probabilities.vision,
    },
  };
}

function parseBooleanMap(value: Json | undefined): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, boolean] => typeof entry[1] === "boolean",
    ),
  );
}

function parseProbabilityMap(value: Json | undefined): Record<string, number> {
  return parseProbabilityRecord(value);
}

function parseProbabilityRecord(
  value: Json | undefined,
): Record<string, number> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, number] =>
        typeof entry[1] === "number" && entry[1] >= 0 && entry[1] <= 1,
    ),
  );
}

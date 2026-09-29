import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import {
  DomainError,
  type ModelCapabilities,
  type ModelRole,
} from "@synlet/core";

export interface LockedModel {
  readonly modelId: string;
  readonly role: ModelRole;
  readonly enabled: boolean;
  readonly provider: "llama.cpp" | "python";
  readonly artifactPath?: string;
  readonly sha256?: string;
  readonly projectorPath?: string;
  readonly projectorSha256?: string;
  readonly template?: string;
  readonly reasoning?: "disabled" | "enabled" | "auto";
  readonly memoryMiB: number;
  readonly capabilities: ModelCapabilities;
  readonly reason?: string;
}

interface ModelLockFile {
  readonly schemaVersion: "synlet.models-lock/v1";
  readonly models: readonly LockedModel[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class ModelRegistry {
  private constructor(private readonly lock: ModelLockFile) {}

  static async load(path: string): Promise<ModelRegistry> {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (
      !isRecord(parsed) ||
      parsed.schemaVersion !== "synlet.models-lock/v1" ||
      !Array.isArray(parsed.models)
    ) {
      throw new DomainError("INVALID_OUTPUT", "Invalid models lock file");
    }
    const ids = new Set<string>();
    for (const candidate of parsed.models) {
      if (!isRecord(candidate) || typeof candidate.modelId !== "string") {
        throw new DomainError("INVALID_OUTPUT", "Invalid model lock entry");
      }
      if (ids.has(candidate.modelId))
        throw new DomainError("INVALID_OUTPUT", "Model IDs must be unique");
      ids.add(candidate.modelId);
      if (
        candidate.enabled === true &&
        (typeof candidate.artifactPath !== "string" ||
          typeof candidate.sha256 !== "string")
      ) {
        throw new DomainError(
          "INVALID_OUTPUT",
          `Enabled model ${candidate.modelId} lacks a locked artifact`,
        );
      }
      const hasProjectorPath = typeof candidate.projectorPath === "string";
      const hasProjectorHash = typeof candidate.projectorSha256 === "string";
      if (hasProjectorPath !== hasProjectorHash) {
        throw new DomainError(
          "INVALID_OUTPUT",
          `Model ${candidate.modelId} must lock both projectorPath and projectorSha256`,
        );
      }
    }
    return new ModelRegistry(parsed as unknown as ModelLockFile);
  }

  list(): readonly LockedModel[] {
    return this.lock.models;
  }

  enabledFor(role: ModelRole): LockedModel | undefined {
    return this.lock.models.find(
      (model) => model.role === role && model.enabled,
    );
  }

  async verifyArtifacts(root = "."): Promise<void> {
    for (const model of this.lock.models.filter((entry) => entry.enabled)) {
      if (!model.artifactPath || !model.sha256)
        throw new DomainError(
          "CAPABILITY_UNAVAILABLE",
          `Enabled model ${model.modelId} has no locked artifact`,
        );
      await verifyHash(
        resolve(root, model.artifactPath),
        model.sha256,
        model.modelId,
      );
      if (model.projectorPath && model.projectorSha256)
        await verifyHash(
          resolve(root, model.projectorPath),
          model.projectorSha256,
          `${model.modelId} projector`,
        );
    }
  }
}

async function verifyHash(
  path: string,
  expected: string,
  label: string,
): Promise<void> {
  const hash = createHash("sha256");
  try {
    for await (const chunk of createReadStream(path)) {
      if (!Buffer.isBuffer(chunk))
        throw new Error("Artifact stream returned non-binary data");
      hash.update(chunk);
    }
  } catch (error: unknown) {
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      `${label} artifact is unavailable: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  if (hash.digest("hex") !== expected)
    throw new DomainError(
      "CAPABILITY_UNAVAILABLE",
      `${label} artifact hash does not match the model lock`,
    );
}

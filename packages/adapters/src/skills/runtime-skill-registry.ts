import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DomainError } from "@synlet/core";

export interface RuntimeSkill {
  readonly id: string;
  readonly version: string;
  readonly title: string;
  readonly description: string;
  readonly trusted: boolean;
  readonly maxSteps: number;
  readonly tools: readonly string[];
  readonly completionChecks: readonly string[];
  readonly instructions: string;
}

const knownTools = new Set([
  "file.read",
  "file.patch",
  "calculator",
  "browser.inspect",
  "browser.search",
  "browser.click",
  "browser.type",
  "command.run",
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class RuntimeSkillRegistry {
  constructor(private readonly root: string) {}

  async load(): Promise<readonly RuntimeSkill[]> {
    const names = await readdir(this.root, { withFileTypes: true });
    const skills: RuntimeSkill[] = [];
    for (const name of names.filter((entry) => entry.isDirectory())) {
      const versions = await readdir(resolve(this.root, name.name), {
        withFileTypes: true,
      });
      for (const version of versions.filter((entry) => entry.isDirectory())) {
        const path = resolve(this.root, name.name, version.name, "skill.json");
        const value: unknown = JSON.parse(await readFile(path, "utf8"));
        if (!isRecord(value))
          throw new DomainError(
            "INVALID_OUTPUT",
            `Invalid runtime skill manifest: ${path}`,
          );
        const parsed = value as Partial<RuntimeSkill>;
        if (
          parsed.id !== name.name ||
          parsed.version !== version.name ||
          !parsed.title ||
          !parsed.description
        ) {
          throw new DomainError(
            "INVALID_OUTPUT",
            `Invalid runtime skill manifest: ${path}`,
          );
        }
        if (
          !Number.isSafeInteger(parsed.maxSteps) ||
          (parsed.maxSteps ?? 0) < 1 ||
          (parsed.maxSteps ?? 0) > 16
        ) {
          throw new DomainError(
            "INVALID_OUTPUT",
            `Skill ${parsed.id} has an invalid step bound`,
          );
        }
        if (
          !Array.isArray(parsed.tools) ||
          parsed.tools.some(
            (tool) => typeof tool !== "string" || !knownTools.has(tool),
          )
        ) {
          throw new DomainError(
            "POLICY_DENIED",
            `Skill ${parsed.id} requests an unknown tool`,
          );
        }
        if (
          !Array.isArray(parsed.completionChecks) ||
          parsed.completionChecks.length === 0
        ) {
          throw new DomainError(
            "INVALID_OUTPUT",
            `Skill ${parsed.id} lacks completion checks`,
          );
        }
        const instructions = await readFile(
          resolve(this.root, name.name, version.name, "SKILL.md"),
          "utf8",
        );
        skills.push({
          ...(parsed as Omit<RuntimeSkill, "instructions">),
          instructions,
        });
      }
    }
    return skills.sort((left, right) => left.id.localeCompare(right.id));
  }

  async active(): Promise<readonly RuntimeSkill[]> {
    return (await this.load()).filter((skill) => skill.trusted);
  }
}

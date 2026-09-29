import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  readFile,
  realpath,
  rename,
  stat,
  writeFile,
} from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve } from "node:path";

import {
  DomainError,
  OutcomeUnknownError,
  type Json,
  type ToolAdapterPort,
} from "@synlet/core";

function objectArguments(value: Json): Record<string, Json> {
  if (value === null || Array.isArray(value) || typeof value !== "object") {
    throw new DomainError("INVALID_OUTPUT", "Tool arguments must be an object");
  }
  return value as Record<string, Json>;
}

function stringArgument(object: Record<string, Json>, name: string): string {
  const value = object[name];
  if (typeof value !== "string") {
    throw new DomainError("INVALID_OUTPUT", `${name} must be a string`);
  }
  return value;
}

function isWithin(root: string, path: string): boolean {
  const relation = relative(root, path);
  return (
    relation === "" || (!relation.startsWith("..") && !isAbsolute(relation))
  );
}

class Calculator {
  private index = 0;
  constructor(private readonly input: string) {}

  parse(): number {
    if (this.input.length > 256)
      throw new DomainError("INVALID_OUTPUT", "Expression is too long");
    const value = this.expression();
    this.space();
    if (this.index !== this.input.length || !Number.isFinite(value)) {
      throw new DomainError("INVALID_OUTPUT", "Invalid calculator expression");
    }
    return value;
  }

  private expression(): number {
    let value = this.term();
    for (;;) {
      this.space();
      const operator = this.input[this.index];
      if (operator !== "+" && operator !== "-") return value;
      this.index += 1;
      const right = this.term();
      value = operator === "+" ? value + right : value - right;
    }
  }

  private term(): number {
    let value = this.factor();
    for (;;) {
      this.space();
      const operator = this.input[this.index];
      if (operator !== "*" && operator !== "/") return value;
      this.index += 1;
      const right = this.factor();
      if (operator === "/" && right === 0)
        throw new DomainError("INVALID_OUTPUT", "Division by zero");
      value = operator === "*" ? value * right : value / right;
    }
  }

  private factor(): number {
    this.space();
    if (this.input[this.index] === "(") {
      this.index += 1;
      const value = this.expression();
      this.space();
      if (this.input[this.index] !== ")")
        throw new DomainError("INVALID_OUTPUT", "Missing closing parenthesis");
      this.index += 1;
      return value;
    }
    const match = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)/u.exec(
      this.input.slice(this.index),
    );
    if (!match) throw new DomainError("INVALID_OUTPUT", "Expected a number");
    this.index += match[0].length;
    return Number(match[0]);
  }

  private space(): void {
    while (/\s/u.test(this.input[this.index] ?? "")) this.index += 1;
  }
}

export interface SafeToolOptions {
  readonly maxReadBytes: number;
  readonly failAfterWrite?: boolean;
}

export class SafeToolAdapter implements ToolAdapterPort {
  constructor(
    private readonly workspaceRoot: string,
    private readonly options: SafeToolOptions,
  ) {}

  async execute(toolId: string, arguments_: Json): Promise<Json> {
    const argumentsObject = objectArguments(arguments_);
    if (toolId === "calculator") {
      return {
        value: new Calculator(
          stringArgument(argumentsObject, "expression"),
        ).parse(),
      };
    }
    if (toolId === "file.read") return this.read(argumentsObject);
    if (toolId === "file.patch") return this.patch(argumentsObject);
    throw new DomainError("POLICY_DENIED", `Unsupported tool: ${toolId}`);
  }

  private async read(arguments_: Record<string, Json>): Promise<Json> {
    const path = await this.resolveExisting(stringArgument(arguments_, "path"));
    const information = await stat(path);
    if (!information.isFile() || information.size > this.options.maxReadBytes) {
      throw new DomainError(
        "RESOURCE_EXHAUSTED",
        "File is not readable within the configured cap",
      );
    }
    const content = await readFile(path, "utf8");
    return {
      path: stringArgument(arguments_, "path"),
      content,
      sha256: digest(content),
    };
  }

  private async patch(arguments_: Record<string, Json>): Promise<Json> {
    const relativePath = stringArgument(arguments_, "path");
    const content = stringArgument(arguments_, "content");
    if (Buffer.byteLength(content, "utf8") > this.options.maxReadBytes) {
      throw new DomainError(
        "RESOURCE_EXHAUSTED",
        "Patch exceeds the configured cap",
      );
    }
    const destination = await this.resolveForWrite(relativePath);
    const current = await readFile(destination, "utf8").catch(() => undefined);
    const expected = stringArgument(arguments_, "expectedSha256");
    if (digest(current ?? "") !== expected) {
      throw new DomainError(
        "STALE_REVISION",
        "File revision does not match expectedSha256",
      );
    }
    await mkdir(dirname(destination), { recursive: true });
    const temporary = resolve(
      dirname(destination),
      `.synlet-${randomUUID()}.tmp`,
    );
    await writeFile(temporary, content, { encoding: "utf8", flag: "wx" });
    await rename(temporary, destination);
    if (this.options.failAfterWrite) {
      throw new OutcomeUnknownError(
        "Write may have completed before receipt persistence",
      );
    }
    return {
      path: relativePath,
      sha256: digest(content),
      bytes: Buffer.byteLength(content),
    };
  }

  private async resolveExisting(input: string): Promise<string> {
    const root = await this.realRoot();
    if (isAbsolute(input))
      throw new DomainError("POLICY_DENIED", "Absolute paths are not allowed");
    const target = await realpath(resolve(root, input)).catch(() => undefined);
    if (!target || !isWithin(root, target))
      throw new DomainError("POLICY_DENIED", "Path escapes the workspace");
    return target;
  }

  private async resolveForWrite(input: string): Promise<string> {
    const root = await this.realRoot();
    if (isAbsolute(input))
      throw new DomainError("POLICY_DENIED", "Absolute paths are not allowed");
    const candidate = resolve(root, input);
    if (!isWithin(root, candidate)) {
      throw new DomainError("POLICY_DENIED", "Path escapes the workspace");
    }
    const parent = await realpath(dirname(candidate)).catch(async () => {
      await mkdir(dirname(candidate), { recursive: true });
      return realpath(dirname(candidate));
    });
    if (!isWithin(root, parent)) {
      throw new DomainError("POLICY_DENIED", "Path escapes the workspace");
    }
    const existing = await realpath(candidate).catch(() => undefined);
    if (existing && !isWithin(root, existing)) {
      throw new DomainError(
        "POLICY_DENIED",
        "Path resolves outside the workspace",
      );
    }
    return candidate;
  }

  private async realRoot(): Promise<string> {
    await mkdir(this.workspaceRoot, { recursive: true });
    return realpath(this.workspaceRoot);
  }
}

function digest(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

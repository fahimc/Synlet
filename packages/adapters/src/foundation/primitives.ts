import { createHash, randomUUID } from "node:crypto";

import type {
  ClockPort,
  CompactorPort,
  HashPort,
  IdPort,
  RetrievedChunk,
  TokenizerPort,
} from "@synlet/core";

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  return `{${Object.entries(value)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`)
    .join(",")}}`;
}

export class SystemClock implements ClockPort {
  now(): string {
    return new Date().toISOString();
  }
}

export class RandomIds implements IdPort {
  next(prefix: string): string {
    return `${prefix}_${randomUUID()}`;
  }
}

export class Sha256Hashes implements HashPort {
  async canonical(value: unknown): Promise<string> {
    return createHash("sha256").update(canonicalize(value)).digest("hex");
  }
}

export class DeterministicTokenizer implements TokenizerPort {
  count(text: string): number {
    return text.trim() === ""
      ? 0
      : (text.match(/[\p{L}\p{N}_]+|[^\s]/gu) ?? []).length;
  }
}

export class SourcePreservingCompactor implements CompactorPort {
  constructor(private readonly tokenizer: TokenizerPort) {}

  async summarize(chunks: readonly RetrievedChunk[], maxTokens: number) {
    const parts: string[] = [];
    let used = 0;
    for (const chunk of chunks) {
      const text = `[${chunk.ref.chunkId}] ${chunk.text}`;
      const tokens = await this.tokenizer.count(text);
      if (used + tokens > maxTokens) break;
      parts.push(text);
      used += tokens;
    }
    return {
      text: parts.join("\n"),
      sources: chunks.slice(0, parts.length).map((chunk) => chunk.ref),
    };
  }
}

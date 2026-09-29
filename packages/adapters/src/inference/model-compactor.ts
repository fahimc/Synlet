import { randomUUID } from "node:crypto";

import {
  DomainError,
  type CompactorPort,
  type ModelPort,
  type RetrievedChunk,
  type SourceRef,
} from "@synlet/core";

export class ModelSourcePreservingCompactor implements CompactorPort {
  constructor(
    private readonly model: ModelPort,
    private readonly modelId: string,
    private readonly timeoutMs: number,
  ) {}

  async summarize(chunks: readonly RetrievedChunk[], maxTokens: number) {
    const prompt = [
      "Compact the supplied excerpts without adding facts. Preserve negations, numbers, corrections, failures, and unresolved uncertainty.",
      'Return ONLY JSON: {"text":"source-linked compact notes","chunkIds":["exact supplied chunk id"]}. Every factual sentence in text must include its supporting [chunk-id]. Do not cite any other id.',
      `TARGET TOKEN ALLOWANCE (validated by host): ${maxTokens}`,
      `EXCERPTS:\n${chunks
        .map((chunk) => `[${chunk.ref.chunkId}] ${chunk.text}`)
        .join("\n\n")}`,
    ].join("\n\n");
    const output: string[] = [];
    const signal = AbortSignal.timeout(this.timeoutMs);
    for await (const event of this.model.generate(
      {
        requestId: `compact-${randomUUID()}`,
        modelId: this.modelId,
        prompt,
        maxOutputTokens: -1,
        deadlineUtc: new Date(Date.now() + this.timeoutMs).toISOString(),
        allowedTools: [],
        responseFormat: "json",
        reasoning: "disabled",
      },
      signal,
    )) {
      if (event.type === "text_delta") output.push(event.text);
      if (event.type === "error")
        throw new DomainError("INVALID_OUTPUT", event.message);
    }
    const raw = output.join("").trim();
    const json = raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1);
    const parsed = JSON.parse(json) as {
      text?: unknown;
      chunkIds?: unknown;
    };
    if (
      typeof parsed.text !== "string" ||
      !Array.isArray(parsed.chunkIds) ||
      parsed.chunkIds.some((id) => typeof id !== "string")
    ) {
      throw new DomainError("INVALID_OUTPUT", "Invalid compactor response");
    }
    const chunkIds = parsed.chunkIds as string[];
    const references = new Map<string, SourceRef>(
      chunks.map((chunk) => [chunk.ref.chunkId ?? "", chunk.ref]),
    );
    const sources = [...new Set(chunkIds)].map((id) => {
      const found = references.get(id);
      if (!found)
        throw new DomainError(
          "INVALID_OUTPUT",
          `Compactor cited unknown chunk: ${id}`,
        );
      return found;
    });
    return { text: parsed.text, sources };
  }
}

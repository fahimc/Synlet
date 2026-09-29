import type { ContextBuildRequest } from "@synlet/contracts";

import {
  DomainError,
  type AccessContext,
  type RetrievedChunk,
  type SourceRef,
} from "../domain/types.js";
import type {
  CompactorPort,
  SourceStorePort,
  TokenizerPort,
} from "../ports/index.js";

export interface ContextInspector {
  readonly packet: {
    readonly role: ContextBuildRequest["role"];
    readonly messages: readonly {
      readonly role: "system" | "user";
      readonly content: string;
    }[];
    readonly evidence: readonly SourceRef[];
    readonly budget: {
      readonly maxInputTokens: number;
      readonly generationReserveTokens: number;
      readonly safetyTokens: number;
      readonly usedInputTokens: number;
    };
  };
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly omitted: readonly SourceRef[];
  readonly coverage: { readonly scanned: number; readonly total: number };
  readonly compaction: "none" | "valid" | "fallback";
}

export interface ContextEngineOptions {
  readonly maxLookupRounds: number;
  readonly maxInputTokens: number;
  readonly generationReserveTokens: number;
  readonly safetyTokens: number;
}

export class ContextEngine {
  constructor(
    private readonly sources: SourceStorePort,
    private readonly tokenizer: TokenizerPort,
    private readonly compactor: CompactorPort,
    private readonly options: ContextEngineOptions,
  ) {}

  async build(
    input: ContextBuildRequest,
    access: AccessContext,
  ): Promise<ContextInspector> {
    const allowance =
      this.options.maxInputTokens -
      this.options.generationReserveTokens -
      this.options.safetyTokens;
    const pinnedText = input.pinnedConstraints
      .map((item) => `PINNED: ${item}`)
      .join("\n");
    const fixedText = [pinnedText, `QUERY: ${input.query}`]
      .filter(Boolean)
      .join("\n");
    const fixedTokens = this.tokenizer.count(fixedText);
    if (fixedTokens > allowance) {
      throw new DomainError(
        "CONTEXT_LIMIT",
        "Pinned constraints exceed the input allowance",
      );
    }

    let candidates: readonly RetrievedChunk[];
    if (input.exhaustive) {
      candidates = await this.sources.scanAll(access);
    } else {
      const found = new Map<string, RetrievedChunk>();
      for (let round = 0; round < this.options.maxLookupRounds; round += 1) {
        const results = await this.sources.search(input.query, 20, access);
        const sizeBefore = found.size;
        for (const chunk of results)
          found.set(chunk.ref.chunkId ?? chunk.ref.sourceId, chunk);
        if (found.size === sizeBefore) break;
      }
      candidates = [...found.values()];
    }

    const beforeTokens = candidates.reduce(
      (total, chunk) => total + this.tokenizer.count(chunk.text),
      fixedTokens,
    );
    const retained: RetrievedChunk[] = [];
    const omitted: SourceRef[] = [];
    let used = fixedTokens;
    for (const chunk of candidates) {
      const tokens = this.tokenizer.count(chunk.text);
      if (used + tokens <= allowance) {
        retained.push(chunk);
        used += tokens;
      } else {
        omitted.push(chunk.ref);
      }
    }

    let evidenceText = retained
      .map((chunk) => `[${chunk.ref.chunkId}] ${chunk.text}`)
      .join("\n\n");
    let evidence = retained.map((chunk) => chunk.ref);
    let compaction: ContextInspector["compaction"] = "none";
    if (omitted.length > 0 && retained.length > 0) {
      try {
        const summary = await this.compactor.summarize(
          retained,
          Math.max(64, allowance - fixedTokens),
        );
        const allowedRefs = new Set(
          evidence.map(
            (ref) => `${ref.sourceId}:${ref.revision}:${ref.chunkId ?? ""}`,
          ),
        );
        const valid = summary.sources.every((ref) =>
          allowedRefs.has(
            `${ref.sourceId}:${ref.revision}:${ref.chunkId ?? ""}`,
          ),
        );
        if (
          valid &&
          this.tokenizer.count(summary.text) + fixedTokens <= allowance
        ) {
          evidenceText = summary.text;
          evidence = [...summary.sources];
          used = fixedTokens + this.tokenizer.count(summary.text);
          compaction = "valid";
        } else {
          compaction = "fallback";
        }
      } catch {
        compaction = "fallback";
      }
    }

    return {
      packet: {
        role: input.role,
        messages: [
          { role: "system", content: pinnedText },
          { role: "user", content: `${input.query}\n\n${evidenceText}`.trim() },
        ],
        evidence,
        budget: {
          maxInputTokens: this.options.maxInputTokens,
          generationReserveTokens: this.options.generationReserveTokens,
          safetyTokens: this.options.safetyTokens,
          usedInputTokens: used,
        },
      },
      beforeTokens,
      afterTokens: used,
      omitted,
      coverage: {
        scanned: input.exhaustive ? candidates.length : retained.length,
        total: candidates.length,
      },
      compaction,
    };
  }
}

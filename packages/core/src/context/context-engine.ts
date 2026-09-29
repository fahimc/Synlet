import type { ContextBuildRequest } from "@synlet/contracts";
import { DomainError, type AccessContext, type RetrievedChunk, type SourceRef } from "../domain/types.js";
import type { CompactorPort, SourceStorePort, TokenizerPort } from "../ports/index.js";

export interface ContextInspector {
  readonly packet: {
    readonly role: ContextBuildRequest["role"];
    readonly messages: readonly { readonly role: "system" | "user"; readonly content: string }[];
    readonly evidence: readonly SourceRef[];
    readonly budget: { readonly maxInputTokens: number; readonly generationReserveTokens: number; readonly safetyTokens: number; readonly usedInputTokens: number };
  };
  readonly beforeTokens: number;
  readonly afterTokens: number;
  readonly omitted: readonly SourceRef[];
  readonly coverage: { readonly scanned: number; readonly total: number; readonly processed: number; readonly included: number; readonly complete: boolean; readonly nextCursor: number | null };
  readonly compaction: "none" | "valid" | "fallback";
}
export interface ContextEngineOptions { readonly maxLookupRounds: number; readonly maxInputTokens: number; readonly generationReserveTokens: number; readonly safetyTokens: number }

/** Compaction is extractive until a separately evaluated entailment checker exists. */
export function validateExtractiveSummary(text: string, refs: readonly SourceRef[], chunks: readonly RetrievedChunk[]): boolean {
  if (!text.trim() || refs.length === 0) return false;
  const allowed = new Map(chunks.map(c => [c.ref.chunkId, c]));
  const declared = new Set<string>();
  for (const ref of refs) {
    const chunk = allowed.get(ref.chunkId);
    if (!ref.chunkId || !chunk || chunk.ref.sourceId !== ref.sourceId || chunk.ref.revision !== ref.revision) return false;
    declared.add(ref.chunkId);
  }
  const used = new Set<string>();
  for (const line of text.split(/\r?\n/u).filter(line => line.trim())) {
    const match = /^\[([^\]]+)\] (.+)$/u.exec(line);
    if (!match || !declared.has(match[1]!)) return false;
    const original = allowed.get(match[1]!)!.text;
    const quote = match[2]!;
    // Whole supplied lines only: cannot turn “Do not delete” into “delete”.
    if (!original.split(/\r?\n/u).some(value => value.trim() === quote)) return false;
    used.add(match[1]!);
  }
  return used.size > 0 && [...declared].every(id => used.has(id));
}

export class ContextEngine {
  constructor(private readonly sources: Pick<SourceStorePort, "search" | "scanAll">, private readonly tokenizer: TokenizerPort, private readonly compactor: CompactorPort, private readonly options: ContextEngineOptions) {}

  async build(input: ContextBuildRequest, access: AccessContext): Promise<ContextInspector> {
    const allowance = this.options.maxInputTokens - this.options.generationReserveTokens - this.options.safetyTokens;
    if (allowance < 1) throw new DomainError("CONTEXT_LIMIT", "Invalid context budget");
    const pinnedText = input.pinnedConstraints.map(item => `PINNED: ${item}`).join("\n");
    const messages = (evidence: string) => [
      { role: "system" as const, content: pinnedText },
      { role: "user" as const, content: `${input.query}\n\n${evidence}`.trim() },
    ];
    const count = async (evidence: string) => this.tokenizer.countMessages ? this.tokenizer.countMessages(messages(evidence)) : this.tokenizer.count(messages(evidence).map(m => `${m.role}: ${m.content}`).join("\n"));
    const fixedTokens = await count("");
    if (fixedTokens > allowance) throw new DomainError("CONTEXT_LIMIT", "Current request and pinned constraints exceed input allowance; originals were not truncated");
    // This interface packs a bounded working set. It does not claim a model has read an entire corpus.
    const candidates = input.exhaustive ? await this.sources.scanAll(access) : await this.sources.search(input.query, 20, access);
    const render = (chunks: readonly RetrievedChunk[]) => chunks.map(c => `[${c.ref.chunkId}] ${c.text}`).join("\n\n");
    const beforeTokens = await count(render(candidates));
    const retained: RetrievedChunk[] = [];
    const omitted: SourceRef[] = [];
    let evidenceText = "";
    let compaction: ContextInspector["compaction"] = "none";
    const processed = new Set<string>();
    for (const chunk of candidates) {
      let text = `[${chunk.ref.chunkId}] ${chunk.text}`;
      const full = [evidenceText, text].filter(Boolean).join("\n\n");
      if (await count(full) > allowance) {
        try {
          const summary = await this.compactor.summarize([chunk], Math.max(1, allowance - await count(evidenceText)));
          processed.add(chunk.ref.chunkId ?? chunk.ref.sourceId);
          if (!validateExtractiveSummary(summary.text, summary.sources, [chunk])) throw new Error("Unsupported summary");
          text = summary.text;
          compaction = "valid";
        } catch {
          compaction = "fallback";
        }
      }
      const next = [evidenceText, text].filter(Boolean).join("\n\n");
      if (await count(next) <= allowance) { evidenceText = next; retained.push(chunk); }
      else omitted.push(chunk.ref);
    }
    const used = await count(evidenceText);
    if (used > allowance) throw new DomainError("CONTEXT_LIMIT", "Final packet exceeds input allowance");
    return {
      packet: { role: input.role, messages: messages(evidenceText), evidence: retained.map(c => c.ref), budget: { maxInputTokens: this.options.maxInputTokens, generationReserveTokens: this.options.generationReserveTokens, safetyTokens: this.options.safetyTokens, usedInputTokens: used } },
      beforeTokens, afterTokens: used, omitted, compaction,
      coverage: { scanned: candidates.length, total: candidates.length, processed: processed.size, included: retained.length, complete: omitted.length === 0, nextCursor: omitted.length ? candidates.findIndex(c => c.ref.chunkId === omitted[0]?.chunkId) : null },
    };
  }
}

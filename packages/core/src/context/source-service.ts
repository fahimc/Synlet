import type { SourceCreateRequest } from "@synlet/contracts";

import {
  DomainError,
  type AccessContext,
  type SourceRef,
} from "../domain/types.js";
import type {
  ArtifactPort,
  ClockPort,
  EmbeddingPort,
  IdPort,
  SemanticIndexPort,
  SourceStorePort,
  StoredSource,
} from "../ports/index.js";

function chunkText(
  content: string,
  ids: IdPort,
): readonly {
  readonly chunkId: string;
  readonly ordinal: number;
  readonly text: string;
}[] {
  const blocks = content
    .split(/\n\s*\n/u)
    .map((part) => part.trim())
    .filter(Boolean);
  const chunks: { chunkId: string; ordinal: number; text: string }[] = [];
  for (const block of blocks) {
    for (let offset = 0; offset < block.length; offset += 1600) {
      chunks.push({
        chunkId: ids.next("chunk"),
        ordinal: chunks.length,
        text: block.slice(offset, offset + 1600),
      });
    }
  }
  return chunks;
}

export class SourceService {
  constructor(
    private readonly store: SourceStorePort,
    private readonly artifacts: ArtifactPort,
    private readonly ids: IdPort,
    private readonly clock: ClockPort,
    private readonly maxBytes: number,
    private readonly embeddings?: EmbeddingPort,
    private readonly semanticIndex?: SemanticIndexPort,
  ) {}

  async ingest(
    request: SourceCreateRequest,
    access: AccessContext,
  ): Promise<StoredSource> {
    const artifact = await this.artifacts.writeText(
      request.content,
      this.maxBytes,
    );
    const source: StoredSource = {
      sourceId: this.ids.next("source"),
      revision: this.ids.next("revision"),
      title: request.title,
      kind: request.kind,
      artifactHash: artifact.hash,
      bytes: artifact.bytes,
      createdAt: this.clock.now(),
      deleted: false,
    };
    const chunks = chunkText(request.content, this.ids);
    const stored = await this.store.add({ source, chunks }, access);
    if (this.embeddings && this.semanticIndex && chunks.length > 0) {
      const timeout = AbortSignal.timeout(300_000);
      const embedded = await this.embeddings.embed(
        {
          requestId: this.ids.next("embedding"),
          taskId: source.sourceId,
          inputs: chunks.map((chunk) => chunk.text),
          deadlineUtc: new Date(Date.now() + 300_000).toISOString(),
        },
        timeout,
      );
      if (embedded.vectors.length !== chunks.length)
        throw new DomainError(
          "INVALID_OUTPUT",
          "Embedding count does not match source chunks",
        );
      for (let index = 0; index < chunks.length; index += 1) {
        const chunk = chunks[index];
        const vector = embedded.vectors[index];
        if (!chunk || !vector)
          throw new DomainError(
            "INVALID_OUTPUT",
            "Embedding result is missing a source chunk or vector",
          );
        this.semanticIndex.upsert(
          chunk.chunkId,
          embedded.modelVersion,
          vector,
          access,
        );
      }
    }
    return stored;
  }

  async get(sourceId: string, access: AccessContext): Promise<StoredSource> {
    const source = await this.store.get(sourceId, access);
    if (!source) throw new DomainError("NOT_FOUND", "Source not found");
    return source;
  }

  async search(query: string, access: AccessContext) {
    const lexical = await this.store.search(query, 20, access);
    if (!this.embeddings || !this.semanticIndex) return lexical;
    const embedded = await this.embeddings.embed(
      {
        requestId: this.ids.next("embedding"),
        taskId: this.ids.next("search"),
        inputs: [query],
        deadlineUtc: new Date(Date.now() + 300_000).toISOString(),
      },
      AbortSignal.timeout(300_000),
    );
    const vector = embedded.vectors[0];
    if (!vector)
      throw new DomainError("INVALID_OUTPUT", "Query embedding is missing");
    const semanticMatches = this.semanticIndex.search(
      embedded.modelVersion,
      vector,
      20,
      access,
    );
    const semantic = await this.store.readByChunkIds(
      semanticMatches.map((match) => match.chunkId),
      access,
    );
    const chunks = new Map(
      [...lexical, ...semantic].flatMap((chunk) =>
        chunk.ref.chunkId ? [[chunk.ref.chunkId, chunk] as const] : [],
      ),
    );
    const scores = new Map<string, number>();
    for (const [rank, chunk] of lexical.entries()) {
      const id = chunk.ref.chunkId;
      if (!id) continue;
      scores.set(id, (scores.get(id) ?? 0) + 1 / (60 + rank));
    }
    for (const [rank, match] of semanticMatches.entries()) {
      scores.set(
        match.chunkId,
        (scores.get(match.chunkId) ?? 0) + 1 / (60 + rank),
      );
    }
    return [...chunks.entries()]
      .sort(
        ([left], [right]) => (scores.get(right) ?? 0) - (scores.get(left) ?? 0),
      )
      .slice(0, 20)
      .map(([, chunk]) => chunk);
  }

  exact(identifier: string, access: AccessContext) {
    return this.store.exact(identifier, 20, access);
  }

  read(ref: SourceRef, access: AccessContext) {
    return this.store.read(ref, access);
  }

  expand(ref: SourceRef, radius: number, access: AccessContext) {
    return this.store.expand(ref, Math.min(Math.max(radius, 0), 8), access);
  }

  scanAll(access: AccessContext) {
    return this.store.scanAll(access);
  }

  async delete(sourceId: string, access: AccessContext): Promise<StoredSource> {
    const deleted = await this.store.delete(sourceId, this.clock.now(), access);
    if ((await this.store.artifactReferenceCount(deleted.artifactHash)) === 0) {
      await this.artifacts.delete(deleted.artifactHash);
    }
    return deleted;
  }
}

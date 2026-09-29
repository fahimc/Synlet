import assert from "node:assert/strict";
import test from "node:test";

import {
  SqliteEmbeddingIndex,
  SqliteSourceStore,
  SynletDatabase,
} from "../../packages/adapters/dist/index.js";

test("embedding versions do not mix and invalidation is scoped", async () => {
  const database = new SynletDatabase(":memory:");
  const sources = new SqliteSourceStore(database);
  const index = new SqliteEmbeddingIndex(database);
  const access = {
    actorId: "actor",
    projectId: "project",
    policyVersion: "policy/v1",
  };
  await sources.add(
    {
      source: {
        sourceId: "s",
        revision: "r",
        title: "source",
        kind: "text",
        artifactHash: "a".repeat(64),
        bytes: 1,
        createdAt: "2026-09-28T00:00:00.000Z",
        deleted: false,
      },
      chunks: [{ chunkId: "c", ordinal: 0, text: "text" }],
    },
    access,
  );
  index.upsert("c", "embed-v1", [1, 0], access);
  index.upsert("c", "embed-v2", [0, 1], access);
  assert.deepEqual(
    index.search("embed-v1", [1, 0], 5, access).map((item) => item.chunkId),
    ["c"],
  );
  assert.equal(index.search("embed-v3", [1, 0], 5, access).length, 0);
  assert.equal(index.invalidateVersion("embed-v1", access), 1);
  assert.equal(index.search("embed-v1", [1, 0], 5, access).length, 0);
  assert.equal(index.search("embed-v2", [0, 1], 5, access).length, 1);
  database.close();
});

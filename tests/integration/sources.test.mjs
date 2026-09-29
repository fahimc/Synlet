import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import { createServer } from "../../apps/server/dist/index.js";
import {
  FileArtifactStore,
  SqliteSourceStore,
  SynletDatabase,
} from "../../packages/adapters/dist/index.js";
import {
  authHeaders,
  testProfile,
  testServices,
} from "../fixtures/test-profile.mjs";

test("sources preserve revision provenance, lookup scope, expansion, and deletion", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-source-"));
  const app = await createServer({
    profile: testProfile,
    authToken: "test-token",
    services: testServices({
      databasePath: join(root, "synlet.sqlite"),
      dataRoot: join(root, "data"),
      workspaceRoot: join(root, "workspace"),
    }),
  });
  context.after(async () => {
    await app.close();
    await rm(root, { force: true, recursive: true });
  });

  const ingested = await app.inject({
    method: "POST",
    url: "/api/v1/sources",
    headers: authHeaders(),
    payload: {
      title: "Fixture corpus",
      kind: "code",
      content:
        "alphaUnique() returns 41.\n\nbetaUnique() corrects it to 42.\n\nFailure: never return 43.",
    },
  });
  assert.equal(ingested.statusCode, 200);
  const source = ingested.json();
  assert.match(source.artifactHash, /^[a-f0-9]{64}$/u);

  const searched = await app.inject({
    method: "POST",
    url: "/api/v1/context/search",
    headers: authHeaders(),
    payload: { query: "corrects" },
  });
  assert.equal(searched.statusCode, 200);
  assert.equal(searched.json()[0].ref.revision, source.revision);
  const chunk = searched.json()[0];

  const exact = await app.inject({
    method: "POST",
    url: "/api/v1/context/search",
    headers: authHeaders(),
    payload: { query: "betaUnique", exact: true },
  });
  assert.equal(exact.json().length, 1);

  const expanded = await app.inject({
    method: "GET",
    url: `/api/v1/sources/${source.sourceId}/chunks/${chunk.ref.chunkId}?revision=${source.revision}&radius=1`,
    headers: authHeaders(),
  });
  assert.equal(expanded.statusCode, 200);
  assert.equal(expanded.json().length, 3);
  assert.ok(expanded.json().every((item) => item.stale === false));

  const crossProject = await app.inject({
    method: "GET",
    url: `/api/v1/sources/${source.sourceId}`,
    headers: authHeaders("project-b"),
  });
  assert.equal(crossProject.statusCode, 404);

  const deleted = await app.inject({
    method: "DELETE",
    url: `/api/v1/sources/${source.sourceId}`,
    headers: authHeaders(),
  });
  assert.equal(deleted.statusCode, 200);
  assert.equal(deleted.json().deleted, true);
  const afterDelete = await app.inject({
    method: "POST",
    url: "/api/v1/context/search",
    headers: authHeaders(),
    payload: { query: "betaUnique", exact: true },
  });
  assert.deepEqual(afterDelete.json(), []);
  const artifactPath = join(
    root,
    "data",
    "artifacts",
    source.artifactHash.slice(0, 2),
    `${source.artifactHash}.txt`,
  );
  await assert.rejects(access(artifactPath));
});

test("source request size is capped before persistence", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-source-cap-"));
  const smallProfile = {
    ...testProfile,
    limits: { ...testProfile.limits, maxSourceBytes: 32 },
  };
  const app = await createServer({
    profile: smallProfile,
    authToken: "test-token",
    services: testServices({
      databasePath: ":memory:",
      dataRoot: join(root, "data"),
    }),
  });
  context.after(async () => {
    await app.close();
    await rm(root, { force: true, recursive: true });
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/sources",
    headers: authHeaders(),
    payload: { title: "too large", kind: "text", content: "x".repeat(33) },
  });
  assert.equal(response.statusCode, 413);
});

test("streaming artifact writes stop at the byte cap and remove partial files", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "synlet-stream-cap-"));
  context.after(async () => rm(root, { force: true, recursive: true }));
  const store = new FileArtifactStore(root);
  await assert.rejects(
    store.writeStream(Readable.from([Buffer.alloc(20), Buffer.alloc(20)]), 32),
    (error) => error?.code === "RESOURCE_EXHAUSTED",
  );
  const { readdir } = await import("node:fs/promises");
  assert.deepEqual(await readdir(root), []);
});

test("old source revisions are explicitly labelled stale", async () => {
  const database = new SynletDatabase(":memory:");
  const store = new SqliteSourceStore(database);
  const accessContext = {
    actorId: "actor",
    projectId: "project",
    policyVersion: "policy/v1",
  };
  await store.add(
    {
      source: {
        sourceId: "source",
        revision: "r1",
        title: "revisioned",
        kind: "text",
        artifactHash: "a".repeat(64),
        bytes: 3,
        createdAt: "2026-09-28T00:00:00.000Z",
        deleted: false,
      },
      chunks: [{ chunkId: "chunk-r1", ordinal: 0, text: "old" }],
    },
    accessContext,
  );
  database.connection
    .prepare(
      "INSERT INTO source_revisions(source_id, revision, artifact_hash, bytes, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run("source", "r2", "b".repeat(64), 3, "2026-09-28T00:00:01.000Z");
  database.connection
    .prepare("UPDATE sources SET current_revision = ? WHERE source_id = ?")
    .run("r2", "source");
  const old = await store.read(
    { sourceId: "source", revision: "r1", chunkId: "chunk-r1" },
    accessContext,
  );
  assert.equal(old.stale, true);
  database.close();
});

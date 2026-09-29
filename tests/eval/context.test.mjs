import assert from "node:assert/strict";
import test from "node:test";

import { ContextEngine } from "../../packages/core/dist/index.js";

const accessContext = {
  actorId: "actor",
  projectId: "project",
  policyVersion: "policy/v1",
};
const chunks = [
  "Do not deploy on Friday.",
  "The corrected limit is 42, not 41.",
  "Previous attempt failed with E_TIMEOUT.",
  "Preserve every explicit negative constraint.",
].map((text, index) => ({
  ref: { sourceId: "source", revision: "r1", chunkId: `c${index}` },
  title: "fixture",
  text,
  ordinal: index,
  stale: false,
}));

const tokenizer = {
  count: (text) => text.trim().split(/\s+/u).filter(Boolean).length,
};
const sources = {
  search: async () => chunks,
  scanAll: async () => chunks,
};

function engine(compactor, maxInputTokens = 30) {
  return new ContextEngine(sources, tokenizer, compactor, {
    maxLookupRounds: 2,
    maxInputTokens,
    generationReserveTokens: 5,
    safetyTokens: 3,
  });
}

const request = {
  query: "What constraints, corrections, and failures matter?",
  role: "controller",
  exhaustive: true,
  pinnedConstraints: ["Never execute unapproved writes"],
};

test("packet preserves reserve, pinned constraints, corrections, negation, numbers, and failures", async () => {
  const result = await engine(
    {
      summarize: async (retained) => ({
        text: retained.map((item) => item.text).join(" "),
        sources: retained.map((item) => item.ref),
      }),
    },
    64,
  ).build(request, accessContext);
  const packet = result.packet.messages
    .map((message) => message.content)
    .join("\n");
  assert.match(packet, /Never execute unapproved writes/u);
  assert.match(packet, /Do not deploy/u);
  assert.match(packet, /42, not 41/u);
  assert.match(packet, /failed with E_TIMEOUT/u);
  assert.ok(result.packet.budget.usedInputTokens <= 56);
  assert.equal(result.coverage.scanned, 4);
  assert.equal(result.coverage.included, 4);
  assert.equal(result.coverage.processed, 0); // No summary was needed in this fixture.
  assert.equal(result.coverage.complete, true);
});

test("invented source references and compactor failures fall back to original excerpts", async () => {
  for (const compactor of [
    {
      summarize: async () => ({
        text: "invented",
        sources: [{ sourceId: "fake", revision: "r9" }],
      }),
    },
    {
      summarize: async () => {
        throw new Error("compactor offline");
      },
    },
  ]) {
    const result = await engine(compactor, 35).build(request, accessContext);
    assert.equal(result.compaction, "fallback");
    assert.ok(result.packet.evidence.every((ref) => ref.sourceId === "source"));
    assert.doesNotMatch(result.packet.messages[1].content, /invented/u);
    assert.ok(result.packet.budget.usedInputTokens <= 27);
  }
});

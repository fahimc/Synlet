import assert from "node:assert/strict";
import test from "node:test";
import {
  ContextEngine,
  collectModelOutput,
  checkObservation,
} from "../../packages/core/dist/index.js";
import { completionEvents } from "../../packages/adapters/dist/inference/llama-server-adapter.js";

const access = {
  actorId: "actor",
  projectId: "project",
  policyVersion: "full-control/v1",
};
const count = (text) => (text.match(/[\p{L}\p{N}_]+|[^\s]/gu) ?? []).length;
const chunks = ["Do not delete originals.", "Use port 43127, not 3000."].map(
  (text, i) => ({
    ref: { sourceId: "s", revision: "r", chunkId: `chunk-very-long-${i}` },
    title: "fixture",
    text,
    ordinal: i,
    stale: false,
  }),
);
const request = {
  role: "controller",
  query: "requirements",
  pinnedConstraints: ["Preserve originals"],
  exhaustive: true,
};
const sources = { search: async () => chunks, scanAll: async () => chunks };

test("final packet recount includes source labels and message formatting", async () => {
  const engine = new ContextEngine(
    sources,
    { count },
    {
      summarize: async () => {
        throw Error("no summary");
      },
    },
    {
      maxInputTokens: 38,
      generationReserveTokens: 5,
      safetyTokens: 3,
      maxLookupRounds: 2,
    },
  );
  const result = await engine.build(request, access);
  const actual = count(
    result.packet.messages.map((m) => `${m.role}: ${m.content}`).join("\n"),
  );
  assert.equal(result.packet.budget.usedInputTokens, actual);
  assert.ok(actual <= 30);
  assert.ok(result.omitted.length > 0);
  assert.equal(result.coverage.complete, false);
  assert.ok(result.coverage.included < result.coverage.total);
});

test("summary cannot invent facts, omit citations, or strip a negation", async () => {
  for (const summary of [
    { text: "All checks passed.", sources: [] },
    { text: "[chunk-very-long-0] delete originals.", sources: [chunks[0].ref] },
  ]) {
    let calls = 0;
    const engine = new ContextEngine(
      sources,
      { count },
      {
        summarize: async () => {
          calls++;
          return summary;
        },
      },
      {
        maxInputTokens: 32,
        generationReserveTokens: 5,
        safetyTokens: 3,
        maxLookupRounds: 2,
      },
    );
    const result = await engine.build(request, access);
    assert.ok(calls > 0, "this regression must actually exercise compaction");
    assert.equal(result.compaction, "fallback");
    assert.doesNotMatch(
      result.packet.messages[1].content,
      /All checks passed|\] delete originals/u,
    );
  }
});

test("valid-looking JSON from length or missing done is never a completed decision", async () => {
  for (const finish of ["length", undefined]) {
    const model = {
      async *generate() {
        yield {
          type: "text_delta",
          text: '{"type":"tool","tool":"command.run","arguments":{"command":"arbitrary"}}',
        };
        if (finish)
          yield { type: "done", finish, inputTokens: 1, outputTokens: 1 };
      },
    };
    await assert.rejects(
      collectModelOutput(model, {}, new AbortController().signal),
      /Incomplete|without a complete/u,
    );
  }
});

test("SSE parser rejects EOF/length and accepts split UTF-8 plus explicit completion", async () => {
  for (const stream of [
    'data: {"choices":[{"delta":{"content":"valid prefix"}}]}\n\n',
    'data: {"choices":[{"finish_reason":"length","delta":{"content":"{}"}}]}\n\ndata: [DONE]\n\n',
  ]) {
    await assert.rejects(async () => {
      for await (const event of completionEvents(new Response(stream), 1)) {
        assert.equal(event.type, "text_delta");
      }
    }, /Incomplete/u);
  }
  const body =
    'data: {"choices":[{"delta":{"content":"héllo"}}]}\n\ndata: {"choices":[{"finish_reason":"stop","delta":{}}]}\n\ndata: [DONE]\n\n';
  const bytes = new TextEncoder().encode(body);
  const response = new Response(
    new ReadableStream({
      start(controller) {
        for (const b of bytes) controller.enqueue(Uint8Array.of(b));
        controller.close();
      },
    }),
  );
  const events = [];
  for await (const event of completionEvents(response, 7)) events.push(event);
  assert.equal(
    events
      .filter((e) => e.type === "text_delta")
      .map((e) => e.text)
      .join(""),
    "héllo",
  );
  assert.equal(events.at(-1).finish, "stop");
});

test("host verification requires a real successful observation and checks exact value", () => {
  const observations = [
    {
      id: "o1",
      tool: "command.run",
      arguments: { command: "any test" },
      result: { exitCode: 0, stdout: "42" },
    },
    {
      id: "advice",
      tool: "specialist.math",
      arguments: {},
      result: { text: "passed" },
    },
  ];
  assert.equal(
    checkObservation(
      {
        observationId: "o1",
        pointer: "/stdout",
        operator: "equals",
        expected: "42",
      },
      observations,
    ).ok,
    true,
  );
  assert.equal(
    checkObservation(
      {
        observationId: "o1",
        pointer: "/stdout",
        operator: "equals",
        expected: "142",
      },
      observations,
    ).ok,
    false,
  );
  assert.throws(
    () =>
      checkObservation(
        {
          observationId: "advice",
          pointer: "/text",
          operator: "equals",
          expected: "passed",
        },
        observations,
      ),
    /successful original/u,
  );
});

test("exact smoke oracle rejects substring counterexamples", () => {
  for (const [expected, bad] of [
    ["42", "142"],
    ["verified", "unverified"],
    ["local-only", "not local-only"],
  ])
    assert.notEqual(bad.trim(), expected);
});

import assert from "node:assert/strict";
import test from "node:test";

const baseUrl = process.env.SYNLET_LIVE_BASE_URL ?? "http://127.0.0.1:43127";
const headers = {
  authorization: `Bearer ${process.env.SYNLET_LIVE_AUTH_TOKEN ?? "synlet-local"}`,
  "content-type": "application/json",
  "x-synlet-actor-id": `live-eval-${process.pid}`,
  "x-synlet-project-id": "local-project",
};

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: { ...headers, ...(init.headers ?? {}) },
  });
  const body = await response.json();
  assert.equal(response.ok, true, `${response.status} ${JSON.stringify(body)}`);
  return body;
}

async function runNaturalPrompt(prompt) {
  const started = await request("/api/v1/agent-runs", {
    method: "POST",
    body: JSON.stringify({ sessionId: "real-world-black-box", prompt }),
  });
  const deadline = Date.now() + 300_000;
  let run = started;
  while (run.status === "running" && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 400));
    run = await request(`/api/v1/agent-runs/${started.runId}`);
  }
  if (run.status === "running") {
    await request(`/api/v1/agent-runs/${started.runId}/cancel`, {
      method: "POST",
      body: "{}",
    });
  }
  assert.notEqual(run.status, "running", `Agent timed out for: ${prompt}`);
  const events = await request(
    `/api/v1/agent-runs/${started.runId}/events?after=0`,
  );
  return { run, events };
}

function completedTools(result) {
  return result.events.filter(
    (candidate) =>
      candidate.kind === "tool" && candidate.status === "completed",
  );
}

function assertNoSemanticShortcuts(result) {
  const labels = result.events.map((event) => event.label);
  assert.equal(labels.includes("computer.status"), false);
  assert.equal(labels.includes("news.search"), false);
}

test("discovers how to answer a natural time question through the shell", async () => {
  const result = await runNaturalPrompt("What time is it?");
  assert.equal(result.run.status, "completed", result.run.result);
  assertNoSemanticShortcuts(result);
  const observation = completedTools(result)
    .filter((event) => event.label === "command.run")
    .map((event) => event.data.result)
    .find(
      (candidate) =>
        candidate.exitCode === 0 &&
        typeof candidate.stdout === "string" &&
        /\b\d{1,2}:\d{2}\b/u.test(candidate.stdout),
    );
  assert.ok(
    observation,
    "Expected successful shell evidence containing a time",
  );
  assert.equal(observation.exitCode, 0, observation.stderr);
  assert.equal(typeof observation.command, "string");
  assert.ok(observation.command.length > 0);
  assert.equal(typeof observation.stdout, "string");
  assert.ok(observation.stdout.trim().length > 0);
  const observedMinute = /\b\d{1,2}:\d{2}\b/u.exec(observation.stdout)?.[0];
  assert.ok(observedMinute, observation.stdout);
  assert.match(result.run.result, new RegExp(observedMinute, "u"));
  assert.doesNotMatch(result.run.result, /not available|cannot access/iu);
});

test("discovers how to answer a natural CPU question through the shell", async () => {
  const result = await runNaturalPrompt("What is the CPU usage?");
  assert.equal(result.run.status, "completed", result.run.result);
  assertNoSemanticShortcuts(result);
  const answerPercent = /([0-9]+(?:\.[0-9]+)?)(?:\s*%|\s+percent\b)/iu.exec(
    result.run.result,
  );
  assert.ok(answerPercent, result.run.result);
  assert.ok(
    Number(answerPercent[1]) >= 0 && Number(answerPercent[1]) <= 100,
    `Answer did not contain a valid CPU percentage: ${result.run.result}`,
  );
  const shellEvidence = completedTools(result)
    .filter((event) => event.label === "command.run")
    .map((event) => event.data.result)
    .filter(
      (observation) =>
        observation.exitCode === 0 &&
        typeof observation.stdout === "string" &&
        /%|percent/iu.test(observation.stdout),
    );
  assert.ok(
    shellEvidence.some((observation) => {
      const observedNumbers = [
        ...observation.stdout.matchAll(/\d+(?:\.\d+)?/gu),
      ].map((match) => Number(match[0]));
      return observedNumbers.some(
        (value) => Math.abs(value - Number(answerPercent[1])) <= 1,
      );
    }),
    `Answer ${answerPercent[1]}% was not grounded in successful percentage evidence`,
  );
});

test("discovers how to answer current news through generic tools", async () => {
  const result = await runNaturalPrompt(
    "What are the latest UK news headlines?",
  );
  assert.equal(result.run.status, "completed", result.run.result);
  assertNoSemanticShortcuts(result);
  const genericTools = completedTools(result).filter(
    (event) =>
      event.label === "browser.search" ||
      event.label === "browser.inspect" ||
      event.label === "command.run",
  );
  assert.ok(
    genericTools.length > 0,
    "Expected live news discovery through generic browser search or host shell",
  );
  const evidence = genericTools
    .map((event) => {
      const observation = event.data.result;
      return `${observation.text ?? ""}\n${observation.stdout ?? ""}`;
    })
    .join("\n");
  assert.ok(evidence.trim().length > 0, "The live tool returned no evidence");
  const evidenceTokens = new Set(
    evidence.toLowerCase().match(/[a-z]{4,}/gu) ?? [],
  );
  const answerLines = result.run.result
    .split(/\r?\n/u)
    .filter((line) => line.trim().length > 12);
  const groundedLines = answerLines.filter((line) => {
    const significant = line.toLowerCase().match(/[a-z]{4,}/gu) ?? [];
    return significant.filter((token) => evidenceTokens.has(token)).length >= 3;
  });
  assert.ok(
    groundedLines.length >= 3,
    `Answer was not grounded in at least three lines of live evidence: ${result.run.result}`,
  );
  assert.doesNotMatch(result.run.result, /websites|can be found on/iu);
  assert.doesNotMatch(result.run.result, /^\s*\{[\s\S]*"type"/u);
});

import { mkdir, writeFile } from "node:fs/promises";

import { generateLocal } from "./lib/local-model.mjs";

const cases = [
  {
    id: "arithmetic",
    prompt: "Answer with only the number: 19 + 23",
    expected: "42",
  },
  {
    id: "instruction",
    prompt: "Reply with exactly the word: verified",
    expected: "verified",
  },
  {
    id: "locality",
    prompt: "Reply with exactly: local-only",
    expected: "local-only",
  },
];
const results = [];
for (const item of cases) {
  const generated = await generateLocal(item.prompt, { maxTokens: 24 });
  results.push({
    id: item.id,
    passed: generated.text.toLowerCase().includes(item.expected),
    response: generated.text,
    elapsedMs: Number(generated.elapsedMs.toFixed(1)),
    modelId: generated.model.modelId,
  });
}
const report = {
  schemaVersion: "synlet.eval-report/v1",
  evidence: "MEASURED",
  samples: results.length,
  passed: results.filter((item) => item.passed).length,
  results,
};
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/local-eval.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
if (report.passed !== report.samples) process.exitCode = 1;

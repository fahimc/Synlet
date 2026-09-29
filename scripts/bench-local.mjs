import { mkdir, writeFile } from "node:fs/promises";

import { generateLocal } from "./lib/local-model.mjs";

const generated = await generateLocal(
  "In two concise sentences, explain why local inference protects privacy.",
  { maxTokens: 96 },
);
const report = {
  schemaVersion: "synlet.benchmark/v1",
  evidence: "MEASURED",
  modelId: generated.model.modelId,
  runtime: "llama.cpp-b11237-cuda-12.4",
  samples: 1,
  elapsedMs: Number(generated.elapsedMs.toFixed(1)),
  outputTokens: generated.usage?.completion_tokens ?? 0,
  tokensPerSecond: Number(
    (generated.timings?.predicted_per_second ?? 0).toFixed(2),
  ),
};
await mkdir("reports", { recursive: true });
await writeFile(
  "reports/local-benchmark.json",
  `${JSON.stringify(report, null, 2)}\n`,
);
process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

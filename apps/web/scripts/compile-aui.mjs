import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { compileReact, parse } from "@codedia/parser";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = resolve(root, "ui/agent-harness.aui");
const outputPath = resolve(root, "src/generated/AgentHarness.tsx");
const source = await readFile(sourcePath, "utf8");
const output = compileReact(parse(source)).replaceAll(
  'onAction("item.action")',
  "onAction(item.action)",
);
await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${output.trimEnd()}\n`, "utf8");
process.stdout.write(`Compiled ${sourcePath} -> ${outputPath}\n`);

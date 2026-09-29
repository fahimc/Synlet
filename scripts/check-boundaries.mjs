import process from "node:process";

import { analyzeWorkspace } from "./lib/dependency-boundaries.mjs";

const violations = await analyzeWorkspace(process.cwd());
if (violations.length > 0) {
  process.stderr.write(
    `Dependency boundary check failed:\n${violations.map((item) => `- ${item}`).join("\n")}\n`,
  );
  process.exitCode = 1;
} else {
  process.stdout.write("Dependency boundaries: OK\n");
}

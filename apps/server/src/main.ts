import { resolve } from "node:path";

import { createServer } from "./bootstrap/create-server.js";
import { loadRuntimeProfile } from "./bootstrap/config.js";

function readConfigArgument(arguments_: readonly string[]): string {
  const index = arguments_.indexOf("--config");
  const configured = index >= 0 ? arguments_[index + 1] : undefined;
  return resolve(configured ?? "config/profiles/local-12gb.json");
}

async function main(): Promise<void> {
  const profile = await loadRuntimeProfile(
    readConfigArgument(process.argv.slice(2)),
  );
  const configuredDataRoot = process.env.SYNLET_DATA_ROOT;
  const app = await createServer({
    profile,
    ...(configuredDataRoot
      ? {
          services: {
            dataRoot: configuredDataRoot,
            workspaceRoot: resolve(configuredDataRoot, "workspace"),
          },
        }
      : {}),
  });

  const close = async (): Promise<void> => {
    await app.close();
    process.exitCode = 0;
  };
  process.once("SIGINT", () => void close());
  process.once("SIGTERM", () => void close());

  await app.listen({ host: profile.server.host, port: profile.server.port });
  process.stdout.write(
    `Synlet local LLM gateway listening at http://${profile.server.host}:${profile.server.port}\n`,
  );
}

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : "Unknown startup error";
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});

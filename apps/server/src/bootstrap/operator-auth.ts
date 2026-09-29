import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export interface OperatorPrincipal {
  readonly actorId: string;
  readonly projectIds: readonly string[];
}
export async function operatorToken(dataRoot: string): Promise<string> {
  if (process.env.SYNLET_AUTH_TOKEN) {
    if (process.env.SYNLET_AUTH_TOKEN.length < 24)
      throw new Error("SYNLET_AUTH_TOKEN must contain at least 24 characters");
    return process.env.SYNLET_AUTH_TOKEN;
  }
  await mkdir(dataRoot, { recursive: true });
  const path = resolve(dataRoot, "operator-auth.json");
  try {
    const value = JSON.parse(await readFile(path, "utf8")) as {
      token?: unknown;
    };
    if (typeof value.token !== "string" || value.token.length < 24)
      throw new Error("Invalid operator token file");
    return value.token;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const token = randomBytes(32).toString("hex");
  try {
    await writeFile(path, JSON.stringify({ token }) + "\n", {
      mode: 0o600,
      flag: "wx",
    });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST")
      return operatorToken(dataRoot);
    throw error;
  }
  process.stdout.write(
    `Synlet operator token saved at ${path}. Paste it into the local UI login. Protect this file and your authenticated remote proxy.\n`,
  );
  return token;
}

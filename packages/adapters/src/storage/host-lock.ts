import { mkdir, readFile, writeFile, unlink } from "node:fs/promises";
import { resolve } from "node:path";
import { randomUUID } from "node:crypto";
function lockRecord(text: string): { pid: number; owner: string } {
  const value: unknown = JSON.parse(text);
  if (
    !value ||
    typeof value !== "object" ||
    !("pid" in value) ||
    !("owner" in value) ||
    typeof value.pid !== "number" ||
    !Number.isSafeInteger(value.pid) ||
    value.pid < 1 ||
    typeof value.owner !== "string"
  )
    throw new Error("Invalid host lock; inspect it manually");
  return { pid: value.pid, owner: value.owner };
}
/** Exclusive local supervisor ownership, not an execution permission policy. */
export async function acquireHostLock(
  root: string,
): Promise<() => Promise<void>> {
  const directory = resolve(root, "run");
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, "agent.lock");
  const owner = randomUUID();
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      await writeFile(path, JSON.stringify({ pid: process.pid, owner }), {
        flag: "wx",
        mode: 0o600,
      });
      return async () => {
        try {
          const current = lockRecord(await readFile(path, "utf8"));
          if (current.owner === owner) await unlink(path);
        } catch (error: unknown) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      };
    } catch (error: unknown) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const current = lockRecord(await readFile(path, "utf8"));
      let live = true;
      try {
        process.kill(current.pid, 0);
      } catch (probe: unknown) {
        if ((probe as NodeJS.ErrnoException).code !== "ESRCH") throw probe;
        live = false;
      }
      if (live)
        throw new Error("Another Synlet supervisor owns this data root", {
          cause: error,
        });
      await unlink(path).catch((failure: unknown) => {
        if ((failure as NodeJS.ErrnoException).code !== "ENOENT") throw failure;
      });
    }
  }
  throw new Error("Could not claim Synlet host lock");
}

import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { DomainError, type Json } from "@synlet/core";

/** Deliberately NOT a sandbox. Paths may be absolute or outside the workspace. */
export class FullControlFiles {
  constructor(private readonly cwd: string) {}
  async execute(
    tool: string,
    args: Record<string, Json>,
    signal?: AbortSignal,
  ): Promise<Json> {
    signal?.throwIfAborted();
    if (typeof args.path !== "string" || !args.path.trim())
      throw new DomainError("INVALID_OUTPUT", "path must be a nonempty string");
    const path = resolve(this.cwd, args.path);
    if (tool === "file.delete") {
      await rm(path, {
        recursive: args.recursive === true,
        force: args.force === true,
      });
      return { ok: true, path, deleted: true, executionMode: "full-control" };
    }
    if (tool === "image.open") {
      const info = await stat(path);
      if (info.size > 8 * 1024 * 1024)
        throw new DomainError(
          "RESOURCE_EXHAUSTED",
          "Image exceeds 8 MiB input limit",
        );
      const bytes = await readFile(path);
      const mime = bytes
        .subarray(0, 8)
        .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        ? "image/png"
        : bytes[0] === 255 && bytes[1] === 216
          ? "image/jpeg"
          : bytes.toString("ascii", 0, 4) === "RIFF" &&
              bytes.toString("ascii", 8, 12) === "WEBP"
            ? "image/webp"
            : undefined;
      if (!mime)
        throw new DomainError(
          "INVALID_OUTPUT",
          "Expected PNG, JPEG or WebP image",
        );
      return {
        ok: true,
        path,
        bytes: bytes.length,
        imageDataUrl: `data:${mime};base64,${bytes.toString("base64")}`,
      };
    }
    let existing = Buffer.alloc(0);
    try {
      const info = await stat(path);
      if (info.size > 4 * 1024 * 1024)
        throw new DomainError(
          "RESOURCE_EXHAUSTED",
          "Use command.run to process this file in chunks; direct text tool limit is 4 MiB",
        );
      existing = await readFile(path);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      if (tool === "file.read") throw error;
    }
    const hash = createHash("sha256").update(existing).digest("hex");
    if (tool === "file.read")
      return {
        ok: true,
        path,
        content: existing.toString("utf8"),
        sha256: hash,
        bytes: existing.length,
      };
    if (typeof args.content !== "string")
      throw new DomainError("INVALID_OUTPUT", "content must be a string");
    if (tool === "file.patch" && args.expectedSha256 !== hash)
      throw new DomainError(
        "STALE_REVISION",
        "File changed since observation; read it again or deliberately use file.write",
      );
    signal?.throwIfAborted();
    await mkdir(dirname(path), { recursive: true });
    const temporary = `${path}.synlet-${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, args.content, "utf8");
      signal?.throwIfAborted();
      await rename(temporary, path);
    } finally {
      await rm(temporary, { force: true }).catch(() => undefined);
    }
    return {
      ok: true,
      path,
      bytes: Buffer.byteLength(args.content),
      sha256: createHash("sha256").update(args.content).digest("hex"),
      executionMode: "full-control",
    };
  }
}

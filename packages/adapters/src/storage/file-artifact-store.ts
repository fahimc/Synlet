import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, rename, rm, stat } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";

import { DomainError, type ArtifactPort } from "@synlet/core";

export class FileArtifactStore implements ArtifactPort {
  constructor(private readonly root: string) {}

  async writeText(content: string, maxBytes: number) {
    return this.writeStream(
      Readable.from([Buffer.from(content, "utf8")]),
      maxBytes,
    );
  }

  async writeStream(stream: AsyncIterable<Uint8Array>, maxBytes: number) {
    await mkdir(this.root, { recursive: true });
    const temporaryPath = resolve(this.root, `.incoming-${randomUUID()}.tmp`);
    const handle = await open(temporaryPath, "wx");
    const hash = createHash("sha256");
    let bytes = 0;
    try {
      for await (const chunk of stream) {
        bytes += chunk.byteLength;
        if (bytes > maxBytes) {
          throw new DomainError(
            "RESOURCE_EXHAUSTED",
            "Source exceeds the configured byte cap",
          );
        }
        hash.update(chunk);
        await handle.write(chunk);
      }
      await handle.sync();
    } catch (error: unknown) {
      await handle.close();
      await rm(temporaryPath, { force: true });
      throw error;
    }
    await handle.close();
    const digest = hash.digest("hex");
    const finalPath = this.pathFor(digest);
    await mkdir(dirname(finalPath), { recursive: true });
    try {
      await rename(temporaryPath, finalPath);
    } catch (error: unknown) {
      const existing = await stat(finalPath).catch(() => undefined);
      if (!existing) throw error;
      await rm(temporaryPath, { force: true });
    }
    return { hash: digest, bytes };
  }

  readStream(hash: string) {
    return createReadStream(this.pathFor(hash));
  }

  async delete(hash: string): Promise<void> {
    await rm(this.pathFor(hash), { force: true });
  }

  private pathFor(hash: string): string {
    if (!/^[a-f0-9]{64}$/u.test(hash))
      throw new DomainError("POLICY_DENIED", "Invalid artifact hash");
    return resolve(this.root, hash.slice(0, 2), `${hash}.txt`);
  }
}

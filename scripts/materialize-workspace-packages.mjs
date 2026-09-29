import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import process from "node:process";

const packages = ["contracts", "core", "adapters", "testkit"];

for (const name of packages) {
  const source = resolve(process.cwd(), "packages", name);
  const destination = resolve(process.cwd(), "node_modules", "@synlet", name);
  await mkdir(destination, { recursive: true });
  await cp(resolve(source, "dist"), resolve(destination, "dist"), {
    force: true,
    recursive: true,
  });
  const manifest = JSON.parse(
    await readFile(resolve(source, "package.json"), "utf8"),
  );
  delete manifest.dependencies;
  delete manifest.dependenciesMeta;
  await writeFile(
    resolve(destination, "package.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
    "utf8",
  );
}

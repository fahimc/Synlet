import { readFile, readdir } from "node:fs/promises";
import { resolve } from "node:path";

const importPattern =
  /(?:import|export)\s+(?:[^"']*?\s+from\s+)?["']([^"']+)["']/g;

const allowedDependencies = new Map([
  ["@synlet/contracts", new Set()],
  ["@synlet/core", new Set(["@synlet/contracts"])],
  ["@synlet/adapters", new Set(["@synlet/contracts", "@synlet/core"])],
  [
    "@synlet/server",
    new Set(["@synlet/contracts", "@synlet/core", "@synlet/adapters"]),
  ],
  ["@synlet/web", new Set(["@synlet/contracts"])],
  [
    "@synlet/testkit",
    new Set(["@synlet/contracts", "@synlet/core", "@synlet/adapters"]),
  ],
]);

async function filesBelow(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(
    () => [],
  );
  const results = [];
  for (const entry of entries) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) results.push(...(await filesBelow(path)));
    else if (entry.isFile() && /\.[cm]?tsx?$/.test(entry.name))
      results.push(path);
  }
  return results;
}

async function discoverPackages(root) {
  const packageDirectories = [];
  for (const parent of ["packages", "apps"]) {
    const parentPath = resolve(root, parent);
    const entries = await readdir(parentPath, { withFileTypes: true }).catch(
      () => [],
    );
    for (const entry of entries) {
      if (entry.isDirectory())
        packageDirectories.push(resolve(parentPath, entry.name));
    }
  }

  const packages = [];
  for (const directory of packageDirectories) {
    const manifest = JSON.parse(
      await readFile(resolve(directory, "package.json"), "utf8"),
    );
    packages.push({ name: manifest.name, directory });
  }
  return packages;
}

function findCycles(graph) {
  const cycles = [];
  const visited = new Set();
  const active = [];

  function visit(node) {
    const activeIndex = active.indexOf(node);
    if (activeIndex >= 0) {
      cycles.push([...active.slice(activeIndex), node]);
      return;
    }
    if (visited.has(node)) return;
    active.push(node);
    for (const dependency of graph.get(node) ?? []) visit(dependency);
    active.pop();
    visited.add(node);
  }

  for (const node of graph.keys()) visit(node);
  return cycles;
}

export async function analyzeWorkspace(root) {
  const packages = await discoverPackages(root);
  const packageNames = new Set(packages.map(({ name }) => name));
  const graph = new Map(packages.map(({ name }) => [name, new Set()]));
  const violations = [];

  for (const workspacePackage of packages) {
    const files = await filesBelow(resolve(workspacePackage.directory, "src"));
    for (const file of files) {
      const source = await readFile(file, "utf8");
      for (const match of source.matchAll(importPattern)) {
        const specifier = match[1];
        const target = [...packageNames].find(
          (name) => specifier === name || specifier.startsWith(`${name}/`),
        );
        if (!target) continue;
        graph.get(workspacePackage.name).add(target);
        if (specifier !== target) {
          violations.push(
            `${workspacePackage.name} deep-imports private path ${specifier}`,
          );
        }
        const allowed = allowedDependencies.get(workspacePackage.name);
        if (allowed && !allowed.has(target)) {
          violations.push(
            `${workspacePackage.name} may not depend on ${target}`,
          );
        }
      }
    }
  }

  for (const cycle of findCycles(graph)) {
    violations.push(`dependency cycle: ${cycle.join(" -> ")}`);
  }
  return violations;
}

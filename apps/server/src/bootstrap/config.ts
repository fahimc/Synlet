import { readFile } from "node:fs/promises";

import { runtimeProfileSchema, type RuntimeProfile } from "@synlet/contracts";
import { Ajv2020 } from "ajv/dist/2020.js";

const ajv = new Ajv2020({ allErrors: true, strict: true });
const validateRuntimeProfile =
  ajv.compile<RuntimeProfile>(runtimeProfileSchema);

export function parseRuntimeProfile(input: unknown): RuntimeProfile {
  if (!validateRuntimeProfile(input)) {
    const details = ajv.errorsText(validateRuntimeProfile.errors, {
      separator: "; ",
    });
    throw new Error(`Invalid runtime profile: ${details}`);
  }

  return input;
}

export async function loadRuntimeProfile(
  path: string,
): Promise<RuntimeProfile> {
  let parsed: unknown;

  try {
    parsed = JSON.parse(await readFile(path, "utf8")) as unknown;
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "unknown error";
    throw new Error(`Unable to read runtime profile at ${path}: ${message}`, {
      cause: error,
    });
  }

  return parseRuntimeProfile(parsed);
}

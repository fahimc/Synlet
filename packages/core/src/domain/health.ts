import type { HealthResponse } from "@synlet/contracts";

import type { RuntimeIdentityPort } from "../ports/runtime-identity.js";

export function createHealthResponse(
  runtime: RuntimeIdentityPort,
  readiness: HealthResponse["readiness"],
): HealthResponse {
  const mode = runtime.getMode();
  const evidenceLabel = runtime.getEvidenceLabel();
  return {
    service: "synlet",
    version: "0.0.0",
    status: "ok",
    readiness,
    mode,
    evidenceLabel,
  };
}

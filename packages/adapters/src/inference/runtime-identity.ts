import type { RuntimeIdentityPort } from "@synlet/core";

export class ProfileRuntimeIdentity implements RuntimeIdentityPort {
  constructor(private readonly evidence: "MEASURED") {}

  getMode(): "local" {
    return "local";
  }

  getEvidenceLabel(): "MEASURED" {
    return this.evidence;
  }
}

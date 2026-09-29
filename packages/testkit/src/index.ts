import type { RuntimeIdentityPort } from "@synlet/core";

export class FakeRuntimeIdentity implements RuntimeIdentityPort {
  getMode(): "local" {
    return "local";
  }

  getEvidenceLabel(): "MEASURED" {
    return "MEASURED";
  }
}

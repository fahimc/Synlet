import { performance } from "node:perf_hooks";

export interface StageMeasurement {
  readonly stage: string;
  readonly evidence: "MEASURED";
  readonly durationMs: number;
  readonly startedAt: string;
}

export class StageTimer {
  async measure<T>(
    stage: string,
    action: () => Promise<T>,
  ): Promise<{ result: T; measurement: StageMeasurement }> {
    const startedAt = new Date().toISOString();
    const start = performance.now();
    const result = await action();
    return {
      result,
      measurement: {
        stage,
        evidence: "MEASURED",
        durationMs: Number((performance.now() - start).toFixed(3)),
        startedAt,
      },
    };
  }
}

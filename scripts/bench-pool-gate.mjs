process.stdout.write(
  `${JSON.stringify({ schemaVersion: "synlet.pool-gate/v1", evidence: "SKIPPED", reason: "T10 is optional and no measured single-host throughput or queue-wait requirement justifies distributed workers" }, null, 2)}\n`,
);

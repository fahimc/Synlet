# Evaluate the actual SOMA harness

## What the automated checks establish

CPU CI exercises real HTTP/SQLite/browser wiring using deterministic inference doubles, native-adapter wire contracts, source preservation, cancellation, recovery and actual temporary shell/file operations. It does not evaluate the installed model weights or GPU performance.

`pnpm eval:local` is an explicitly labelled three-prompt text smoke test. `pnpm smoke:models` checks model loading/text response, not specialist quality. Neither can establish that vision receives useful images, routing is calibrated, or the multi-model system beats a controller alone.

## End-to-end model regression runner

Start the real local stack, then run from a second terminal:

```powershell
$env:SYNLET_LIVE_AUTH_TOKEN = (Get-Content .\runtime-data\operator-auth.json -Raw | ConvertFrom-Json).token
$env:SYNLET_EVAL_PROFILE_LABEL = "adaptive-local-12gb"
$env:SYNLET_EVAL_SERVICE_COMMIT = (git rev-parse HEAD)
pnpm eval:harness
Remove-Item Env:SYNLET_LIVE_AUTH_TOKEN
```

Use the actual data-root token or the externally configured `SYNLET_AUTH_TOKEN`, not an obsolete static token. Do not paste credentials into issues or reports. `SYNLET_LIVE_BASE_URL` selects a different authorised endpoint. Profile/commit labels are operator declarations, not remote attestation.

The runner uses the same `/api/v1/agent-runs` path as the UI, preserves a session across case turns, retrieves persisted traces, enforces a deadline and cancels timed-out runs. Exact text, exact JSON (including types and extra keys), and numeric comparisons are independent host oracles. A model's own approval is not a passing test. It records the model registry, suite SHA-256, failed cases, sample count and end-to-end p50/p95 latency under ignored `reports/`. These are wall-clock task measurements; they are not decode-only tokens/second or controlled cold-start measurements.

The bundled ten cases cover arithmetic, JSON, source corrections, code reading and cross-turn memory. They are PUBLIC REGRESSION FIXTURES, not a private holdout, a coding benchmark or proof of arbitrary PC-management reliability. Instructions in these fixtures are never imported by the runtime and do not create intent-to-command routes.

## Private/extended suites

```text
pnpm eval:harness path/to/private-suite.json
```

Use the versioned shape in `evals/harness-regressions.json`. A case has `id`, `category`, one or more `turns`, and a final-answer `oracle`. A turn can include `images` using the same bounded PNG/JPEG/WebP data-input format as the agent API. Keep expected answers on the evaluator side, out of prompts. Include independent image fixtures with known labels and ambiguous/corrupted-image cases before claiming visual quality.

For code-editing and service-management quality, pair real agent tasks with independently prepared filesystem assertions, tests/builds and service-state probes on a disposable authorised machine. Exact text agreement is not an adequate oracle for those tasks. The full-control harness is deliberately not sandboxed and might change the host in response to evaluation prompts; run destructive cases only in an appropriate test environment. No such destructive live evaluation is run by ordinary CPU CI.

## Controller-only comparison

`SYNLET_MODEL_STRATEGY=adaptive` is the default. For a controlled comparison, restart with:

```powershell
$env:SYNLET_MODEL_STRATEGY = "controller-only"
pnpm dev
```

This experimental configuration bypasses Julia/skill selection and specialist delegation; the controller retains the SAME unrestricted generic tool catalogue, memory interfaces, completion validation and execution budget. The controller also performs any required compaction. It does not install different execution routes or alter permissions. Set `SYNLET_MODEL_STRATEGY=adaptive` and restart to restore the standard model ensemble. The chosen strategy appears in the run trace.

Run the same suite with separate identically seeded data roots, equal tools/deadlines/model quantisations, no overlapping jobs, and recorded hardware/runtime versions. Clear or control prior evaluation memories to avoid answer contamination. Measure multiple cold and warm repetitions separately; never compare an unloaded specialist run against a prewarmed baseline without labelling it. Compare independent task success first, then latency, queue time, model calls and peak memory. Do not combine incompatible modalities or unequal budgets into a single winner score.

A useful release gate should include private multi-label routing recall and calibration, image extraction/grounding accuracy, compaction retention of negatives/numbers/corrections, independent code tests, multi-turn tasks, restart/cancel fault cases, and matched baseline results. Record failures and unavailable roles explicitly. The remediation supplies the engineering fixes and evaluation mechanism; it does not invent local-model quality measurements.

# SOMA review remediation

Scope: review of e648271 and the owner's subsequent explicit full-control requirement.

## Implemented changes to validate

- Shared UI/model API AgentHarness, role-aware requests, cross-turn session memory and generic context lookup.
- Native template/token accounting, actual image transport and visual-token prefill, no silent reasoning-mode downgrade.
- Source-preserving extractive compaction, exact source validation, explicit omitted/included/processed coverage.
- Valid embedding batches and pre-commit worker validation; query/document embedding modes.
- Advisory Julia decisions with attachment metadata and marked bounded routing briefs; enabled experts are not hidden by classifier mistakes.
- Full-control shell with PowerShell/CMD selection, unrestricted host file read/write/edit/delete and generic image/browser tools.
- Server-authenticated operator identity, private runtime bearer token, no published frontend credential.
- Persisted idempotent agent intake, bounded serialized runs, checkpoints/action intent, conservative crash recovery and cancellation.
- Confirmed model completion before tools, generic host evidence assertions, model critique labelled separately from verification.
- Stronger regression tests and wider CI; exact smoke matching instead of substring acceptance.

## Test evidence policy

The source branch's automated checks and logs are the source of truth. This document is not a pre-filled passing test report. Real CUDA/Julia/EmbeddingGemma/image quality and a rebuilt multi-gigabyte portable release require local operator validation and are not asserted by the CPU tests.

## Preserved intentionally

No time/CPU/news intent-to-command lookup. No shell command allowlist. No content filter inserted around the LLM. No workspace-only filesystem restriction in full-control mode. Existing model weights and their native learned behavior are not changed. OS privileges are those of the launch account.

## Operator migration

Restart after pulling. Replace the old static bearer credential with the private operator token in runtime-data/operator-auth.json. Keep the authenticated remote proxy in front. Existing sources, history, model files and archived blueprints are preserved; checkpoint/memory tables are additive.

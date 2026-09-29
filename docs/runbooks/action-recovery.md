# Action recovery runbook

Use this when a tool receipt has status `outcome_unknown`.

1. Stop new actions for the affected task and record the action ID, tool ID,
   arguments, action hash and task revision from the journal.
2. Inspect the target through a read-only path. For `file.patch`, compare the file's
   SHA-256 and content with the proposed result.
3. If the intended result is present, record the incident as completed externally.
   Do not replay the original approval; the action claim is deliberately one-shot.
4. If the intended result is absent, create a new action against the task's current
   revision and obtain a new hash-bound approval.
5. Preserve the original receipt and investigation evidence. Restore service only
   after the target state is known.

For stale approvals, refresh the task, propose again, and review the new hash. Never
edit approval or receipt rows by hand.

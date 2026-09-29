# Model onboarding

1. Review the candidate identity, upstream licence, native template, tokenizer and
   runtime support. Do not infer a conversion or projector from the model name.
2. Place the user-authorised artifact under the chosen model root. Compute SHA-256
   locally and add its exact path/hash to `config/models.lock.json`.
3. Pin the exact llama.cpp executable/build and record its provenance. Never use an
   unversioned executable found opportunistically on PATH.
4. Run `pnpm smoke:models`; then role tests for cancellation, context limits, native
   tool parsing, truncation and output validation. Vision additionally requires the
   exact projector and coordinate checks.
5. Run `pnpm eval:local` and `pnpm bench:local`. Promote only measured results that
   pass the fixed gates. Keep failing candidates disabled with their reason.

Rollback by disabling the model lock entry and restoring the prior lock. Model files
are separate from program and data roots and must not be deleted automatically.

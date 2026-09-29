# Portable release operations

Run `pnpm test:release` to build and verify `releases/synlet-local`. The packager
requires the exact Node 24.21.0 executable; set `SYNLET_NODE_RUNTIME` if it is not
discoverable. Generated release files are ignored by Git.

Inside the bundle:

- `start.cmd` verifies and starts the bundled llama.cpp CUDA server and local gateway
  with separate program and data roots.
- `runtime/node.exe scripts/synlet-cli.mjs doctor --root <bundle> --data <data>`
  checks required files and data-root write access.
- Use `backup --data <data> --output <backup>` while stopped.
- Use `restore --data <data> --backup <backup> --confirm` while stopped. The old data
  root is retained beside the restored root for rollback.

Verify `release-manifest.json` hashes before use. Updates replace only the program
root. Never overwrite the selected data root. The immutable model and runtime ship
inside the program root and are verified before startup.

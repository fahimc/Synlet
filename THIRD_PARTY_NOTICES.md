# Third-party notices

The portable local bundle contains Node.js and the exact npm packages listed in
`dependency-inventory.json`. Their licence declarations and package-level licence
files remain within the bundle. Node.js is distributed under its upstream licence.

It also contains CPython 3.11.4, the installed Python packages recorded by their
package metadata, and llama.cpp build b11237 with its bundled CUDA 12.4 runtime
libraries. Upstream licence files remain with those distributions where supplied.

Enabled model artifacts are:

- SupersonicLabs/Julia-1 revision `a85b127321d580d65176c89ced8273f305745d85`
  (Apache-2.0).
- openbmb/MiniCPM5-2B-GGUF revision
  `2079a22f3beaa4e306449978533478fe0522f4b3` (Apache-2.0).
- mradermacher/Nanbeige4.1-3B-GGUF revision
  `c2c9e50a6bffb92c194c286e90cdf794b5657b13` (Apache-2.0 community conversion).
- LiquidAI/LFM2.5-VL-3B-GGUF revision
  `6f730e9a2c454e8af9adc29db58e638e01e5957f` (LFM 1.0 licence), including its
  vision projector.
- lmstudio-community/Qwen3.5-0.8B-GGUF revision
  `26bab2c9369648924251c0ebb3dae012f5147707` (Apache-2.0 community conversion).
- google/embeddinggemma-300m revision
  `57c266a740f537b4dc058e1b0cda161fd15afa75` (Gemma Terms of Use). Access to this
  gated model was accepted and authenticated by the local operator.

Exact filenames, enabled state and SHA-256 values are recorded in
`config/models.lock.json`; llama.cpp provenance is in `config/runtime.lock.json`.
K2-Horizon and the older Qwen3-4B fallback are disabled and are not included in the
portable bundle.

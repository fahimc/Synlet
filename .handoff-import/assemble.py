"""One-time, checksum-verified import of the user-approved Synlet handoff."""
from __future__ import annotations

import base64
import hashlib
import io
import json
import lzma
from pathlib import Path, PurePosixPath
import subprocess
import zipfile


def digest(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def checked_path(root: Path, name: str) -> Path:
    p = PurePosixPath(name)
    if (not name or p.is_absolute() or str(p) != name or
            any(x in ("", ".", "..") for x in p.parts) or
            "\\" in name or ":" in name or
            p.parts[0] in (".git", ".github", ".handoff-import")):
        raise ValueError(f"Unsafe output path: {name!r}")
    target = root.joinpath(*p.parts)
    if not target.resolve().is_relative_to(root):
        raise ValueError(f"Output escapes repository: {name!r}")
    return target


def make_zip(spec: dict) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as archive:
        archive.comment = base64.b64decode(spec["comment_b64"], validate=True)
        for entry in spec["entries"]:
            meta = entry["info"]
            info = zipfile.ZipInfo(meta["filename"], tuple(meta["date_time"]))
            for key in ("compress_type", "create_system", "create_version",
                        "extract_version", "flag_bits", "volume",
                        "internal_attr", "external_attr"):
                setattr(info, key, meta[key])
            info.comment = base64.b64decode(meta["comment_b64"], validate=True)
            info.extra = base64.b64decode(meta["extra_b64"], validate=True)
            archive.writestr(info, entry["text"].encode("utf-8"),
                             compress_type=meta["compress_type"],
                             compresslevel=spec["compression_level"])
    return buf.getvalue()


def main() -> None:
    root = Path.cwd().resolve()
    source = root / ".handoff-import"
    ready = json.loads((source / "READY.json").read_text(encoding="utf-8"))
    if ready["version"] != 1 or ready["encoding"] != "base64-lzma-json":
        raise ValueError("Unsupported handoff manifest")
    pieces = []
    for i, meta in enumerate(ready["parts"]):
        if meta["file"] != f"part-{i:03d}.b64":
            raise ValueError("Invalid part sequence")
        data = (source / meta["file"]).read_bytes()
        if len(data) != meta["bytes"] or digest(data) != meta["sha256"]:
            raise ValueError(f"Transfer checksum mismatch: {meta['file']}")
        pieces.append(b"".join(data.split()))
    packed = base64.b64decode(b"".join(pieces), validate=True)
    if (len(packed) != ready["payload_bytes"] or
            digest(packed) != ready["payload_sha256"]):
        raise ValueError("Payload checksum mismatch")
    decoder = lzma.LZMADecompressor(memlimit=256 * 1024 * 1024)
    decoded = decoder.decompress(packed, max_length=5 * 1024 * 1024)
    if not decoder.eof or decoder.unused_data or len(decoded) != ready["decoded_bytes"]:
        raise ValueError("Invalid or oversized decompressed payload")
    payload = json.loads(decoded)
    expected = ready["expected_files"]
    if payload["version"] != 1 or payload["sha256"] != expected or len(expected) != 21:
        raise ValueError("Unexpected file manifest")
    outputs = {name: text.encode("utf-8") for name, text in payload["files"].items()}
    for name, spec in payload["archives"].items():
        if name in outputs:
            raise ValueError("Duplicate output")
        outputs[name] = make_zip(spec)
    if set(outputs) != set(expected):
        raise ValueError("Missing or extra output files")
    # Verify every output before changing any destination.
    for name, data in outputs.items():
        checked_path(root, name)
        if digest(data) != expected[name]:
            raise ValueError(f"Output checksum mismatch: {name}")
    for name, data in outputs.items():
        target = checked_path(root, name)
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(data)
    # Stage exactly the verified files. The workflow commits this whole index.
    subprocess.run(["git", "add", "--", *sorted(outputs)], check=True)
    # Check Git's stored bytes too, including possible line-ending filters.
    for name, data in outputs.items():
        blob = subprocess.check_output(["git", "show", f":{name}"])
        if digest(blob) != expected[name]:
            raise ValueError(f"Git index checksum mismatch: {name}")
    print(f"Verified and staged {len(outputs)} files; all SHA-256 checks passed.")


if __name__ == "__main__":
    main()

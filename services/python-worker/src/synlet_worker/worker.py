import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

from julia import load_model
from .contracts import WorkerRequest


ROUTER_VERSION = "julia-1@a85b127321d5"
EMBEDDING_VERSION = "embeddinggemma-300m@57c266a740f5"
JULIA_MODEL_ROOT = Path(
    os.environ.get(
        "SYNLET_JULIA_MODEL_ROOT",
        Path(__file__).resolve().parents[4] / "model-weights" / "Julia-1",
    )
)
_JULIA_ENGINE = None
EMBEDDING_MODEL_ROOT = Path(
    os.environ.get(
        "SYNLET_EMBEDDING_MODEL_ROOT",
        Path(__file__).resolve().parents[4] / "model-weights" / "EmbeddingGemma-300m",
    )
)
_EMBEDDING_ENGINE = None


def _julia_engine():
    global _JULIA_ENGINE
    if _JULIA_ENGINE is None:
        _JULIA_ENGINE = load_model(
            str(JULIA_MODEL_ROOT),
            device="cpu",
            strict_encoding=True,
            max_length=1024,
            head_length=512,
        )
    return _JULIA_ENGINE


def _embedding_engine():
    global _EMBEDDING_ENGINE
    if _EMBEDDING_ENGINE is None:
        if not EMBEDDING_MODEL_ROOT.exists():
            raise RuntimeError(
                "EmbeddingGemma is unavailable: its gated artifact is not installed. "
                "Authenticate with Hugging Face and accept the Gemma licence first."
            )
        from sentence_transformers import SentenceTransformer

        _EMBEDDING_ENGINE = SentenceTransformer(
            str(EMBEDDING_MODEL_ROOT),
            device="cpu",
            local_files_only=True,
        )
    return _EMBEDDING_ENGINE


def _true_probability(answer):
    probabilities = answer.get("probabilities", {})
    if "true" in probabilities:
        return float(probabilities["true"])
    value = answer.get("noul")
    if isinstance(value, (int, float)):
        return float(value)
    raise ValueError("Julia Boolean answer omitted its true probability")


def _route(text):
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        payload = {"goal": text, "skills": []}
    if not isinstance(payload, dict) or not isinstance(payload.get("goal"), str):
        raise ValueError("route input must contain a string goal")
    questions = {
        "code": {
            "type": "noul",
            "instructions": "Does this task require a dedicated code specialist?",
            "criteria": {
                "false": "No dedicated code specialist is required",
                "true": "A dedicated code specialist is required",
            },
        },
        "math": {
            "type": "noul",
            "instructions": "Does this task require a dedicated mathematical reasoning specialist?",
            "criteria": {
                "false": "No dedicated mathematical specialist is required",
                "true": "A dedicated mathematical specialist is required",
            },
        },
        "vision": {
            "type": "noul",
            "instructions": "Does this task require interpreting an image or visually locating interface elements?",
            "criteria": {
                "false": "No vision specialist is required",
                "true": "A vision specialist is required",
            },
        },
    }
    result = _julia_engine().predict(
        state=(
            ("Images are attached. " if payload.get("hasImages") else "No image is currently attached; tools may provide images later. ")
            + f"Requested goal: {payload['goal']}"
        ),
        questions=questions,
    )
    answers = result.get("answers", {})
    probabilities = {
        capability: _true_probability(answers[capability])
        for capability in ("code", "math", "vision")
    }
    return json.dumps(
        {
            "capabilities": {
                capability: probability >= 0.5
                for capability, probability in probabilities.items()
            },
            "probabilities": probabilities,
        },
        sort_keys=True,
    )


def _embed_batch(inputs):
    engine = _embedding_engine()
    outputs = []
    for value in inputs:
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            parsed = {"text": value, "kind": "document"}
        if not isinstance(parsed, dict) or not isinstance(parsed.get("text"), str):
            raise ValueError("embedding input must contain text")
        kind = parsed.get("kind", "document")
        if kind not in {"query", "document"}:
            raise ValueError("unknown embedding purpose")
        method = getattr(engine, "encode_query" if kind == "query" else "encode_document", None)
        if method is None:
            raise RuntimeError("Pinned SentenceTransformers must support query/document encoding")
        # Reject rather than silently truncate an embedding input. The native method adds the appropriate prompt.
        prompt = engine.prompts.get(kind, "")
        if len(engine.tokenizer.encode(prompt + parsed["text"], add_special_tokens=True)) > engine.max_seq_length:
            raise ValueError("embedding input exceeds native token window; split it into smaller chunks")
        vector = method([parsed["text"]], show_progress_bar=False, convert_to_numpy=True, normalize_embeddings=True)[0]
        outputs.append(json.dumps(vector.tolist()))
    return outputs


def handle(value):
    request = WorkerRequest.parse(value)
    deadline = datetime.fromisoformat(request.deadline_utc.replace("Z", "+00:00"))
    if deadline <= datetime.now(timezone.utc):
        return {
            "schemaVersion": "synlet.worker/v1",
            "requestId": request.request_id,
            "status": "error",
            "modelVersion": "none",
            "outputs": ["deadline expired"],
        }
    outputs = (
        [_route(item) for item in request.inputs]
        if request.operation == "route"
        else _embed_batch(request.inputs)
    )
    return {
        "schemaVersion": "synlet.worker/v1",
        "requestId": request.request_id,
        "status": "ok",
        "modelVersion": (
            ROUTER_VERSION if request.operation == "route" else EMBEDDING_VERSION
        ),
        "outputs": outputs,
    }


def main():
    for line in sys.stdin:
        request_id = "unknown"
        try:
            value = json.loads(line)
            if isinstance(value, dict) and isinstance(value.get("requestId"), str):
                request_id = value["requestId"]
            print(json.dumps(handle(value)))
        except Exception as error:
            print(
                json.dumps(
                    {
                        "schemaVersion": "synlet.worker/v1",
                        "requestId": request_id,
                        "status": "error",
                        "modelVersion": "none",
                        "outputs": [str(error)],
                    }
                )
            )
        sys.stdout.flush()


if __name__ == "__main__":
    main()

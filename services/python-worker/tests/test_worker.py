import json

import synlet_worker.worker as worker


def request(operation, inputs):
    return {
        "schemaVersion": "synlet.worker/v1",
        "requestId": "r1",
        "taskId": "t1",
        "stepId": "s1",
        "deadlineUtc": "2099-01-01T00:00:00Z",
        "operation": operation,
        "inputs": inputs,
    }


def test_routing_uses_julia_finite_decisions(monkeypatch):
    class Julia:
        def predict(self, state, questions):
            assert set(questions) == {"code", "math", "vision"}
            return {
                "answers": {
                    "code": {
                        "probabilities": {
                            "false": 0.1 if "patch" in state else 0.9,
                            "true": 0.9 if "patch" in state else 0.1,
                        }
                    },
                    "math": {"probabilities": {"false": 0.8, "true": 0.2}},
                    "vision": {"probabilities": {"false": 0.7, "true": 0.3}},
                }
            }

    monkeypatch.setattr(worker, "_julia_engine", lambda: Julia())
    route_input = json.dumps(
        {
            "goal": "patch code",
        }
    )
    result = worker.handle(request("route", [route_input]))
    assert result["status"] == "ok"
    assert result["modelVersion"].startswith("julia-1@")
    decision = json.loads(result["outputs"][0])
    assert decision["capabilities"] == {
        "code": True,
        "math": False,
        "vision": False,
    }


def test_embedding_does_not_silently_use_a_generative_model(monkeypatch):
    monkeypatch.setattr(
        worker,
        "EMBEDDING_MODEL_ROOT",
        worker.EMBEDDING_MODEL_ROOT / "definitely-missing",
    )
    monkeypatch.setattr(worker, "_EMBEDDING_ENGINE", None)
    try:
        worker.handle(request("embed", ["first", "second"]))
    except RuntimeError as error:
        assert "EmbeddingGemma is unavailable" in str(error)
    else:
        raise AssertionError("a fake embedding fallback was accepted")


def test_embedding_batches_use_embeddinggemma(monkeypatch):
    class Vector:
        def __init__(self, values):
            self.values = values

        def tolist(self):
            return self.values

    class EmbeddingGemma:
        def encode(self, inputs, **options):
            assert inputs == ["first", "second"]
            assert options["normalize_embeddings"] is True
            return [Vector([0.1, 0.2]), Vector([0.3, 0.4])]

    monkeypatch.setattr(worker, "_embedding_engine", lambda: EmbeddingGemma())
    result = worker.handle(request("embed", ["first", "second"]))
    assert result["modelVersion"].startswith("embeddinggemma-300m@")
    assert json.loads(result["outputs"][0]) == [0.1, 0.2]
    assert json.loads(result["outputs"][1]) == [0.3, 0.4]


def test_unknown_fields_are_rejected():
    value = request("route", ["text"])
    value["execute"] = "arbitrary code"
    try:
        worker.handle(value)
    except ValueError as error:
        assert "fields" in str(error)
    else:
        raise AssertionError("unexpected worker field was accepted")

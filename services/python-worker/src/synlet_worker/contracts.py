from dataclasses import dataclass
from typing import List


@dataclass(frozen=True)
class WorkerRequest:
    schema_version: str
    request_id: str
    task_id: str
    step_id: str
    deadline_utc: str
    operation: str
    inputs: List[str]

    @classmethod
    def parse(cls, value):
        expected = {"schemaVersion", "requestId", "taskId", "stepId", "deadlineUtc", "operation", "inputs"}
        if not isinstance(value, dict) or set(value) != expected:
            raise ValueError("worker request fields are invalid")
        if value["schemaVersion"] != "synlet.worker/v1" or value["operation"] not in {"route", "embed"}:
            raise ValueError("worker request version or operation is invalid")
        inputs = value["inputs"]
        if not isinstance(inputs, list) or not 1 <= len(inputs) <= 64 or not all(isinstance(item, str) and len(item) <= 8192 for item in inputs):
            raise ValueError("worker inputs are invalid")
        return cls(value["schemaVersion"], value["requestId"], value["taskId"], value["stepId"], value["deadlineUtc"], value["operation"], inputs)

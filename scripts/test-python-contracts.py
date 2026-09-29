"""CPU-only contract checks; deliberately not a Julia/embedding quality score."""
import importlib.util
import pathlib
import sys
import unittest

root = pathlib.Path(__file__).resolve().parents[1]
path = root / "services/python-worker/src/synlet_worker/contracts.py"
spec = importlib.util.spec_from_file_location("synlet_contract_fixture", path)
module = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = module
spec.loader.exec_module(module)

class WorkerContractTests(unittest.TestCase):
    def payload(self, inputs):
        return {"schemaVersion":"synlet.worker/v1","requestId":"r","taskId":"t","stepId":"s","deadlineUtc":"2099-01-01T00:00:00Z","operation":"embed","inputs":inputs}
    def test_sixty_four_documents_are_accepted(self):
        self.assertEqual(len(module.WorkerRequest.parse(self.payload(["x"]*64)).inputs),64)
    def test_sixty_five_documents_require_host_batching(self):
        with self.assertRaises(ValueError): module.WorkerRequest.parse(self.payload(["x"]*65))
    def test_oversized_input_is_not_silently_truncated(self):
        with self.assertRaises(ValueError): module.WorkerRequest.parse(self.payload(["x"*8193]))
    def test_unknown_fields_do_not_cross_the_worker_boundary(self):
        p=self.payload(["x"]);p["executeCommand"]="arbitrary"
        with self.assertRaises(ValueError): module.WorkerRequest.parse(p)

if __name__ == "__main__": unittest.main()

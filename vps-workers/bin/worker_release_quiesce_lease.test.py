import importlib.util
import sys
import unittest
from pathlib import Path

def load_suite(filename, module_name):
    spec = importlib.util.spec_from_file_location(module_name, Path(__file__).with_name(filename))
    assert spec and spec.loader
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module

lifecycle = load_suite("worker_release_quiesce_lease_lifecycle_test.py", "worker_quiesce_lease_lifecycle_tests")
protocol = load_suite("worker_release_quiesce_lease_protocol_test.py", "worker_quiesce_lease_protocol_tests")
WorkerQuiesceLeaseLifecycleTests = lifecycle.WorkerQuiesceLeaseLifecycleTests
WorkerQuiesceLeaseProtocolTests = protocol.WorkerQuiesceLeaseProtocolTests

if __name__ == "__main__":
    unittest.main()

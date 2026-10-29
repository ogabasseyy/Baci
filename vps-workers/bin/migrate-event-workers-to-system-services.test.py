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

provisioning = load_suite("migrate_event_workers_provisioning_test.py", "event_worker_provisioning_tests")
rollback = load_suite("migrate_event_workers_rollback_test.py", "event_worker_rollback_tests")
MigrationProvisioningTests = provisioning.MigrationProvisioningTests
MigrationRollbackTests = rollback.MigrationRollbackTests

if __name__ == "__main__":
    unittest.main()

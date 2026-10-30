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

validation = load_suite("migrate_baci_release_runner_validation_test.py", "release_runner_validation_tests")
installation = load_suite("migrate_baci_release_runner_install_test.py", "release_runner_install_tests")
rollback = load_suite("migrate_baci_release_runner_rollback_test.py", "release_runner_rollback_tests")
ReleaseRunnerValidationTests = validation.ReleaseRunnerValidationTests
ReleaseRunnerInstallTests = installation.ReleaseRunnerInstallTests
ReleaseRunnerRollbackTests = rollback.ReleaseRunnerRollbackTests

if __name__ == "__main__":
    unittest.main()

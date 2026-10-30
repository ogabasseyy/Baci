"""Builder quiescence must gate dependency install and result cleanup."""
from __future__ import annotations

import importlib.util
import sys
import unittest
from pathlib import Path

_fixture_path = Path(__file__).with_name("worker_release_dependency_consumer.test.py")
_fixture_spec = importlib.util.spec_from_file_location("dependency_consumer_fixtures", _fixture_path)
_fixtures = importlib.util.module_from_spec(_fixture_spec)
sys.modules[_fixture_spec.name] = _fixtures
_fixture_spec.loader.exec_module(_fixtures)


class ConsumerQuiescenceTests(unittest.TestCase):
    def setUp(self):
        self.fixture = _fixtures.DependencyConsumerTests()
        self.fixture.setUp()

    def tearDown(self):
        self.fixture.tearDown()

    def test_proof_precedes_install_and_false_proof_preserves_candidate(self):
        observed = []

        def proof(fence):
            observed.append(fence)
            candidate = self.fixture.result_root / "candidate"
            self.assertTrue(candidate.is_dir())
            self.assertFalse((self.fixture.release / "node_modules").exists())
            return False

        with self.assertRaisesRegex(_fixtures.consumer.BuilderRejected, "process-quiescence proof"):
            self.fixture.run_consumer(
                self.fixture.make_builder(), builder_quiesced=proof,
            )

        self.assertEqual(len(observed), 1)
        self.assertTrue((self.fixture.result_root / "candidate").is_dir())
        self.assertFalse((self.fixture.release / "apps" / "web" / "node_modules").exists())


if __name__ == "__main__":
    unittest.main()

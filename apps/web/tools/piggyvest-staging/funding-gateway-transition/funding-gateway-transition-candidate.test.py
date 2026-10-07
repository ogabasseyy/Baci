import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent


def _load_fixture():
    spec = importlib.util.spec_from_file_location(
        'transition_fixture', BASE / 'funding-gateway-transition-fixture.py'
    )
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


fixture = _load_fixture()
candidate_spec = importlib.util.spec_from_file_location(
    'funding_gateway_transition_candidate',
    BASE / 'funding-gateway-transition-candidate.py',
)
candidate = importlib.util.module_from_spec(candidate_spec)
candidate_spec.loader.exec_module(candidate)


class TransitionCandidateTests(unittest.TestCase):
    def test_check_passes_when_preflight_accepts(self):
        with patch.object(candidate, 'validate_preflight', return_value={}):
            self.assertEqual(candidate.main(['--check']), 0)

    def test_check_refuses_when_preflight_rejects(self):
        with patch.object(
            candidate, 'validate_preflight', side_effect=candidate.Refused('no')
        ):
            self.assertEqual(candidate.main(['--check']), 1)


if __name__ == '__main__':
    unittest.main()

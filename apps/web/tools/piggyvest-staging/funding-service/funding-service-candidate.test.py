import importlib.util
import hashlib
import os
import stat
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'funding_service_candidate', BASE / 'funding-service-candidate.py'
)
candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate)


class FundingServiceCandidateTests(unittest.TestCase):
    def test_cli_update_unit_reports_outcome_without_starting_service(self):
        with (
            patch.object(candidate, 'verify_artifact'),
            patch.object(candidate, 'verify_config_metadata'),
            patch.object(candidate, 'verify_unit_directory'),
            patch.object(candidate, 'update_unit', return_value='updated'),
        ):
            self.assertEqual(candidate.main(['--update-unit']), 0)


    def test_regression_cli_accepts_normal_check_flag_without_path_overrides(self):
        with (
            patch.object(candidate, 'verify_artifact'),
            patch.object(candidate, 'verify_config_metadata'),
            patch.object(candidate, 'verify_unit_directory'),
        ):
            self.assertEqual(candidate.main(['--check']), 0)
        with self.assertRaises(SystemExit):
            candidate.main(['--check', '/tmp/standalone'])


    def test_regression_checks_every_artifact_ancestor(self):
        with patch.object(candidate, '_require_safe_path') as safe_path:
            candidate._verify_root_owned_ancestors(
                candidate.ARTIFACT_ROOT, 'Funding artifact path'
            )
        self.assertEqual(
            [call.args[0] for call in safe_path.call_args_list],
            [
                Path('/'),
                Path('/opt'),
                candidate.ARTIFACT_ROOT,
            ],
        )


if __name__ == '__main__':
    unittest.main()

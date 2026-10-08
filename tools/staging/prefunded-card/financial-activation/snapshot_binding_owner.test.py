import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

import snapshot_binding_owner as owner

HERE = Path(__file__).resolve().parent


class SnapshotBindingOwnerTests(unittest.TestCase):
    def test_standalone_cli_help_works_without_pythonpath_bootstrap(self):
        result = subprocess.run([sys.executable, str(HERE / 'snapshot_binding_owner.py'), '--help'],
            cwd='/', text=True, capture_output=True, timeout=10)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('collect', result.stdout)

    def test_nonroot_collection_and_candidate_refuse_before_database_or_file_read(self):
        import os
        with tempfile.TemporaryDirectory() as directory, patch.object(os, 'geteuid', return_value=501), \
                patch.object(owner, 'database') as database:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, 'snapshot_binding_root_required'):
                owner.collect(root / 'baseline.json')
            with self.assertRaisesRegex(ValueError, 'snapshot_binding_root_required'):
                owner.candidate(root / 'baseline.json', root, root / 'candidate')
            database.assert_not_called()

    def test_existing_output_is_retained_without_database_contact(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'baseline.json'
            path.write_text('retained')
            with patch.object(os, 'geteuid', return_value=0), patch.object(owner, 'root_ancestors'), \
                    patch.object(owner, 'private_directory'), patch.object(owner, 'database') as database:
                with self.assertRaisesRegex(ValueError, 'snapshot_binding_output_exists'):
                    owner.collect(path)
                database.assert_not_called()
            self.assertEqual(path.read_text(), 'retained')

    def test_collection_uses_readonly_sql_and_writes_private_metadata_only(self):
        import os
        baseline = {'readOnly': True, 'systemIdentifier': '7685292944002592802',
                    'observedAt': '2026-10-02T06:00:00Z', 'metadata': {'rolesHash': 'a' * 64}}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'baseline.json'
            with patch.object(os, 'geteuid', return_value=0), patch.object(owner, 'root_ancestors'), \
                    patch.object(owner, 'private_directory'), \
                    patch.object(owner, 'database', return_value=json.dumps(baseline)) as database:
                report = owner.collect(path)
            self.assertIn('REPEATABLE READ READ ONLY', database.call_args.args[0])
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            self.assertFalse(report['changesApplied'])
            self.assertNotIn('metadata', report)

    def test_unsafe_parent_metadata_refuses_before_database_contact(self):
        import os
        with patch.object(os, 'geteuid', return_value=0), \
                patch.object(owner, 'root_ancestors', side_effect=ValueError('unsafe owner directory')), \
                patch.object(owner, 'database') as database:
            with self.assertRaisesRegex(ValueError, 'unsafe owner directory'):
                owner.collect(Path('/root/private/baseline.json'))
            database.assert_not_called()

    def test_failed_candidate_write_removes_only_new_partial_output(self):
        import os
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / 'candidate'
            retained = root / 'retained'
            retained.write_text('keep')
            original_write = owner.write_private
            writes = 0

            def failing_write(path, content):
                nonlocal writes
                writes += 1
                if writes == 2:
                    raise OSError('fixture write failure')
                original_write(path, content)

            with patch.object(os, 'geteuid', return_value=0), patch.object(owner, 'root_ancestors'), \
                    patch.object(owner, 'private_directory'), \
                    patch.object(owner, 'read_file', return_value=b'{}'), \
                    patch.object(owner, 'render', return_value=b'fixture-sql'), \
                    patch.object(owner, 'write_private', side_effect=failing_write):
                with self.assertRaisesRegex(OSError, 'fixture write failure'):
                    owner.candidate(root / 'baseline', root, output)
            self.assertFalse(output.exists())
            self.assertEqual(retained.read_text(), 'keep')


if __name__ == '__main__':
    unittest.main()

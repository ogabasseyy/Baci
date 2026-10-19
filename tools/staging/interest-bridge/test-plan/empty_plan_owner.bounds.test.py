from contextlib import redirect_stdout
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import empty_plan_owner as owner
from plan_constants import MAX_BYTES
from read_empty_wallet import read_sealed


INVENTORY_LIMIT = 8 * MAX_BYTES


class InventoryBoundTests(unittest.TestCase):
    def database_result(self, raw, inventory=True):
        process = subprocess.CompletedProcess(['synthetic-psql'], 0, raw, '')
        with patch.object(owner.subprocess, 'run', return_value=process):
            return owner._database('synthetic-inventory', inventory=inventory)

    def root_stat(self, descriptor):
        values = list(self.original_stat(descriptor))
        values[4] = 0
        return os.stat_result(values)

    def test_inventory_accepts_live_schema_larger_than_one_mib_but_other_sql_does_not(self):
        raw = json.dumps({'schema': 'x' * MAX_BYTES})
        self.assertEqual(len(self.database_result(raw)['schema']), MAX_BYTES)
        with self.assertRaisesRegex(ValueError, 'database-refused'):
            self.database_result(raw, inventory=False)

    def test_inventory_refuses_more_than_eight_mib_even_when_sql_succeeds(self):
        raw = json.dumps({'schema': 'x' * INVENTORY_LIMIT})
        with self.assertRaisesRegex(ValueError, 'database-refused'):
            self.database_result(raw)

    def test_inventory_accepts_exact_eight_mib_raw_output_boundary(self):
        overhead = len(json.dumps({'schema': ''}).encode())
        raw = json.dumps({'schema': 'x' * (INVENTORY_LIMIT - overhead)})
        self.assertEqual(len(raw.encode()), INVENTORY_LIMIT)
        self.assertEqual(len(self.database_result(raw)['schema']), INVENTORY_LIMIT - overhead)

    def test_inventory_limit_counts_utf8_bytes_not_python_characters(self):
        raw = json.dumps({'schema': '\u00e9' * (INVENTORY_LIMIT // 2)}, ensure_ascii=False)
        self.assertLess(len(raw), INVENTORY_LIMIT)
        with self.assertRaisesRegex(ValueError, 'database-refused'):
            self.database_result(raw)

    def test_only_dedicated_snapshot_reader_accepts_large_root_private_pinned_json(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'snapshot.json'
            raw = json.dumps({'schema': 'x' * MAX_BYTES}).encode()
            path.write_bytes(raw)
            path.chmod(0o600)
            checksum = hashlib.sha256(raw).hexdigest()
            self.original_stat = os.fstat
            with patch('read_empty_wallet.os.fstat', side_effect=self.root_stat):
                self.assertEqual(len(owner.read_snapshot(path, checksum)['schema']), MAX_BYTES)
                with self.assertRaisesRegex(ValueError, 'sealed-file-metadata'):
                    owner._json(path, checksum)
                with self.assertRaisesRegex(ValueError, 'sealed-file-metadata'):
                    read_sealed(path, checksum)
                with self.assertRaisesRegex(ValueError, 'sealed-file-pin'):
                    owner.read_snapshot(path, '0'*64)
                path.chmod(0o644)
                with self.assertRaisesRegex(ValueError, 'sealed-file-metadata'):
                    owner.read_snapshot(path, checksum)
                path.chmod(0o600)
                oversized = json.dumps({'schema': 'x' * INVENTORY_LIMIT}).encode()
                path.write_bytes(oversized)
                with self.assertRaisesRegex(ValueError, 'sealed-file-metadata'):
                    owner.read_snapshot(path, hashlib.sha256(oversized).hexdigest())

    def run_inventory_cli(self, result, output, mode='inventory'):
        argv = ['empty_plan_owner.py', mode, '--source-manifest-sha256', 'a'*64,
                '--output', str(output)]
        stdout = io.StringIO()
        with patch('sys.argv', argv), patch.object(owner.os, 'geteuid', return_value=0), \
                patch.object(owner, 'execute', return_value=result), redirect_stdout(stdout):
            code = owner.main()
        return code, json.loads(stdout.getvalue())

    def test_inventory_report_is_readable_when_pretty_printing_would_exceed_eight_mib(self):
        result = {'kind': 'empty_interest_plan_inventory', 'changesMade': False, 'schema': ['x'] * 1000000}
        self.assertGreater(len(json.dumps(result, indent=2).encode()), INVENTORY_LIMIT)
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'inventory.json'
            code, status = self.run_inventory_cli(result, path)
            raw = path.read_bytes()
            self.assertEqual(code, 0)
            self.assertLessEqual(len(raw), INVENTORY_LIMIT)
            self.assertEqual(status['artifactSha256'], hashlib.sha256(raw).hexdigest())

    def test_inventory_report_refuses_oversize_after_adding_owner_metadata(self):
        result = {'kind': 'empty_interest_plan_inventory', 'changesMade': False, 'schema': 'x' * INVENTORY_LIMIT}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'inventory.json'
            code, status = self.run_inventory_cli(result, path)
            self.assertEqual(code, 1)
            self.assertEqual(status['refusalCode'], 'report-size-bound')
            self.assertEqual(path.stat().st_size, 0)

    def test_noninventory_report_cannot_use_large_limit_by_claiming_inventory_kind(self):
        result = {'kind': 'empty_interest_plan_inventory', 'changesMade': False, 'schema': 'x' * MAX_BYTES}
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'rehearsal.json'
            code, status = self.run_inventory_cli(result, path, mode='goal-rehearse')
            self.assertEqual(code, 1)
            self.assertEqual(status['refusalCode'], 'report-size-bound')
            self.assertEqual(path.stat().st_size, 0)


if __name__ == '__main__':
    unittest.main()

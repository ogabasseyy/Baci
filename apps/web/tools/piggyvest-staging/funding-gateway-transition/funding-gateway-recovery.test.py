import hashlib
import importlib.util
import json
import os
import stat
import tempfile
import unittest
from datetime import UTC, datetime
from pathlib import Path


PATH = Path(__file__).with_name('funding-gateway-recovery.py')
SPEC = importlib.util.spec_from_file_location('recovery', PATH)
RECOVERY = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RECOVERY)


class RecoveryTests(unittest.TestCase):
    def test_inventory_helper_pin_preserves_installed_executable_mode(self):
        self.assertEqual(RECOVERY.PINS[RECOVERY.CODE / 'managed-inventory-helper.mjs'][1], (0o550,))

    def test_secure_bytes_rejects_symlink_and_writable_file(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'target'
            target.write_text('safe')
            link = root / 'link'
            link.symlink_to(target)
            with self.assertRaises(RECOVERY.Refused):
                RECOVERY.secure_bytes(link, (0o600,), os.getuid())
            target.chmod(0o622)
            with self.assertRaises(RECOVERY.Refused):
                RECOVERY.secure_bytes(target, (0o600,), os.getuid())

    def test_expiry_rejects_different_or_elapsed_deadline(self):
        binding = {'leaseExpiresAt': datetime.fromtimestamp(RECOVERY.DEADLINE, UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z')}
        RECOVERY._expiry(binding, RECOVERY.DEADLINE - 1)
        with self.assertRaises(RECOVERY.Refused):
            RECOVERY._expiry(binding, RECOVERY.DEADLINE)
        binding['leaseExpiresAt'] = '2026-09-29T15:59:11.000Z'
        with self.assertRaises(RECOVERY.Refused):
            RECOVERY._expiry(binding, RECOVERY.DEADLINE - 1)

    def test_pinned_rejects_hash_mismatch(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'input'
            path.write_text('actual')
            path.chmod(0o600)
            with self.assertRaises(RECOVERY.Refused):
                RECOVERY._pinned(path, hashlib.sha256(b'other').hexdigest(), (0o600,), os.getuid())

    def test_json_rejects_non_object(self):
        with self.assertRaises(RECOVERY.Refused):
            RECOVERY._json(json.dumps([]).encode())


if __name__ == '__main__':
    unittest.main()

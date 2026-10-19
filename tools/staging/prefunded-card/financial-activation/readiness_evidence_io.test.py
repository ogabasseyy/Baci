import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import readiness_evidence_io as io


class EvidenceIoTests(unittest.TestCase):
    def test_command_refuses_and_redacts_provider_bodies_and_stderr(self):
        result = subprocess.CompletedProcess(['test'], 1, 'private-provider-body', 'secret-password')
        with patch.object(io.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(io.Refused, 'command_refused') as error:
                io.command(['/usr/bin/test'])
        self.assertNotIn('private-provider-body', str(error.exception))
        self.assertNotIn('secret-password', str(error.exception))

    def test_command_rechecks_expiry_after_process_returns(self):
        result = subprocess.CompletedProcess(['test'], 0, '{}', '')
        with patch.object(io.subprocess, 'run', return_value=result), \
                patch.object(io.time, 'time', side_effect=[io.EPOCH - 601, io.EPOCH - 600]):
            with self.assertRaisesRegex(io.Refused, 'window_expired'):
                io.command(['/usr/bin/test'])

    def test_nonroot_request_refuses_before_private_file_read(self):
        with patch.object(io.os, 'geteuid', return_value=501), patch.object(io, 'pinned') as read:
            with self.assertRaisesRegex(io.Refused, 'root_required'):
                io.root_request(Path('/root/request'), 'a' * 64)
            read.assert_not_called()

    def test_pin_mismatch_and_unapproved_owner_are_refused(self):
        record = {'path': '/root/private/config', 'owner': 0, 'mode': 0o600, 'sha256': 'a' * 64}
        with patch.object(io, 'root_ancestors'), patch.object(io, 'read_file', return_value=b'{}'):
            with self.assertRaisesRegex(io.Refused, 'pin_mismatch'):
                io.pinned(record)
            with self.assertRaisesRegex(io.Refused, 'metadata_refused'):
                io.pinned({**record, 'owner': 501})

    def test_saves_private_metadata_without_overwriting_existing_output(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(io, 'root_ancestors'), \
                patch.object(io, 'private_directory'):
            path = Path(directory) / 'evidence.json'
            value = {'readOnly': True}
            self.assertEqual(io.save(path, value), io.digest(path.read_bytes()))
            self.assertEqual(path.stat().st_mode & 0o777, 0o600)
            with self.assertRaises(Exception):
                io.save(path, {'changed': True})
            self.assertEqual(json.loads(path.read_text()), value)

    def test_accepts_only_exact_replay_root_group_and_0440_metadata(self):
        from types import SimpleNamespace
        record = {'path': '/opt/baci-prefunded-replay/config/config.json',
            'owner': 0, 'mode': 0o440, 'sha256': io.digest(b'{}')}
        with patch.object(io, 'root_ancestors'), patch.object(io, 'read_file', return_value=b'{}'), \
                patch.object(io.Path, 'lstat', return_value=SimpleNamespace(st_gid=65532)):
            self.assertEqual(io.pinned(record), b'{}')
            with self.assertRaisesRegex(io.Refused, 'replay_group_metadata_refused'):
                io.pinned({**record, 'path': '/opt/other/config.json'})
            with self.assertRaisesRegex(io.Refused, 'replay_group_metadata_refused'):
                io.pinned({**record, 'owner': 65532})
        with patch.object(io, 'root_ancestors'), \
                patch.object(io.Path, 'lstat', return_value=SimpleNamespace(st_gid=0)):
            with self.assertRaisesRegex(io.Refused, 'replay_group_metadata_refused'):
                io.pinned(record)


if __name__ == '__main__':
    unittest.main()

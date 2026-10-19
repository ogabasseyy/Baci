from pathlib import Path
import json
import tempfile
import unittest
from unittest.mock import patch

import release_contract as release

REPOSITORY = Path(__file__).resolve().parents[4]
RECEIVER = Path('/Users/mac/.codex/worktrees/0d77/Baci-app/apps/web')
REPLAY = Path('/private/tmp/baci-financial-replay-source-20261002-r2')
WORKERS = Path('/private/tmp/prefunded-card-worker-renewal-20261002-r4')
REPLAY_SHA = '06957f1972dc677da9191b0164953d7f29333f6b619a02f24f6d80b89220a8f3'
WORKER_SHA = 'fccc5fe11de7a7e18c5a0c38309fb57e9013729e76d31d609bc652dab77f8d6a'


class ReleaseContractTests(unittest.TestCase):
    def test_missing_replay_release_refuses_with_explicit_rebuild_error(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, 'financial_replay_release_missing_rebuild_from_source_required'):
                release.verify_replay(Path(directory), 'a' * 64, RECEIVER, REPOSITORY / 'apps/web/src')

    def test_rejects_source_paths_outside_root(self):
        with self.assertRaisesRegex(ValueError, 'source_path_refused'):
            release.source_path(REPOSITORY, '../credentials.json')

    def test_malformed_entrypoint_metadata_refuses_without_attribute_error(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receiver = root / 'receiver'
            savings = root / 'savings'
            manifest = root / 'replay-artifact.manifest.json'
            roots = {'receiver': receiver, 'prefundedReplay': savings}
            rows = {kind: [{'path': str(path / 'fixture.ts'), 'sha256': 'a' * 64}]
                    for kind, path in roots.items()}
            for malformed in (None, [], 'invalid', 1):
                meta = {'version': 1, 'outputs': {'replay-daemon.mjs': release.DAEMON,
                    'prefunded-replay-bundle.mjs': release.FACTORY}, 'source': {
                    'receiverRoot': str(receiver), 'savingsRoot': str(savings),
                    'inputs': rows, 'entrypoints': {kind: malformed for kind in roots}}}
                raw = json.dumps(meta).encode()
                manifest.write_bytes(raw)
                with self.subTest(malformed=malformed), \
                        patch.object(release, 'pin_read', return_value=raw), \
                        self.assertRaisesRegex(release.Refused, 'replay_entrypoint_missing'):
                    release.verify_replay(root, 'b' * 64, receiver, savings)

    @unittest.skipUnless(REPLAY.is_dir() and WORKERS.is_dir(), 'reviewed local release unavailable')
    def test_verifies_actual_two_worktree_closures_and_worker_sources(self):
        _, replay_files, replay_report = release.verify_replay(REPLAY, REPLAY_SHA,
            RECEIVER, REPOSITORY / 'apps/web/src')
        _, worker_files, worker_report = release.verify_worker(WORKERS, WORKER_SHA, REPOSITORY)
        self.assertEqual(replay_report['sourceCount'], 74)
        self.assertEqual(worker_report['sourceCount'], 195)
        self.assertEqual(release.digest(replay_files['prefunded-replay-bundle.mjs']), release.FACTORY)
        self.assertEqual(set(worker_files), set(release.WORKER_ENTRIES))

    @unittest.skipUnless(REPLAY.is_dir(), 'reviewed local release unavailable')
    def test_refuses_current_manifest_when_any_source_file_no_longer_matches(self):
        original = release._read
        def changed(path, expected, limit):
            if str(path).endswith('replay-daemon.ts'):
                raise release.Refused('activation_input_pin_mismatch')
            return original(path, expected, limit)
        with patch.object(release, '_read', changed):
            with self.assertRaisesRegex(ValueError, 'activation_input_pin_mismatch'):
                release.verify_replay(REPLAY, REPLAY_SHA, RECEIVER, REPOSITORY / 'apps/web/src')

    @unittest.skipUnless(REPLAY.is_dir(), 'reviewed local release unavailable')
    def test_refuses_manifest_digest_and_root_identity_drift(self):
        with self.assertRaisesRegex(ValueError, 'activation_input_pin_mismatch'):
            release.verify_replay(REPLAY, '0' * 64, RECEIVER, REPOSITORY / 'apps/web/src')
        with self.assertRaisesRegex(ValueError, 'replay_source_roots_refused'):
            release.verify_replay(REPLAY, REPLAY_SHA, RECEIVER.parent, REPOSITORY / 'apps/web/src')


if __name__ == '__main__':
    unittest.main()

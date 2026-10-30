"""Crash-safe broker upgrade journal regressions."""
from __future__ import annotations

import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from worker_release_broker_upgrade_journal import (
    BrokerUpgradeJournalRejected, clear_upgrade_journal, read_upgrade_journal,
    write_upgrade_journal,
)


class BrokerUpgradeJournalTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(dir=Path.home())
        self.root = Path(self.temporary.name)
        os.chmod(self.root, 0o755)
        self.path = self.root / "upgrade-journal.json"
        self.uid = os.getuid()
        self.gid = os.getgid()
        self.document = {
            "version": 1, "transaction_id": "a" * 32, "phase": "prepared",
            "old_digest": "b" * 64, "new_digest": "c" * 64,
            "unit": "baci-worker-release-broker.service",
        }

    def tearDown(self):
        self.temporary.cleanup()

    def write(self, document=None):
        write_upgrade_journal(document or self.document, self.path,
                              owner_uid=self.uid, owner_gid=self.gid)

    def read(self):
        return read_upgrade_journal(self.path, owner_uid=self.uid, owner_gid=self.gid)

    def test_atomic_journal_round_trip_and_fenced_clear(self):
        self.write()
        self.assertEqual(self.read(), self.document)
        with self.assertRaisesRegex(BrokerUpgradeJournalRejected, "transaction changed"):
            clear_upgrade_journal(self.path, owner_uid=self.uid, owner_gid=self.gid,
                                  transaction_id="d" * 32)
        self.assertEqual(self.read(), self.document)
        clear_upgrade_journal(self.path, owner_uid=self.uid, owner_gid=self.gid,
                              transaction_id=self.document["transaction_id"])
        self.assertIsNone(self.read())

    def test_rejects_noncanonical_malformed_or_wrong_mode_journal(self):
        self.write()
        self.path.chmod(0o640)
        with self.assertRaisesRegex(BrokerUpgradeJournalRejected, "metadata is unsafe"):
            self.read()
        self.path.chmod(0o600)
        self.path.write_text('{"phase":"prepared"}\n')
        with self.assertRaisesRegex(BrokerUpgradeJournalRejected, "fields are invalid"):
            self.read()

    def test_rejects_symlink_journal_and_invalid_target_digest(self):
        with self.assertRaisesRegex(BrokerUpgradeJournalRejected, "digest is invalid"):
            self.write({**self.document, "new_digest": "../unsafe"})
        self.path.symlink_to("/tmp/not-a-journal")
        with self.assertRaisesRegex(BrokerUpgradeJournalRejected, "existing upgrade journal is unsafe"):
            self.write()


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import errno
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
sys.path.insert(0, str(Path(__file__).parent))
import dependency_seed_transaction as transaction
from worker_release_dependency_artifacts import BuilderRejected


class PublisherTerminalProofTests(unittest.TestCase):
    def setUp(self):
        self.identity = {"pid": 1234, "startTicks": 99, "bootId": "a" * 36}

    def test_same_pid_and_start_ticks_is_still_active(self):
        with patch.object(transaction, "_boot_id", return_value="a" * 36), \
             patch.object(transaction, "_process_start_ticks", return_value=("S", 99)):
            self.assertFalse(transaction.publisher_is_terminal(self.identity))

    def test_reused_pid_with_new_start_ticks_is_terminal(self):
        with patch.object(transaction, "_boot_id", return_value="a" * 36), \
             patch.object(transaction, "_process_start_ticks", return_value=("R", 100)):
            self.assertTrue(transaction.publisher_is_terminal(self.identity))

    def test_zombie_is_terminal_even_with_matching_start_ticks(self):
        with patch.object(transaction, "_boot_id", return_value="a" * 36), \
             patch.object(transaction, "_process_start_ticks", return_value=("Z", 99)):
            self.assertTrue(transaction.publisher_is_terminal(self.identity))

    def test_rebooted_host_is_terminal(self):
        with patch.object(transaction, "_boot_id", return_value="b" * 36):
            self.assertTrue(transaction.publisher_is_terminal(self.identity))

    def test_missing_process_is_terminal_but_unreadable_identity_fails_closed(self):
        missing = BuilderRejected("missing")
        missing.__cause__ = OSError(errno.ENOENT, "missing")
        denied = BuilderRejected("denied")
        denied.__cause__ = OSError(errno.EPERM, "denied")
        with patch.object(transaction, "_boot_id", return_value="a" * 36), \
             patch.object(transaction, "_process_start_ticks", side_effect=missing):
            self.assertTrue(transaction.publisher_is_terminal(self.identity))
        with patch.object(transaction, "_boot_id", return_value="a" * 36), \
             patch.object(transaction, "_process_start_ticks", side_effect=denied):
            with self.assertRaises(BuilderRejected):
                transaction.publisher_is_terminal(self.identity)


if __name__ == "__main__":
    unittest.main()

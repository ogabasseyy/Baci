from pathlib import Path
import tempfile
import unittest
from unittest.mock import Mock

from public_app_upgrade_recovery import recover_runtime, restore_original
from treasury_owner_contract import Refused


class RecoveryTests(unittest.TestCase):
    def test_missing_live_app_after_second_rename_failure_restores_pinned_backup(self):
        with tempfile.TemporaryDirectory() as directory:
            root, stage, backup = [Path(directory) / name / 'app' for name in ('live', 'candidate', 'backup')]
            state = {root: None, stage: 'new', backup: 'old'}
            rename = Mock()
            restore_original(root, stage, backup, state.get, rename)
            rename.assert_called_once_with(backup, root)
            state[root] = 'foreign'
            rename.reset_mock()
            with self.assertRaises(Refused):
                restore_original(root, stage, backup, state.get, rename)
            rename.assert_not_called()

    def test_recovery_proves_exact_old_or_new_runtime_without_replacing_files(self):
        for current in ('old', 'new'):
            with self.subTest(current=current):
                installer = Mock(old_files={'server': b'old'}, new_files={'server': b'new'})
                if current == 'old':
                    installer.verify_active.side_effect = Refused('not new')
                self.assertEqual(recover_runtime(installer), {'state': current})
                installer.verify_container.assert_called_once_with(None)
                installer.prove_running.assert_called_once_with({ 'server': current.encode() })
                installer.stage.assert_not_called()
                installer.activate.assert_not_called()


if __name__ == '__main__':
    unittest.main()

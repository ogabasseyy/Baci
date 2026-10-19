from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import public_app_upgrade as upgrade
from treasury_owner_contract import Refused


class PublicAppUpgradeApiTests(unittest.TestCase):
    def test_upgrade_stages_old_state_and_returns_backup_info(self):
        bundle = Path('/root/private/bundle')
        installer = Mock()
        installer.verify_active.side_effect = Refused('old receipt')
        installer.stage.return_value = bundle / 'candidate'
        installer.activate.return_value = Path('/opt/rollback')
        with patch.object(upgrade, 'load_bundle', return_value=installer):
            result = upgrade.upgrade(bundle)
        self.assertEqual(result['status'], 'upgraded')
        self.assertEqual(result['appBackup'], '/opt/rollback/app')
        installer.unexpired.assert_called_once()
        installer.stage.assert_called_once()
        installer.activate.assert_called_once_with(bundle / 'candidate')

    def test_upgrade_resumes_verified_active_state_without_staging(self):
        installer = Mock()
        installer.backup_info.return_value = {'status': 'already-active'}
        with patch.object(upgrade, 'load_bundle', return_value=installer):
            self.assertEqual(upgrade.upgrade('/root/private/bundle'), {'status': 'already-active'})
        installer.verify_active.assert_called_once()
        installer.prove_running.assert_called_once_with(installer.new_files)
        installer.stage.assert_not_called()

    def test_recover_runtime_uses_the_no_swap_runtime_preflight(self):
        installer = Mock()
        installer.new_files = {'server.js': b'new'}
        with patch.object(upgrade, 'load_bundle', return_value=installer), \
                patch.object(upgrade, 'recover_runtime', return_value={'state': 'new'}) as recovered:
            self.assertEqual(upgrade.recover_existing_runtime('/root/private/bundle'), {'state': 'new'})
        installer.load_artifacts.assert_called_once()
        installer.unexpired.assert_called_once()
        recovered.assert_called_once_with(installer)


if __name__ == '__main__':
    unittest.main()

import hashlib
import io
import json
import os
from pathlib import Path
import tarfile
import tempfile
import unittest
from unittest.mock import Mock, patch

import public_app_upgrade as upgrade
import public_app_upgrade_probes as upgrade_probes
from public_app_upgrade_probes import mounted_app_digest
from treasury_owner_contract import DEADLINE_EPOCH, Refused

def artifact(files):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode='w:gz') as archive:
        for name, content in files.items():
            member = tarfile.TarInfo(name)
            member.size = len(content)
            archive.addfile(member, io.BytesIO(content))
    content = output.getvalue()
    manifest = dict(
        version=1,
        count=len(files),
        bytes=sum(len(value) for value in files.values()),
        files=[dict(path=name, sha256=hashlib.sha256(value).hexdigest(), size=len(value))
               for name, value in files.items()],
        tarballSha256=hashlib.sha256(content).hexdigest(),
        tarballSize=len(content),
    )
    return content, json.dumps(manifest, sort_keys=True).encode(), files


class PublicAppUpgradeTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'baci-prefunded-public'
        self.old_archive, self.old_manifest, self.old_files = artifact({
            'launch-public.cjs': b'old launcher',
            'apps/web/server.js': b'old server',
            'node_modules/client-only/index.js': b'',
        })
        self.new_archive, self.new_manifest, self.new_files = artifact({
            'launch-public.cjs': b'new launcher',
            'apps/web/server.js': b'new server',
            'node_modules/client-only/index.js': b'',
        })
        self.old_archive_hash = hashlib.sha256(self.old_archive).hexdigest()
        self.old_manifest_hash = hashlib.sha256(self.old_manifest).hexdigest()
        self.new_archive_hash = hashlib.sha256(self.new_archive).hexdigest()
        self.new_manifest_hash = hashlib.sha256(self.new_manifest).hexdigest()
        self.commands = []
        self.mounted_digest = None
        self.native_rename = os.rename
        self.inputs = {
            'old.tar.gz': self.old_archive,
            'old.manifest.json': self.old_manifest,
            'new.tar.gz': self.new_archive,
            'new.manifest.json': self.new_manifest,
        }
        self.patches = [
            patch.object(upgrade, 'ROOT', self.root),
            patch.object(upgrade, 'SYSTEMD', self.root / 'live-units'),
            patch.object(upgrade, 'OWNER', os.getuid()),
            patch.object(upgrade, 'ROOT_GROUP', os.getgid()),
            patch.object(upgrade, 'APP_GROUP', os.getgid()),
            patch.object(upgrade, 'OLD_ARCHIVE_SHA256', self.old_archive_hash),
            patch.object(upgrade, 'OLD_MANIFEST_SHA256', self.old_manifest_hash),
            patch.object(upgrade, 'capture', side_effect=lambda path, _limit: self.inputs[Path(path).name]),
            patch.object(upgrade, 'root_ancestors'),
            patch.object(upgrade, 'command', side_effect=self.command),
            patch.object(upgrade, 'read_private', side_effect=self.read_private),
        ]
        for active in self.patches:
            active.start()
            self.addCleanup(active.stop)
        self.create_current_root()
        self.tool = upgrade.PublicAppUpgrade(
            'old.tar.gz', 'old.manifest.json', 'new.tar.gz', self.new_archive_hash,
            'new.manifest.json', self.new_manifest_hash, clock=lambda: DEADLINE_EPOCH - 1,
        )

    def create_current_root(self):
        self.root.mkdir(mode=0o750)
        (self.root / 'app').mkdir(mode=0o755)
        for name, content in self.old_files.items():
            target = self.root / 'app' / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes(content)
            target.chmod(0o444)
        for directory in (self.root / 'app').rglob('*'):
            if directory.is_dir():
                directory.chmod(0o555)
        (self.root / 'app').chmod(0o555)
        (self.root / 'config').mkdir(mode=0o710)
        for name, content in {'checkout.json': b'checkout', 'anon.json': b'anon'}.items():
            target = self.root / 'config' / name
            target.write_bytes(content)
            target.chmod(0o440)
        (self.root / 'units').mkdir(mode=0o700)
        for name, content in upgrade.contract.units().items():
            target = self.root / 'units' / name
            target.write_text(content)
            target.chmod(0o644)
        live_units = self.root / 'live-units'
        live_units.mkdir(mode=0o700)
        for name, content in upgrade.contract.units().items():
            target = live_units / name
            target.write_text(content)
            target.chmod(0o644)
        self.receipt = json.dumps({
            'archiveSha256': self.old_archive_hash,
            'manifestSha256': self.old_manifest_hash,
            'deadline': upgrade.DEADLINE,
            'checkoutSha256': hashlib.sha256(b'checkout').hexdigest(),
            'anonSha256': hashlib.sha256(b'anon').hexdigest(),
        }).encode()
        (self.root / 'receipt.json').write_bytes(self.receipt)
        (self.root / 'receipt.json').chmod(0o600)

    def read_private(self, path, _mode, _limit):
        return Path(path).read_bytes()

    def rename(self, source, destination):
        source = Path(source)
        destination = Path(destination)
        directory = source.is_dir()
        if directory:
            source.chmod(0o755)
        self.native_rename(source, destination)
        if directory:
            destination.chmod(0o555)

    def command(self, arguments, **_kwargs):
        self.commands.append(arguments)
        if arguments[2:4] == ['image', 'inspect']:
            return json.dumps([{'Id': upgrade.contract.IMAGE,
                                'Config': {'Env': ['PATH=/usr/bin']}}])
        if arguments[2:3] == ['inspect']:
            state = {'Running': upgrade.contract.NAME + '.service' in self.started}
            value = upgrade.contract.container_contract(self.old_manifest_hash)
            value['Config']['Env'] = ['PATH=/usr/bin']
            value['State'] = state
            return json.dumps([value])
        if arguments[2:3] == ['exec']:
            files = {
                str(path.relative_to(self.root / 'app')): path.read_bytes()
                for path in (self.root / 'app').rglob('*') if path.is_file()
            }
            return self.mounted_digest or mounted_app_digest(files)
        if arguments[:2] == ['/usr/bin/systemctl', 'start']:
            self.started.add(arguments[-1])
        if (arguments[:2] == ['/usr/bin/systemctl', 'stop']
                or arguments[2:3] == ['stop']):
            self.started.discard(upgrade.contract.NAME + '.service')
        return ''

    def test_stages_verified_new_tar_without_touching_live_app_or_configuration(self):
        self.started = set()
        staged = self.tool.stage()
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'old server')
        self.assertEqual((self.root / 'config/checkout.json').read_bytes(), b'checkout')
        self.assertEqual((staged / 'app/apps/web/server.js').read_bytes(), b'new server')
        self.assertEqual((staged / 'public-app.tar.gz').read_bytes(), self.new_archive)
    def test_refuses_old_pin_or_current_tree_drift_before_staging(self):
        self.started = set()
        (self.root / 'app/apps/web/server.js').chmod(0o644)
        with self.assertRaises(Refused):
            self.tool.stage()
    def test_refuses_live_unit_drift_before_staging(self):
        self.started = {upgrade.contract.NAME + '.service'}
        (self.root / 'live-units' / (upgrade.contract.NAME + '.service')).write_text('drift')
        with self.assertRaises(Refused):
            self.tool.stage()
    def test_activate_stops_then_atomically_replaces_only_app_and_preserves_configuration_units(self):
        self.started = {upgrade.contract.NAME + '.service'}
        staged = self.tool.stage()
        before = {
            path: (path.stat().st_ino, path.read_bytes())
            for path in [self.root / 'config/checkout.json', self.root / 'config/anon.json',
                         *[(self.root / 'units' / name) for name in upgrade.contract.units()]]
        }
        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback'), \
                patch.object(upgrade.os, 'rename', side_effect=self.rename):
            backup = self.tool.activate(staged)
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'new server')
        self.assertEqual((backup / 'app/apps/web/server.js').read_bytes(), b'old server')
        self.assertEqual((backup / 'receipt.json').read_bytes(), self.receipt)
        receipt = json.loads((self.root / 'receipt.json').read_text())
        self.assertEqual(receipt['manifestSha256'], self.new_manifest_hash)
        self.assertEqual(receipt['predecessorManifestSha256'], self.old_manifest_hash)
        self.assertEqual(before, {
            path: (path.stat().st_ino, path.read_bytes()) for path in before
        })
        stop_at = self.commands.index(upgrade.contract.rollback_commands()[0])
        self.assertEqual(self.commands[stop_at:stop_at + 2], upgrade.contract.rollback_commands())
    def test_failed_post_restart_probe_restores_only_the_old_app(self):
        self.started = {upgrade.contract.NAME + '.service'}
        staged = self.tool.stage()
        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback', side_effect=Refused('probe failed')), \
                patch.object(upgrade.os, 'rename', side_effect=self.rename):
            with self.assertRaises(Refused):
                self.tool.activate(staged)
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'old server')
        self.assertEqual((self.root / 'config/anon.json').read_bytes(), b'anon')
    def test_known_stopped_container_is_valid_rollback_input(self):
        self.started = set()
        self.tool.load_artifacts()
        self.assertIsNone(self.tool.verify_container(None))
        with self.assertRaises(Refused):
            self.tool.verify_container(True)
    def test_resume_starts_the_reviewed_service_and_proves_the_mounted_app(self):
        self.started = set()
        self.tool.load_artifacts()
        with patch.object(upgrade_probes, 'wait_for_loopback'), patch.object(self.tool, 'probe_loopback'):
            self.tool.prove_running(self.old_files)
        self.assertIn(['/usr/bin/systemctl', 'start', upgrade.contract.NAME + '.service'], self.commands)

    def test_resume_refuses_a_running_container_with_different_mounted_app_bytes(self):
        self.started = {upgrade.contract.NAME + '.service'}
        self.mounted_digest = '0' * 64
        self.tool.load_artifacts()
        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback'), \
                self.assertRaisesRegex(Refused, 'Public mounted app bytes differ'):
            self.tool.prove_running(self.old_files)

    def test_second_candidate_uses_a_new_private_sibling_without_deleting_the_first(self):
        self.started = set()
        first = self.tool.stage()
        second = self.tool.stage()
        self.assertNotEqual(first, second)
        self.assertTrue(first.is_dir())
        self.assertTrue(second.is_dir())

    def test_existing_rollback_backup_refuses_before_stopping_the_old_service(self):
        self.started = {upgrade.contract.NAME + '.service'}
        staged = self.tool.stage()
        (self.root.parent / (self.root.name + '.app.rollback-' + self.old_manifest_hash[:12])).mkdir()
        with self.assertRaises(Refused):
            self.tool.activate(staged)
        self.assertIn(upgrade.contract.NAME + '.service', self.started)
        self.assertFalse(any(command == upgrade.contract.rollback_commands()[0] for command in self.commands))

    def test_first_app_rename_failure_restarts_the_verified_original_app(self):
        self.started = {upgrade.contract.NAME + '.service'}
        staged = self.tool.stage()

        def fail_first(source, destination):
            if Path(source) == self.root / 'app':
                raise OSError('first rename failed')
            self.rename(source, destination)

        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback'), \
                patch.object(upgrade.os, 'rename', side_effect=fail_first), \
                self.assertRaises(OSError):
            self.tool.activate(staged)
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'old server')
        self.assertIn(upgrade.contract.NAME + '.service', self.started)

    def test_second_app_rename_failure_restores_the_exact_original_app(self):
        self.started = {upgrade.contract.NAME + '.service'}
        staged = self.tool.stage()

        def fail_second(source, destination):
            if Path(source) == staged / 'app':
                raise OSError('second rename failed')
            self.rename(source, destination)

        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback'), \
                patch.object(upgrade.os, 'rename', side_effect=fail_second), \
                self.assertRaises(OSError):
            self.tool.activate(staged)
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'old server')
        self.assertEqual((staged / 'app/apps/web/server.js').read_bytes(), b'new server')
        self.assertIn(upgrade.contract.NAME + '.service', self.started)

    def test_exact_retained_backup_allows_a_retry_after_rollback(self):
        self.started = {upgrade.contract.NAME + '.service'}
        failed = self.tool.stage()
        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback', side_effect=Refused('probe failed')), \
                patch.object(upgrade.os, 'rename', side_effect=self.rename), self.assertRaises(Refused):
            self.tool.activate(failed)
        retry = self.tool.stage()
        with patch.object(upgrade_probes, 'wait_for_loopback'), \
                patch.object(self.tool, 'probe_loopback'), \
                patch.object(upgrade.os, 'rename', side_effect=self.rename):
            self.tool.activate(retry)
        self.assertEqual((self.root / 'app/apps/web/server.js').read_bytes(), b'new server')

if __name__ == '__main__':
    unittest.main()

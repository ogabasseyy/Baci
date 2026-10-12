import hashlib
import json
import os
from pathlib import Path
import time

from public_artifact import ARCHIVE_LIMIT, MANIFEST_LIMIT, validate_archive
from public_install_io import capture
from public_projection import parsed
import public_service_contract as contract
import public_app_upgrade_io as upgrade_io
from public_app_upgrade_probes import prove_running as prove_runtime, probe_loopback
from public_app_upgrade_recovery import (
    app_state, prepare_backup as prepare_retained_backup, recover_runtime,
    restore_original, verify_backup,
)
from runtime_owner_support import command
from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused
from treasury_owner_io import private_directory, read_file, root_ancestors


ROOT, SYSTEMD = Path(contract.ROOT), Path('/etc/systemd/system')
OWNER, ROOT_GROUP, APP_GROUP = 0, 0, 65530
OLD_ARCHIVE_SHA256 = '63431f68c320bf40a5d10136fb9f748ce8aa51f349a829534740bb25f4b94f6f'
OLD_MANIFEST_SHA256 = '525902e94dca498fe1d5a66c4be53b10335a7f663e07f62203c8f7fd81f77c82'
LIMIT = 4_194_304
def read_private(path, mode, limit):
    return read_file(path, OWNER, mode, limit)
def metadata(path, mode, group, directory=False):
    return upgrade_io.metadata(path, mode, group, OWNER, directory)
def exact(path, expected, mode, group):
    return upgrade_io.exact(path, expected, mode, group, OWNER, read_private)
def verify_app(root, files):
    return upgrade_io.verify_app(root, files, OWNER, ROOT_GROUP, read_private)
def write_file(path, content, mode, group=None):
    group = ROOT_GROUP if group is None else group
    return upgrade_io.write_file(path, content, mode, OWNER, group)
def sync(directory):
    return upgrade_io.sync(directory)
class PublicAppUpgrade:
    def __init__(self, old_archive, old_manifest, archive, archive_sha256, manifest, manifest_sha256, clock=time.time):
        self.old_archive = Path(old_archive)
        self.old_manifest = Path(old_manifest)
        self.archive = Path(archive)
        self.archive_sha256 = archive_sha256
        self.manifest = Path(manifest)
        self.manifest_sha256 = manifest_sha256
        self.clock = clock
        self.old_files = None
        self.new_files = None
        self.old_archive_content = None
        self.old_manifest_content = None
        self.archive_content = None
        self.manifest_content = None

    def unexpired(self):
        if self.clock() >= DEADLINE_EPOCH:
            raise Refused('Public staging deadline expired')
    def load_artifacts(self):
        self.old_archive_content = capture(self.old_archive, ARCHIVE_LIMIT)
        self.old_manifest_content = capture(self.old_manifest, MANIFEST_LIMIT)
        self.archive_content = capture(self.archive, ARCHIVE_LIMIT)
        self.manifest_content = capture(self.manifest, MANIFEST_LIMIT)
        self.old_files = validate_archive(
            self.old_archive_content, self.old_manifest_content,
            OLD_ARCHIVE_SHA256, OLD_MANIFEST_SHA256)
        self.new_files = validate_archive(
            self.archive_content, self.manifest_content,
            self.archive_sha256, self.manifest_sha256)
    def verify_current(self):
        root_ancestors(ROOT)
        metadata(ROOT, 0o750, APP_GROUP, directory=True)
        verify_app(ROOT / 'app', self.old_files)
        metadata(ROOT / 'config', 0o710, APP_GROUP, directory=True)
        receipt = parsed(read_private(ROOT / 'receipt.json', 0o600, 65536))
        if (receipt.get('archiveSha256') != OLD_ARCHIVE_SHA256
                or receipt.get('manifestSha256') != OLD_MANIFEST_SHA256
                or receipt.get('deadline') != DEADLINE):
            raise Refused('Pinned predecessor receipt differs')
        self.verify_support(receipt)

    def verify_support(self, receipt):
        for name in ('checkout.json', 'anon.json'):
            expected = receipt.get(name.removesuffix('.json') + 'Sha256')
            content = read_private(ROOT / 'config' / name, 0o440, 131072)
            if hashlib.sha256(content).hexdigest() != expected:
                raise Refused('Public configuration differs')
        metadata(ROOT / 'units', 0o700, ROOT_GROUP, directory=True)
        expected_units = contract.units()
        if {item.name for item in (ROOT / 'units').iterdir()} != set(expected_units):
            raise Refused('Public unit set differs')
        for name, content in expected_units.items():
            exact(ROOT / 'units' / name, content.encode(), 0o644, ROOT_GROUP)
            root_ancestors(SYSTEMD / name)
            exact(SYSTEMD / name, content.encode(), 0o644, ROOT_GROUP)

    def active_receipt(self):
        receipt = parsed(read_private(ROOT / 'receipt.json', 0o600, 65536))
        if (receipt.get('archiveSha256') != self.archive_sha256
                or receipt.get('manifestSha256') != self.manifest_sha256
                or receipt.get('predecessorArchiveSha256') != OLD_ARCHIVE_SHA256
                or receipt.get('predecessorManifestSha256') != OLD_MANIFEST_SHA256
                or receipt.get('deadline') != DEADLINE):
            raise Refused('Active public receipt differs')
        return receipt

    def verify_active(self):
        metadata(ROOT, 0o750, APP_GROUP, directory=True)
        verify_app(ROOT / 'app', self.new_files)
        self.verify_support(self.active_receipt())

    def stage(self):
        self.unexpired()
        self.load_artifacts()
        self.verify_current()
        base = ROOT.name + '.candidate-' + self.manifest_sha256[:12] + '-'
        stage = next((ROOT.parent / (base + str(number)) for number in range(1, 1000)
                      if not (ROOT.parent / (base + str(number))).exists()
                      and not (ROOT.parent / (base + str(number))).is_symlink()), None)
        if stage is None:
            raise Refused('Candidate sibling capacity exhausted')
        stage.mkdir(mode=0o700)
        os.chown(stage, OWNER, ROOT_GROUP)
        write_file(stage / 'public-app.tar.gz', self.archive_content, 0o600)
        write_file(stage / 'public-app.manifest.json', self.manifest_content, 0o600)
        write_file(stage / 'candidate.json', json.dumps({
            'archiveSha256': self.archive_sha256, 'manifestSha256': self.manifest_sha256,
            'predecessorArchiveSha256': OLD_ARCHIVE_SHA256, 'predecessorManifestSha256': OLD_MANIFEST_SHA256,
            'deadline': DEADLINE,
        }, sort_keys=True, separators=(',', ':')).encode(), 0o600)
        app = stage / 'app'
        app.mkdir(mode=0o700)
        os.chown(app, OWNER, ROOT_GROUP)
        for name, content in self.new_files.items():
            target = app / name
            target.parent.mkdir(parents=True, exist_ok=True)
            for directory in (target.parent, *target.parent.parents):
                if directory == stage:
                    break
                os.chown(directory, OWNER, ROOT_GROUP)
                directory.chmod(0o700)
            write_file(target, content, 0o444)
        for directory in sorted((item for item in app.rglob('*') if item.is_dir()),
                                key=lambda item: len(item.parts), reverse=True):
            directory.chmod(0o555)
        app.chmod(0o555)
        verify_app(app, self.new_files)
        sync(stage)
        return stage

    def prepare_backup(self):
        return prepare_retained_backup(self, ROOT, OLD_MANIFEST_SHA256, OWNER, ROOT_GROUP,
                                       write_file, sync, read_private, self.verify_backup)

    def verify_backup(self, backup, with_app):
        return verify_backup(backup, with_app, self.old_files, self.old_archive_content,
                             self.old_manifest_content, OLD_ARCHIVE_SHA256, OLD_MANIFEST_SHA256,
                             DEADLINE, ROOT_GROUP, metadata, verify_app, exact, parsed, read_private)

    def activate_receipt(self, backup):
        prior = parsed(read_private(ROOT / 'receipt.json', 0o600, 65536))
        receipt = {**prior, 'archiveSha256': self.archive_sha256,
                   'manifestSha256': self.manifest_sha256,
                   'predecessorArchiveSha256': OLD_ARCHIVE_SHA256,
                   'predecessorManifestSha256': OLD_MANIFEST_SHA256,
                   'rollbackPath': str(backup)}
        replacement = ROOT / 'receipt.json.candidate'
        if replacement.exists() or replacement.is_symlink():
            raise Refused('Existing receipt replacement retained')
        write_file(replacement, json.dumps(receipt, sort_keys=True, separators=(',', ':')).encode(), 0o600)
        os.rename(replacement, ROOT / 'receipt.json')
        sync(ROOT)
        self.active_receipt()

    def verify_container(self, running):
        image = parsed(command([*contract.DOCKER, 'image', 'inspect', contract.IMAGE]))
        observed = parsed(command([*contract.DOCKER, 'inspect', contract.NAME]))
        if len(image) != 1 or image[0].get('Id') != contract.IMAGE or len(observed) != 1:
            raise Refused('Public container identity differs')
        contract.validate_container(observed[0], OLD_MANIFEST_SHA256, image[0].get('Config', {}).get('Env'))
        if running is not None and observed[0].get('State', {}).get('Running') is not running:
            raise Refused('Public container running state differs')

    def probe_loopback(self):
        return probe_loopback(contract, LIMIT)

    def prove_running(self, files):
        return prove_runtime(contract, files, self.verify_container, command, self.probe_loopback)

    def app_state(self, path):
        return app_state(path, self.old_files, self.new_files, verify_app)

    def restore(self, stage, backup):
        self.verify_container(None)
        for arguments in contract.rollback_commands():
            command(arguments)
        self.verify_container(None)
        restore_original(ROOT / 'app', stage / 'app', backup / 'app', self.app_state, os.rename)
        replacement = ROOT / 'receipt.json.rollback'
        if replacement.exists() or replacement.is_symlink():
            raise Refused('Existing receipt rollback retained')
        write_file(replacement, read_private(backup / 'receipt.json', 0o600, 65536), 0o600)
        os.rename(replacement, ROOT / 'receipt.json')
        sync(ROOT.parent)
        verify_app(ROOT / 'app', self.old_files)
        self.prove_running(self.old_files)

    def activate(self, stage):
        self.unexpired()
        stage = Path(stage)
        if stage.parent != ROOT.parent or not stage.name.startswith(ROOT.name + '.candidate-'):
            raise Refused('Private candidate path differs')
        verify_app(stage / 'app', self.new_files)
        self.verify_current()
        self.verify_container(True)
        backup = self.prepare_backup()
        try:
            for arguments in contract.rollback_commands():
                command(arguments)
            self.verify_container(False)
            self.verify_current()
        except BaseException:
            self.prove_running(self.old_files)
            raise
        try:
            os.rename(ROOT / 'app', backup / 'app')
            os.rename(stage / 'app', ROOT / 'app')
            sync(ROOT.parent)
            verify_app(ROOT / 'app', self.new_files)
            self.activate_receipt(backup)
            self.prove_running(self.new_files)
            self.verify_active()
            self.unexpired()
            return backup
        except BaseException:
            self.restore(stage, backup)
            raise

    def backup_info(self):
        receipt = self.active_receipt()
        backup = Path(receipt.get('rollbackPath', ''))
        expected = ROOT.parent / (ROOT.name + '.app.rollback-' + OLD_MANIFEST_SHA256[:12])
        if backup != expected:
            raise Refused('Public rollback receipt path differs')
        self.verify_backup(backup, True)
        return {'status': 'already-active', 'appBackup': str(backup / 'app'),
                'artifactBackup': str(backup / 'public-app.tar.gz'),
                'receiptBackup': str(backup / 'receipt.json')}


def load_bundle(bundle_dir):
    bundle = Path(bundle_dir)
    if os.geteuid() != 0:
        raise Refused('Root-private public upgrade required')
    root_ancestors(bundle)
    private_directory(bundle)
    pins = parsed(read_private(bundle / 'pins.json', 0o600, 8192))
    if (set(pins) != {'oldArchiveSha256', 'oldManifestSha256', 'archiveSha256', 'manifestSha256', 'deadline'}
            or pins['oldArchiveSha256'] != OLD_ARCHIVE_SHA256
            or pins['oldManifestSha256'] != OLD_MANIFEST_SHA256
            or pins['deadline'] != DEADLINE
            or any(not isinstance(pins[name], str) or len(pins[name]) != 64
                   for name in ('archiveSha256', 'manifestSha256'))):
        raise Refused('Public upgrade bundle pins differ')
    installer = PublicAppUpgrade(
        bundle / 'old-public-app.tar.gz', bundle / 'old-public-app.manifest.json',
        bundle / 'public-app.tar.gz', pins['archiveSha256'],
        bundle / 'public-app.manifest.json', pins['manifestSha256'])
    return installer


def ensure_candidate(bundle_dir):
    installer = load_bundle(bundle_dir)
    installer.load_artifacts()
    installer.unexpired()
    try:
        installer.verify_active()
        installer.prove_running(installer.new_files)
        return installer.backup_info()
    except Refused:
        installer.verify_current()
    backup = installer.activate(installer.stage())
    return {'status': 'upgraded', 'appBackup': str(backup / 'app'),
            'artifactBackup': str(backup / 'public-app.tar.gz'),
            'receiptBackup': str(backup / 'receipt.json')}


def upgrade(bundle_dir):
    return ensure_candidate(bundle_dir)


def recover_existing_runtime(bundle_dir):
    installer = load_bundle(bundle_dir)
    installer.load_artifacts()
    installer.unexpired()
    return recover_runtime(installer)

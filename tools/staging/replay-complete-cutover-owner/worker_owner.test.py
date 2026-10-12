import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import io
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import worker_source_authority as authority
try:
    import worker_owner as module
except ModuleNotFoundError:
    module = None


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('worker_owner_fixture', HERE / 'worker_source_authority.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
FINANCE = Path('/root/baci-financial-owner.2ynkl9kc')
BUNDLE = FINANCE / 'bundle-r8'
SCHEDULER = BUNDLE / 'tooling/runtime_scheduler.py'
DEPENDENCY = BUNDLE / 'tooling/treasury_owner_contract.py'
PROPERTIES = ('FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState', 'ActiveState',
              'SubState', 'Result', 'ExecMainStatus', 'InvocationID')


class WorkerOwnerTests(unittest.TestCase):
    def setUp(self):
        self.fixture = FIXTURE.WorkerSourceAuthorityTests('runTest')
        self.fixture.setUp()
        self.clock = self.fixture.clock
        self.container = self.fixture.facts['container']
        self.image = self.fixture.facts['image']
        self.unit = self.fixture.facts['unit'] | dict(Result='success', ExecMainStatus='0', InvocationID='')
        encode = FIXTURE.encoded
        dependency = (FIXTURE.SOURCE / 'treasury_owner_contract.py').read_bytes()
        self.fixture.manifest['files']['tooling/treasury_owner_contract.py'] = hashlib.sha256(dependency).hexdigest()
        self.blobs = {
            BUNDLE / 'financial-preparation.json': encode(self.fixture.manifest),
            FINANCE / 'captured/activation.prepared.json': encode(self.fixture.original),
            FINANCE / 'renewal-candidate/candidate.json': encode(self.fixture.candidate),
            FINANCE / 'renewal-candidate/artifacts/workers/background.json': encode(self.fixture.configuration),
            SCHEDULER: self.fixture.scheduler, DEPENDENCY: dependency,
            BUNDLE / 'tooling/background-runner.sh': self.fixture.wrapper,
            Path(authority.CONFIGURATION): encode(self.fixture.configuration),
            Path(authority.UNIT): authority.BACKGROUND_UNIT,
        }
        for path in self.fixture.facts['files']:
            if path.endswith('.cjs'):
                self.blobs[Path(path)] = b'synthetic-compiled:' + path.encode()
            elif path.endswith('background.sh'):
                self.blobs[Path(path)] = FIXTURE.SCHEDULER.background_wrapper().encode()
        self.pins = {raw: hashlib.sha256(raw).hexdigest() for raw in self.blobs.values()}
        for path, pin in ((BUNDLE / 'financial-preparation.json', authority.MANIFEST_SHA256),
            (FINANCE / 'captured/activation.prepared.json', authority.ORIGINAL_CONFIGURATION_SHA256),
            (FINANCE / 'renewal-candidate/candidate.json', authority.CANDIDATE_SHA256),
            (Path(authority.CONFIGURATION), authority.CONFIGURATION_SHA256)):
            self.pins[self.blobs[path]] = pin
        for path, value in self.fixture.facts['files'].items():
            self.pins[self.blobs[Path(path)]] = value['sha256']
        self.metadata_rows = {}
        for path, raw in self.blobs.items():
            uid, mode = (65532, 0o600) if str(path) == authority.CONFIGURATION else (0,
                0o644 if str(path) == authority.UNIT else 0o444 if str(path).startswith(authority.ROOT) else 0o600)
            self.metadata_rows[path] = self.info(stat.S_IFREG | mode, uid, len(raw))
            for parent in path.parents:
                self.metadata_rows.setdefault(parent, self.info(stat.S_IFDIR | 0o755, 0, 4096))
        self.metadata = Mock(side_effect=lambda path: copy.copy(self.metadata_rows[Path(path)]))
        self.context = SimpleNamespace(owner=SimpleNamespace(read=Mock(side_effect=self.read)),
            finance={'command': Mock(side_effect=self.command)}, deadline=Mock())
        self.scheduler = SimpleNamespace(__file__=str(SCHEDULER), IMAGE=authority.IMAGE,
            units=FIXTURE.SCHEDULER.units, validate_container=FIXTURE.SCHEDULER.validate_container)
        self.loader = Mock(return_value=self.scheduler)
        self.records = []

    def info(self, mode, uid, size):
        return SimpleNamespace(st_mode=mode, st_uid=uid, st_gid=uid, st_nlink=1, st_size=size,
            st_dev=1, st_ino=len(getattr(self, 'metadata_rows', {})) + 1, st_mtime_ns=1, st_ctime_ns=1)

    def read(self, path, pin, *, modes, uid):
        row = self.metadata_rows[Path(path)]
        self.assertEqual(row.st_uid, uid)
        self.assertIn(stat.S_IMODE(row.st_mode), modes)
        return self.blobs[Path(path)]

    def command(self, arguments):
        self.records.append(arguments)
        if arguments[:3] == ['/usr/bin/python3', '-B', '-c']:
            self.assertIn("context['closure']()", arguments[3])
            return '{"status":"sealed-financial-source-verified"}'
        if arguments == ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'inspect', authority.BACKGROUND_CONTAINER_ID]:
            return json.dumps([self.container])
        if arguments == ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'image', 'inspect', authority.IMAGE]:
            return json.dumps([self.image])
        if arguments == ['/usr/bin/systemctl', 'show', 'baci-prefunded-background.service',
                         *['--property=' + name for name in PROPERTIES]]:
            return ''.join(name + '=' + self.unit[name] + '\n' for name in PROPERTIES)
        self.fail('unexpected or mutating command')

    def collect(self):
        self.assertIsNotNone(module, 'read-only owner collector not implemented')
        real = hashlib.sha256
        digest = lambda raw: self.pins.get(raw, real(raw).hexdigest())
        with (patch.object(module, '_digest', side_effect=digest),
              patch.object(authority, '_sha', side_effect=digest), patch.object(module.os, 'geteuid', return_value=0),
              patch.object(module, 'datetime') as clock, patch.object(authority, 'datetime') as authority_clock):
            for mock in (clock, authority_clock):
                mock.now.side_effect = lambda _: self.clock
                mock.fromisoformat.side_effect = datetime.fromisoformat
            return module.collect_worker_authority(self.context, metadata=self.metadata, load_scheduler=self.loader)

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^worker_owner_refused$'):
            self.collect()

    def test_binds_pinned_private_provenance_sources_and_stopped_facts_without_leaking_bytes(self):
        with patch('sys.stdout', new_callable=io.StringIO) as output:
            report, scheduler = self.collect()
        self.assertEqual(report['containerId'], authority.BACKGROUND_CONTAINER_ID)
        self.assertEqual(report['manifestSha256'], authority.MANIFEST_SHA256)
        self.assertIs(scheduler, self.scheduler)
        self.assertNotIn('synthetic-private-marker', json.dumps(report))
        self.assertEqual(output.getvalue(), '')
        self.assertNotIn('activationAuthorized', report)
        self.assertEqual(self.loader.call_count, 1)
        self.assertEqual(self.loader.call_args.args, (SCHEDULER, {
            str(SCHEDULER): authority.SCHEDULER_SHA256, str(DEPENDENCY): self.pins[self.blobs[DEPENDENCY]]}))
        for path in self.blobs:
            self.assertGreaterEqual(sum(call.args[0] == path for call in self.context.owner.read.call_args_list), 2)

    def test_root_and_original_financial_closure_failure_refuse_before_private_reads(self):
        self.assertIsNotNone(module)
        with patch.object(module.os, 'geteuid', return_value=1001), self.assertRaisesRegex(ValueError, '^worker_owner_refused$'):
            module.collect_worker_authority(self.context, metadata=self.metadata, load_scheduler=self.loader)
        self.context.owner.read.assert_not_called()
        self.context.finance['command'].side_effect = ValueError('synthetic-private-marker')
        self.refused()
        self.context.owner.read.assert_not_called()
        self.loader.assert_not_called()

    def test_gid_is_checked_even_though_injected_reader_does_not_check_it(self):
        for path in (BUNDLE / 'financial-preparation.json', SCHEDULER, Path(authority.CONFIGURATION), Path(authority.UNIT)):
            original = self.metadata_rows[path].st_gid
            self.metadata_rows[path].st_gid = 42
            self.refused()
            self.metadata_rows[path].st_gid = original
        self.loader.assert_not_called()

    def test_symlink_hardlink_nonregular_owner_mode_and_size_refuse(self):
        path = BUNDLE / 'financial-preparation.json'
        original = copy.copy(self.metadata_rows[path])
        for name, value in (('st_mode',stat.S_IFLNK | 0o600), ('st_mode',stat.S_IFDIR | 0o600),
            ('st_nlink',2), ('st_uid',65532), ('st_mode',stat.S_IFREG | 0o640), ('st_size',0), ('st_size',16_000_001)):
            self.metadata_rows[path] = copy.copy(original)
            setattr(self.metadata_rows[path], name, value)
            self.refused()
        self.loader.assert_not_called()

    def test_symlink_or_writable_ancestor_refuses_without_reading_private_bytes(self):
        path = FINANCE
        for mode in (stat.S_IFLNK | 0o755, stat.S_IFDIR | 0o777):
            self.metadata_rows[path].st_mode = mode
            self.refused()
        self.context.owner.read.assert_not_called()

    def test_file_gid_or_inode_change_during_read_and_postcollection_changes_refuse(self):
        path = Path(authority.CONFIGURATION)
        def change_during_read(filename, pin, **options):
            value = self.read(filename, pin, **options)
            if filename == path:
                self.metadata_rows[path].st_gid = 7
            return value
        self.context.owner.read.side_effect = change_during_read
        self.refused()
        self.metadata_rows[path].st_gid = 65532
        self.context.owner.read.side_effect = self.read
        def changed_loader(*args):
            self.metadata_rows[path].st_ino += 1
            return self.scheduler
        self.loader.side_effect = changed_loader
        self.refused()

    def test_reader_wrong_hash_size_or_secret_exception_is_sanitized(self):
        original = self.context.owner.read.side_effect
        same_size_wrong_hash = b'x' * len(self.blobs[BUNDLE / 'financial-preparation.json'])
        for replacement in (b'wrong', same_size_wrong_hash, None, ValueError('synthetic-private-marker')):
            self.context.owner.read.side_effect = replacement if isinstance(replacement, Exception) else lambda *args, **kwargs: replacement
            self.refused()
        self.context.owner.read.side_effect = original
        self.loader.assert_not_called()

    def test_mutable_metadata_inode_change_during_read_refuses_before_scheduler_load(self):
        path = Path(authority.CONFIGURATION)
        self.metadata.side_effect = lambda filename: self.metadata_rows[Path(filename)]
        def change(filename, pin, **options):
            raw = self.read(filename, pin, **options)
            if filename == path:
                self.metadata_rows[path].st_ino += 1
            return raw
        self.context.owner.read.side_effect = change
        self.refused()
        self.loader.assert_not_called()

    def test_original_private_and_sealed_source_byte_drift_refuses_before_loader(self):
        for path in (BUNDLE / 'financial-preparation.json', FINANCE / 'captured/activation.prepared.json',
            FINANCE / 'renewal-candidate/candidate.json', SCHEDULER, DEPENDENCY, Path(authority.UNIT)):
            original = self.blobs[path]
            self.blobs[path] = original[:-1] + b'x'
            self.refused()
            self.blobs[path] = original
        self.loader.assert_not_called()

    def test_private_upstream_candidate_must_match_installed_configuration(self):
        self.blobs[FINANCE / 'renewal-candidate/artifacts/workers/background.json'] = b'{}'
        self.refused()
        self.loader.assert_not_called()

    def test_wrong_sibling_running_profile_or_extra_environment_refuses_before_loader(self):
        baseline = copy.deepcopy(self.container)
        for field, value in (('Id',authority.BACKGROUND_CONTAINER_ID[:-1] + '5'), ('Running',True), ('Env',['EXTRA=1'])):
            self.container = copy.deepcopy(baseline)
            target = self.container if field == 'Id' else self.container['State' if field == 'Running' else 'Config']
            target[field] = value
            self.refused()
        self.loader.assert_not_called()

    def test_effective_unit_missing_duplicate_dropin_active_or_reload_fields_refuse(self):
        original = dict(self.unit)
        for field, value in (('DropInPaths','/foreign'), ('NeedDaemonReload','yes'), ('ActiveState','active')):
            self.unit = original | {field:value}
            self.refused()
        self.unit = original
        base = self.command
        for suffix in ('FragmentPath=/duplicate\n', 'Foreign=value\n'):
            self.context.finance['command'].side_effect = lambda args: base(args) + suffix if args[0] == '/usr/bin/systemctl' else base(args)
            self.refused()
        self.loader.assert_not_called()

    def test_scheduler_closure_or_loaded_module_origin_and_unit_abi_refuse(self):
        self.scheduler.__file__ = '/foreign/runtime_scheduler.py'
        self.refused()
        self.scheduler.__file__ = str(SCHEDULER)
        self.scheduler.units = lambda: {'background.service':'foreign'}
        self.refused()

    def test_missing_multiple_invalid_or_delayed_installed_probe_facts_refuse_before_loader(self):
        base = self.command
        for kind in ('multiple', 'invalid', 'missing', 'delay'):
            def run(arguments):
                raw = base(arguments)
                if arguments[0] == '/usr/bin/systemctl':
                    if kind == 'missing':
                        return raw.replace('SubState=dead\n', '')
                    if kind == 'delay':
                        self.clock += timedelta(seconds=61)
                if arguments[0] == '/usr/bin/docker' and arguments[-1] == authority.BACKGROUND_CONTAINER_ID:
                    return json.dumps([self.container, self.container]) if kind == 'multiple' else 'invalid' if kind == 'invalid' else raw
                return raw
            self.context.finance['command'].side_effect = run
            self.refused()
        self.loader.assert_not_called()

    def test_source_or_container_change_after_loader_and_slow_collection_refuse(self):
        def drift(*args):
            self.container['State']['Running'] = True
            return self.scheduler
        self.loader.side_effect = drift
        self.refused()
        self.container['State']['Running'] = False
        def delay(*args):
            self.clock += timedelta(seconds=61)
            return self.scheduler
        self.loader.side_effect = delay
        self.refused()

    def test_default_metadata_uses_lstat_not_following_stat(self):
        self.assertIsNotNone(module)
        with patch.object(Path, 'lstat', return_value='synthetic') as observed:
            self.assertEqual(module._lstat(Path('/synthetic')), 'synthetic')
        observed.assert_called_once()


if __name__ == '__main__':
    unittest.main()

import importlib.util
import json
import io
import os
import stat
import tempfile
import unittest
from contextlib import nullcontext
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


HERE = Path(__file__).resolve().parent


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


contract = load('wallet_transition_contract_test', 'wallet-gateway-transition-installer.py')
runtime = load('wallet_transition_runtime_test', 'wallet-gateway-transition-runtime.py')
activator, candidate = contract.legacy_modules()


def current_binding():
    timestamp = '2026-09-22T15:59:10.442Z'
    return {
        'version': 1,
        'identity': {
            'host': 'staging-auth.ogabassey.com',
            'containers': {'auth': {}, 'rest': {}},
            'networks': {'database': {}},
            'restRoutes': [
                {'path': path, 'methods': list(methods)}
                for path, methods in candidate.ROUTES
            ],
        },
        'reviewedAt': timestamp,
        'leaseNotBefore': timestamp,
        'leaseExpiresAt': '2026-09-29T15:59:10.442Z',
    }


class WalletTransitionContractTests(unittest.TestCase):
    def test_route_contract_is_exact_eleven_to_sixteen_extension(self):
        routes = contract.routes_16(candidate)
        self.assertEqual(len(routes), 16)
        self.assertEqual(routes[:11], tuple(candidate.ROUTES))
        self.assertEqual(routes[11:], contract.NEW_ROUTES)
        with self.assertRaisesRegex(contract.Refused, 'legacy_11_route_contract_drift'):
            contract.routes_16(type('Candidate', (), {'ROUTES': candidate.ROUTES + (contract.NEW_ROUTES[0],)})())

    def test_manifest_pins_pretty_printed_predecessor_bytes_verbatim(self):
        binding = current_binding()
        source_bytes = json.dumps(binding, indent=2).encode()
        with tempfile.TemporaryDirectory() as temporary:
            output = Path(temporary) / 'package'
            result = contract.build_package(
                output, binding=binding, binding_bytes=source_bytes,
                activator=activator, candidate=candidate,
                now=1790180000,
            )
            manifest = json.loads((output / 'manifest.json').read_bytes())
            self.assertEqual(manifest['predecessorBindingSha256'], contract.sha(source_bytes))
            self.assertEqual((output / 'binding-before.json').read_bytes(), source_bytes)
            self.assertEqual(result['routesAfter'], 16)

    def test_prepare_rejects_manifest_pin_tampering_before_database_probe(self):
        with patch.object(runtime, 'PACKAGE', Path('/private/package')), \
             patch.object(contract, 'legacy_preflight'), \
             patch.object(contract, 'validate_current_binding', return_value={}), \
             patch.object(contract, 'read_package', return_value=({}, b'target', b'manifest')):
                fake_activator = SimpleNamespace(
                    BINDING_PATH=Path('/private/binding.json'),
                    _read_json=lambda *args: (current_binding(), b'original'),
                    _read_root_file=lambda *args: b'wrong-pin\n',
                )
                database = SimpleNamespace(check_docker_database=lambda: self.fail('DB preflight must not run'))
                with self.assertRaisesRegex(RuntimeError, 'owner manifest pin mismatch'):
                    runtime._prepare(contract, fake_activator, candidate, database)

    def test_main_check_cli_uses_preflight_and_emits_ready(self):
        fake_activator = SimpleNamespace(
            verify_graph=lambda: None,
            LOCK_PATH=Path('/run/shared-transition.lock'),
            _locked=lambda path: nullcontext(),
        )
        fake_contract = SimpleNamespace(
            Refused=contract.Refused,
            legacy_modules=lambda: (fake_activator, candidate),
            verify_graph=lambda: None,
            build_package=contract.build_package,
            sha=contract.sha,
        )
        context = {'target': {'leaseExpiresAt': '2026-09-29T15:59:10.442Z'},
                   'manifestBytes': b'manifest', 'database': {'databaseReadOnly': True}}
        with patch.object(runtime, '_module', side_effect=[fake_contract, SimpleNamespace(Refused=RuntimeError)]), \
             patch.object(runtime.os, 'geteuid', return_value=0), \
             patch.object(runtime, '_prepare', return_value=context), \
             patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(runtime.main(['--check']), 0)
        self.assertEqual(json.loads(output.getvalue())['status'], 'ready')

    def test_main_stage_package_cli_stages_review_pinned_bundle(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / 'source'
            source.mkdir(mode=0o700)
            manifest_bytes = b'{"restRoutes":[]}'
            for name, content in (('binding-before.json', b'{}'), ('binding.json', b'{}'),
                                  ('manifest.json', manifest_bytes)):
                (source / name).write_bytes(content)
                (source / name).chmod(0o600)
            manifest_hash = contract.sha(manifest_bytes)
            fake_activator = SimpleNamespace(
                verify_graph=lambda: None, LOCK_PATH=Path('/run/shared-transition.lock'),
                _locked=lambda path: nullcontext(),
            )
            fake_contract = SimpleNamespace(
                Refused=contract.Refused,
                legacy_modules=lambda: (fake_activator, candidate),
                stage_package=contract.stage_package,
            )
            package = root / 'installed' / 'wallet-route-transition'
            package.parent.mkdir(mode=0o700)
            real_lstat = Path.lstat

            def root_lstat(path):
                info = real_lstat(path)
                mode = (stat.S_IFDIR | 0o700) if path.is_dir() else info.st_mode
                return SimpleNamespace(st_mode=mode, st_uid=0, st_nlink=info.st_nlink)

            with patch.object(runtime, '_module', side_effect=[fake_contract, SimpleNamespace(Refused=RuntimeError)]), \
                 patch.object(contract, 'legacy_modules', return_value=(SimpleNamespace(
                     _safe_ancestors=lambda *args: None,
                     _read_root_file=lambda path, *args: Path(path).read_bytes(),
                 ), candidate)), \
                 patch.object(runtime.os, 'geteuid', return_value=0), \
                 patch.object(runtime, 'PACKAGE', package), \
                 patch.object(runtime, '_safe_directory'), \
                 patch.object(Path, 'lstat', root_lstat), \
                 patch('sys.stdout', new_callable=io.StringIO) as output:
                self.assertEqual(runtime.main(['--stage-package', str(source), '--manifest-sha256', manifest_hash]), 0)
            self.assertTrue((package / runtime.REVIEW_PIN).exists())
            self.assertEqual(json.loads(output.getvalue())['status'], 'package_staged')
            with patch.object(runtime, '_module', side_effect=[fake_contract, SimpleNamespace(Refused=RuntimeError)]), \
                 patch.object(contract, 'legacy_modules', return_value=(SimpleNamespace(
                     _safe_ancestors=lambda *args: None,
                     _read_root_file=lambda path, *args: Path(path).read_bytes(),
                 ), candidate)), \
                 patch.object(runtime.os, 'geteuid', return_value=0), \
                 patch.object(runtime, 'PACKAGE', package), \
                 patch.object(runtime, '_safe_directory'), \
                 patch.object(Path, 'lstat', root_lstat), \
                 patch('sys.stdout', new_callable=io.StringIO) as retry_output:
                self.assertEqual(runtime.main(['--stage-package', str(source), '--manifest-sha256', manifest_hash]), 0)
            self.assertEqual(json.loads(retry_output.getvalue())['status'], 'package_already_staged')
            (package / 'binding.json').chmod(0o600)
            (package / 'binding.json').write_bytes(b'changed')
            (package / 'binding.json').chmod(0o400)
            with patch.object(runtime, '_module', side_effect=[fake_contract, SimpleNamespace(Refused=RuntimeError)]), \
                 patch.object(contract, 'legacy_modules', return_value=(SimpleNamespace(
                     _safe_ancestors=lambda *args: None,
                     _read_root_file=lambda path, *args: Path(path).read_bytes(),
                 ), candidate)), \
                 patch.object(runtime.os, 'geteuid', return_value=0), \
                 patch.object(runtime, 'PACKAGE', package), \
                 patch.object(runtime, '_safe_directory'), \
                 patch.object(Path, 'lstat', root_lstat), \
                 patch('sys.stderr', new_callable=io.StringIO):
                self.assertEqual(runtime.main(['--stage-package', str(source), '--manifest-sha256', manifest_hash]), 1)

    def test_activation_success_records_receipt_and_reports_fixed_lease(self):
        context = {'targetBytes': b'target', 'evidenceBytes': b'evidence', 'gid': 22,
                   'uid': 11, 'gateway': {'InvocationID': 'old'}, 'baseline': [],
                   'target': {'leaseExpiresAt': '2026-09-29T15:59:10.442Z'}}
        with patch.object(runtime, '_save_backups', return_value=(Path('/safe/backup'), {'version': 1})), \
             patch.object(runtime, '_record_receipt'), \
             patch.object(runtime, '_health'), \
             patch.object(runtime.os, 'unlink'):
            activator_fake = SimpleNamespace(
                BINDING_PATH=Path('/unused/binding.json'), EVIDENCE_PATH=Path('/unused/evidence.json'),
                _install_managed=lambda *args: None, _restart_gateway=lambda: None,
                _poll_gateway=lambda *args: None,
            )
            result = runtime._activate(contract, activator_fake, candidate, context)
        self.assertEqual(result['status'], 'activated')
        self.assertEqual(result['routesAfter'], 16)

    def test_failed_activation_health_automatically_restores_previous_binding(self):
        context = {'targetBytes': b'target', 'evidenceBytes': b'evidence', 'gid': 22,
                   'uid': 11, 'gateway': {'InvocationID': 'old'}, 'baseline': [],
                   'target': {'leaseExpiresAt': '2026-09-29T15:59:10.442Z'}}
        restored = []
        with patch.object(runtime, '_save_backups', return_value=(Path('/safe/backup'), {'version': 1})), \
             patch.object(runtime, '_health', side_effect=RuntimeError('probe failed')), \
             patch.object(runtime, '_restore', side_effect=lambda *args: restored.append(args)), \
             patch.object(runtime, '_record_receipt'), \
             patch.object(runtime.os, 'unlink'):
            activator_fake = SimpleNamespace(
                _install_managed=lambda *args: None, _restart_gateway=lambda: None,
                _poll_gateway=lambda *args: None,
            )
            with self.assertRaisesRegex(RuntimeError, 'activation_rolled_back'):
                runtime._activate(contract, activator_fake, candidate, context)
        self.assertEqual(len(restored), 1)

    def test_recovery_installs_saved_bytes_before_fresh_inventory_and_evidence(self):
        events = []
        saved = current_binding()
        saved_bytes = json.dumps(saved, indent=4).encode()
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            binding_path = root / 'binding.json'
            evidence_path = root / 'startup-evidence.json'
            backup = root / 'backup'
            backup.mkdir()
            saved_file = backup / 'binding.json'
            saved_file.write_bytes(saved_bytes)
            saved_file.chmod(0o400)
            (backup / 'startup-evidence.json').write_bytes(b'stale-evidence')

            class FakeActivator:
                BINDING_PATH = binding_path
                EVIDENCE_PATH = evidence_path

                @staticmethod
                def _read_root_file(path, owner, modes):
                    return Path(path).read_bytes()

                @staticmethod
                def _routes_tuple(routes):
                    return activator._routes_tuple(routes)

                @staticmethod
                def _install_managed(path, content, gid):
                    Path(path).write_bytes(content)
                    events.append(('install', Path(path).name))

                @staticmethod
                def _collect_inventory():
                    events.append(('inventory', json.loads(binding_path.read_bytes())['identity']['restRoutes'] == saved['identity']['restRoutes']))
                    return {'containers': {}, 'networks': {}}, 1790180000000

                @staticmethod
                def _build_evidence(binding, inventory, started):
                    events.append(('build-evidence', binding['identity']['restRoutes'] == saved['identity']['restRoutes']))
                    return {}, b'fresh-evidence'

                @staticmethod
                def _validate_evidence(binding, evidence, started, now):
                    events.append(('validate-evidence', True))

                @staticmethod
                def _restart_gateway():
                    events.append(('restart', True))

                @staticmethod
                def _gateway_account():
                    return 10, 20

                @staticmethod
                def _poll_gateway(previous, uid, gid):
                    events.append(('poll', True))

                @staticmethod
                def _verify_post_transition(baseline):
                    events.append(('health', True))

            runtime._restore(contract, FakeActivator, candidate, backup, 20, 'old-invocation', [])
            self.assertEqual(binding_path.read_bytes(), saved_bytes)
            self.assertEqual(evidence_path.read_bytes(), b'fresh-evidence')
            self.assertEqual(events[0], ('install', 'binding.json'))
            self.assertEqual(events[1], ('inventory', True))
            self.assertEqual(events[2], ('build-evidence', True))
            self.assertEqual(events[-1], ('health', True))


if __name__ == '__main__':
    unittest.main()

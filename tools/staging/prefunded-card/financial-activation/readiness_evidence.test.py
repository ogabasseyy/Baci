import copy
from pathlib import Path
import json
import subprocess
import sys
import unittest
from unittest.mock import patch
import importlib.util
import contextlib
import io
import tempfile
import readiness_evidence_io as evidence_io
import shutil

import readiness_evidence as evidence
from protected_snapshot import TABLES

HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('jwt_fixture', HERE / 'readiness_evidence_jwt.test.py')
jwt_fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(jwt_fixture)
NOW = jwt_fixture.NOW


def fixture():
    contents = {name: name.encode() for name in evidence.PATHS}
    contents['activationConfig'] = b'{"background":{"database":{"password":"different-worker-password"}}}'
    contents['snapshotConfig'] = b'{"database":{"password":"synthetic-snapshot-password"}}'
    contents['factoryConfig'] = jwt_fixture.FACTORY
    contents['replayConfig'] = json.dumps(jwt_fixture.configuration()).encode()
    artifacts = {name: {'path': path, 'owner': 0, 'mode': 0o600,
        'sha256': evidence.digest(contents[name])} for name, path in evidence.PATHS.items()}
    seal = {'status': 'source-verified-prepared-inactive', 'deadline': '2026-10-06T15:59:10Z',
        'approvedCompanyBudgetKobo': 10000, 'preservedPrincipalKobo': 10000,
        'replay': {'sourceVerified': True}, 'workers': {'sourceVerified': True}, 'files': {}}
    for name in ('readiness', 'background', 'snapshot', 'daemon', 'factory'):
        relative = ('replay/' + ('replay-daemon.mjs' if name == 'daemon' else 'prefunded-replay-bundle.mjs')
                    if name in ('daemon', 'factory') else 'workers/' + name + '.cjs')
        seal['files'][relative] = evidence.digest(contents[name])
    for stem in evidence.STOPS:
        for suffix in ('.timer', '.service'):
            name = stem + suffix
            artifacts[name] = {'path': '/etc/systemd/system/' + name}
    request = {'seal': {'path': '/root/private/seal.json', 'owner': 0, 'mode': 0o600,
        'sha256': evidence.digest(json.dumps(seal).encode())}, 'signingKeys': {'path': '/root/private/keys.json'},
        'artifacts': artifacts, 'snapshotCaContainerPath': '/etc/ca.pem', 'phase': 'prestart'}
    data = {artifacts[name]['path']: value for name, value in contents.items()}
    data[request['seal']['path']] = json.dumps(seal).encode()
    data[request['signingKeys']['path']] = json.dumps(jwt_fixture.KEYS).encode()
    protected = {'systemIdentifier': '7685292944002592802', 'readOnly': True,
        'protectedFinancialSha256': 'b' * 64,
        'tables': {name: {'count': 0, 'sha256': 'c' * 64} for name in TABLES}}
    return request, data, protected, evidence.digest(contents['daemon'])


class EvidenceCollectionTests(unittest.TestCase):
    def setUp(self):
        root = patch.object(evidence.os, 'geteuid', return_value=0)
        root.start()
        self.addCleanup(root.stop)

    def test_nonroot_adapter_call_refuses_before_artifact_reads_or_checks(self):
        with patch.object(evidence.os, 'geteuid', return_value=501), patch.object(evidence, 'pinned') as read:
            with self.assertRaisesRegex(Exception, 'root_required'):
                evidence.collect({})
            read.assert_not_called()

    def test_partial_collection_uses_seal_labels_and_does_not_invent_owner_proof(self):
        request, data, protected, daemon = fixture()
        with patch.object(evidence, 'pinned', side_effect=lambda row, private=False: data[row['path']]), \
                patch.object(evidence, 'DAEMON', daemon), \
                patch.object(evidence, 'runtime_checks', return_value={'replayConfigurationChecked': True}) as check, \
                patch.object(evidence, 'snapshot_tls', return_value={'snapshotTlsIdentityVerified': True}), \
                patch.object(evidence, 'timers', return_value={}), \
                patch.object(evidence, 'financial_state', return_value={'financialSchedulesStopped': True}) as state:
            result = evidence.collect(request, now=lambda: NOW, query=lambda sql: json.dumps(protected))
        check.assert_called_once()
        self.assertEqual(check.call_args.args[:2], (request['seal']['sha256'],) * 2)
        self.assertEqual(state.call_args.args[1:3], (request['seal']['sha256'],) * 2)
        self.assertEqual(result['status'], 'financial-readiness-evidence-partial')
        self.assertNotIn('guardedRenewalCommitted', result)
        self.assertNotIn('public', result)
        self.assertNotIn('roles', result)
        self.assertIn('public', result['ownerEvidenceStillRequired'])
        self.assertFalse(result['mutationsEnabled'])

    def test_protected_snapshot_drift_refuses_instead_of_returning_partial_success(self):
        request, data, protected, daemon = fixture()
        changed = {**protected, 'protectedFinancialSha256': 'd' * 64}
        with patch.object(evidence, 'pinned', side_effect=lambda row, private=False: data[row['path']]), \
                patch.object(evidence, 'DAEMON', daemon), patch.object(evidence, 'runtime_checks', return_value={}), \
                patch.object(evidence, 'snapshot_tls', return_value={}), patch.object(evidence, 'timers', return_value={}), \
                patch.object(evidence, 'financial_state', return_value={}):
            with self.assertRaisesRegex(ValueError, 'protected_snapshot_changed'):
                evidence.collect(request, now=lambda: NOW,
                    query=unittest.mock.Mock(side_effect=[json.dumps(protected), json.dumps(changed)]))

    def test_wrong_installed_path_is_not_an_approved_alternate(self):
        request, data, _, _ = fixture()
        request['artifacts']['readiness']['path'] = '/root/alternate/readiness.cjs'
        with patch.object(evidence, 'pinned', side_effect=lambda row, private=False: data[row['path']]):
            with self.assertRaisesRegex(Exception, 'installed_artifact_path_refused'):
                evidence.collect(request, now=lambda: NOW)

    def test_actual_cli_help_imports_without_pythonpath(self):
        for name in ('readiness_evidence.py', 'readiness_evidence_roles.py'):
            result = subprocess.run([sys.executable, str(HERE / name), '--help'],
                cwd='/', capture_output=True, text=True, timeout=10)
            self.assertEqual(result.returncode, 0, result.stderr)

    def test_cli_redacts_unexpected_private_failure(self):
        with patch.object(evidence, 'root_request', side_effect=RuntimeError('private-token')), \
                contextlib.redirect_stdout(io.StringIO()) as output:
            code = evidence.main(['--request', '/root/request', '--request-sha256', 'a' * 64,
                                  '--output', '/root/output'])
        self.assertEqual(code, 1)
        self.assertNotIn('private-token', output.getvalue())

    def test_existing_output_is_retained_and_refused_before_check_commands(self):
        with tempfile.TemporaryDirectory() as directory:
            output = Path(directory) / 'evidence.json'
            output.write_text('retained')
            with patch.object(evidence, 'root_request', return_value={}), \
                    patch.object(evidence_io, 'root_ancestors'), \
                    patch.object(evidence_io, 'private_directory'), patch.object(evidence, 'collect') as collect, \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(evidence.main(['--request', '/root/request', '--request-sha256', 'a' * 64,
                                               '--output', str(output)]), 1)
            collect.assert_not_called()
            self.assertEqual(output.read_text(), 'retained')

    @unittest.skipUnless(Path('/private/tmp/baci-financial-activation-preparation-20261002-lane1-r5').is_dir(),
                         'reviewed source seal unavailable')
    def test_closed_copied_cli_imports_include_sibling_sealed_contracts(self):
        seal = Path('/private/tmp/baci-financial-activation-preparation-20261002-lane1-r5')
        with tempfile.TemporaryDirectory(prefix='baci-evidence-import-') as directory:
            root = Path(directory)
            for name in ('tooling', 'contracts'):
                shutil.copytree(seal / name, root / name)
            target = root / 'tooling/financial-activation'
            for path in HERE.glob('readiness_evidence*.py'):
                if '.test.' not in path.name:
                    shutil.copyfile(path, target / path.name)
            for name in ('readiness_evidence.py', 'readiness_evidence_roles.py'):
                result = subprocess.run([sys.executable, str(target / name), '--help'],
                    cwd='/', capture_output=True, text=True, timeout=10)
                self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

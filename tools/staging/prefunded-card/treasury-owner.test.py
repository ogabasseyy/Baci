import importlib.util
import json
import contextlib
import io
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import hashlib
import subprocess


SPEC = importlib.util.spec_from_file_location('treasury_owner', Path(__file__).with_name('treasury-owner.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class TreasuryOwner(unittest.TestCase):
    def test_snapshot_config_contains_only_independent_verifier_credential(self):
        config = MODULE.snapshot_config('test_key_synthetic', 'synthetic-ca', 'p' * 64)
        self.assertEqual(config['database']['login'], 'prefunded_snapshot_verifier')
        self.assertEqual(config['database']['host'], MODULE.HOST)
        self.assertEqual(config['verifier']['sourceWalletId'], MODULE.SOURCE)
        self.assertEqual(config['verifier']['expiresAt'], MODULE.DEADLINE)
        self.assertNotIn('paystack', json.dumps(config).lower())
        self.assertNotIn('prefunded_treasury_operator', json.dumps(config))

    def test_resume_requires_exact_function_bodies_and_unchanged_binding(self):
        snapshot = Path(__file__).with_name('treasury-snapshot-store.sql').read_text()
        bodies = MODULE.function_bodies(snapshot)
        self.assertEqual(len(bodies), 4)
        state = dict(bindingMatches=True, verifierMatches=True, customerRoutes=0, activeCardLogins=0,
                     functions=[dict(name=name, body=body, securityDefiner=True, searchPath=['search_path=pg_catalog'])
                                for name, body in bodies.items()])
        MODULE.validate_resume(state, snapshot)
        for change in [dict(bindingMatches=False), dict(verifierMatches=False), dict(customerRoutes=1),
                       dict(activeCardLogins=1), dict(functions=[]),
                       dict(functions=[{**state['functions'][0], 'body': 'different'}])]:
            with self.assertRaises(MODULE.Refused):
                MODULE.validate_resume({**state, **change}, snapshot)

    def rehearse(self, fail_database=False, fail_snapshot=False, existing_config=False):
        with tempfile.TemporaryDirectory() as temporary, contextlib.ExitStack() as stack:
            directory = Path(temporary)
            source = Path(__file__).parent
            contents = {name: (source / name).read_bytes() if name != 'treasury-snapshot-cli.cjs' else b'synthetic-cli'
                        for name in MODULE.FILES}
            expected = {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}
            def read(path, owner, mode, limit):
                if path == directory / 'manifest.json':
                    return json.dumps(expected).encode()
                if path.name in contents:
                    return contents[path.name]
                if path.name == 'ca.pem':
                    return b'-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----'
                return path.read_bytes()
            stack.enter_context(patch.object(MODULE.os, 'geteuid', return_value=0))
            stack.enter_context(patch.object(MODULE.sys, 'argv', ['treasury-owner.py']))
            stack.enter_context(patch.object(MODULE, '__file__', str(directory / 'treasury-owner.py')))
            stack.enter_context(patch.object(MODULE, 'CONFIG_DIRECTORY', directory / 'private'))
            stack.enter_context(patch.object(MODULE, 'CONFIG', directory / 'private' / 'config.json'))
            stack.enter_context(patch.object(MODULE, 'CA', directory / 'ca.pem'))
            stack.enter_context(patch.object(MODULE, 'root_ancestors'))
            stack.enter_context(patch.object(MODULE, 'private_directory'))
            stack.enter_context(patch.object(MODULE, 'read_file', side_effect=read))
            stack.enter_context(patch.object(MODULE, 'read_provider', return_value='test_key_SYNTHETIC'))
            preserved = None
            if existing_config:
                MODULE.CONFIG_DIRECTORY.mkdir(mode=0o700)
                saved = MODULE.snapshot_config('test_key_SYNTHETIC',
                  '-----BEGIN CERTIFICATE-----\nsynthetic\n-----END CERTIFICATE-----', 'p' * 64)
                preserved = json.dumps(saved, sort_keys=True).encode()
                MODULE.write_private(MODULE.CONFIG, preserved)
                stack.enter_context(patch.object(MODULE.secrets, 'token_urlsafe',
                                                 side_effect=AssertionError('Existing password must not rotate')))
            provider = stack.enter_context(patch.object(MODULE, 'provider_wallet'))
            stack.enter_context(patch.object(MODULE, 'probe', return_value=dict(treasuries=0, snapshotTable=False, snapshotRole=False)))
            execute = stack.enter_context(patch.object(MODULE, 'database', side_effect=MODULE.Refused() if fail_database else None))
            stack.enter_context(patch.object(MODULE, 'resume_state', return_value={}))
            stack.enter_context(patch.object(MODULE, 'validate_resume'))
            cli = stack.enter_context(patch.object(MODULE, 'command', return_value=json.dumps(dict(outcome='recorded')),
                                                  side_effect=MODULE.Refused() if fail_snapshot else None))
            capture = io.StringIO()
            with contextlib.redirect_stdout(capture):
                outcome = MODULE.main()
            output = capture.getvalue()
            self.assertNotIn('test_key_SYNTHETIC', output)
            self.assertEqual(provider.call_count, 1)
            self.assertEqual(execute.call_count, 1)
            self.assertTrue((directory / 'private' / 'config.json').exists())
            if preserved is not None:
                self.assertEqual(MODULE.CONFIG.read_bytes(), preserved)
            return outcome, output, cli.call_count

    def test_success_requires_restricted_snapshot_proof(self):
        outcome, output, calls = self.rehearse()
        self.assertEqual(outcome, 0)
        self.assertEqual(calls, 1)
        result = json.loads(output.splitlines()[0])
        self.assertTrue(result['restrictedTlsVerified'])
        self.assertFalse(result['cardPaymentsEnabled'])
        self.assertFalse(result['servicesStarted'])

    def test_uncertain_apply_does_not_claim_no_database_change(self):
        outcome, output, calls = self.rehearse(fail_database=True)
        self.assertEqual(outcome, 1)
        self.assertEqual(calls, 0)
        self.assertIsNone(json.loads(output)['databasePrepared'])
        self.assertEqual(json.loads(output)['stage'], 'database-apply-unconfirmed')

    def test_retry_after_rolled_back_apply_preserves_existing_verifier_credential(self):
        outcome, output, calls = self.rehearse(existing_config=True)
        self.assertEqual(outcome, 0)
        self.assertEqual(calls, 1)
        self.assertIn('TREASURY_PREREQUISITES_READY', output)

    def test_tls_refusal_reports_prepared_not_activated(self):
        outcome, output, calls = self.rehearse(fail_snapshot=True)
        self.assertEqual(outcome, 1)
        self.assertEqual(calls, 1)
        self.assertTrue(json.loads(output)['databasePrepared'])
        self.assertFalse(json.loads(output)['cardPaymentsEnabled'])

    def test_command_diagnostics_do_not_leak_provider_or_database_errors(self):
        failed = subprocess.CompletedProcess(['test'], 3, '', 'ERROR: 42501\nsecret=do-not-print')
        with patch.object(MODULE.subprocess, 'run', return_value=failed):
            with self.assertRaisesRegex(MODULE.Refused, 'SQLSTATE 42501') as caught:
                MODULE.command(['test'])
        self.assertNotIn('do-not-print', str(caught.exception))
        failed.stdout = '{"outcome":"refused","reason":"snapshot_store_unavailable"}'
        failed.stderr = 'private database password'
        with patch.object(MODULE.subprocess, 'run', return_value=failed):
            with self.assertRaisesRegex(MODULE.Refused, 'snapshot_store_unavailable'):
                MODULE.command(['test'])


if __name__ == '__main__':
    unittest.main()

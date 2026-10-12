import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import patch

import activation_owner as owner
from renewal_contract import BINDING, PINS, Refused, canonical, digest


SPEC = importlib.util.spec_from_file_location('credentials_fixture', Path(__file__).with_name('activation_credentials.test.py'))
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
EVIDENCE_SPEC = importlib.util.spec_from_file_location('evidence_fixture', Path(__file__).with_name('activation_evidence.test.py'))
EVIDENCE = importlib.util.module_from_spec(EVIDENCE_SPEC)
EVIDENCE_SPEC.loader.exec_module(EVIDENCE)


class ActivationOwnerTests(unittest.TestCase):
    def test_no_mutating_command_can_use_the_readonly_probe(self):
        for arguments in (['/usr/bin/systemctl', 'start', 'x'], ['/usr/bin/docker', 'start', 'x'],
                          ['/bin/sh', '-c', 'anything']):
            with self.subTest(arguments=arguments), self.assertRaises(Refused):
                owner.readonly_probe(arguments)

    def test_probe_failure_is_redacted_without_provider_response_or_env(self):
        result = type('Result', (), {'returncode': 2, 'stdout': b'never-print-secret', 'stderr': b'never-print-secret'})()
        with patch.object(owner.subprocess, 'run', return_value=result):
            with self.assertRaisesRegex(Refused, '^activation-readonly-command$'):
                owner.readonly_probe(['/usr/bin/curl', '-q', '--silent', '--show-error', '--max-time', '5',
                                      '--output', '/dev/null', '--write-out', '%{http_code}',
                                      'http://172.23.0.3:9999/health'])

    def test_curl_without_disable_config_is_refused_before_it_can_load_curlrc(self):
        result = SimpleNamespace(returncode=0, stdout=b'200')
        with patch.object(owner.subprocess, 'run', return_value=result) as run:
            with self.assertRaisesRegex(Refused, '^non-readonly-command$'):
                owner.readonly_probe(['/usr/bin/curl', '--silent', '--show-error', '--max-time', '5',
                                      '--output', '/dev/null', '--write-out', '%{http_code}',
                                      'http://172.23.0.3:9999/health'])
            run.assert_not_called()

    def test_extra_prepared_startup_evidence_is_rejected_not_ignored(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'original').mkdir()
            (directory / 'candidate').mkdir()
            (directory / 'receipt.json').touch()
            for index, path in enumerate(PINS):
                (directory / 'original' / f'{index:02d}-{Path(path).name}').touch()
            for name in owner.CANDIDATES + ('startup-evidence.json',):
                (directory / 'candidate' / name).touch()
            receipt = canonical({'inventorySha256': digest(b'fixture'), 'invariants': {}})
            def read(filename, *args, **kwargs):
                return (receipt if Path(filename).name == 'receipt.json' else b'fixture'), None
            with patch.object(owner, 'PREPARATION', directory), patch.object(owner, 'private_directory'), \
                    patch.object(owner, 'read_verified', side_effect=read), \
                    patch.object(owner, 'validate_preparation', return_value={}), \
                    patch.object(owner, 'inventory_summary', return_value={}):
                with self.assertRaisesRegex(Refused, '^preparation-directory-closure$'):
                    owner.preparation_inputs()

    def test_collector_never_dispatches_activation_or_writes_live_files(self):
        report = {'stage': 'lane-a-activation-evidence', 'status': 'review-required', 'readOnly': True}
        with patch.object(owner.sys, 'argv', ['activation_owner.py', '--bundle-sha256', 'a' * 64]), \
                patch.object(owner, 'collect', return_value=report) as collect, \
                patch.object(owner, 'write_private') as write, patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(owner.main(), 0)
        collect.assert_called_once_with(owner.HERE, 'a' * 64)
        write.assert_called_once()
        self.assertEqual(write.call_args.args[0], owner.HERE / 'activation-evidence.json')
        self.assertIn('STAGING_ACTIVATION_EVIDENCE_READY', output.getvalue())
        self.assertNotIn('systemctl start', output.getvalue())

    def test_refusal_does_not_print_exception_text_or_report_success(self):
        with patch.object(owner.sys, 'argv', ['activation_owner.py', '--bundle-sha256', 'a' * 64]), \
                patch.object(owner, 'collect', side_effect=RuntimeError('never-print-secret')), \
                patch.object(owner, 'write_private') as write, patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(owner.main(), 1)
        value = json.loads(output.getvalue())
        self.assertFalse(value['renewalApplied'])
        self.assertFalse(value['databaseApplied'])
        self.assertFalse(value['newPaymentStarted'])
        self.assertNotIn('never-print-secret', output.getvalue())
        self.assertNotIn('READY', output.getvalue())
        write.assert_not_called()

    def test_preparation_inventory_digest_is_recomputed_not_just_formatted(self):
        contents = {path: b'fixture' for path in PINS}
        originals = {f'{index:02d}-{Path(path).name}': content for index, (path, content) in enumerate(contents.items())}
        receipt = canonical({'inventorySha256': '0' * 64, 'invariants': {}})
        def read(filename, *args, **kwargs):
            filename = Path(filename)
            if filename.name == 'receipt.json':
                return receipt, None
            if filename == owner.INVENTORY:
                return b'private-inventory', None
            if filename.parent.name == 'original':
                return originals[filename.name], None
            return b'fixture', None
        def entries(directory):
            if directory.name == 'original':
                return [Path(name) for name in originals]
            if directory.name == 'candidate':
                return [Path(name) for name in owner.CANDIDATES]
            return [Path(name) for name in ('receipt.json', 'original', 'candidate')]
        with patch.object(owner, 'read_verified', side_effect=read), patch.object(owner, 'private_directory'), \
                patch.object(owner, 'validate_preparation', return_value={}), patch.object(owner, 'inventory_summary'), \
                patch.object(Path, 'iterdir', autospec=True, side_effect=entries):
            with self.assertRaisesRegex(Refused, '^preparation-inventory-correlation$'):
                owner.preparation_inputs()

    def test_composed_collection_returns_redacted_facts_and_never_changes_state(self):
        contents = {path: b'fixture' for path in PINS}
        contents[BINDING] = canonical({'identity': {'host': 'staging-auth.ogabassey.com'}})
        contents[owner.FUNDING_ENV] = FIXTURE.environment()
        contents[owner.UNIT_DIRECTORY + 'baci-savings-drafts.service'] = (
            'Environment=NEXT_PUBLIC_SUPABASE_ANON_KEY=' + FIXTURE.token() + '\n').encode()
        states = {'funding': 'active-expired', 'financial': 'stopped'}
        metadata = SimpleNamespace(st_uid=0, st_gid=0, st_mode=0o100440, st_nlink=1)
        def read(filename, *args):
            return contents.get(str(filename), b'fixture-graph'), metadata
        snapshot = (EVIDENCE.database(), {'readOnly': True}, EVIDENCE.role())
        with patch.object(owner, 'verified_bundle'), patch.object(owner, 'preparation_inputs', return_value={}), \
                patch.object(owner, 'boundary_states', return_value=states), patch.object(owner, 'read_verified', side_effect=read), \
                patch.object(owner.grp, 'getgrnam', return_value=SimpleNamespace(gr_gid=0)), \
                patch.object(owner, 'upstream_inputs', return_value=(FIXTURE.SECRET, {'auth': {'healthHttp': 200}})), \
                patch.object(owner, 'physical_snapshot', return_value=snapshot), patch.object(owner, 'unchanged'), \
                patch.object(owner, 'readonly_probe', return_value=(0, '')), patch.object(owner.time, 'time', return_value=FIXTURE.NOW), \
                patch.object(owner, 'write_private') as write, patch.object(owner.subprocess, 'run') as run:
            result = owner.collect(owner.HERE, 'a' * 64)
        write.assert_not_called()
        run.assert_not_called()
        self.assertTrue(result['readOnly'])
        self.assertFalse(result['activationReady'])
        self.assertFalse(result['financialReplayEnabled'])
        self.assertFalse(result['databaseApplied'])
        self.assertEqual(result['serviceStates'], states)
        self.assertNotIn('never-print', json.dumps(result))
        self.assertNotIn(FIXTURE.SECRET, json.dumps(result))


if __name__ == '__main__':
    unittest.main()

import io
import copy
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
import tempfile
import unittest
from unittest.mock import Mock, patch

import connectivity_owner as owner
from renewal_contract import BINDING, Refused, canonical, digest
from connectivity_contract import FALSE_FIELDS, STABLE_FIELDS
from connectivity_transaction import execute


class ConnectivityOwnerTests(unittest.TestCase):
    def test_sealed_real_manifest_accepts_the_pinned_evidence_checksum_filename(self):
        manifest = Path(__file__).with_name('CONNECTIVITY_SHA256SUMS').read_bytes()
        self.assertIn(b'  ACTIVATION_SHA256SUMS\n', manifest)
        entries = [Path('/root/fixture') / name for name in owner.SOURCES]
        entries.append(Path('/root/fixture/CONNECTIVITY_SHA256SUMS'))
        with patch.object(owner, 'HERE', Path('/root/fixture')), \
                patch.object(owner.os, 'geteuid', return_value=0), \
                patch.object(owner, 'trusted_parents'), patch.object(owner, 'private_directory'), \
                patch.object(owner, 'read_verified', return_value=(manifest, None)) as verified, \
                patch.object(Path, 'iterdir', return_value=entries):
            owner.verify_bundle(digest(manifest))
        self.assertEqual(verified.call_count, len(owner.SOURCES) + 1)

    def test_source_manifest_still_rejects_unapproved_numeric_paths_and_duplicate_entries(self):
        manifest = Path(__file__).with_name('CONNECTIVITY_SHA256SUMS').read_bytes()
        for invalid in (manifest + b'0' * 64 + b'  unapproved123.py\n',
                        manifest + manifest.splitlines(keepends=True)[0]):
            with self.subTest(manifest=invalid[-100:]), \
                    patch.object(owner, 'HERE', Path('/root/fixture')), \
                    patch.object(owner.os, 'geteuid', return_value=0), \
                    patch.object(owner, 'trusted_parents'), patch.object(owner, 'private_directory'), \
                    patch.object(owner, 'read_verified', return_value=(invalid, None)):
                with self.assertRaisesRegex(Refused, '^connectivity-source-closure$'):
                    owner.verify_bundle(digest(invalid))

    def composed(self, fail_start=False):
        originals = {path: b'original-' + path.encode() for path in owner.PINS}
        originals[BINDING] = canonical({'identity': {'host': 'staging-auth.ogabassey.com'}})
        for name in owner.TIMERS:
            stopper = name.replace('.timer', '.service')
            service = 'baci-savings-drafts.service' if 'drafts' in name else 'baci-savings-funding.service'
            originals[owner.UNIT_DIRECTORY + stopper] = f'ExecStart=/usr/bin/systemctl stop {service}\n'.encode()
        candidates = {name: ('candidate-' + name).encode() for name in owner.CANDIDATES}
        candidates['binding.preview.json'] = originals[BINDING]
        contents = dict(originals)
        reviewed = {**{name: {} for name in STABLE_FIELDS}, **{name: False for name in FALSE_FIELDS},
                    'stage': 'lane-a-activation-evidence', 'status': 'review-required', 'readOnly': True,
                    'requestedServiceDeadline': owner.TARGET, 'observedAt': datetime.now(timezone.utc).isoformat(),
                    'fundingDatabaseRole': {'expiresAtEpoch': None}, 'gatewayGraph': [],
                    'firewall': [{'bridge': name, 'reviewedDropRulePresent': True} for name in ('baci-stg-db', 'baci-stg-mail')],
                    'upstreams': {'auth': {'healthHttp': 200}, 'rest': {'healthHttp': 200}}}
        runtime = Mock()
        bounded = [False]
        def role_sql(commit):
            bounded[0] = bounded[0] or commit
            return {'passwordUnchanged': True, 'expiresAt': owner.TARGET}
        runtime.role_sql.side_effect = role_sql
        runtime.inventory.return_value = {'observedAt': reviewed['observedAt']}
        runtime.verify.return_value = {'fixture': 401}
        if fail_start:
            runtime.start.side_effect = Refused('connectivity-start-failure')
        def snapshot():
            return ({'principal': 10000}, {'receipt': 'unchanged'},
                    {'role': {'expiresAtEpoch': owner.TARGET_EPOCH if bounded[0] else None}})
        def read(path, *args, **kwargs):
            path = str(path)
            content = canonical(reviewed) if path == owner.REPORT_PATH else candidates[Path(path).name] if '/candidate/' in path else contents[path]
            return content, SimpleNamespace(st_mode=0o100644, st_gid=0)
        def replace(path, previous, content, mode, group):
            self.assertEqual(digest(contents[path]), previous)
            contents[path] = content
        def effective(name, extra):
            service = 'baci-savings-drafts.service' if 'drafts' in name else 'baci-savings-funding.service'
            return {'ExecStart': f'{{ argv[]=/usr/bin/systemctl stop {service} ; ignore_errors=no ; }}'}
        with tempfile.TemporaryDirectory() as temporary:
            action = owner.Actions.__new__(owner.Actions)
            action.directory = Path(temporary)
            action.runtime, action.installed, action.role_bound = runtime, [], False
            action.ingress_gid, action.funding_gid, action.ingress_uid = 984, 983, 998
            with patch.object(owner, 'read_verified', side_effect=read), patch.object(owner, 'collect', return_value=reviewed), \
                    patch.object(owner, 'physical_snapshot', side_effect=snapshot), patch.object(owner, 'show', side_effect=effective), \
                    patch.object(owner, 'http', return_value=405), patch.object(owner, 'replace_owned', side_effect=replace), \
                    patch('activation_owner.upstream_inputs', return_value=('secret', reviewed['upstreams'])), \
                    patch('activation_owner.readonly_probe', return_value=(0, '')), patch('sys.stdout', new_callable=io.StringIO):
                if fail_start:
                    with self.assertRaises(Refused):
                        execute(action)
                    self.assertTrue((action.directory / 'recovery.json').exists())
                    self.assertEqual(contents, originals)
                else:
                    result = execute(action)
                    self.assertFalse(result['phoneReady'])
                    self.assertFalse(result['financialReplayEnabled'])
                    self.assertTrue(result['renewalApplied'])
                    self.assertTrue((action.directory / 'result.json').exists())
        self.assertTrue(bounded[0])
        self.assertEqual([call[0] for call in runtime.mock_calls[:2]], ['stop', 'role_sql'])

    def test_composed_activation_keeps_financial_replay_off_and_never_claims_phone_readiness(self):
        self.composed()

    def test_composed_start_failure_restores_files_keeps_password_bounded_and_records_fail_stopped(self):
        self.composed(fail_start=True)

    def test_refused_or_ambiguous_apply_is_never_reported_as_renewed(self):
        with patch.object(owner.sys, 'argv', ['connectivity_owner.py', '--bundle-sha256', 'a' * 64]), \
                patch.object(owner, 'run', side_effect=Refused('secret')), \
                patch('sys.stdout', new_callable=io.StringIO) as output:
            self.assertEqual(owner.main(), 1)
        self.assertNotIn('secret', output.getvalue())
        self.assertNotIn('STAGING_CONNECTIVITY_RENEWED', output.getvalue())
        self.assertIn('"renewalApplied":null', output.getvalue())

    def test_restore_refuses_unknown_drift_and_never_restores_unbounded_role(self):
        action = owner.Actions.__new__(owner.Actions)
        action.runtime = Mock()
        action.installed = [(BINDING, b'original', digest(b'candidate'), 0o440, 984)]
        action.before_snapshot = ({}, {}, {})
        action.directory = Path('/root/fixture')
        with patch.object(owner, 'read_verified', side_effect=Refused('foreign-state')), \
                patch.object(owner, 'replace_owned') as replace:
            with self.assertRaisesRegex(Refused, '^connectivity-recovery-unconfirmed$'):
                action.recover()
        replace.assert_not_called()
        action.runtime.stop.assert_called_once()
        action.runtime.role_sql.assert_not_called()

    def test_install_records_owned_write_before_swap_and_uses_only_six_prepared_candidates(self):
        action = owner.Actions.__new__(owner.Actions)
        action.prepared = {name: ('candidate-' + name).encode() for name in owner.CANDIDATES}
        action.contents = {path: b'original' for path in owner.PINS}
        action.metadata = {path: Mock(st_mode=0o100644, st_gid=0) for path in owner.PINS}
        action.installed = []
        action.directory = Path('/root/fixture')
        with patch.object(owner, 'replace_owned', side_effect=Refused('swap-failed')), \
                patch.object(owner, 'write_private'):
            with self.assertRaises(Refused):
                action.install()
        self.assertEqual(len(action.installed), 1)
        self.assertEqual(action.installed[0][0], BINDING)


if __name__ == '__main__':
    unittest.main()

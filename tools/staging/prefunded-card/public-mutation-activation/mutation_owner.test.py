from contextlib import contextmanager
import copy
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import mutation_contract
import mutation_owner as owner


def adapter():
    value = object.__new__(owner.PublicMutationOwner)
    value.now = lambda: 1790899200
    value.bundle = Path('/root/bundle')
    value.audit = Path('/root/baci-public-mutation.fixture')
    value.retained = owner.service.NAME + '-before-' + value.audit.name
    value.seal_sha = 'c' * 64
    value.request_sha = 'd' * 64
    value.old_id = 'a' * 64
    value.new_id = 'b' * 64
    value.renamed = True
    value.recovery_only = False
    value.verify_public_unit = lambda **kwargs: None
    return value


def container(enabled=False):
    value = copy.deepcopy(owner.service.container_contract(owner.MANIFEST))
    value.update(Id='b' * 64 if enabled else 'a' * 64, State={'Running': True})
    value['Config']['Env'] = ['PATH=/usr/bin'] + ([owner.FLAG + '=true'] if enabled else [])
    return value


class OwnerTests(unittest.TestCase):
    def environment_case(self, entries, inherited, recovery=False, enabled=True):
        value = adapter()
        observed = container(enabled)
        observed['Config']['Env'] = entries
        image = {'Id': owner.service.IMAGE, 'Config': {'Env': inherited}}
        removed, calls = [False], []
        old = {'Id': value.old_id, 'State': {'Running': False}}
        value.inspect = lambda name=owner.service.NAME, **kwargs: (old if recovery and
            (name == value.retained or removed[0]) else observed)
        if recovery:
            value.now = lambda: owner.EPOCH
            observed['State']['Running'] = False

        def command(arguments):
            calls.append(arguments)
            if 'image' in arguments:
                return json.dumps([image])
            if 'ps' in arguments:
                return value.old_id if value.retained + '$' in ' '.join(arguments) else value.new_id
            if 'rm' in arguments:
                removed[0] = True
            return ''

        with patch.object(owner, 'command', side_effect=command), \
                patch.object(owner.owner_public_artifacts, 'verify', return_value=True):
            report = value.recover() if recovery else value.verify_public(enabled)
        return report, calls

    def test_reordered_enabled_environment_passes_verification_and_exact_predecessor_recovery(self):
        inherited = ['PATH=/usr/bin', 'LANG=C', 'EXPRESSION=a=b', 'EMPTY=']
        entries = [owner.FLAG + '=true', 'EMPTY=', 'LANG=C', 'EXPRESSION=a=b', 'PATH=/usr/bin']
        frozen = copy.deepcopy((inherited, entries))
        for recovery in (False, True):
            with self.subTest(recovery=recovery):
                report, calls = self.environment_case(entries, inherited, recovery)
                if recovery:
                    self.assertEqual(report['status'], 'public-stopped-deadline-expired')
                    self.assertIn([*owner.DOCKER, 'rm', '--force', 'b' * 64], calls)
                    self.assertIn([*owner.DOCKER, 'rename', 'a' * 64, owner.service.NAME], calls)
                    self.assertFalse(any('start' in arguments for arguments in calls))
                else:
                    self.assertEqual(report['Config']['Env'], entries)
        self.assertEqual((inherited, entries), frozen)

    def test_reordered_disabled_environment_requires_flag_absence(self):
        inherited = ['PATH=/usr/bin', 'LANG=C']
        report, unused = self.environment_case(list(reversed(inherited)), inherited, enabled=False)
        self.assertEqual(report['Id'], 'a' * 64)
        for flag in ('true', 'false', ''):
            with self.subTest(flag=flag), self.assertRaises(ValueError):
                self.environment_case(inherited + [owner.FLAG + '=' + flag], inherited, enabled=False)

    def test_duplicate_extra_missing_malformed_or_changed_environment_refuses_both_paths(self):
        inherited = ['PATH=/usr/bin', 'LANG=C']
        expected = inherited + [owner.FLAG + '=true']
        cases = [expected + ['LANG=C'], expected + [owner.FLAG + '=true'],
            expected + ['EXTRA=unreviewed'], ['PATH=/usr/bin', owner.FLAG + '=true'], inherited,
            inherited + [owner.FLAG + '=false'], inherited + [owner.FLAG + '=TRUE'],
            ['PATH=/usr/bin', 'LANG=en', owner.FLAG + '=true'], expected + ['MALFORMED'],
            expected + ['=empty-key'], expected + [None]]
        for recovery in (False, True):
            for entries in cases:
                with self.subTest(recovery=recovery, entries=entries), self.assertRaises(ValueError):
                    self.environment_case(entries, inherited, recovery)

    def test_inherited_image_duplicates_malformed_keys_or_mutation_flag_refuse_both_paths(self):
        for inherited in (['PATH=/usr/bin', 'PATH=/usr/bin'], ['PATH=/usr/bin', 'BROKEN'],
                          ['PATH=/usr/bin', '=empty-key'], ['PATH=/usr/bin', None],
                          ['PATH=/usr/bin', owner.FLAG + '=true']):
            for recovery in (False, True):
                with self.subTest(recovery=recovery, inherited=inherited), self.assertRaises(ValueError):
                    self.environment_case(inherited + [owner.FLAG + '=true'], inherited, recovery)

    def test_only_exact_flag_delta_is_removed_before_full_container_validation(self):
        value = adapter()
        observed = container(True)
        image = {'Id': owner.service.IMAGE, 'Config': {'Env': ['PATH=/usr/bin']}}
        value.inspect = lambda **kwargs: observed
        with patch.object(owner, 'command', return_value=json.dumps([image])), \
                patch.object(owner.owner_public_artifacts, 'verify', return_value=True):
            self.assertEqual(value.verify_public(True)['Id'], 'b' * 64)
        self.assertEqual(observed['Config']['Env'][-1], owner.FLAG + '=true')

    def test_extra_secret_environment_or_isolation_drift_is_rejected(self):
        for mutate in (
            lambda value: value['Config']['Env'].append('SUPABASE_SERVICE_ROLE_KEY=fixture'),
            lambda value: value['HostConfig'].update(Privileged=True),
            lambda value: value['Config'].update(Env=['PATH=/usr/bin', owner.FLAG + '=false']),
            lambda value: value['Mounts'][0].update(RW=True),
        ):
            value = adapter()
            observed = container(True)
            mutate(observed)
            value.inspect = lambda **kwargs: observed
            image = {'Id': owner.service.IMAGE, 'Config': {'Env': ['PATH=/usr/bin']}}
            with patch.object(owner, 'command', return_value=json.dumps([image])), \
                    self.assertRaises((ValueError, owner.service.Refused)):
                value.verify_public(True)

    def test_deadline_recovery_restores_exact_predecessor_without_starting_any_service(self):
        value = adapter()
        value.now = lambda: owner.EPOCH
        value.inspect = lambda name=owner.service.NAME: {
            'Id': value.old_id, 'State': {'Running': False}}
        calls = []
        def command(arguments):
            calls.append(arguments)
            if 'ps' in arguments:
                return 'old' if value.retained + '$' in ' '.join(arguments) else ''
            return ''
        with patch.object(owner, 'command', side_effect=command):
            report = value.recover()
        self.assertEqual(report['status'], 'public-stopped-deadline-expired')
        self.assertFalse(any('start' in arguments for arguments in calls))
        self.assertFalse(any('rm' in arguments for arguments in calls))

    def test_partial_rename_is_reconciled_from_actual_retained_identity(self):
        value = adapter()
        value.renamed = False
        value.now = lambda: owner.EPOCH
        value.inspect = lambda name=owner.service.NAME: {'Id': value.old_id, 'State': {'Running': False}}
        def command(arguments):
            if 'ps' in arguments:
                return 'old' if value.retained + '$' in ' '.join(arguments) else ''
            return ''
        with patch.object(owner, 'command', side_effect=command):
            self.assertEqual(value.recover()['status'], 'public-stopped-deadline-expired')
        self.assertTrue(value.renamed)

    def test_unknown_predecessor_is_not_restored_or_claimed_recovered(self):
        value = adapter()
        value.inspect = lambda name=owner.service.NAME: {'Id': 'e' * 64, 'State': {'Running': False}}
        def command(arguments):
            return 'old' if 'ps' in arguments and value.retained + '$' in ' '.join(arguments) else ''
        with patch.object(owner, 'command', side_effect=command), self.assertRaises(ValueError):
            value.recover()

    def test_interrupted_recovery_checks_private_request_and_predecessor_journal(self):
        value = adapter()
        @contextmanager
        def lock():
            yield
        value.lock = lock
        value.recover = lambda: {'status': 'fixture-recovered'}
        journal = {'requestSha256': value.request_sha, 'financialSealSha256': value.seal_sha,
            'retainedName': value.retained, 'deadline': owner.DEADLINE, 'predecessorId': value.old_id}
        with patch.object(owner, 'read_file', return_value=json.dumps(journal).encode()):
            self.assertEqual(value.recover_interrupted()['status'], 'fixture-recovered')
        journal['requestSha256'] = 'f' * 64
        with patch.object(owner, 'read_file', return_value=json.dumps(journal).encode()), \
                self.assertRaises(ValueError):
            value.recover_interrupted()

    def test_recovery_only_object_cannot_be_used_for_enablement(self):
        value = adapter()
        value.recovery_only = True
        with self.assertRaisesRegex(ValueError, 'recovery_cannot_enable'):
            value.verify_reviewed_inputs()

    def test_reviewed_sidecar_requires_new_reader_pin_and_rejects_reader_drift(self):
        value = adapter()
        value.seal_sha = owner.FINANCIAL_SEAL
        directory = Path(owner.__file__).parent
        names = ('mutation_contract.py', 'mutation_chain.py', 'mutation_runtime.py',
            'mutation_gate.py', 'mutation_owner.py', 'systemd_deadline_reader.py',
            'mutation_runtime_bounds.py', 'README.md')
        pins = {name: owner.digest((directory / name).read_bytes()) for name in names}
        value.request = {'reviewedSidecarSha256': pins,
            'runtimeRequest': {'path': '/root/request', 'sha256': 'a' * 64}}
        value.private_input = lambda key: {}
        with patch.object(owner, 'verify_seal', return_value={}), patch.object(owner, 'RuntimeBounds') as bounds, \
                patch.object(owner, 'financial_report'), patch.object(owner, 'prove_unchanged'), \
                patch.object(owner, 'validate_chain', return_value='b' * 64), \
                patch.object(owner, 'root_request', return_value={'seal': {'sha256': owner.FINANCIAL_SEAL}}), \
                patch.object(owner, 'command', return_value=''):
            value.verify_reviewed_inputs()
            bounds.return_value.verify_sources.assert_called_once()
            pins.pop('systemd_deadline_reader.py')
            with self.assertRaisesRegex(ValueError, 'reviewed_source_incomplete'):
                value.verify_reviewed_inputs()
            pins['systemd_deadline_reader.py'] = 'f' * 64
            with self.assertRaisesRegex(ValueError, 'reviewed_source_drift'):
                value.verify_reviewed_inputs()

    def test_public_private_probe_only_runs_pinned_launcher_check(self):
        value = adapter()
        report = {'status': 'public-private-ready'}
        with patch.object(owner, 'command', return_value=json.dumps(report)) as command:
            self.assertEqual(value.private_launch(), report)
        self.assertEqual(command.call_args.args[0][-2:], ['/app/launch-public.cjs', '--check'])

    def test_public_unit_requires_october_condition_exact_command_and_no_injected_environment(self):
        value = adapter()
        record = {'path': '/etc/systemd/system/baci-prefunded-public.service',
            'owner': 0, 'mode': 0o644, 'sha256': 'a' * 64}
        value.request = {'publicService': record}
        unit = ('ExecCondition=/bin/sh -c \'test "$(/bin/date -u +%%s)" -lt "1791302350"\'\n'
                'ExecStart=' + ' '.join([*owner.DOCKER, 'start', '--attach', owner.service.NAME]) + '\n')
        properties = ('FragmentPath=' + record['path'] + '\nDropInPaths=\nNeedDaemonReload=no\n'
                      'LoadState=loaded\nActiveState=active')
        with patch.object(owner, 'pinned', return_value=unit.encode()), \
                patch.object(owner, 'command', return_value=properties):
            owner.PublicMutationOwner.verify_public_unit(value)
        for changed in (unit.replace('1791302350', '1790697550'),
                        unit + 'Environment=UNREVIEWED=true\n', unit + 'ExecStartPre=/bin/true\n'):
            with patch.object(owner, 'pinned', return_value=changed.encode()), \
                    self.assertRaises(ValueError):
                owner.PublicMutationOwner.verify_public_unit(value)


if __name__ == '__main__':
    unittest.main()

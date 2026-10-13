import copy
import importlib.util
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import Mock, patch


SPEC = importlib.util.spec_from_file_location('reboot_continuity',
    Path(__file__).with_name('reboot_continuity.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def observation():
    return dict(boot=MODULE.CURRENT_BOOT, unit=dict(MODULE.CURRENT_UNIT),
        worker=dict(id=MODULE.WORKER, state=dict(MODULE.FAILED_STATE), restartCount=0),
        journal=[{'_BOOT_ID': MODULE.PREVIOUS_BOOT.replace('-', ''),
                  '_SYSTEMD_INVOCATION_ID': MODULE.INVOCATION}])


class RebootContinuityTests(unittest.TestCase):
    def diagnostic(self):
        value = observation()
        state = '\n'.join(name + '=' + field for name, field in value['unit'].items())
        import json
        results = [SimpleNamespace(returncode=0, stderr='', stdout=state),
                   SimpleNamespace(returncode=0, stderr='', stdout=json.dumps(value['journal'][0]))]
        return SimpleNamespace(WORKER=MODULE.WORKER, DEADLINE='2026-10-06T15:59:10Z',
            run=Mock(side_effect=results), inspect=Mock(return_value={
                'Id': MODULE.WORKER, 'State': dict(MODULE.FAILED_STATE), 'RestartCount': 0}),
            worker_unit=Mock(), guard=Mock(), bootstrap=Mock())

    def test_adapter_retains_original_guard_and_returns_observed_inactive_state(self):
        diagnostic = self.diagnostic()
        guard, bootstrap = diagnostic.guard, diagnostic.bootstrap
        with patch.object(MODULE.Path, 'read_text', return_value=MODULE.CURRENT_BOOT):
            self.assertIs(MODULE.install(diagnostic), diagnostic)
            self.assertEqual(diagnostic.worker_unit(), MODULE.CURRENT_UNIT)
        self.assertIs(diagnostic.guard, guard)
        self.assertIs(diagnostic.bootstrap, bootstrap)
        self.assertEqual(diagnostic.inspect.call_args.args, (MODULE.WORKER,))

    def test_reboot_during_observation_refuses_before_returning_state(self):
        diagnostic = self.diagnostic()
        MODULE.install(diagnostic)
        with patch.object(MODULE.Path, 'read_text', side_effect=[MODULE.CURRENT_BOOT, 'later-boot']):
            with self.assertRaises(ValueError):
                diagnostic.worker_unit()

    def test_wrong_dependency_worker_or_deadline_refuses_installation(self):
        for field in ('WORKER', 'DEADLINE'):
            diagnostic = self.diagnostic()
            setattr(diagnostic, field, 'foreign')
            original = diagnostic.worker_unit
            with self.assertRaises(ValueError):
                MODULE.install(diagnostic)
            self.assertIs(diagnostic.worker_unit, original)

    def test_failed_stderr_oversized_or_malformed_collectors_refuse(self):
        for command_index, field, changed in ((0, 'returncode', 1), (0, 'stderr', 'error'),
            (0, 'stdout', 'x' * 8193), (0, 'stdout', 'InvocationID=\n' * 12),
            (0, 'stdout', 'MainPID=0'), (1, 'returncode', 1), (1, 'stderr', 'error'),
            (1, 'stdout', 'x' * 65537), (1, 'stdout', 'not-json')):
            diagnostic = self.diagnostic()
            responses = list(diagnostic.run.side_effect)
            setattr(responses[command_index], field, changed)
            diagnostic.run.side_effect = responses
            MODULE.install(diagnostic)
            with patch.object(MODULE.Path, 'read_text', return_value=MODULE.CURRENT_BOOT):
                with self.subTest(index=command_index, field=field), self.assertRaises(ValueError):
                    diagnostic.worker_unit()

    def test_authorized_reboot_accepts_actual_inactive_unit_without_faking_failed_state(self):
        value = observation()
        before = copy.deepcopy(value)
        result = MODULE.verify(value)
        self.assertEqual(result, MODULE.CURRENT_UNIT)
        self.assertEqual(result['ActiveState'], 'inactive')
        self.assertEqual(value, before)

    def test_any_later_or_original_boot_refuses(self):
        for boot in (MODULE.PREVIOUS_BOOT, '00000000-0000-0000-0000-000000000000', ''):
            value = observation()
            value['boot'] = boot
            with self.assertRaises(ValueError):
                MODULE.verify(value)

    def test_running_reset_or_new_invocation_refuses(self):
        for field, changed in (('MainPID', '1'), ('ExecMainPID', '1'),
            ('InvocationID', MODULE.INVOCATION), ('ActiveState', 'active'),
            ('Result', 'exit-code'), ('DropInPaths', '/foreign.conf'),
            ('ExecMainStartTimestamp', 'today'), ('NeedDaemonReload', 'yes')):
            value = observation()
            value['unit'][field] = changed
            with self.subTest(field=field), self.assertRaises(ValueError):
                MODULE.verify(value)

    def test_missing_or_extra_unit_fields_refuse(self):
        for unit in ({}, dict(MODULE.CURRENT_UNIT, extra='unknown')):
            value = observation()
            value['unit'] = unit
            with self.assertRaises(ValueError):
                MODULE.verify(value)

    def test_preserved_failed_container_restarted_or_changed_refuses(self):
        for field, changed in (('Running', True), ('Pid', 1), ('ExitCode', 0),
            ('OOMKilled', True), ('FinishedAt', 'later'), ('StartedAt', 'later'),
            ('Running', 0), ('Pid', False)):
            value = observation()
            value['worker']['state'][field] = changed
            with self.subTest(field=field), self.assertRaises(ValueError):
                MODULE.verify(value)
        for field, changed in (('id', 'foreign'), ('restartCount', 1), ('restartCount', False)):
            value = observation()
            value['worker'][field] = changed
            with self.assertRaises(ValueError):
                MODULE.verify(value)

    def test_missing_foreign_or_mixed_historical_journal_refuses(self):
        for rows in ([], [{}], [{'_BOOT_ID': MODULE.CURRENT_BOOT,
            '_SYSTEMD_INVOCATION_ID': MODULE.INVOCATION}],
            [dict(observation()['journal'][0], _SYSTEMD_INVOCATION_ID='foreign')],
            observation()['journal'] + [{}]):
            value = observation()
            value['journal'] = rows
            with self.assertRaises(ValueError):
                MODULE.verify(value)


if __name__ == '__main__':
    unittest.main()

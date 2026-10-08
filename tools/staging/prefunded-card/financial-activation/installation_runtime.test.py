from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import installation_runtime as runtime


class InstallationRuntimeTests(unittest.TestCase):
    def prepared_installation(self, clock=1790918000):
        installer = object.__new__(runtime.RuntimeInstallation)
        observed = {'State': {'Running': False}}
        installer.expected_trees = {str(runtime.WORKER_ROOT): {}, str(runtime.REPLAY_ROOT): {}}
        installer.baseline = {'observedAt': clock,
            'containers': dict.fromkeys(runtime.NAMES, observed),
            'trees': dict.fromkeys(installer.expected_trees, {})}
        installer.audit, installer.candidate = Path('/root/review-audit'), Path('/root/candidate')
        installer.candidate_sha, installer.seal_sha = 'a' * 64, 'b' * 64
        installer.retained = []
        installer.workers = {'background.cjs': b'pinned'}
        installer.configs = {'background.json': b'{}', 'snapshot.json': b'{}'}
        installer.replay = {'replay-daemon.mjs': b'pinned'}
        installer.replay_configs = {'config.json': b'{}', 'prefunded.json': b'{}'}
        events = []

        def command(arguments, **kwargs):
            if 'rename' in arguments:
                events.append('rename-container')
            return ''

        replacements = (
            (runtime.time, 'time', {'return_value': clock}),
            (runtime, 'quiescent', {}), (runtime, 'runner_state', {}),
            (runtime, 'inspect', {'return_value': observed}),
            (runtime, 'tree_fingerprint', {'return_value': {}}),
            (Path, 'exists', {'return_value': False}),
            (Path, 'is_symlink', {'return_value': False}),
            (runtime, 'command', {'side_effect': command}),
            (runtime.os, 'rename', {'side_effect': lambda *args: events.append('rename-tree')}),
            (runtime, 'directory', {}), (runtime, 'place', {}),
            (installer, 'create_containers', {'side_effect': lambda: events.append('create-containers')}),
            (runtime, 'validate_unchanged_units', {'create': True,
                'side_effect': lambda: events.append('unchanged-units')}),
            (runtime, 'verified_plan', {'create': True,
                'side_effect': lambda *args: events.append('candidate-plan')}),
            (runtime, 'install_deadlines', {'side_effect': lambda *args: events.append('final-recheck')}),
        )
        for target, attribute, options in replacements:
            replacement = patch.object(target, attribute, **options)
            replacement.start()
            self.addCleanup(replacement.stop)
        return installer, events

    def test_unit_and_pinned_candidate_preflight_precedes_every_mutation_and_keeps_final_recheck(self):
        installer, events = self.prepared_installation()
        result = installer.install()
        self.assertLess(events.index('unchanged-units'), events.index('rename-container'))
        self.assertLess(events.index('candidate-plan'), events.index('rename-container'))
        self.assertGreater(events.index('final-recheck'), events.index('create-containers'))
        runtime.verified_plan.assert_called_once_with(installer.candidate, installer.candidate_sha)
        runtime.install_deadlines.assert_called_once_with(
            installer.candidate, installer.audit / 'units-before', installer.candidate_sha)
        self.assertFalse(result['mutationsEnabled'])

    def test_drifted_units_or_candidate_refuse_without_renaming_any_predecessor(self):
        for check in ('validate_unchanged_units', 'verified_plan'):
            with self.subTest(check=check):
                installer, events = self.prepared_installation()
                getattr(runtime, check).side_effect = ValueError('reviewed-preflight-refused')
                with self.assertRaisesRegex(ValueError, 'reviewed-preflight-refused'):
                    installer.install()
                self.assertNotIn('rename-container', events)
                self.assertNotIn('rename-tree', events)
                runtime.directory.assert_not_called()
                runtime.place.assert_not_called()
                runtime.install_deadlines.assert_not_called()
                self.doCleanups()

    def test_absolute_window_refuses_fresh_baseline_at_boundary_or_when_preflight_crosses_it(self):
        cutoff = 1791301750
        for initial, final in ((cutoff, cutoff), (cutoff + 1, cutoff + 1), (cutoff - 1, cutoff)):
            with self.subTest(initial=initial, final=final):
                installer, events = self.prepared_installation(initial)
                runtime.time.time.side_effect = [initial, final]
                with self.assertRaisesRegex(ValueError, 'installation_window_expired'):
                    installer.install()
                self.assertNotIn('rename-container', events)
                runtime.directory.assert_not_called()
                runtime.place.assert_not_called()
                self.doCleanups()

    def test_non_root_cannot_install_or_inspect_live_runtime(self):
        with patch.object(runtime.os, 'geteuid', return_value=501), patch.object(runtime, 'command') as command:
            with self.assertRaisesRegex(ValueError, 'installation_root_or_window_refused'):
                runtime.RuntimeInstallation(Path('/bundle'), 'a'*64, Path('/candidate'),
                                            Path('/replay'), {}, Path('/audit'), candidate_sha='b' * 64)
            command.assert_not_called()

    def test_stale_or_missing_baseline_cannot_rename_a_container(self):
        for baseline in (None, {'observedAt': 1}):
            installer = object.__new__(runtime.RuntimeInstallation)
            installer.baseline = baseline
            with patch.object(runtime, 'command') as command:
                with self.subTest(baseline=baseline), self.assertRaisesRegex(ValueError, 'baseline_stale'):
                    installer.install()
                command.assert_not_called()

    def test_unknown_inspect_shapes_refuse(self):
        with patch.object(runtime, 'command', return_value='[]'):
            with self.assertRaisesRegex(ValueError, 'installation_container_missing'):
                runtime.inspect('baci-prefunded-background')

    def test_runner_lock_is_empty_private_single_link_before_any_install(self):
        import os
        from types import SimpleNamespace
        directory = SimpleNamespace(st_mode=0o40700, st_uid=65532, st_gid=65532)
        lock = SimpleNamespace(st_mode=0o100600, st_uid=65532, st_gid=65532,
                               st_nlink=1, st_size=0)
        with patch.object(runtime, 'root_ancestors'), \
                patch.object(Path, 'lstat', return_value=directory), \
                patch.object(runtime.os, 'open', return_value=23) as opened, \
                patch.object(runtime.os, 'close'), patch.object(runtime.os, 'fstat', return_value=lock):
            runtime.runner_state(Path('/state'))
            self.assertTrue(opened.call_args.args[1] & os.O_NOFOLLOW)
            for field, value in (('st_size', 1), ('st_nlink', 2), ('st_uid', 0), ('st_mode', 0o100644)):
                original = getattr(lock, field)
                setattr(lock, field, value)
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'runner_lock_refused'):
                    runtime.runner_state(Path('/state'))
                setattr(lock, field, original)

    def test_withdrawal_only_stops_financial_not_public_interest_or_notifications(self):
        installer = object.__new__(runtime.RuntimeInstallation)
        calls = []

        def command(arguments, **kwargs):
            calls.append(arguments)
            return ''

        with patch.object(runtime, 'command', side_effect=command):
            self.assertTrue(installer.withdraw())
        flattened = ' '.join(' '.join(call) for call in calls)
        self.assertNotIn('baci-prefunded-public', flattened)
        self.assertNotIn('baci-interest', flattened)
        self.assertNotIn('baci-savings-notifications', flattened)
        self.assertIn('baci-prefunded-background.timer', flattened)

    def test_withdrawal_failure_is_not_reported_as_success(self):
        installer = object.__new__(runtime.RuntimeInstallation)
        with patch.object(runtime, 'command', side_effect=ValueError('stop failed')):
            with self.assertRaisesRegex(ValueError, 'stop failed'):
                installer.withdraw()


if __name__ == '__main__':
    unittest.main()

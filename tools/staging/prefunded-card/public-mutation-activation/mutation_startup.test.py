import copy
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

import mutation_contract
import mutation_owner as owner
import mutation_runtime as runtime

NOW = 1790899200


class StartupTests(unittest.TestCase):
    def fixture(self, enabled):
        value = object.__new__(owner.PublicMutationOwner)
        value.now = lambda: NOW
        value.bundle = Path('/root/bundle')
        value.retained = owner.service.NAME + '-before-fixture'
        value.old_id, value.new_id = 'a' * 64, 'b' * 64
        value.verify_public_unit = lambda **kwargs: None
        rows = {flag: copy.deepcopy(owner.service.container_contract(owner.MANIFEST))
                for flag in (False, True)}
        for flag, row in rows.items():
            row.update(Id=value.new_id if flag else value.old_id, State={'Running': False})
            row['Config']['Env'] = ['PATH=/usr/bin'] + ([owner.FLAG + '=true'] if flag else [])
        rows[False]['State']['Running'] = enabled
        state = {'enabled': False, 'started': False, 'polls': 0}
        elapsed, calls = [0.0], []

        def command(arguments, **kwargs):
            calls.append((arguments, kwargs))
            if 'image' in arguments:
                return json.dumps([{'Id': owner.service.IMAGE, 'Config': {'Env': ['PATH=/usr/bin']}}])
            if 'inspect' in arguments:
                row = rows[state['enabled']]
                if state['started']:
                    state['polls'] += 1
                    row['State']['Running'] = state['polls'] >= 3
                return json.dumps([row])
            if 'create' in arguments:
                state['enabled'] = True
            if 'stop' in arguments:
                rows[False]['State']['Running'] = False
            if 'start' in arguments:
                state['started'] = True
            return ''

        def pause(delay):
            elapsed[0] += delay

        return value, rows, state, elapsed, calls, command, pause

    def test_type_simple_replacement_and_recovery_wait_for_exact_docker_running(self):
        for enabled in (True, False):
            with self.subTest(enabled=enabled):
                value, rows, state, elapsed, calls, command, pause = self.fixture(enabled)
                with patch.object(owner, 'command', side_effect=command), \
                        patch.object(runtime.time, 'monotonic', side_effect=lambda: elapsed[0]), \
                        patch.object(runtime.time, 'sleep', side_effect=pause), \
                        patch.object(owner.owner_public_artifacts, 'verify', return_value=True) as artifacts, \
                        patch.object(owner.owner_public, 'verify', return_value=True) as http:
                    if enabled:
                        value.replace_public()
                        http.assert_not_called()
                    else:
                        self.assertEqual(value.recover()['status'], 'public-readonly-restored')
                        http.assert_called_once()
                self.assertEqual(state['polls'], 3)
                self.assertTrue(rows[enabled]['State']['Running'])
                self.assertEqual(artifacts.call_count, 2 if enabled else 1)
                polls = [kwargs for arguments, kwargs in calls if 'timeout' in kwargs]
                self.assertTrue(polls)
                self.assertTrue(all(0 < kwargs['timeout'] <= 30 for kwargs in polls))

    def test_stopped_wrong_identity_or_isolation_never_waits_or_reaches_http(self):
        for enabled in (True, False):
            for field in ('identity', 'environment', 'isolation'):
                with self.subTest(enabled=enabled, field=field):
                    value, rows, state, elapsed, calls, command, pause = self.fixture(enabled)

                    def altered(arguments, **kwargs):
                        result = command(arguments, **kwargs)
                        if state['started'] and 'inspect' in arguments and 'image' not in arguments:
                            row = json.loads(result)[0]
                            if field == 'identity':
                                row['Id'] = 'e' * 64
                            elif field == 'environment':
                                row['Config']['Env'].append('UNREVIEWED=true')
                            else:
                                row['HostConfig']['Privileged'] = True
                            return json.dumps([row])
                        return result

                    with patch.object(owner, 'command', side_effect=altered), \
                            patch.object(runtime.time, 'sleep') as sleep, \
                            patch.object(owner.owner_public_artifacts, 'verify', return_value=True), \
                            patch.object(owner.owner_public, 'verify') as http, \
                            self.assertRaises((ValueError, owner.service.Refused)):
                        value.replace_public() if enabled else value.recover()
                    sleep.assert_not_called()
                    http.assert_not_called()

    def test_polling_retries_only_exact_not_running_and_preserves_bounded_runner_arguments(self):
        elapsed, calls = [0.0], []
        result = {'Id': 'b' * 64, 'State': {'Running': True}}
        run = Mock(return_value='observed')

        def check(runner):
            calls.append(runner(['inspect-fixture'], input_text='original', timeout=120))
            if len(calls) < 3:
                raise mutation_contract.Refused('public_mutation_public_not_running')
            return result

        observed = runtime.wait_public(check, run=run, now=lambda: NOW,
            clock=lambda: elapsed[0], pause=lambda delay: elapsed.__setitem__(0, elapsed[0] + delay))
        self.assertIs(observed, result)
        self.assertEqual(calls, ['observed'] * 3)
        self.assertEqual(run.call_args_list[0].kwargs, {'input_text': 'original', 'timeout': 30})
        self.assertLess(run.call_args_list[-1].kwargs['timeout'], 30)
        for error in (mutation_contract.Refused('public_mutation_public_unit_not_effective'),
                      mutation_contract.Refused('public_mutation_exact_flag_required'),
                      ValueError('public_mutation_public_not_running')):
            with self.subTest(error=repr(error)), self.assertRaises(type(error)):
                runtime.wait_public(Mock(side_effect=error), run=run, now=lambda: NOW,
                                    pause=Mock(side_effect=AssertionError('must not retry')))

    def test_permanently_stopped_container_times_out_before_more_observations(self):
        elapsed, checks = [0.0], Mock(side_effect=mutation_contract.Refused('public_mutation_public_not_running'))
        with self.assertRaisesRegex(ValueError, 'public_mutation_startup_timeout'):
            runtime.wait_public(checks, run=Mock(), now=lambda: NOW, clock=lambda: elapsed[0],
                pause=lambda delay: elapsed.__setitem__(0, elapsed[0] + max(delay, 10)))
        self.assertEqual(checks.call_count, 3)

    def test_active_unit_cannot_substitute_for_running_container_or_skip_later_isolation(self):
        for drift in (False, True):
            with self.subTest(drift=drift):
                value, rows, state, elapsed, calls, command, unused = self.fixture(False)
                value.verify_public_unit = Mock()

                def altered(arguments, **kwargs):
                    result = command(arguments, **kwargs)
                    if state['started'] and 'inspect' in arguments and 'image' not in arguments:
                        row = json.loads(result)[0]
                        row['State']['Running'] = False
                        if drift and state['polls'] == 2:
                            row['HostConfig']['Privileged'] = True
                        return json.dumps([row])
                    return result

                with patch.object(owner, 'command', side_effect=altered), \
                        patch.object(runtime.time, 'monotonic', side_effect=lambda: elapsed[0]), \
                        patch.object(runtime.time, 'sleep',
                            side_effect=lambda delay: elapsed.__setitem__(0, elapsed[0] + 10)), \
                        patch.object(owner.owner_public_artifacts, 'verify') as artifacts, \
                        patch.object(owner.owner_public, 'verify') as http, \
                        self.assertRaises((ValueError, owner.service.Refused)):
                    value.recover()
                self.assertEqual(state['polls'], 2 if drift else 3)
                self.assertEqual(value.verify_public_unit.call_count, state['polls'])
                artifacts.assert_not_called()
                http.assert_not_called()

    def test_command_failure_and_late_command_result_cannot_be_retried_or_accepted(self):
        for failure in (True, False):
            elapsed, pause = [0.0], Mock()

            def run(arguments, **kwargs):
                if failure:
                    raise mutation_contract.Refused('Runtime command refused')
                elapsed[0] = 30
                return 'late'

            with self.subTest(failure=failure), self.assertRaises(ValueError):
                runtime.wait_public(lambda runner: runner(['inspect']), run=run, now=lambda: NOW,
                                    clock=lambda: elapsed[0], pause=pause)
            pause.assert_not_called()

    def test_fixed_deadline_caps_command_timeout_without_discarding_input_or_environment(self):
        run = Mock(return_value={'State': {'Running': True}})
        runtime.wait_public(lambda runner: runner(['inspect-fixture'], input_text='unchanged',
            extra_env={'FIXTURE': 'value'}, timeout=120), run=run, now=lambda: owner.EPOCH - 600 - 0.5)
        self.assertEqual(run.call_args.kwargs, {'input_text': 'unchanged',
            'extra_env': {'FIXTURE': 'value'}, 'timeout': 0.5})

    def test_slow_success_cannot_be_accepted_after_timeout_or_fixed_deadline(self):
        for deadline in (False, True):
            elapsed, wall = [0.0], [NOW]

            def check(runner):
                if deadline:
                    wall[0] = owner.EPOCH - 600
                else:
                    elapsed[0] = 30
                return {'State': {'Running': True}}

            reason = 'window_refused' if deadline else 'startup_timeout'
            with self.subTest(deadline=deadline), self.assertRaisesRegex(ValueError, reason):
                runtime.wait_public(check, run=Mock(), now=lambda: wall[0], clock=lambda: elapsed[0])

    def test_deadline_or_timeout_exhaustion_prevents_next_command_or_observation(self):
        for deadline in (False, True):
            elapsed, wall, run = [0.0], [owner.EPOCH - 600 - 0.05 if deadline else NOW], Mock()

            def check(runner):
                if deadline:
                    wall[0] = owner.EPOCH - 600
                else:
                    elapsed[0] = 30
                runner(['must-not-execute'])

            with self.subTest(deadline=deadline), self.assertRaises(ValueError):
                runtime.wait_public(check, run=run, now=lambda: wall[0], clock=lambda: elapsed[0])
            run.assert_not_called()
        check = Mock()
        with self.assertRaisesRegex(ValueError, 'window_refused'):
            runtime.wait_public(check, run=Mock(), now=lambda: owner.EPOCH - 600)
        check.assert_not_called()


if __name__ == '__main__':
    unittest.main()

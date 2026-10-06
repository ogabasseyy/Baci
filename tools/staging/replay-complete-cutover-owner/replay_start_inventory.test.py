import copy
import importlib.util
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock

import cutover_runtime as runtime
import replay_start_inventory as subject


HERE = Path(__file__).resolve().parent


def load(name):
    specification = importlib.util.spec_from_file_location(name, HERE/(name+'.py'))
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class StartupInventoryTests(unittest.TestCase):
    def setUp(self):
        self.host = load('replay_rehearsal_inventory.test').Host()
        self.operator = SimpleNamespace(inspect=Mock(side_effect=self.inspect))
        self.callbacks = SimpleNamespace(inventory_run=self.host.run, clock=lambda: self.host.now,
            locks_held=lambda: self.host.held)
        self.subject = subject.StartupInventory(self.callbacks, self.operator)

    def inspect(self, identifier, directory, label, name):
        value = next(value for value in self.host.containers if value['Id'] == identifier)
        self.assertEqual(value['Name'], '/' + name)
        self.assertEqual((directory, label), (runtime.NATIVE_ROOT, runtime.NATIVE_SEAL)
            if identifier == runtime.NATIVE_ID else (runtime.CANDIDATE_ROOT, runtime.CANDIDATE_SEAL))
        return copy.deepcopy(value)

    def retain(self):
        self.subject.retained = True
        native = next(value for value in self.host.containers if value['Id'] == runtime.NATIVE_ID)
        native['Name'] = '/' + runtime.RETAINED

    def candidate(self, running=False):
        self.retain()
        value = copy.deepcopy(self.host.containers[0])
        value.update(Id='a'*64, Name='/'+runtime.CONTAINER)
        value['State'].update(Running=running, Status='running' if running else 'created',
            Pid=345 if running else 0)
        self.host.containers.append(value)
        self.subject.candidate_id = value['Id']
        return value

    def test_original_retained_and_stopped_candidate_are_explicitly_observed(self):
        self.subject.sample()
        self.retain()
        sample = self.subject.sample()
        self.assertEqual(sample['containers'][runtime.NATIVE_ID]['Name'], '/'+runtime.RETAINED)
        candidate = self.candidate()
        self.assertEqual(self.subject.sample()['containers'][candidate['Id']]['State']['Running'], False)

    def test_running_candidate_requires_launch_transition_and_bound_container(self):
        self.candidate(True)
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.subject.allow_running = True
        self.host.processes += '345 1 node /opt/replay-daemon.mjs\n346 345 node replay-child\n'
        self.subject.sample()
        self.operator.inspect.assert_called()

    def test_unrelated_replay_process_is_not_excluded_with_candidate_descendants(self):
        self.candidate(True)
        self.subject.allow_running = True
        self.host.processes += '345 1 node replay-daemon\n346 345 node replay-child\n347 1 node replay-unknown\n'
        with self.assertRaises(ValueError):
            self.subject.sample()

    def test_retained_native_restart_or_original_name_mismatch_refuses(self):
        self.retain()
        native = next(value for value in self.host.containers if value['Id'] == runtime.NATIVE_ID)
        for field, value in (('Running', True), ('Pid', 1)):
            original = native['State'][field]
            native['State'][field] = value
            with self.assertRaises(ValueError):
                self.subject.sample()
            native['State'][field] = original
        native['Name'] = '/' + runtime.CONTAINER
        with self.assertRaises(ValueError):
            self.subject.sample()

    def test_unknown_receipt_container_and_pending_launcher_job_refuse(self):
        unknown = copy.deepcopy(self.host.containers[-1])
        unknown.update(Id='f'*64, Name='/unknown-worker')
        self.host.containers.append(unknown)
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.host.containers.pop()
        self.host.jobs = '12 baci-interest-replay.service start waiting\n'
        with self.assertRaises(ValueError):
            self.subject.sample()

    def test_candidate_pid_drift_after_process_discovery_refuses(self):
        self.candidate(True)
        self.subject.allow_running = True
        self.host.processes += '345 1 node replay-daemon\n'
        calls = 0

        def drift(*args, **kwargs):
            nonlocal calls
            value = self.inspect(*args, **kwargs)
            if args[0] == 'a'*64:
                calls += 1
                if calls == 2:
                    value['State']['Pid'] += 1
            return value

        self.operator.inspect.side_effect = drift
        with self.assertRaises(ValueError):
            self.subject.sample()

    def test_lost_lock_and_background_restart_refuse(self):
        self.host.held = False
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.host.held = True
        background = next(value for value in self.host.containers if value['Name'] == '/baci-prefunded-background')
        background['State']['Running'] = True
        with self.assertRaises(ValueError):
            self.subject.sample()


if __name__ == '__main__':
    unittest.main()

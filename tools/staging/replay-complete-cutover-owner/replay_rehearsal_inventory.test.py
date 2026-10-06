import copy
from datetime import timedelta
import importlib.util
import json
import os
import fnmatch
from pathlib import Path
import unittest
from unittest.mock import patch
import replay_rehearsal_inventory as inventory
import replay_quiescence as quiescence
HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('quiescence_fixture', HERE / 'replay_quiescence.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
class Host:
    def __init__(self):
        self.sample, _, self.receipt = FIXTURE.fixture()
        self.now = FIXTURE.NOW
        self.held = True
        self.calls = []
        self.jobs = ''
        self.processes = f'{os.getpid()} 42 python3 replay-rehearsal-parent.py\n1 0 systemd /sbin/init\n'
        self.policies = {}
        self.containers = list(copy.deepcopy(self.sample['containers']).values())
        for identifier, name in inventory.INFRASTRUCTURE.items():
            self.containers.append(dict(Id=identifier, Name=name,
                State=dict(Running=True, Paused=False, Restarting=False), HostConfig={}))
        for value in self.containers:
            value.update(NetworkSettings=dict(Networks={inventory.NETWORK: {}}),
                Image='reviewed', Entrypoint=None, Cmd=[])
        self.units = copy.deepcopy(self.sample['units'])
        self.units[inventory.LAUNCHER] = dict(self.units['baci-staging-test-payments.service'],
            FragmentPath='/etc/systemd/system/' + inventory.LAUNCHER)
        self.units['baci-prefunded-public.service'] = dict(
            self.units['baci-staging-test-payments.service'], ActiveState='active', SubState='running', MainPID='14')
        self.units['baci-savings-notifications.service'] = dict(self.units['baci-prefunded-public.service'])
        for name, value in self.units.items():
            value.pop('pendingJobs', None)
            value.update(Id=name, FragmentPath='/etc/systemd/system/' + name,
                ExecStart='', Triggers='', TriggeredBy='')
    def listing(self):
        return ''.join(f'{name} loaded {value["ActiveState"]} {value["SubState"]} Fixture\n'
            for name, value in self.units.items() if any(fnmatch.fnmatch(name, pattern)
                for pattern in inventory.PATTERNS))
    def run(self, argv, input=None, timeout=5):
        self.calls.append(argv)
        assert 0 < timeout <= 5
        assert input is None
        return self.stdout(argv).encode()
    def stdout(self, argv):
        if argv[:len(inventory.DOCKER)] == inventory.DOCKER:
            operation = argv[len(inventory.DOCKER):]
            if operation[:2] == ['container', 'ls']:
                return '\n'.join(value['Id'] for value in self.containers) + '\n'
            if operation[:2] == ['container', 'inspect']:
                return '\n'.join(json.dumps(value) for value in self.containers) + '\n'
        if argv[0] == '/usr/bin/systemctl':
            if argv[1] == 'list-units':
                return self.listing()
            if argv[1] == 'list-jobs':
                return self.jobs
            if argv[1] == 'list-unit-files':
                return ''.join(f'{name} {self.policies.get(name, "disabled")}\n'
                    for name in self.units if any(fnmatch.fnmatch(name, pattern) for pattern in inventory.PATTERNS))
            if argv[1] == 'show':
                return '\n\n'.join('\n'.join(key + '=' + str(item)
                    for key, item in self.units[name].items()) for name in argv[4:]) + '\n'
        if argv == ['/usr/bin/ps', '-eo', 'pid=,ppid=,comm=,args=']:
            return self.processes
        raise AssertionError('unexpected command')
    def collector(self, run=None, **options):
        return inventory.ReplayRehearsalInventory(run=run or self.run,
            clock=lambda: self.now, lock_held=lambda: self.held, **options)
    def add_container(self, *, name='/foreign', running=True, network=True, cmd=None):
        value = copy.deepcopy(self.containers[0])
        value.update(Id='a' * 64, Name=name, Cmd=cmd or [])
        value['State'].update(Running=running, Status='running' if running else 'exited')
        value['NetworkSettings']['Networks'] = {inventory.NETWORK: {}} if network else {}
        self.containers.append(value)
class Tests(unittest.TestCase):
    def setUp(self):
        self.host = Host()
        self.subject = self.host.collector()
    def test_actual_command_projections_supply_before_after_validator(self):
        before = self.subject.sample()
        receipt = copy.deepcopy(self.host.receipt)
        receipt['observedAt'] = before['observedAt']
        self.host.now += timedelta(seconds=1)
        after = self.subject.sample()
        proof = quiescence.verify_replay_quiescence(before=before, after=after,
            receipt=receipt, now=self.host.now)
        self.assertTrue(proof['failedBackgroundHalted'])
        self.assertEqual(set(before['units']), set(quiescence.UNITS))
        self.assertEqual(before['containers'], self.host.sample['containers'])
        self.assertEqual(self.subject.exclusive_inventory(), dict(observedAt=after['observedAt'],
            exclusive=True, unknownClaimants=[]))
    def test_discovery_running_receipt_container_and_running_replay_elsewhere(self):
        for options in (dict(), dict(name='/unknown-replay', network=False),
                dict(name='/innocent', network=False, cmd=['node', '/opt/replay/worker.js'])):
            with self.subTest(options=options):
                host = Host()
                host.add_container(**options)
                self.assertEqual(host.collector().exclusive_inventory()['unknownClaimants'],
                    ['container:' + 'a' * 64])
                with self.assertRaisesRegex(ValueError, '^replay_rehearsal_inventory_refused$'):
                    host.collector().sample()
    def test_retained_stopped_legacy_replay_checks_and_archives_are_allowed(self):
        self.host.add_container(name='/pvb-staging-replay-old-check-archive', running=False)
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
    def test_postreboot_background_success_preserves_failed_container_exit(self):
        self.host.units['baci-prefunded-background.service'].update(
            ActiveState='inactive', SubState='dead', Result='success', ExecMainStatus='0')
        result = self.subject.sample()
        self.assertEqual(result['containers']['baci-prefunded-background']['State']['ExitCode'], 1)
    def test_waiting_deadline_timer_requires_stop_only_service_target(self):
        timer = 'baci-interest-replay-deadline.timer'
        service = 'baci-interest-replay-deadline.service'
        command = '{ path=/usr/bin/systemctl ; argv[]=/usr/bin/systemctl stop baci-interest-replay.service ; }'
        self.host.units[timer] = dict(self.host.units[inventory.LAUNCHER], Id=timer,
            ActiveState='active', SubState='waiting', Triggers=service)
        self.host.units[service] = dict(self.host.units[inventory.LAUNCHER], Id=service, ExecStart=command)
        def multirow(argv, **bounds):
            raw = self.host.run(argv, **bounds)
            return raw.replace(('ExecStart=' + command + '\n').encode(), ('ExecStart=' + command + '\nExecStart=' + interest + '\n').encode()) if 'show' in argv else raw
        native = '{ path=/usr/bin/docker ; argv[]=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded ; }'
        self.assertTrue(inventory._stop_only({'ExecStart': native}))
        self.assertFalse(inventory._stop_only({'ExecStart': native.replace('--time 15', '--time 30')}))
        interest = '{ path=/usr/bin/docker ; argv[]=/usr/bin/docker stop --time 10 baci-interest-replay ; }'
        self.assertTrue(inventory._stop_only({'ExecStart': command + ' ' + interest}))
        self.assertEqual(self.host.collector(multirow).exclusive_inventory()['unknownClaimants'], [])
        interest = interest.replace(' stop ', ' start ')
        with self.assertRaises(ValueError):
            self.host.collector(multirow).sample()
        interest = interest.replace(' start ', ' stop ')
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
        for prefix, effective in (('prefunded-replay', native), ('baci-staging-test-payments', command.replace('baci-interest-replay.service', 'baci-staging-test-payments.service'))):
            stop_timer, stop_service = prefix + '-deadline.timer', prefix + '-deadline.service'
            self.host.units[stop_timer] = dict(self.host.units[timer], Id=stop_timer, Triggers=stop_service, SubState='elapsed')
            self.host.units[stop_service] = dict(self.host.units[service], Id=stop_service, ExecStart=effective)
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
        self.host.units[service]['ExecStart'] = command.replace(' stop ', ' start ')
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], ['unit:' + timer])
        self.host.units[service]['ExecStart'] = command
        self.host.jobs = f'8 {timer} start waiting\n'
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], ['unit:' + timer])
    def test_pending_unknown_replay_job_refuses_even_when_unit_inactive(self):
        name = 'unknown-replay.service'
        self.host.units[name] = dict(self.host.units[inventory.LAUNCHER], Id=name)
        self.host.jobs = f'8 {name} start waiting\n'
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], ['unit:' + name])
    def test_lock_loss_during_authenticated_runner_refuses(self):
        def run(argv, **bounds):
            raw = self.host.run(argv, **bounds)
            self.host.held = False
            return raw
        with self.assertRaises(ValueError):
            self.host.collector(run).sample()
    def test_nonreceipt_unrelated_container_is_outside_claimant_scope(self):
        self.host.add_container(network=False)
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
    def test_exact_infrastructure_identity_and_running_state_required(self):
        for field, value in (('Id', 'b' * 64), ('Name', '/replaced')):
            host = Host()
            host.containers[3][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                host.collector().exclusive_inventory()
        for change in ('stopped', 'missing-network', 'missing'):
            host = Host()
            if change == 'stopped':
                host.containers[3]['State']['Running'] = False
            elif change == 'missing-network':
                host.containers[3]['NetworkSettings']['Networks'] = {}
            else:
                host.containers.pop(3)
            with self.subTest(change=change), self.assertRaises(ValueError):
                host.collector().exclusive_inventory()
    def test_each_exact_stopped_pin_and_launcher_drift_refuses(self):
        for index in range(3):
            for change in ('running', 'replacement', 'restart'):
                host = Host()
                if change == 'running':
                    host.containers[index]['State']['Running'] = True
                elif change == 'replacement':
                    host.containers[index]['Id'] = 'b' * 64
                else:
                    host.containers[index]['HostConfig']['RestartPolicy']['Name'] = 'always'
                with self.subTest(index=index, change=change), self.assertRaises(ValueError):
                    host.collector().sample()
        for field, value in (('ActiveState', 'active'), ('DropInPaths', '/extra'),
                ('FragmentPath', '/foreign'), ('Restart', 'always'), ('MainPID', '10')):
            host = Host()
            host.units[inventory.LAUNCHER][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                host.collector().exclusive_inventory()
    def test_jobs_refuse_for_known_units_and_discover_unknown_launchers(self):
        self.host.jobs = '7 baci-prefunded-background.service start waiting\n'
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.host.jobs = ''
        self.host.units['prefunded-launcher.service'] = dict(self.host.units[inventory.LAUNCHER],
            Id='prefunded-launcher.service', ActiveState='active', SubState='running',
            ExecStart='/usr/bin/node /opt/interest-replay/start.js')
        self.host.units['foreign-replay.timer'] = dict(self.host.units[inventory.LAUNCHER],
            Id='foreign-replay.timer', ActiveState='active', SubState='waiting')
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'],
            ['unit:foreign-replay.timer', 'unit:prefunded-launcher.service'])
    def test_postgres_background_writer_allowed_while_replay_and_prefunded_launchers_reported(self):
        self.host.processes += '86 1 postgres postgres: background writer\n87 1 postgres postgres: logical replication launcher\n'
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
        self.host.processes += '85 1 node node /opt/replay/worker.js --token=private-secret\n'
        result = self.subject.exclusive_inventory()
        self.assertEqual(result['unknownClaimants'], ['process:85'])
        self.assertNotIn('private-secret', json.dumps(result))
        self.host.processes += '88 1 node node /opt/baci-prefunded-background/worker.js\n'
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], ['process:85', 'process:88'])
    def test_inventory_races_malformed_duplicate_and_oversized_output_refuse(self):
        for mode in ('race', 'duplicate', 'invalid-id', 'oversized', 'json-duplicate', 'missing-unit', 'unit-duplicate'):
            host = Host()
            count = 0
            def run(argv, **bounds):
                nonlocal count
                raw = host.run(argv, **bounds)
                if 'ls' in argv:
                    count += 1
                    if mode == 'race' and count == 2:
                        return raw + b'c' * 64 + b'\n'
                    if mode == 'duplicate':
                        return raw + raw.splitlines()[0] + b'\n'
                    if mode == 'invalid-id':
                        return b'not-an-id\n'
                if mode == 'oversized':
                    return b'x' * (inventory.LIMIT + 1)
                if mode == 'json-duplicate' and 'inspect' in argv:
                    return raw.replace(b'"Id":', b'"Id":"secret", "Id":', 1)
                if mode == 'missing-unit' and 'show' in argv:
                    return raw.split(b'\n\n', 1)[1]
                if mode == 'unit-duplicate' and 'show' in argv:
                    return raw.replace(b'LoadState=loaded', b'LoadState=loaded\nLoadState=loaded', 1)
                return raw
            with self.subTest(mode=mode), self.assertRaises(ValueError):
                host.collector(run).exclusive_inventory()
    def test_failed_commands_lock_deadline_and_elapsed_bounds_refuse_redacted(self):
        def failed(argv, **bounds):
            raise RuntimeError('private-secret')
        with self.assertRaisesRegex(ValueError, '^replay_rehearsal_inventory_refused$') as failure:
            self.host.collector(failed).sample()
        self.assertTrue(failure.exception.__suppress_context__)
        self.host.held = False
        with self.assertRaises(ValueError):
            self.subject.exclusive_inventory()
        self.assertEqual(self.host.calls, [])
        self.host.held = True
        self.host.now = quiescence._time(quiescence.DEADLINE)
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.host.now = FIXTURE.NOW
        with patch.object(inventory.time, 'monotonic', side_effect=[0, 26]), self.assertRaises(ValueError):
            self.subject.sample()

    def test_only_fixed_readonly_commands_and_secret_free_docker_projection(self):
        self.subject.sample()
        for argv in self.host.calls:
            if argv[0] == '/usr/bin/docker':
                self.assertIn(argv[3], ('ls', 'inspect'))
                self.assertNotIn('exec', argv)
                self.assertNotIn('.Config.Env', ' '.join(argv))
            elif argv[0] == '/usr/bin/systemctl':
                self.assertIn(argv[1], ('show', 'list-units', 'list-jobs', 'list-unit-files'))
            else:
                self.assertEqual(argv, ['/usr/bin/ps', '-eo', 'pid=,ppid=,comm=,args='])

    def test_authenticated_ancestry_only_excludes_actual_driver_parent_chain(self):
        self.host.processes += '42 1 bash bash parent-replay-driver.sh\n85 1 bash unknown-replay.sh\n'
        subject = self.host.collector(driver_ancestry=(os.getpid(), 42))
        self.assertEqual(subject.exclusive_inventory()['unknownClaimants'], ['process:85'])
        with self.assertRaises(ValueError):
            self.host.collector(driver_ancestry=(os.getpid(), 85)).exclusive_inventory()

    def test_unrelated_unit_volume_and_descriptions_are_outside_scoped_listing(self):
        for index in range(700):
            name = f'unrelated-{index}.service'
            self.host.units[name] = dict(self.host.units[inventory.LAUNCHER], Id=name)
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], [])
        self.assertEqual(self.subject.collect_sample(), self.subject.sample())

    def test_retained_restart_policy_and_enabled_unknown_launcher_refuse(self):
        self.host.add_container(name='/retained-replay', running=False)
        self.host.containers[-1]['HostConfig']['RestartPolicy']['Name'] = 'always'
        with self.assertRaises(ValueError):
            self.subject.sample()
        self.host.containers.pop()
        name = 'retained-replay.service'
        self.host.units[name] = dict(self.host.units[inventory.LAUNCHER], Id=name)
        self.host.policies[name] = 'enabled'
        self.assertEqual(self.subject.exclusive_inventory()['unknownClaimants'], ['unit:' + name])
if __name__ == '__main__':
    unittest.main()

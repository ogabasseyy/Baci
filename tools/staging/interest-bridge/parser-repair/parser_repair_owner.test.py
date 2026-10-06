import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import patch


sys.path.insert(0, str(Path(__file__).parent))
SPEC = importlib.util.spec_from_file_location('parser_repair_owner', Path(__file__).with_name('parser_repair_owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


class FakeRepair(OWNER.Repair):
    def __init__(self):
        super().__init__(Path('/root/reviewed-test-bundle'))
        self.tag = 'test'
        self.daemon = OWNER.ORIGINAL_DIGEST
        self.new_digest = 'candidate-manifest'
        self.image_environment = ['NODE_VERSION=22']
        self.commands = []
        self.fail_rename = False
        self.fail_create_after_commit = False
        self.containers = {
            name: dict(Name='/' + name, Id='original-' + str(position),
                State=dict(Running=False, Paused=False, Restarting=False, Status='exited'),
                Config=dict(Labels={OWNER.LABEL: OWNER.MANIFEST_DIGEST}, Env=self.image_environment),
                NetworkSettings=dict(Networks={network: {} for network in ('receipts', 'application', 'ingress')}))
            for position, name in enumerate(OWNER.CONTAINERS)
        }
        self.runtime = SimpleNamespace(NETWORKS=('receipts', 'application', 'ingress'),
            create_arguments=lambda directory, digest, check: ['create', '--name=original',
                '--label=' + digest, '--check=' + str(check)],
            validate_container=self.validate_container)
        self.original = b'original'
        self.repaired = b'repaired'

    def validate_container(self, observed, directory, expected_digest, check):
        if observed['Config']['Labels'][OWNER.LABEL] != expected_digest:
            raise OWNER.Refused('Manifest drift')

    def inspect(self, name):
        if name in self.containers:
            return copy.deepcopy(self.containers[name])
        for container in self.containers.values():
            if container['Id'] == name:
                return copy.deepcopy(container)
        raise OWNER.Refused('Missing container')

    def command(self, arguments):
        operation = arguments[len(OWNER.DOCKER):]
        self.commands.append(operation)
        if operation[0] == 'create':
            name = next(value.split('=', 1)[1] for value in operation if value.startswith('--name='))
            self.containers[name] = dict(Name='/' + name, Id=hashlib.sha256(name.encode()).hexdigest(),
                State=dict(Running=False, Paused=False, Restarting=False, Status='created'),
                Config=dict(Labels={OWNER.LABEL: self.new_digest, OWNER.RUN_LABEL: self.tag}, Env=self.image_environment),
                NetworkSettings=dict(Networks={'receipts': {}}))
            if self.fail_create_after_commit:
                self.fail_create_after_commit = False
                raise TimeoutError('Simulated ambiguous create')
            return self.containers[name]['Id']
        if operation[0] == 'ps':
            identifiers = [value.split('=', 1)[1] for value in operation if value.startswith('id=')]
            if identifiers:
                return '\n'.join(container['Id'] for container in self.containers.values()
                    if container['Id'] == identifiers[0])
            name = next(value.split('name=^/', 1)[1][:-1] for value in operation if value.startswith('name=^/'))
            return self.containers[name]['Id'] if name in self.containers else ''
        if operation[0] == 'rename':
            if self.fail_rename and '-parser-next-' in operation[1]:
                self.fail_rename = False
                raise OWNER.Refused('Simulated rename failure')
            observed = self.inspect(operation[1])
            previous_name = observed['Name'].lstrip('/')
            if operation[2] in self.containers:
                raise OWNER.Refused('Name exists')
            self.containers[operation[2]] = self.containers.pop(previous_name)
            self.containers[operation[2]]['Name'] = '/' + operation[2]
            return ''
        if operation[0] == 'rm':
            observed = self.inspect(operation[1])
            del self.containers[observed['Name'].lstrip('/')]
            return ''
        if operation[:2] == ['network', 'connect']:
            self.containers[operation[3]]['NetworkSettings']['Networks'][operation[2]] = {}
            return ''
        raise AssertionError('Unexpected command: ' + json.dumps(operation))

    def preflight(self):
        self.original_ids = {
            name: self.verify_container(name, OWNER.MANIFEST_DIGEST, position == 1)
            for position, name in enumerate(OWNER.CONTAINERS)
        }

    def protected_files(self, expected_daemon):
        if self.daemon != expected_daemon:
            raise OWNER.Refused('Artifact drift')

    def swap(self, content, expected):
        self.protected_files(expected)
        self.daemon = OWNER.REPAIRED_DIGEST if content == self.repaired else OWNER.ORIGINAL_DIGEST

    def record(self):
        return dict(status='interest-parser-installed-inactive', servicesStarted=False)

    def current_digest(self):
        return self.daemon


class ParserRepairOwnerTests(unittest.TestCase):
    def test_installs_both_stopped_containers_without_financial_commands(self):
        repair = FakeRepair()
        result = repair.run()
        self.assertFalse(result['servicesStarted'])
        self.assertEqual(repair.daemon, OWNER.REPAIRED_DIGEST)
        for name in OWNER.CONTAINERS:
            self.assertFalse(repair.containers[name]['State']['Running'])
            self.assertEqual(repair.containers[name]['Config']['Labels'][OWNER.LABEL], repair.new_digest)
        self.assertTrue(set(repair.renamed.values()).issubset(repair.containers))
        self.assertFalse(any(command[0] in ('start', 'run', 'exec', 'restart') for command in repair.commands))

    def test_refuses_a_running_original_without_changes(self):
        repair = FakeRepair()
        repair.containers[OWNER.CONTAINERS[0]]['State']['Running'] = True
        with self.assertRaises(OWNER.Refused):
            repair.run()
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)
        self.assertEqual(repair.commands, [])

    def test_refuses_original_environment_drift(self):
        repair = FakeRepair()
        repair.containers[OWNER.CONTAINERS[0]]['Config']['Env'] = ['NODE_OPTIONS=foreign']
        with self.assertRaises(OWNER.Refused):
            repair.run()
        self.assertEqual(repair.commands, [])

    def test_refuses_original_manifest_label_drift(self):
        repair = FakeRepair()
        repair.containers[OWNER.CONTAINERS[1]]['Config']['Labels'][OWNER.LABEL] = 'foreign'
        with self.assertRaises(OWNER.Refused):
            repair.run()
        self.assertEqual(repair.commands, [])

    def test_rolls_back_a_failure_between_container_renames(self):
        repair = FakeRepair()
        repair.fail_rename = True
        baseline = copy.deepcopy(repair.containers)
        with self.assertRaises(OWNER.Refused):
            repair.run()
        repair.rollback()
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)
        self.assertEqual(repair.containers, baseline)

    def test_refuses_to_overwrite_a_foreign_daemon_during_rollback(self):
        repair = FakeRepair()
        repair.run()
        repair.daemon = 'foreign'
        with self.assertRaises(OWNER.Refused):
            repair.rollback()
        self.assertEqual(repair.daemon, 'foreign')

    def test_rechecks_original_identity_before_swapping(self):
        repair = FakeRepair()
        repair.preflight()
        repair.create_candidates()
        repair.containers[OWNER.CONTAINERS[0]]['Id'] = 'foreign'
        with self.assertRaises(OWNER.Refused):
            repair.install()
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)

    def test_reconciles_a_candidate_created_before_the_docker_reply_times_out(self):
        repair = FakeRepair()
        repair.fail_create_after_commit = True
        baseline = copy.deepcopy(repair.containers)
        with self.assertRaises(TimeoutError):
            repair.run()
        self.assertEqual(len(repair.containers), 3)
        repair.rollback()
        self.assertEqual(repair.containers, baseline)
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)

    def test_preserves_foreign_candidate_label_after_ambiguous_create(self):
        repair = FakeRepair()
        repair.fail_create_after_commit = True
        with self.assertRaises(TimeoutError):
            repair.run()
        candidate = next(name for name in repair.containers if '-parser-next-' in name)
        repair.containers[candidate]['Config']['Labels'][OWNER.LABEL] = 'foreign'
        with self.assertRaises(OWNER.Refused):
            repair.rollback()
        self.assertIn(candidate, repair.containers)

    def test_preserves_another_runs_candidate_after_ambiguous_create(self):
        repair = FakeRepair()
        repair.fail_create_after_commit = True
        with self.assertRaises(TimeoutError):
            repair.run()
        candidate = next(name for name in repair.containers if '-parser-next-' in name)
        repair.containers[candidate]['Config']['Labels'][OWNER.RUN_LABEL] = 'another-run'
        with self.assertRaises(OWNER.Refused):
            repair.rollback()
        self.assertIn(candidate, repair.containers)

    def test_restores_original_when_verification_fails_after_candidate_rename(self):
        repair = FakeRepair()
        baseline = copy.deepcopy(repair.containers)
        verify = repair.verify_container

        def fail_after_rename(name, expected_digest, check, expected_id=None):
            if name == OWNER.CONTAINERS[0] and expected_digest == repair.new_digest:
                raise OWNER.Refused('Simulated post-rename failure')
            return verify(name, expected_digest, check, expected_id)

        with patch.object(repair, 'verify_container', side_effect=fail_after_rename):
            with self.assertRaises(OWNER.Refused):
                repair.run()
        repair.rollback()
        self.assertEqual(repair.containers, baseline)
        self.assertEqual(repair.daemon, OWNER.ORIGINAL_DIGEST)

    def test_retains_redacted_refusal_metadata_without_exception_messages(self):
        repair = FakeRepair()
        repair.created = {'owned-candidate': 'known-id'}
        with patch.object(OWNER, 'write_new') as output:
            repair.record_refusal(OWNER.Refused('secret-provider-body'), RuntimeError('secret-token'), False)
        path, content = output.call_args.args
        report = json.loads(content)
        self.assertEqual(path.name, 'refusal-result.json')
        self.assertFalse(report['cleanupSucceeded'])
        self.assertEqual(report['exceptionClass'], 'Refused')
        self.assertEqual(report['rollbackExceptionClass'], 'RuntimeError')
        self.assertEqual(report['candidateContainers'], repair.created)
        self.assertNotIn(b'secret', content)


if __name__ == '__main__':
    unittest.main()

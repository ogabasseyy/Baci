import copy
import hashlib
import json
from pathlib import Path
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

from probe_transport import DOCKER, IMAGE, collect_http, run_probes, validate_probe_container


def container():
    return dict(Id='synthetic-id', Name='/synthetic-probe', Image=IMAGE,
        Config=dict(User='65532:65532', Entrypoint=['/usr/local/bin/node'], Cmd=['/probe/probe.cjs'],
                    Env=['PATH=synthetic'], Labels={'com.baci.claim-fence.probe-sha256': 'synthetic-sha'}),
        HostConfig=dict(ReadonlyRootfs=True, Privileged=False, RestartPolicy=dict(Name='no'),
            CapDrop=['ALL'], CapAdd=None, SecurityOpt=['no-new-privileges'], Memory=134217728,
            NanoCpus=125000000, PidsLimit=32, PortBindings={}, NetworkMode='pvb-staging-receipts'),
        NetworkSettings=dict(Networks={'pvb-staging-receipts': {}}),
        Mounts=[dict(Type='bind', Source='/synthetic-private', Destination='/probe', RW=False)])


class ProbeTransportTests(unittest.TestCase):
    def test_bounded_container_rejects_network_memory_and_writable_mount_drift(self):
        value = container()
        validate = lambda candidate: validate_probe_container(candidate, 'synthetic-id', 'synthetic-probe',
            Path('/synthetic-private'), 'synthetic-sha', ['PATH=synthetic'])
        validate(value)
        mutations = [lambda row: row['NetworkSettings']['Networks'].update(extra={}),
                     lambda row: row['HostConfig'].update(Memory=0),
                     lambda row: row['Mounts'][0].update(RW=True)]
        for mutate in mutations:
            changed = copy.deepcopy(value)
            mutate(changed)
            with self.assertRaisesRegex(ValueError, 'bounded_probe_container_refused'):
                validate(changed)

    def test_snapshot_brackets_actual_http_batch_not_cached_validation(self):
        calls = []
        context = type('Context', (), {'credentials': lambda _: ({}, {}),
            'contract': type('Contract', (), {'serialize': staticmethod(lambda _: b'synthetic')})})()
        def snapshot():
            calls.append('snapshot')
            return {'synthetic': 'value'}
        def collect(*args):
            calls.append('actual-http')
            return {name: dict(identity='7686901100561231906', status=400, body='{}')
                    for name in ('new', 'oldNative', 'oldInterest')}
        with patch('probe_transport.collect_http', collect), patch('probe_transport.probe_claim_fence',
            lambda **kwargs: calls.append('cached-validation') or {'status': 'synthetic'}):
            with self.assertRaises(KeyError):
                run_probes(context, snapshot, 'synthetic')
        self.assertEqual(calls, ['snapshot', 'actual-http', 'snapshot', 'cached-validation'])

    def test_aliased_snapshot_mutation_cannot_overwrite_the_before_witness(self):
        tokens = dict(oldNative='synthetic-native', oldInterest='synthetic-interest', new='synthetic-new')
        proofs = {}
        for name, token in tokens.items():
            claims = dict(role='pvb_staging_worker', aud='pvb-staging-receipts', iat=1790995436, exp=1791302350)
            if name == 'new':
                claims['replay_claimant_generation'] = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
            proofs[name] = dict(tokenSha256=hashlib.sha256(token.encode()).hexdigest(),
                                signatureVerified=True, claims=claims)
        context = type('Context', (), {'credentials': lambda _: (tokens, proofs)})()
        shared = {name: '1' * 64 for name in ('receiptStateSha256', 'quarantineStateSha256',
            'signatureStateSha256', 'financialStateSha256', 'principalStateSha256')}
        def collect(*args):
            shared['financialStateSha256'] = '2' * 64
            return {name: dict(identity='7686901100561231906', status=400 if name == 'new' else 403,
                body=json.dumps(dict(code='22023' if name == 'new' else '42501',
                    message='Invalid claim bounds' if name == 'new' else 'Replay claimant refused',
                    details=None, hint=None))) for name in tokens}
        with patch('probe_transport.collect_http', collect):
            with self.assertRaisesRegex(ValueError, 'claim_fence_probe_refused'):
                run_probes(context, lambda: shared, 'synthetic-sha')


class ProbeCleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.directory = Path(self.temporary.name)/'owned-probe'
        self.directory.mkdir()
        self.sibling = Path(self.temporary.name)/'sibling-audit'
        self.sibling.write_bytes(b'preserved')
        self.identifier = 'a'*64
        self.script = b'synthetic-probe'
        self.pin = hashlib.sha256(self.script).hexdigest()
        self.calls, self.inspections = [], 0
        self.failure, self.returned = None, self.identifier
        self.context = SimpleNamespace(owner=SimpleNamespace(read=lambda *args: self.script, write=self.write),
            contract=SimpleNamespace(serialize=lambda value: json.dumps(value).encode()),
            finance={'command': self.command}, deadline=lambda: None)

    def write(self, path, value, **kwargs):
        path.write_bytes(value)
        if self.failure == 'write' and path.name == 'tokens.json':
            raise ValueError('synthetic_write_refused')

    def command(self, arguments, **kwargs):
        self.assertEqual(arguments[:len(DOCKER)], DOCKER)
        action = arguments[len(DOCKER):]
        self.calls.append(action)
        if action[:2] == ['image', 'inspect']:
            return json.dumps([dict(Id=IMAGE, Config=dict(Env=['PATH=synthetic']))])
        if action[0] == 'create':
            name = next(value.split('=', 1)[1] for value in action if value.startswith('--name='))
            self.container = container()
            self.container.update(Id=self.identifier, Name='/'+name,
                State=dict(Running=False, ExitCode=0, OOMKilled=False))
            self.container['Mounts'][0]['Source'] = str(self.directory)
            self.container['Config']['Labels']['com.baci.claim-fence.probe-sha256'] = self.pin
            if self.failure == 'create':
                raise ValueError('synthetic_create_transport_refused')
            return self.returned
        if action[0] == 'inspect':
            self.inspections += 1
            cleanup = self.inspections >= 3 or self.returned != self.identifier or self.failure == 'create'
            if cleanup and self.failure == 'inspect':
                raise ValueError('synthetic_inspect_refused')
            observed = copy.deepcopy(self.container)
            if cleanup and self.failure == 'identity':
                observed['Name'] = '/sibling-container'
            if cleanup and self.failure == 'mount':
                observed['Mounts'][0]['Source'] = str(self.sibling)
            return json.dumps([observed])
        if action[0] == 'start':
            self.container['State']['Running'] = True
            return self.identifier
        if action[0] == 'wait':
            if self.failure == 'stop':
                raise ValueError('synthetic_wait_refused')
            self.container['State']['Running'] = False
            return '0'
        if action[0] == 'logs':
            return json.dumps({profile: {} for profile in ('oldNative', 'oldInterest', 'new')})
        if action[0] in ('stop', 'rm'):
            self.assertEqual(action[-1], self.identifier)
            if action[0] == self.failure:
                raise ValueError('synthetic_cleanup_refused')
            if action[0] == 'stop':
                self.container['State']['Running'] = False
            return self.identifier
        raise AssertionError('unexpected Docker action')

    def collect(self):
        with (patch('probe_transport.tempfile.mkdtemp', return_value=str(self.directory)),
              patch('probe_transport.os.chown'), patch('probe_transport.os.chmod')):
            return collect_http(self.context, {'new': 'synthetic-private-token'}, self.pin)

    def assert_private_files_removed(self):
        self.assertFalse(self.directory.exists())
        self.assertEqual(self.sibling.read_bytes(), b'preserved')

    def test_cleanup_inspect_failure_still_unlinks_private_tokens_and_script(self):
        self.failure = 'inspect'
        with self.assertRaises(ValueError):
            self.collect()
        self.assert_private_files_removed()
        self.assertFalse(any(call[0] in ('stop', 'rm') for call in self.calls))

    def test_cleanup_stop_failure_still_unlinks_private_files_without_removal(self):
        self.failure = 'stop'
        with self.assertRaises(ValueError):
            self.collect()
        self.assert_private_files_removed()
        self.assertFalse(any(call[0] == 'rm' for call in self.calls))

    def test_cleanup_remove_failure_still_unlinks_private_files(self):
        self.failure = 'rm'
        with self.assertRaises(ValueError):
            self.collect()
        self.assert_private_files_removed()

    def test_invalid_create_id_uses_validated_owned_name_only_for_cleanup(self):
        self.returned = 'not-a-container-id'
        with self.assertRaisesRegex(ValueError, 'probe_id_refused'):
            self.collect()
        self.assert_private_files_removed()
        removals = [call for call in self.calls if call[0] == 'rm']
        self.assertEqual(removals, [['rm', self.identifier]])
        self.assertFalse(any(call[0] == 'start' for call in self.calls))
        inspected = [call[-1] for call in self.calls if call[0] == 'inspect']
        self.assertEqual(inspected, [self.container['Name'][1:]])

    def test_create_transport_failure_can_remove_only_fully_verified_owned_container(self):
        self.failure = 'create'
        with self.assertRaises(ValueError):
            self.collect()
        self.assert_private_files_removed()
        self.assertEqual([call for call in self.calls if call[0] == 'rm'], [['rm', self.identifier]])

    def test_owned_name_fallback_refuses_identity_or_mount_drift_without_stop_or_remove(self):
        for failure in ('identity', 'mount'):
            self.setUp()
            self.failure, self.returned = failure, 'not-a-container-id'
            with self.subTest(failure=failure), self.assertRaises(ValueError):
                self.collect()
            self.assert_private_files_removed()
            self.assertFalse(any(call[0] in ('start', 'stop', 'rm') for call in self.calls))

    def test_partial_private_write_failure_is_cleaned_before_any_container_creation(self):
        self.failure = 'write'
        with self.assertRaises(ValueError):
            self.collect()
        self.assert_private_files_removed()
        self.assertEqual(self.calls, [])

    def test_success_removes_only_owned_container_and_private_files(self):
        self.assertEqual(set(self.collect()), {'oldNative', 'oldInterest', 'new'})
        self.assert_private_files_removed()
        self.assertEqual([call for call in self.calls if call[0] == 'rm'], [['rm', self.identifier]])


if __name__ == '__main__':
    unittest.main()

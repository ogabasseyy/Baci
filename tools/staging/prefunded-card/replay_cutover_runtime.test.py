import base64
import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from runtime_configuration import build_runtime_configuration


HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('cutover_runtime', HERE / 'replay_cutover_runtime.py')
RUNTIME = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(RUNTIME)


class ReplayCutoverRuntime(unittest.TestCase):
    def inputs(self):
        activation = json.dumps({'receiverReplayRuntime': {'expectedAppSystemId': RUNTIME.SYSTEM,
                                 'configuration': {'scope': {}, 'evidence': {}, 'database': {}}},
                                 'background': {'paystack': {'secret': 'never-copy'}}}).encode()
        def token(role, audience):
            claims = base64.urlsafe_b64encode(json.dumps(dict(role=role, aud=audience,
                iat=1790500000, exp=1790697550)).encode()).rstrip(b'=').decode()
            return 'header.' + claims + '.signature'
        base = json.dumps(dict(environment='staging', receiptSystemId='7686901100561231906',
            appSystemId='7685292944002592802', receiptKey=base64.b64encode(b'x' * 32).decode(),
            receiptToken=token('pvb_staging_worker', 'pvb-staging-receipts'),
            appToken=token('pvb_staging_app_worker', 'authenticated'))).encode()
        return activation, base, hashlib.sha256(activation).hexdigest()

    def test_extracts_only_replay_credentials_and_pins_exact_bytes(self):
        activation, base, digest = self.inputs()
        result = RUNTIME.runtime_files(activation, base, digest, 'a' * 64)
        self.assertNotIn(b'never-copy', b''.join(result.values()))
        parsed = json.loads(result['config.json'])
        self.assertEqual(parsed['prefundedReplay'], dict(bundleSha256='a' * 64,
            configurationSha256=hashlib.sha256(result['prefunded.json']).hexdigest()))
        self.assertEqual(json.loads(result['prefunded.json']),
                         json.loads(activation)['receiverReplayRuntime']['configuration'])

    def test_accepts_actual_activation_template_and_refuses_wrong_receiver_system(self):
        template = json.loads((HERE / 'activation-config.template.json').read_text())
        configuration = build_runtime_configuration(template,
            '-----BEGIN CERTIFICATE-----\nU3ludGhldGljIENB\n-----END CERTIFICATE-----\n',
            'test_key_synthetic', 'sk_test_synthetic', {
                'prefunded_treasury_operator': 'T' * 64,
                'prefunded_evidence': 'E' * 64, 'prefunded_authorizer': 'A' * 64})
        _activation, base, _digest = self.inputs()
        activation = json.dumps(configuration).encode()
        result = RUNTIME.runtime_files(activation, base, hashlib.sha256(activation).hexdigest(), 'a' * 64)
        self.assertEqual(json.loads(result['prefunded.json']),
                         configuration['receiverReplayRuntime']['configuration'])
        configuration['receiverReplayRuntime']['expectedAppSystemId'] = 'foreign'
        activation = json.dumps(configuration).encode()
        with self.assertRaises(RUNTIME.Refused):
            RUNTIME.runtime_files(activation, base, hashlib.sha256(activation).hexdigest(), 'a' * 64)

    def test_refuses_changed_activation_or_unbounded_replay_token(self):
        activation, base, digest = self.inputs()
        with self.assertRaises(RUNTIME.Refused):
            RUNTIME.runtime_files(activation + b' ', base, digest, 'a' * 64)
        value = json.loads(base)
        value['appToken'] = value['receiptToken']
        with self.assertRaises(RUNTIME.Refused):
            RUNTIME.runtime_files(activation, json.dumps(value).encode(), digest, 'a' * 64)

    def test_both_replay_tokens_must_keep_exact_fixed_deadline_and_bounded_lifetime(self):
        activation, base, digest = self.inputs()
        for name in ('receiptToken', 'appToken'):
            for changes in ({'exp': 1790424621}, {'exp': RUNTIME.DEADLINE_EPOCH + 1},
                            {'exp': float(RUNTIME.DEADLINE_EPOCH)},
                            {'iat': RUNTIME.DEADLINE_EPOCH - 604801},
                            {'iat': RUNTIME.DEADLINE_EPOCH}):
                with self.subTest(name=name, changes=changes):
                    replay = json.loads(base)
                    header, body, signature = replay[name].split('.')
                    claims = json.loads(base64.urlsafe_b64decode(body + '==='))
                    claims.update(changes)
                    body = base64.urlsafe_b64encode(json.dumps(claims).encode()).rstrip(b'=').decode()
                    replay[name] = '.'.join((header, body, signature))
                    with self.assertRaises(RUNTIME.Refused):
                        RUNTIME.runtime_files(activation, json.dumps(replay).encode(), digest, 'a' * 64)

    def test_container_command_has_no_public_ports_or_privileged_credentials(self):
        args = RUNTIME.create_arguments('/opt/baci-prefunded-replay', 'a' * 64, check=True)
        self.assertIn('--user=65532:65532', args)
        self.assertIn('--read-only', args)
        self.assertIn('--restart=no', args)
        self.assertIn('--cap-drop=ALL', args)
        self.assertIn('--security-opt=no-new-privileges', args)
        self.assertEqual(args[-3:], ['node', '/opt/pvb-replay/replay-daemon.mjs', '--check'])
        self.assertFalse(any(item.startswith(('--publish', '--privileged', '--env')) for item in args))

    def test_container_validation_rejects_writable_mount_extra_network_and_changed_image(self):
        value = RUNTIME.expected_container('/opt/baci-prefunded-replay', 'a' * 64, check=False)
        RUNTIME.validate_container(value, '/opt/baci-prefunded-replay', 'a' * 64, check=False)
        for mutate in (
            lambda item: item['Mounts'][0].update(RW=True),
            lambda item: item['NetworkSettings']['Networks'].update(unapproved={}),
            lambda item: item.update(Image='foreign'),
            lambda item: item['HostConfig'].update(Privileged=True),
            lambda item: item['Config'].update(Cmd=['sh']),
        ):
            changed = copy.deepcopy(value)
            mutate(changed)
            with self.assertRaises(RUNTIME.Refused):
                RUNTIME.validate_container(changed, '/opt/baci-prefunded-replay', 'a' * 64, check=False)


if __name__ == '__main__':
    unittest.main()

from contextlib import ExitStack, redirect_stdout
import hashlib
import base64
import hmac
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from runtime_configuration import Refused as ConfigurationRefused
from treasury_owner_contract import DEADLINE, SYSTEM, Refused


SPEC = importlib.util.spec_from_file_location('runtime_owner', Path(__file__).with_name('runtime-preparation-owner.py'))
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)


def material():
    return dict(systemIdentifier=SYSTEM, expiresAt=DEADLINE, credentialProof='q' * 64,
                passwords={role: chr(97 + index) * 64 for index, role in enumerate(OWNER.PASSWORD_FIELDS)})


class RuntimePreparationOwnerTests(unittest.TestCase):
    def test_prepared_inputs_match_approved_keys_and_refuse_cross_environment_sources(self):
        ca = '-----BEGIN CERTIFICATE-----\nU3ludGhldGljIENB\n-----END CERTIFICATE-----\n'
        provider = 'test_key_synthetic'
        intake = dict(environment='staging', providerSecret=provider,
                      encryptionKey=base64.b64encode(b'x' * 32).decode())
        treasury = dict(database={'certificateAuthority': ca},
                        verifier={'expiresAt': DEADLINE, 'piggyvest': {'apiSecret': provider}})
        original = dict(environment='staging', appSystemId=SYSTEM, receiptSystemId='7686901100561231906',
                        receiptKey=intake['encryptionKey'])
        keys = {'appToken': 'a' * 40, 'receiptToken': 'r' * 40}
        def encode(value):
            return base64.urlsafe_b64encode(json.dumps(value).encode()).rstrip(b'=')
        for name, role, audience in (('appToken', 'pvb_staging_app_worker', 'authenticated'),
                                     ('receiptToken', 'pvb_staging_worker', 'pvb-staging-receipts')):
            body = b'.'.join((encode({'alg': 'HS256', 'typ': 'JWT'}),
                              encode({'role': role, 'aud': audience, 'iat': int(time.time()) - 3600,
                                      'exp': int(time.time()) - 1})))
            signature = hmac.new(keys[name].encode(), body, hashlib.sha256).digest()
            original[name] = (body + b'.' + base64.urlsafe_b64encode(signature).rstrip(b'=')).decode()
        template = Path(__file__).with_name('activation-config.template.json').read_bytes()
        for failure in (None, 'project', 'receipt-system', 'live-paystack', 'treasury-key'):
            def read(path, *_):
                if path == OWNER.CA:
                    return ca.encode()
                if path == OWNER.PAYSTACK:
                    return b'sk_live_synthetic' if failure == 'live-paystack' else b'sk_test_synthetic'
                if path == OWNER.INTAKE:
                    return json.dumps(intake).encode()
                copy = json.loads(json.dumps(treasury))
                if failure == 'treasury-key':
                    copy['verifier']['piggyvest']['apiSecret'] = 'test_key_other'
                return json.dumps(copy).encode()
            with self.subTest(failure=failure), tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
                stack.enter_context(patch.object(OWNER, 'DIRECTORY', Path(directory)))
                stack.enter_context(patch.object(OWNER, 'root_ancestors'))
                stack.enter_context(patch.object(OWNER, 'private_directory'))
                stack.enter_context(patch.object(OWNER, 'read_file', side_effect=read))
                stack.enter_context(patch.object(OWNER.pwd, 'getpwnam', return_value=SimpleNamespace(pw_uid=1001)))
                stack.enter_context(patch.object(OWNER, 'inspect', return_value={'Config': {'Labels': {
                    'com.docker.compose.project': 'production' if failure == 'project' else 'baci-isolated-savings'}}}))
                stack.enter_context(patch.object(OWNER, 'database', return_value=(
                    '123' if failure == 'receipt-system' else '7686901100561231906')))
                stack.enter_context(patch.object(OWNER, 'read_replay_inputs', return_value=(original, keys)))
                stack.enter_context(patch.object(OWNER, 'credential_material', return_value=material()))
                if failure:
                    with self.assertRaises((Refused, ConfigurationRefused)):
                        OWNER.prepared_inputs({'activation-config.template.json': template})
                else:
                    credentials, config, replay = OWNER.prepared_inputs({'activation-config.template.json': template})
                    self.assertEqual(credentials, material())
                    self.assertEqual(config['publicCheckout']['maximumAmountKobo'], 10000)
                    self.assertEqual(config['background']['evidence']['webhookSecret'], provider)
                    self.assertEqual(replay['receiptKey'], intake['encryptionKey'])
                    self.assertNotIn('prefundedReplay', replay)

    def test_sql_has_passwords_only_on_initial_not_retry_and_refuses_partial_roles(self):
        source = "SELECT __OWNER_INPUT__::jsonb;"
        initial = OWNER.render_sql(source, material(), 0)
        retry = OWNER.render_sql(source, material(), 3)
        self.assertIn('"mode":"initial"', initial)
        self.assertIn('"treasuryPassword"', initial)
        self.assertIn('"mode":"retry"', retry)
        for password in material()['passwords'].values():
            self.assertNotIn(password, retry)
        for count in (1, 2, 4, True, None):
            with self.assertRaises(Refused):
                OWNER.render_sql(source, material(), count)

    def test_generates_private_material_once_and_does_not_adopt_foreign_shape(self):
        with tempfile.TemporaryDirectory() as directory, patch.object(OWNER, 'DIRECTORY', Path(directory)):
            with patch.object(OWNER, 'save_exact') as save:
                created = OWNER.credential_material()
            self.assertEqual(set(created), set(material()))
            self.assertEqual(len(set(created['passwords'].values())), 3)
            self.assertEqual(save.call_count, 1)
            path = Path(directory) / 'runtime-credentials.json'
            path.touch()
            with patch.object(OWNER, 'read_file', return_value=json.dumps(created).encode()), patch.object(OWNER, 'save_exact'):
                self.assertEqual(OWNER.credential_material(), created)
            created['expiresAt'] = '2099-01-01T00:00:00Z'
            with patch.object(OWNER, 'read_file', return_value=json.dumps(created).encode()):
                with self.assertRaises(Refused):
                    OWNER.credential_material()

    def run_owner(self, *, failed_check=False, failed_database=False, login_count=0):
        contents = {name: b'fixture' for name in OWNER.FILES}
        contents['runtime-credentials-owner.sql'] = b'SELECT __OWNER_INPUT__::jsonb;'
        manifest = {name: hashlib.sha256(content).hexdigest() for name, content in contents.items()}
        outputs = {
            '--check': dict(status='configuration-checked', databaseContacted=False, cardPaymentsEnabled=False),
            '--connect': dict(status='restricted-tls-ready', profiles=['worker', 'authorizer', 'evidence'],
                              readOnly=True, cardPaymentsEnabled=False),
        }
        def read(path, *_):
            if path.name == 'manifest.json':
                return json.dumps(manifest).encode()
            if path.name == 'activation.prepared.json':
                return b'{}'
            return contents[path.name]
        def cli(arguments, **_):
            if failed_check and '--check' in arguments:
                raise Refused('Runtime command refused')
            return json.dumps(outputs[arguments[2]])
        stream = io.StringIO()
        with tempfile.TemporaryDirectory() as directory, ExitStack() as stack:
            stack.enter_context(patch.object(OWNER, 'DIRECTORY', Path(directory)))
            stack.enter_context(patch.object(OWNER.os, 'geteuid', return_value=0))
            stack.enter_context(patch.object(OWNER.sys, 'argv', ['runtime-preparation-owner.py']))
            stack.enter_context(patch.object(OWNER, 'root_ancestors'))
            stack.enter_context(patch.object(OWNER, 'private_directory'))
            stack.enter_context(patch.object(OWNER, 'read_file', side_effect=read))
            stack.enter_context(patch.object(OWNER, 'prepared_inputs', return_value=(material(), {}, {})))
            original_fstat = os.fstat
            def fstat(descriptor):
                fields = list(original_fstat(descriptor))
                fields[4] = 0
                return os.stat_result(fields)
            stack.enter_context(patch.object(OWNER.os, 'fstat', side_effect=fstat))
            stack.enter_context(patch.object(OWNER, 'command', side_effect=cli))
            stack.enter_context(patch.object(OWNER, 'probe', return_value={'roleCount': 3, 'loginCount': login_count}))
            db = stack.enter_context(patch.object(OWNER, 'database'))
            if failed_database:
                db.side_effect = RuntimeError('password=do-not-print')
            saved = stack.enter_context(patch.object(OWNER, 'save_exact'))
            with redirect_stdout(stream):
                exit_code = OWNER.main()
        return exit_code, json.loads(stream.getvalue()), db, saved

    def test_prepares_credentials_without_enabling_or_starting_any_service(self):
        exit_code, result, db, saved = self.run_owner()
        self.assertEqual(exit_code, 0)
        self.assertEqual(result['status'], 'restricted-runtime-prepared')
        for flag in ('cardPaymentsEnabled', 'prefundedReplayEnabled', 'liveReplayUpdated', 'servicesStarted'):
            self.assertFalse(result[flag])
        self.assertEqual(db.call_count, 1)
        self.assertIn('replay-base.prepared.json', [call.args[0].name for call in saved.call_args_list])

    def test_invalid_configuration_never_touches_database(self):
        exit_code, result, db, _saved = self.run_owner(failed_check=True)
        self.assertEqual(exit_code, 1)
        self.assertEqual(result['stage'], 'configuration-preflight')
        self.assertFalse(result['databasePrepared'])
        db.assert_not_called()

    def test_uncertain_apply_keeps_secrets_redacted_and_does_not_publish_replay(self):
        exit_code, result, _db, saved = self.run_owner(failed_database=True)
        self.assertEqual(exit_code, 1)
        self.assertEqual(result['stage'], 'database-apply-unconfirmed')
        self.assertIsNone(result['databasePrepared'])
        self.assertNotIn('do-not-print', json.dumps(result))
        self.assertNotIn('replay-base.prepared.json', [call.args[0].name for call in saved.call_args_list])


if __name__ == '__main__':
    unittest.main()

import copy
import importlib.util
import json
from datetime import datetime, timezone
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 3, 1, tzinfo=timezone.utc)
FIXTURE_SPECIFICATION = importlib.util.spec_from_file_location('complete_artifact_fixture', HERE / 'artifact.test.py')
artifact_fixture = importlib.util.module_from_spec(FIXTURE_SPECIFICATION)
FIXTURE_SPECIFICATION.loader.exec_module(artifact_fixture)


def load_candidate():
    specification = importlib.util.spec_from_file_location('complete_candidate_tests', HERE / 'candidate.py')
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


class CandidateTests(unittest.TestCase):
    def setUp(self):
        self.module = load_candidate()
        self.contract = self.module.contract
        self.private = json.dumps({'scope': self.contract.FACTORY_SCOPE,
                                   'evidence': {}, 'database': {}}).encode()
        self.bundle = b'synthetic-unchanged-factory-bytes'
        self.base = dict(environment='staging', appSystemId=self.contract.APP_SYSTEM,
                         receiptSystemId=self.contract.RECEIPT_SYSTEM, receiptKey='unchanged-key',
                         appToken='unchanged-app-token', receiptToken='old-private-token',
                         prefundedReplay=dict(bundleSha256=self.contract.sha(self.bundle),
                                              configurationSha256=self.contract.sha(self.private)))
        self.paid = dict(host=self.contract.HOST, port=5432, database='postgres',
                         role='prefunded_treasury_operator', password='synthetic-private-password',
                         integrationId=self.contract.INTEGRATION, businessId=self.contract.BUSINESS,
                         ssl={'ca': 'synthetic-certificate-authority'})
        self.interest = self.contract.serialize({**{name: value for name, value in self.base.items()
                                                   if name != 'prefundedReplay'},
                                                'financialDatabase': self.paid})
        self.files = {'code/replay-daemon.mjs': b'synthetic-old-daemon',
                      'code/prefunded-replay-bundle.mjs': self.bundle,
                      'config/config.json': self.contract.serialize(self.base),
                      'config/prefunded.json': self.private}
        self.token = 'synthetic-parent-supplied-token-not-signed-evidence'
        self.proof = dict(tokenSha256=self.contract.sha(self.token.encode()), signatureVerified=True,
                          claims=dict(role='pvb_staging_worker', aud='pvb-staging-receipts',
                                      iat=int(NOW.timestamp()), exp=self.contract.EXPIRY,
                                      replay_claimant_generation=self.contract.GENERATION))
        self.private_pins = dict(PREDECESSOR_FILES={name: self.contract.sha(content)
                                                 for name, content in self.files.items()},
                                 INTEREST_CONFIG_SHA256=self.contract.sha(self.interest))
        with patch.multiple(self.contract, **self.private_pins):
            self.artifact_files, artifact_pins = artifact_fixture.fixture(self.contract)
        self.private_pins.update(artifact_pins)
        self.daemon = self.artifact_files['replay-daemon.mjs']

    def prepare(self, *, files=None, proof=None, interest=None):
        proof = self.proof if proof is None else proof
        with patch.multiple(self.contract, **self.private_pins), patch.object(self.contract, 'datetime') as clock:
            clock.now.return_value = NOW
            return self.module.prepare_candidate(
                self.files if files is None else files,
                self.interest if interest is None else interest,
                self.artifact_files, self.token,
                proof, self.contract.digest(proof))

    def test_adds_only_paid_connection_and_parent_token_preserving_private_factory_bytes(self):
        result = self.prepare()
        output = result['files']
        self.assertEqual(output['config/prefunded.json'], self.private)
        self.assertEqual(output['code/prefunded-replay-bundle.mjs'], self.bundle)
        outer = json.loads(output['config/config.json'])
        self.assertEqual(outer['paidInterestDatabase'], self.paid)
        self.assertEqual(outer['receiptToken'], self.token)
        for name in set(self.base) - {'receiptToken'}:
            self.assertEqual(outer[name], self.base[name])
        self.assertNotIn('financialDatabase', outer)
        self.assertNotIn('interestAccrualSigningSecret', outer)

    def test_seal_is_sanitized_inactive_and_forbids_unfenced_recovery(self):
        seal = self.prepare()['seal']
        serialized = self.contract.serialize(seal).decode()
        self.assertNotIn(self.token, serialized)
        self.assertNotIn(self.paid['password'], serialized)
        self.assertFalse(seal['automaticPredecessorRestartAllowed'])
        self.assertFalse(seal['unfencedSqlRollbackAllowed'])
        self.assertEqual(seal['status'], 'source-candidate-inactive')

    def test_missing_generation_or_wrong_role_audience_expiry_refuses(self):
        for field, value in (('replay_claimant_generation', None), ('role', 'authenticated'),
                             ('aud', 'authenticated'), ('exp', 1791302351), ('iat', True)):
            with self.subTest(field=field):
                proof = copy.deepcopy(self.proof)
                proof['claims'][field] = value
                with self.assertRaises(ValueError):
                    self.prepare(proof=proof)

    def test_signature_not_verified_or_wrong_token_hash_refuses(self):
        for field, value in (('signatureVerified', False), ('tokenSha256', '0' * 64)):
            with self.subTest(field=field):
                proof = copy.deepcopy(self.proof)
                proof[field] = value
                with self.assertRaises(ValueError):
                    self.prepare(proof=proof)

    def test_changed_private_or_bundle_or_predecessor_config_refuses(self):
        for name in self.files:
            with self.subTest(name=name):
                files = {**self.files, name: self.files[name] + b'changed'}
                with self.assertRaisesRegex(ValueError, 'predecessor_file_pin_refused'):
                    self.prepare(files=files)

    def test_foreign_paid_scope_refuses_even_with_test_private_source_pin(self):
        interest = json.loads(self.interest)
        interest['financialDatabase']['businessId'] = 'foreign-business'
        changed = self.contract.serialize(interest)
        self.private_pins['INTEREST_CONFIG_SHA256'] = self.contract.sha(changed)
        with self.assertRaisesRegex(ValueError, 'paid_interest_scope_refused'):
            self.prepare(interest=changed)

    def test_duplicate_config_keys_refuse_with_sanitized_error(self):
        changed = b'{"environment":"staging","environment":"staging"}'
        self.private_pins['INTEREST_CONFIG_SHA256'] = self.contract.sha(changed)
        with self.assertRaisesRegex(ValueError, '^private_json_refused$'):
            self.prepare(interest=changed)

    def test_claim_proof_pin_mismatch_refuses(self):
        with patch.multiple(self.contract, **self.private_pins), patch.object(self.contract, 'datetime') as clock:
            clock.now.return_value = NOW
            with self.assertRaisesRegex(ValueError, 'parent_claim_proof_pin_refused'):
                self.module.prepare_candidate(self.files, self.interest, self.artifact_files,
                    self.token, self.proof, '0' * 64)

    def test_factory_scope_uses_the_existing_six_field_environment_abi(self):
        self.assertEqual(set(self.contract.FACTORY_SCOPE), {'environment', 'integrationId', 'businessId',
            'expectedSystemId', 'merchantId', 'treasuryBindingId'})
        self.assertEqual(self.contract.FACTORY_SCOPE['environment'], 'staging')

    def test_old_half_capability_daemon_cannot_be_a_reviewed_candidate(self):
        self.artifact_files['replay-daemon.mjs'] = self.files['code/replay-daemon.mjs']
        with self.assertRaisesRegex(ValueError, 'reviewed_complete_daemon_required'):
            self.prepare()

    def test_seal_scope_does_not_mutate_the_pinned_contract(self):
        result = self.prepare()
        result['seal']['factoryScope']['businessId'] = 'foreign'
        self.assertEqual(self.contract.FACTORY_SCOPE['businessId'], self.contract.BUSINESS)

    def test_public_arbitrary_daemon_digest_override_is_rejected(self):
        with patch.multiple(self.contract, **self.private_pins), patch.object(self.contract, 'datetime') as clock:
            clock.now.return_value = NOW
            with self.assertRaises(TypeError):
                self.module.prepare_candidate(
                    predecessor_files=self.files, interest_outer=self.interest,
                    daemon=self.daemon, reviewed_daemon_sha256=self.contract.sha(self.daemon),
                    parent_receipt_token=self.token, parent_claim_proof=self.proof,
                    reviewed_claim_proof_sha256=self.contract.digest(self.proof))

    def test_new_seal_contains_exact_artifact_closure_and_no_generated_factory_output(self):
        result = self.prepare()
        self.assertEqual(result['seal']['daemonArtifact'], self.private_pins['DAEMON_ARTIFACT'])
        self.assertEqual(set(result['files']), set(self.files))
        self.assertEqual(result['files']['code/prefunded-replay-bundle.mjs'], self.bundle)

    def test_generated_factory_in_candidate_artifact_is_rejected(self):
        self.artifact_files['prefunded-replay-bundle.mjs'] = b'old-uncorrected-generated-factory'
        with self.assertRaisesRegex(ValueError, 'artifact_file_set_refused'):
            self.prepare()


if __name__ == '__main__':
    unittest.main()

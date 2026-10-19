import base64
import hashlib
import hmac
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


DIRECTORY = Path(__file__).resolve().parent
sys.path.insert(0, str(DIRECTORY.parent))
spec = importlib.util.spec_from_file_location('readonly_contract', DIRECTORY / 'contract.py')
contract = importlib.util.module_from_spec(spec)
spec.loader.exec_module(contract)


def token(secret, claims):
    def encode(value):
        return base64.urlsafe_b64encode(json.dumps(value).encode()).decode().rstrip('=')
    head = encode({'alg': 'HS256', 'typ': 'JWT'}) + '.' + encode(claims)
    signature = base64.urlsafe_b64encode(hmac.new(secret.encode(), head.encode(), hashlib.sha256).digest())
    return head + '.' + signature.decode().rstrip('=')


class ContractTests(unittest.TestCase):
    def auth(self, claims):
        secret = 'x' * 64
        content = contract.serialized({'url': 'https://staging-auth.ogabassey.com', 'key': token(secret, claims)})
        observed = {'Name': '/baci-isolated-savings-auth-1', 'State': {'Running': True}, 'Config': {
            'Labels': {'com.docker.compose.project': 'baci-isolated-savings', 'com.docker.compose.service': 'auth'},
            'Env': ['GOTRUE_JWT_SECRET=' + secret,
                    'GOTRUE_JWT_ISSUER=https://staging-auth.ogabassey.com/auth/v1']}}
        return content, observed

    def test_anon_proof_accepts_signed_anon_covering_entire_lease(self):
        content, observed = self.auth({'role': 'anon', 'exp': contract.DEADLINE_EPOCH})
        with patch.object(contract, 'ANON', contract.digest(content)):
            contract.prove_anon(content, observed, contract.DEADLINE_EPOCH - 1)

    def test_anon_proof_rejects_expired_privileged_and_not_yet_valid_claims(self):
        for claims in ({'role': 'anon', 'exp': contract.DEADLINE_EPOCH - 1},
                       {'role': 'service_role', 'exp': contract.DEADLINE_EPOCH},
                       {'role': 'anon', 'exp': contract.DEADLINE_EPOCH, 'nbf': contract.DEADLINE_EPOCH}):
            content, observed = self.auth(claims)
            with patch.object(contract, 'ANON', contract.digest(content)), self.assertRaises(contract.Refused):
                contract.prove_anon(content, observed, contract.DEADLINE_EPOCH - 1)

    def test_anon_proof_rejects_wrong_signature_issuer_and_inactive_auth(self):
        content, observed = self.auth({'role': 'anon', 'exp': contract.DEADLINE_EPOCH})
        for mutate in (lambda value: value['Config']['Env'].__setitem__(0, 'GOTRUE_JWT_SECRET=' + 'y' * 64),
                       lambda value: value['Config']['Env'].__setitem__(1, 'GOTRUE_JWT_ISSUER=https://other.test'),
                       lambda value: value['State'].__setitem__('Running', False)):
            current = json.loads(json.dumps(observed))
            mutate(current)
            with patch.object(contract, 'ANON', contract.digest(content)), self.assertRaises(contract.Refused):
                contract.prove_anon(content, current, contract.DEADLINE_EPOCH - 1)

    def test_renewal_changes_only_three_checkout_expiries(self):
        value = {'expiresAt': contract.OLD_DEADLINE, 'maximumAmountKobo': 10000,
                 'checkout': {'scope': {'expiresAt': contract.OLD_DEADLINE, 'customer': 'unchanged'},
                              'provider': {'expiresAt': contract.OLD_DEADLINE, 'secret': 'unchanged'}}}
        source, checkout = b'activation', contract.serialized(value)
        with patch.object(contract, 'ACTIVATION', contract.digest(source)), \
             patch.object(contract, 'CHECKOUT', contract.digest(checkout)), \
             patch.object(contract.public_projection, 'project_checkout', return_value=checkout):
            result = contract.parsed(contract.renew_checkout(source, checkout))
        result['expiresAt'] = contract.OLD_DEADLINE
        result['checkout']['scope']['expiresAt'] = contract.OLD_DEADLINE
        result['checkout']['provider']['expiresAt'] = contract.OLD_DEADLINE
        self.assertEqual(result, value)

    def test_config_pin_drift_is_refused_before_projection(self):
        with patch.object(contract.public_projection, 'project_checkout') as projection:
            with self.assertRaises(contract.Refused):
                contract.renew_checkout(b'drift', b'drift')
        projection.assert_not_called()

    def test_unknown_checkout_scope_is_refused(self):
        source, checkout = b'activation', b'{"expiresAt":"2026-09-29T15:59:10Z","changed":true}'
        with patch.object(contract, 'ACTIVATION', contract.digest(source)), \
             patch.object(contract, 'CHECKOUT', contract.digest(checkout)), \
             patch.object(contract.public_projection, 'project_checkout', return_value=b'{}'), \
             self.assertRaises(contract.Refused):
            contract.renew_checkout(source, checkout)

    def test_units_only_change_fixed_stop_date_and_exec_condition(self):
        expected = {name: content.encode() for name, content in contract.public_service_contract.units().items()}
        candidate = contract.renewed_units()
        candidate['baci-prefunded-public.service'] = candidate['baci-prefunded-public.service'].replace(
            b'1791302350', b'1790697550')
        candidate['baci-prefunded-public-deadline.timer'] = candidate['baci-prefunded-public-deadline.timer'].replace(
            b'2026-10-06 15:59:10 UTC', b'2026-09-29 15:59:10 UTC')
        self.assertEqual(candidate, expected)

    def test_units_refuse_unexpected_predecessor(self):
        with patch.object(contract.public_service_contract, 'units', return_value={
                'baci-prefunded-public.service': 'unexpected',
                'baci-prefunded-public-deadline.timer': 'unexpected'}), self.assertRaises(contract.Refused):
            contract.renewed_units()

    def test_json_rejects_duplicates_and_nonfinite_numbers(self):
        for content in (b'{"enabled":false,"enabled":true}', b'{"amount":NaN}', b'{"amount":Infinity}'):
            with self.assertRaises(contract.Refused):
                contract.parsed(content)

    def test_readonly_environment_rejects_inherited_mutation_flag(self):
        contract.prove_mutations_off(['PATH=/usr/local/bin:/usr/bin:/bin', 'NODE_VERSION=24'])
        for value in ('true', 'false', 'TRUE', ''):
            with self.assertRaises(contract.Refused):
                contract.prove_mutations_off(['PATH=/usr/bin',
                    'PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=' + value])

    def test_protected_snapshot_retains_roles_functions_constraints_and_indexes(self):
        state = dict(goalId=contract.GOAL, principalKobo=10000, treasuryBudgetKobo=10000,
            treasuryReservedKobo=0, treasuryConsumedKobo=0, treasuryAvailableKobo=10000,
            retiredIntentPhase='retired_unconfirmed', retiredIntentAmountKobo=10000,
            otherIntentCount=0, otherOperationCount=0, retirementAuditCount=1, newPaymentStarted=False,
            retiredOperation={'id': 'd8bcf921-61b3-4647-90e2-5648e4d6967d', 'retired': True,
                'collection': 'pending', 'transfer': 'not_started', 'projection': 'unapplied'})
        roles = [dict(name=name, present=True, login=True, unsafe=False, expiresAt='unchanged')
            for name in ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence')]
        snapshot = dict(systemIdentifier='7685292944002592802', readOnly=True, state=state,
            roles=roles, functions=[{'owner': 'postgres', 'acl': 'unchanged'}],
            constraints=[{'definitionSha256': 'unchanged'}], indexes=[{'name': 'unchanged'}])
        self.assertIs(contract.prove_protected_state(snapshot), snapshot)
        for field in ('roles', 'functions', 'constraints', 'indexes'):
            changed = json.loads(json.dumps(snapshot))
            changed[field][0]['drift'] = True
            self.assertNotEqual(contract.prove_protected_state(changed), snapshot)
        snapshot['roles'][0]['unsafe'] = True
        with self.assertRaises(contract.Refused):
            contract.prove_protected_state(snapshot)

    def test_protected_snapshot_refuses_incomplete_metadata(self):
        with self.assertRaises(contract.Refused):
            contract.prove_protected_state({'systemIdentifier': '7685292944002592802', 'state': {}})

    def test_receipt_uses_installed_retirement_artifact_not_initial_container_label(self):
        value = dict(archiveSha256=contract.OLD_ARCHIVE, manifestSha256=contract.OLD_MANIFEST,
                     deadline=contract.OLD_DEADLINE)
        content = contract.serialized(value)
        with patch.object(contract, 'RECEIPT', contract.digest(content)):
            self.assertEqual(contract.prove_receipt(content), value)
        value['manifestSha256'] = contract.CONTAINER_MANIFEST
        content = contract.serialized(value)
        with patch.object(contract, 'RECEIPT', contract.digest(content)), self.assertRaises(contract.Refused):
            contract.prove_receipt(content)


if __name__ == '__main__':
    unittest.main()

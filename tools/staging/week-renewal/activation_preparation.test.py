import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch

import renewal_contract as contract
import renewal_owner as owner
import activation_preparation as validator


SPEC = importlib.util.spec_from_file_location('contract_fixture', Path(__file__).with_name('renewal_contract.test.py'))
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
NOW = FIXTURE.NOW


class ActivationPreparationTests(unittest.TestCase):
    def setUp(self):
        self.contents = FIXTURE.fixture()
        fixture_pins = {path: contract.digest(content) for path, content in self.contents.items()}
        for module in (contract, owner, validator):
            handle = patch.object(module, 'PINS', fixture_pins)
            handle.start()
            self.addCleanup(handle.stop)
        self.prepared = contract.candidates(self.contents, NOW)
        self.metadata = {path: type('Metadata', (), {'st_uid': 0, 'st_gid': 0, 'st_mode': mode,
                                                     'st_size': len(content), 'st_nlink': 1})()
                         for path, content in self.contents.items()
                         for mode in (0o100644 if path.startswith(contract.UNIT_DIRECTORY) else 0o100440,)}
        self.metadata[contract.FUNDING_ENV].st_mode = 0o100600
        report = ('a' * 64, {
            'physicalSystems': [contract.SYSTEM, contract.RECEIPT_SYSTEM], 'principalKobo': 10000,
            'treasuryReservedKobo': 0, 'treasuryConsumedKobo': 0, 'treasuryApprovedKobo': 10000,
            'oldIntentRetained': True, 'replayJwtExpiryUnverified': [contract.OLD_EPOCH],
            'replayJwtCoversTargetUnverified': False,
        })
        states = {}
        units = [path.rsplit('/', 1)[-1] for path in contract.PINS if path.startswith(contract.UNIT_DIRECTORY)]
        for name in units + list(contract.PROTECTED_SERVICES) + list(contract.PROTECTED_TIMERS):
            state = {'LoadState': 'loaded', 'ActiveState': 'inactive', 'SubState': 'dead',
                     'FragmentPath': contract.UNIT_DIRECTORY + name, 'DropInPaths': '',
                     'NeedDaemonReload': 'no', 'UnitFileState': 'static'}
            if name.endswith('.service'):
                state['MainPID'] = '0'
            states[name] = state
        for name in contract.PROTECTED_CONTAINERS:
            states[name] = {'running': False, 'restarting': False, 'restartPolicy': 'no'}
        self.originals, self.receipt = owner.preparation_record(
            None, self.contents, self.metadata, self.prepared, report, states, NOW)
        self.expected = hashlib.sha256(self.receipt).hexdigest()

    def validate(self, receipt=None, originals=None, candidates=None, expected_hash=None):
        return validator.validate_preparation(
            self.receipt if receipt is None else receipt,
            self.originals if originals is None else originals,
            self.prepared if candidates is None else candidates,
            expected_sha256=self.expected if expected_hash is None else expected_hash)

    def test_accepts_complete_preparation_and_returns_only_redacted_metadata(self):
        result = self.validate()
        self.assertEqual(result, {
            'stage': 'lane-a-preparation', 'status': 'prepared-review-required',
            'receiptSha256': self.expected, 'preparedAtEpochMs': NOW,
            'requestedServiceDeadline': contract.TARGET,
            'requestedGatewayDeadline': contract.GATEWAY_TARGET,
            'sourceCount': len(contract.PINS), 'candidateCount': len(self.prepared),
            'principalKobo': 10000, 'treasuryApprovedKobo': 10000,
            'treasuryReservedKobo': 0, 'treasuryConsumedKobo': 0,
            'oldIntentRetained': True, 'activationReady': False,
            'renewalApplied': False, 'liveChangesMade': False, 'newPaymentStarted': False,
        })
        self.assertNotIn('observedStates', result)
        self.assertNotIn('never-print-secret', json.dumps(result))

    def test_rejects_owner_receipt_hash_mismatch(self):
        with self.assertRaises(contract.Refused):
            self.validate(expected_hash='0' * 64)
        with self.assertRaises(contract.Refused):
            validator.validate_preparation(self.receipt, self.originals, self.prepared)

    def test_rejects_duplicate_json_keys_and_wrong_record_shape(self):
        duplicate = self.receipt[:-1] + b',"status":"prepared-review-required"}'
        with self.assertRaises(contract.Refused):
            self.validate(receipt=duplicate, expected_hash=hashlib.sha256(duplicate).hexdigest())
        value = json.loads(self.receipt)
        value['unexpected'] = True
        changed = contract.canonical(value)
        with self.assertRaises(contract.Refused):
            self.validate(receipt=changed, expected_hash=hashlib.sha256(changed).hexdigest())

    def test_rejects_original_pin_drift_candidate_byte_drift_and_financial_drift(self):
        altered = dict(self.originals)
        key = next(iter(altered))
        altered[key] += b'changed'
        with self.assertRaises(contract.Refused):
            self.validate(originals=altered)
        altered_candidates = dict(self.prepared)
        altered_candidates['baci-savings-drafts.service'] += b'changed'
        with self.assertRaises(contract.Refused):
            self.validate(candidates=altered_candidates)
        value = json.loads(self.receipt)
        value['invariants']['principalKobo'] = 1
        changed = contract.canonical(value)
        with self.assertRaises(contract.Refused):
            self.validate(receipt=changed, expected_hash=hashlib.sha256(changed).hexdigest())

    def test_rejects_crossed_or_duplicate_source_and_candidate_records(self):
        value = json.loads(self.receipt)
        value['sources'][1]['path'] = value['sources'][0]['path']
        changed = contract.canonical(value)
        with self.assertRaises(contract.Refused):
            self.validate(receipt=changed, expected_hash=hashlib.sha256(changed).hexdigest())
        altered = dict(self.prepared)
        altered['gateway.service'] = b'crossed'
        with self.assertRaises(contract.Refused):
            self.validate(candidates=altered)


if __name__ == '__main__':
    unittest.main()

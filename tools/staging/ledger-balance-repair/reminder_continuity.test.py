import copy
import importlib.util
import json
from pathlib import Path
import unittest


SPEC = importlib.util.spec_from_file_location('reminder_continuity',
    Path(__file__).with_name('reminder_continuity.py'))
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def snapshots():
    previous = dict(capturedAt='before', tableRows={MODULE.RELATION: dict(MODULE.HISTORICAL),
        'auth.users': {'sha256': 'unchanged'}},
        allowedTargetWitnesses={MODULE.RELATION: {'targetCount': 0}},
        permanentMetadataSha256='unchanged', identity={'database': 'isolated'})
    current = copy.deepcopy(previous)
    current['capturedAt'] = 'after'
    current['tableRows'][MODULE.RELATION] = dict(MODULE.CURRENT)
    current['allowedTargetWitnesses'][MODULE.RELATION] = json.loads(
        Path(__file__).with_name('notification-witness.fixture.json').read_text())
    return previous, current


class ReminderContinuityTests(unittest.TestCase):
    def verify(self, previous, current, proof):
        return MODULE.normalize(previous, current, proof)

    def test_accepts_only_proven_two_insertions_without_mutating_actual_snapshot(self):
        previous, current = snapshots()
        original = copy.deepcopy(current)
        self.assertEqual(MODULE.witness_digest(current['allowedTargetWitnesses'][MODULE.RELATION]),
                         MODULE.WITNESS_SHA)
        normalized = self.verify(previous, current, MODULE.EXPECTED_PROOF)
        self.assertEqual(normalized['tableRows'], previous['tableRows'])
        self.assertEqual(normalized['allowedTargetWitnesses'], previous['allowedTargetWitnesses'])
        self.assertEqual(current, original)
        self.assertEqual(current['tableRows'][MODULE.RELATION]['count'], 8)

    def test_wrong_current_or_historical_event_rows_refuse(self):
        for target, field, changed in (('previous', 'count', 5), ('current', 'count', 9),
            ('current', 'sha256', 'foreign'), ('current', 'oid', 1)):
            previous, current = snapshots()
            (previous if target == 'previous' else current)['tableRows'][MODULE.RELATION][field] = changed
            with self.assertRaises(ValueError):
                self.verify(previous, current, MODULE.EXPECTED_PROOF)

    def test_missing_unknown_or_changed_proof_refuses(self):
        previous, current = snapshots()
        for proof in ({}, dict(MODULE.EXPECTED_PROOF, extra=True),
            dict(MODULE.EXPECTED_PROOF, kind='arbitrary-rebaseline')):
            with self.assertRaises(ValueError):
                self.verify(previous, current, proof)
        proof = copy.deepcopy(MODULE.EXPECTED_PROOF)
        proof['database']['reminders'][0]['rowSha256'] = 'changed'
        with self.assertRaises(ValueError):
            self.verify(previous, current, proof)
        for key, value in (('id', 'foreign'), ('rowSha256', 'foreign')):
            altered = copy.deepcopy(MODULE.EXPECTED_PROOF)
            altered['database']['reminders'][0][key] = value
            with self.assertRaises(ValueError):
                self.verify(previous, current, altered)

    def test_actual_witness_digest_change_refuses(self):
        previous, current = snapshots()
        witness = current['allowedTargetWitnesses'][MODULE.RELATION]
        for key in witness:
            altered = copy.deepcopy(current)
            altered['allowedTargetWitnesses'][MODULE.RELATION][key] = 'changed'
            with self.subTest(key=key), self.assertRaises(ValueError):
                MODULE.normalize(previous, altered, MODULE.EXPECTED_PROOF)

    def test_unrelated_drift_remains_visible_for_full_baseline_comparison(self):
        previous, current = snapshots()
        current['tableRows']['auth.users']['sha256'] = 'changed'
        current['permanentMetadataSha256'] = 'changed'
        normalized = self.verify(previous, current, MODULE.EXPECTED_PROOF)
        self.assertEqual(normalized['tableRows']['auth.users']['sha256'], 'changed')
        self.assertEqual(normalized['permanentMetadataSha256'], 'changed')
        self.assertNotEqual(normalized['tableRows'], previous['tableRows'])


if __name__ == '__main__':
    unittest.main()

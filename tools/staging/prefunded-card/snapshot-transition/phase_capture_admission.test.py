import copy
from pathlib import Path
import runpy
import unittest
from unittest.mock import patch

import snapshot_transition

from phase_capture_admission import admit

FIXTURE = runpy.run_path(str(Path(__file__).with_name('current_renewal_proof.test.py')))


class PhaseAdmissionTests(unittest.TestCase):
    def test_only_capture_time_can_refresh_an_explicitly_reviewed_complete_prestart_state(self):
        unused_manifest, unused_seal, approved, current, unused_history, unused_origins = FIXTURE['fixture']()
        self.assertIs(admit(current, approved, phase='prestart'), current)

    def test_each_protected_table_change_refuses_instead_of_self_approving_a_fresh_capture(self):
        unused_manifest, unused_seal, approved, current, unused_history, unused_origins = FIXTURE['fixture']()
        for table in current['capture']['protected']['tables']:
            changed = copy.deepcopy(current)
            changed['capture']['protected']['tables'][table]['count'] += 1
            with self.subTest(table=table), self.assertRaises(ValueError):
                admit(changed, approved, phase='prestart')

    def test_schema_acl_credentials_or_binding_identity_drift_refuses(self):
        unused_manifest, unused_seal, approved, current, unused_history, unused_origins = FIXTURE['fixture']()
        for key in ('executorFingerprint', 'roles', 'sourceOrigins', 'metadata'):
            changed = copy.deepcopy(current)
            changed[key] = {} if isinstance(changed[key], dict) else 'changed'
            with self.subTest(key=key), self.assertRaises((ValueError, KeyError)):
                admit(changed, approved, phase='prestart')

    def test_later_phase_cannot_refresh_the_baseline_without_the_exact_authorized_receipt(self):
        unused_manifest, unused_seal, approved, current, unused_history, unused_origins = FIXTURE['fixture']()
        for phase in ('preschedule', 'public-mutation'):
            changed = copy.deepcopy(current)
            changed['phase'] = phase
            with self.subTest(phase=phase), self.assertRaisesRegex(ValueError, 'transition_required'):
                admit(changed, approved, phase=phase)

    def test_preschedule_requires_revalidation_of_the_exact_complete_snapshot_transition(self):
        fixture = FIXTURE['FIXTURE']
        before, after = fixture['pair']()
        unused_manifest, unused_seal, approved, current, unused_history, unused_origins = FIXTURE['fixture']()
        approved['capture'] = before
        FIXTURE['refresh'](approved)
        current = copy.deepcopy(approved)
        current.update(phase='preschedule', capture=after)
        FIXTURE['refresh'](current)
        receipt = fixture['validate'](before, after)
        snapshot = next(row for row in after['snapshots']['rows'] if row['sequence_number'] == 8)
        transition = {'before': before, 'after': after, 'receipt': receipt, 'snapshot': snapshot}
        with patch.object(snapshot_transition, 'SEAL', fixture['SEAL']):
            self.assertIs(admit(current, approved, phase='preschedule', transition=transition,
                seal_manifest=fixture['MANIFEST']), current)
            changed = copy.deepcopy(transition)
            changed['receipt']['transitionSha256'] = '0' * 64
            with self.assertRaisesRegex(ValueError, 'receipt_drift'):
                admit(current, approved, phase='preschedule', transition=changed,
                    seal_manifest=fixture['MANIFEST'])


if __name__ == '__main__':
    unittest.main()

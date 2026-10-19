import copy
from datetime import datetime, timezone
import unittest
from types import SimpleNamespace

from financial_snapshot_step import perform


class SnapshotStepTest(unittest.TestCase):
    def run_step(self, *, fail_validation=False, fail_save=None, drift=False):
        adapter = SimpleNamespace(payment_before={'sha256': 'original'}, passes={})
        captures = iter([{'protected': {'sha256': 'drift' if drift else 'original'}},
                         {'protected': {'sha256': 'authorized-after'}}])
        saved = {}
        calls = []

        def run_once(kind):
            calls.append(kind)
            adapter.passes[kind] = {'outcome': 'recorded'}

        def save(name, value):
            if name == fail_save:
                raise ValueError('durable-save-failed')
            saved[name] = copy.deepcopy(value)

        def validate(before, after, **arguments):
            if fail_validation:
                raise ValueError('unauthorized-transition')
            self.assertEqual(arguments['seal_manifest'], b'exact-reviewed-seal')
            self.assertEqual(arguments['expected_snapshot'], {'evidence_id': 'actual-row'})
            self.assertEqual(arguments['outcome'], 'recorded')
            self.assertEqual(adapter.payment_before, {'sha256': 'original'})
            return {'status': 'authorized-snapshot-transition', 'baselineAdopted': False}

        def unchanged(original, current):
            if original != current:
                raise ValueError('prepass-drift')

        adapter.run_once = run_once
        try:
            perform(adapter, capture=lambda: next(captures),
                read_expected=lambda: {'evidence_id': 'actual-row'}, validate=validate,
                save=save, prove_unchanged=unchanged, seal_manifest=b'exact-reviewed-seal',
                clock=lambda: datetime(2026, 10, 2, 10, tzinfo=timezone.utc))
        except ValueError as error:
            return adapter, saved, calls, str(error)
        return adapter, saved, calls, None

    def test_adopts_only_after_durable_exact_transition_proof_and_preserves_original(self):
        adapter, saved, calls, error = self.run_step()
        self.assertIsNone(error)
        self.assertEqual(calls, ['snapshot'])
        self.assertEqual(saved['original-protected-baseline'], {'sha256': 'original'})
        self.assertEqual(adapter.payment_before, {'sha256': 'authorized-after'})
        self.assertIs(saved['snapshot-transition-proof']['baselineAdopted'], False)

    def test_failed_validation_keeps_original_baseline(self):
        adapter, saved, calls, error = self.run_step(fail_validation=True)
        self.assertEqual(error, 'unauthorized-transition')
        self.assertEqual(adapter.payment_before, {'sha256': 'original'})
        self.assertNotIn('snapshot-transition-proof', saved)

    def test_failed_durable_save_never_adopts_baseline(self):
        for name in ('snapshot-transition-proof', 'post-snapshot-protected-baseline'):
            with self.subTest(name=name):
                adapter, saved, calls, error = self.run_step(fail_save=name)
                self.assertEqual(error, 'durable-save-failed')
                self.assertEqual(adapter.payment_before, {'sha256': 'original'})

    def test_prepass_drift_refuses_before_starting_snapshot(self):
        adapter, saved, calls, error = self.run_step(drift=True)
        self.assertEqual(error, 'prepass-drift')
        self.assertEqual(calls, [])
        self.assertEqual(saved, {})


if __name__ == '__main__':
    unittest.main()

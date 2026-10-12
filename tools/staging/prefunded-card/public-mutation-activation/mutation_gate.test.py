from contextlib import contextmanager
import importlib.util
from pathlib import Path
import unittest

import mutation_gate as gate
from mutation_contract import EPOCH, GOAL

spec = importlib.util.spec_from_file_location('contract_fixture', Path(__file__).with_name('mutation_contract.test.py'))
fixture = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fixture)


class Adapter:
    seal_sha = fixture.SEAL
    deadline = '2026-10-06T15:59:10Z'

    def __init__(self, failed=None):
        self.events = []
        self.failed = failed
        self.baseline = fixture.snapshot()

    @contextmanager
    def lock(self):
        self.events.append('lock')
        yield

    def operation(self, name):
        self.events.append(name)
        if name == self.failed:
            raise RuntimeError(name)

    def verify_reviewed_inputs(self):
        self.operation('verify-inputs')

    def collect(self):
        self.operation('collect')
        return fixture.evidence()

    def record(self, name, value):
        self.operation('record-' + name)

    def recheck(self, evidence):
        self.operation('recheck')

    def transition(self):
        self.operation('transition')
        return {'status': 'pending'}

    def replace_public(self):
        self.operation('replace')

    def verify_enabled(self):
        self.operation('verify-enabled')

    def capability(self):
        self.operation('capability')
        return 200, {'goalId': GOAL, 'enabled': True, 'maximumAmountKobo': 10000, 'currency': 'NGN'}

    def snapshot(self):
        self.operation('snapshot')
        return fixture.snapshot()

    def recheck_chain(self):
        self.operation('chain')

    def recover(self):
        self.operation('recover')
        return {'status': 'public-readonly-restored'}


class GateTests(unittest.TestCase):
    def test_enable_requires_actual_financial_and_fresh_chain_before_flag_change(self):
        adapter = Adapter()
        report = gate.enable(adapter, now=lambda: fixture.NOW)
        self.assertEqual(adapter.events, ['lock', 'verify-inputs', 'collect', 'record-preflight',
            'recheck', 'transition', 'record-enable-intent', 'replace', 'verify-enabled',
            'capability', 'snapshot', 'chain', 'record-enabled'])
        self.assertTrue(report['mutationsEnabled'])
        self.assertEqual(report['paymentOutcome'], 'not-tested')
        self.assertFalse(report['savedCardsEnabled'])

    def test_missing_actual_financial_report_prevents_any_change(self):
        adapter = Adapter()
        adapter.collect = lambda: {**fixture.evidence(), 'financialReport': None}
        with self.assertRaises(ValueError):
            gate.enable(adapter, now=lambda: fixture.NOW)
        self.assertNotIn('replace', adapter.events)
        self.assertNotIn('recover', adapter.events)

    def test_all_post_attempt_failures_recover_including_partial_create_or_report_write(self):
        for step in ('replace', 'verify-enabled', 'capability', 'snapshot', 'chain', 'record-enabled'):
            adapter = Adapter(step)
            with self.subTest(step=step), self.assertRaises(RuntimeError):
                gate.enable(adapter, now=lambda: fixture.NOW)
            self.assertEqual(adapter.events[-2:], ['recover', 'record-recovery'])

    def test_failed_preflight_or_journal_never_starts_public_mutations(self):
        for step in ('verify-inputs', 'collect', 'record-preflight', 'recheck', 'record-enable-intent'):
            adapter = Adapter(step)
            with self.subTest(step=step), self.assertRaises(RuntimeError):
                gate.enable(adapter, now=lambda: fixture.NOW)
            self.assertNotIn('replace', adapter.events)

    def test_stale_evidence_after_recheck_refuses_before_enable(self):
        adapter = Adapter()
        calls = iter([fixture.NOW, fixture.NOW, fixture.NOW, fixture.NOW + 61])
        with self.assertRaisesRegex(ValueError, 'stale'):
            gate.enable(adapter, now=lambda: next(calls))
        self.assertNotIn('replace', adapter.events)

    def test_cutoff_after_replacement_recovers_without_next_probe(self):
        adapter = Adapter()
        def clock():
            return EPOCH - 600 if 'replace' in adapter.events else fixture.NOW
        with self.assertRaisesRegex(ValueError, 'window'):
            gate.enable(adapter, now=clock)
        self.assertNotIn('verify-enabled', adapter.events)
        self.assertIn('recover', adapter.events)

    def test_keyboard_interrupt_during_partial_replacement_also_recovers(self):
        adapter = Adapter()
        def interrupt():
            raise KeyboardInterrupt()
        adapter.replace_public = interrupt
        with self.assertRaises(KeyboardInterrupt):
            gate.enable(adapter, now=lambda: fixture.NOW)
        self.assertIn('recover', adapter.events)

    def test_recovery_failure_is_unconfirmed_and_preserves_cause(self):
        adapter = Adapter('replace')
        adapter.recover = lambda: {'status': 'unknown'}
        with self.assertRaisesRegex(ValueError, 'recovery_unconfirmed') as caught:
            gate.enable(adapter, now=lambda: fixture.NOW)
        self.assertIsNotNone(caught.exception.__cause__)


if __name__ == '__main__':
    unittest.main()

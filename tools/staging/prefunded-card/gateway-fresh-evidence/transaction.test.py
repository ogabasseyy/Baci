import unittest

from transaction import EvidenceRefresh


class Actions:
    def __init__(self, failure=None):
        self.failure = failure
        self.events = []
        self.evidence = b'old authentic stale evidence'
        self.running = False

    def step(self, name):
        self.events.append(name)
        if self.failure == name:
            raise ValueError(name)

    def guard(self):
        self.step('guard')

    def stopped(self):
        self.step('stopped')
        if self.running:
            raise ValueError('already running')

    def collect(self):
        self.step('collect')
        return b'fresh independently checked evidence'

    def validate(self, candidate):
        self.step('validate')

    def backup(self, candidate):
        self.step('backup')

    def replace(self, candidate):
        self.step('replace')
        self.evidence = candidate

    def start(self):
        self.running = True
        self.step('start')

    def verify(self):
        self.step('verify')

    def stop(self):
        self.step('stop')
        self.running = False

    def restore(self, candidate):
        self.step('restore')
        self.evidence = b'old authentic stale evidence'


class Tests(unittest.TestCase):
    def test_default_preflight_never_backs_up_writes_or_starts(self):
        actions = Actions()
        report = EvidenceRefresh(actions).run()
        self.assertFalse(report['applied'])
        self.assertEqual(actions.events, ['guard', 'stopped', 'collect', 'validate', 'guard'])

    def test_exact_apply_changes_only_evidence_and_starts_after_validation(self):
        actions = Actions()
        report = EvidenceRefresh(actions).run(apply=True)
        self.assertTrue(report['applied'])
        self.assertLess(actions.events.index('backup'), actions.events.index('replace'))
        self.assertLess(actions.events.index('validate'), actions.events.index('start'))
        self.assertEqual(actions.evidence, b'fresh independently checked evidence')
        self.assertTrue(actions.running)

    def test_health_firewall_inventory_or_proof_failure_prevents_install(self):
        for failure in ('guard', 'stopped', 'collect', 'validate', 'backup'):
            with self.subTest(failure=failure):
                actions = Actions(failure)
                with self.assertRaises(ValueError):
                    EvidenceRefresh(actions).run(apply=True)
                self.assertNotIn('start', actions.events)
                self.assertEqual(actions.evidence, b'old authentic stale evidence')

    def test_start_or_401_verification_failure_stops_and_restores_old_bytes_without_restart(self):
        for failure in ('start', 'verify'):
            with self.subTest(failure=failure):
                actions = Actions(failure)
                with self.assertRaisesRegex(ValueError, 'refresh_failed'):
                    EvidenceRefresh(actions).run(apply=True)
                self.assertFalse(actions.running)
                self.assertEqual(actions.events.count('start'), 1)
                self.assertEqual(actions.events[-2:], ['stop', 'restore'])
                self.assertEqual(actions.evidence, b'old authentic stale evidence')

    def test_current_active_gateway_is_not_restarted(self):
        actions = Actions()
        actions.running = True
        with self.assertRaisesRegex(ValueError, 'already running'):
            EvidenceRefresh(actions).run(apply=True)
        self.assertNotIn('replace', actions.events)

    def test_compare_failure_never_starts_or_overwrites_a_different_predecessor(self):
        actions = Actions('replace')
        with self.assertRaisesRegex(ValueError, 'refresh_failed'):
            EvidenceRefresh(actions).run(apply=True)
        self.assertNotIn('start', actions.events)
        self.assertEqual(actions.evidence, b'old authentic stale evidence')

    def test_preserved_source_or_binding_drift_after_replace_restores_without_starting(self):
        class Drift(Actions):
            def guard(self):
                self.events.append('guard')
                if self.events.count('guard') == 4:
                    raise ValueError('preserved source changed')
        actions = Drift()
        with self.assertRaisesRegex(ValueError, 'refresh_failed'):
            EvidenceRefresh(actions).run(apply=True)
        self.assertNotIn('start', actions.events)
        self.assertEqual(actions.evidence, b'old authentic stale evidence')


if __name__ == '__main__':
    unittest.main()

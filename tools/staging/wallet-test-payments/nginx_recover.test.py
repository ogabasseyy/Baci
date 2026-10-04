import hashlib
import importlib.util
from pathlib import Path
from unittest.mock import patch
import unittest


SPEC = importlib.util.spec_from_file_location(
    'wallet_test_nginx_recover', Path(__file__).with_name('nginx_recover.py')
)
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


class NginxRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.predecessor = b'''server {
    server_name staging-auth.ogabassey.com;
    location / { return 404; }
}
'''
        self.rendered = MODULE.render_nginx(
            self.predecessor, hashlib.sha256(self.predecessor).hexdigest()
        )

    def test_accepts_only_the_pinned_predecessor_or_its_exact_union(self):
        self.assertEqual(
            MODULE.choose_target(self.predecessor, self.predecessor),
            self.rendered,
        )
        self.assertEqual(
            MODULE.choose_target(self.predecessor, self.rendered), self.rendered
        )
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.choose_target(self.predecessor, self.predecessor + b'# foreign\n')

    def test_refuses_predecessor_hash_drift(self):
        with self.assertRaises(MODULE.InstallRefused):
            MODULE.validate_predecessor(b'other')

    def test_refuses_a_nonreviewed_nginx_argument_before_reading_state(self):
        with patch.object(MODULE.os, 'geteuid', return_value=0), patch.object(
            MODULE.time, 'time', return_value=0
        ), patch.object(MODULE, 'load_bundle') as load_bundle:
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.recover(Path('/root/bundle'), 'a' * 64, 'b' * 64)
        load_bundle.assert_not_called()

    def test_refuses_when_the_deadline_timer_is_inactive(self):
        with patch.object(
            MODULE, 'command', side_effect=['active', str(MODULE.SERVICE_PATH), 'inactive']
        ), patch.object(
            MODULE, 'read_root_file', side_effect=[MODULE.render_unit(), b'']
        ), patch.object(MODULE, 'direct_payment_status', return_value=401):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.verify_runtime(hashlib.sha256(b'').hexdigest())

    def test_refuses_when_the_fixed_expiry_timer_receipt_changed(self):
        with patch.object(
            MODULE,
            'command',
            side_effect=[
                'active', str(MODULE.SERVICE_PATH), 'active', 'loaded',
                str(MODULE.TIMER_PATH), MODULE.TIMER_CALENDAR,
            ],
        ), patch.object(
            MODULE,
            'read_root_file',
            side_effect=[MODULE.render_unit(), b'', b'foreign'],
        ), patch.object(MODULE, 'direct_payment_status', return_value=401):
            with self.assertRaises(MODULE.InstallRefused):
                MODULE.verify_runtime(hashlib.sha256(b'').hexdigest())

    def test_accepts_the_sealed_server_payload_above_one_megabyte(self):
        payload = b'x' * 1_593_000
        with patch.object(
            MODULE,
            'command',
            side_effect=[
                'active', str(MODULE.SERVICE_PATH), 'active', 'loaded',
                str(MODULE.TIMER_PATH), MODULE.TIMER_CALENDAR,
            ],
        ), patch.object(
            MODULE,
            'read_root_file',
            side_effect=[
                MODULE.render_unit(), payload,
                MODULE.render_deadline_units()[MODULE.DEADLINE_TIMER],
            ],
        ) as read_root_file, patch.object(
            MODULE, 'direct_payment_status', return_value=401
        ), patch.object(MODULE, 'verify_manual_artifact'):
            MODULE.verify_runtime(hashlib.sha256(payload).hexdigest())
        self.assertIn(
            (MODULE.ROOT / 'server.cjs', 2_000_000),
            [call.args for call in read_root_file.call_args_list],
        )

    def test_refuses_replace_when_live_fingerprint_changes_after_staging(self):
        snapshots = iter(
            [
                (self.predecessor, ('changed',)),
            ]
        )
        writes = []

        with self.assertRaises(MODULE.InstallRefused):
            MODULE.replace_if_unchanged(
                self.predecessor,
                ('before',),
                self.rendered,
                lambda: next(snapshots),
                lambda content: None,
                lambda content: writes.append(content),
            )
        self.assertEqual(writes, [])

    def test_requires_new_method_statuses_and_legacy_gets_including_goals(self):
        with patch.object(MODULE, 'probe', return_value=401):
            routes = MODULE.route_statuses()
        self.assertEqual(routes[:6], list(MODULE.NEW_ROUTE_EXPECTATIONS))
        self.assertIn(('GET', MODULE.GOALS_ROUTE, 401), routes)
        with patch.object(
            MODULE,
            'probe',
            side_effect=lambda method, path, timeout: 503 if path == MODULE.GOALS_ROUTE else 401,
        ), self.assertRaises(MODULE.InstallRefused):
            MODULE.route_statuses()

    def test_rolls_back_only_when_the_installed_candidate_is_unchanged(self):
        writes = []
        self.assertTrue(
            MODULE.rollback_if_current(
                self.predecessor,
                self.rendered,
                ('candidate',),
                lambda: (self.rendered, ('candidate',)),
                lambda content: None,
                lambda content: writes.append(content),
            )
        )
        self.assertEqual(writes, [self.predecessor])
        self.assertFalse(
            MODULE.rollback_if_current(
                self.predecessor,
                self.rendered,
                ('candidate',),
                lambda: (self.rendered, ('intervened',)),
                lambda content: None,
                lambda content: writes.append(content),
            )
        )

    def test_verifies_candidate_immediately_before_the_final_live_snapshot(self):
        events = []
        MODULE.replace_if_unchanged(
            self.predecessor,
            ('same',),
            self.rendered,
            lambda: events.append('snapshot') or (self.predecessor, ('same',)),
            lambda content: events.append('candidate'),
            lambda content: events.append('replace'),
        )
        self.assertEqual(events, ['candidate', 'snapshot', 'replace'])

    def test_verifies_rollback_candidate_before_its_final_live_snapshot(self):
        events = []
        MODULE.rollback_if_current(
            self.predecessor,
            self.rendered,
            ('same',),
            lambda: events.append('snapshot') or (self.rendered, ('same',)),
            lambda content: events.append('candidate'),
            lambda content: events.append('replace'),
        )
        self.assertEqual(events, ['candidate', 'snapshot', 'replace'])

    def test_requires_sustained_hash_and_routes_for_fifteen_seconds(self):
        clock = [0.0]
        checks = []

        def sleep(seconds):
            clock[0] += seconds

        MODULE.wait_stable(
            self.rendered,
            lambda: (self.rendered, ('same',)),
            lambda: checks.append(clock[0]),
            lambda: clock[0],
            sleep,
            duration=15,
        )
        self.assertEqual(checks, [0.0, 1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0, 13.0, 14.0, 15.0])


if __name__ == '__main__':
    unittest.main()

import importlib.util
from pathlib import Path
import copy
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('notification_cli', HERE/'notification_cli.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


class Tests(unittest.TestCase):
    def test_current_auth_must_be_explicit_exact_hashes_not_latest_rebaseline(self):
        def same(first, second):
            SUBJECT.require({key: value for key, value in first.items() if key != 'capturedAt'}
                == {key: value for key, value in second.items() if key != 'capturedAt'})
        base = SimpleNamespace(financial_delta=SimpleNamespace(_snapshot=Mock()), same=same)
        historical = dict(readOnly=True, tableRows={'auth.sessions': dict(oid=1, count=1, sha256='a'*64),
            'public.customer_savings_goals': dict(oid=2, count=2, sha256='b'*64)}, permanentMetadataSha256='c'*64)
        approved = copy.deepcopy(historical)
        approved['tableRows']['auth.sessions'].update(count=2, sha256='d'*64)
        auth = {'auth.sessions': dict(before=historical['tableRows']['auth.sessions'],
            current=approved['tableRows']['auth.sessions'])}
        SUBJECT.approve_snapshot(base, approved, approved, historical, auth)
        SUBJECT.approve_snapshot(base, historical, historical, historical, {})
        with self.assertRaises(ValueError):
            SUBJECT.approve_snapshot(base, approved, approved, historical, {})
        for field in ('permanentMetadataSha256', 'financial'):
            modified = copy.deepcopy(approved)
            modified[field] = 'changed'
            with self.assertRaises(ValueError):
                SUBJECT.approve_snapshot(base, modified, modified, historical, auth)
        for case in ('non-auth', 'unlisted-auth', 'oid', 'actual', 'witness', 'extra'):
            modified, witness = copy.deepcopy(approved), copy.deepcopy(auth)
            if case == 'non-auth':
                name = 'public.customer_savings_goals'
                modified['tableRows'][name]['sha256'] = 'e'*64
                witness[name] = dict(before=historical['tableRows'][name], current=modified['tableRows'][name])
            elif case == 'unlisted-auth':
                historical_extra = dict(oid=3, count=1, sha256='f'*64)
                original = copy.deepcopy(historical)
                original['tableRows']['auth.users'] = historical_extra
                modified['tableRows']['auth.users'] = dict(oid=3, count=1, sha256='e'*64)
                with self.assertRaises(ValueError):
                    SUBJECT.approve_snapshot(base, modified, modified, original, witness)
                continue
            elif case == 'oid':
                modified['tableRows']['auth.sessions']['oid'] = 99
                witness['auth.sessions']['current']['oid'] = 99
            elif case == 'actual':
                current = copy.deepcopy(modified)
                current['tableRows']['auth.sessions']['sha256'] = 'e'*64
                with self.assertRaises(ValueError):
                    SUBJECT.approve_snapshot(base, current, modified, historical, witness)
                continue
            elif case == 'witness':
                witness['auth.sessions']['before']['sha256'] = 'e'*64
            else:
                witness['auth.sessions']['current']['attested'] = True
            with self.assertRaises(ValueError, msg=case):
                SUBJECT.approve_snapshot(base, modified, modified, historical, witness)

    def test_release_authenticates_exact_set_before_any_import(self):
        manifest = dict(kind='sealed-notification-timer-only-resume', files={}, reviewed={})
        with patch.object(SUBJECT, 'protected', return_value=SUBJECT.encode(manifest)):
            with self.assertRaises(ValueError):
                SUBJECT.capture(Path('/root/notification-package'), 'a'*64)

    def test_r7_loader_includes_owned_stop_before_runtime(self):
        self.assertIn('owned_public_stop.py', SUBJECT.PINS)
        self.assertLess(SUBJECT.LOCAL.index('owned_public_stop'), SUBJECT.LOCAL.index('public_resume_runtime'))

    def test_final_seal_refusal_withdraws_attempted_timer_independent_of_seal(self):
        callbacks = SimpleNamespace(attempted=True, cleanup_confirmed=False, run=Mock())
        def stop(*args, **kwargs):
            callbacks.cleanup_confirmed = True
        callbacks.run.side_effect = stop
        self.assertTrue(SUBJECT.withdraw(callbacks))
        callbacks.run.assert_called_once_with(['/usr/bin/systemctl', 'stop',
            'baci-savings-notifications.timer', 'baci-savings-notifications.service'], timeout=30)

    def test_invoke_final_seal_failure_stops_before_releasing_root_lock(self):
        order = []
        root = SimpleNamespace(audit=Path('/root/private-audit'),
            context=SimpleNamespace(owner=SimpleNamespace(write=Mock())), close=lambda: order.append('close'))
        snapshot = {}
        scope = dict(protectedSnapshot=snapshot, database={}, scope=dict(capturedAt='fixed'))
        callbacks = SimpleNamespace(attempted=False, cleanup_confirmed=False,
            collect=Mock(return_value=dict(protectedSnapshot=snapshot)), scope_collect=Mock(return_value=scope),
            audits={'completed': SUBJECT.encode(dict(reconciliation=dict(collection=dict(protectedSnapshot=snapshot))))},
            exclusive=Mock(return_value=True), read=Mock(), state=Mock(), run=Mock(), job_state=Mock(),
            settle=Mock(), clock=Mock())
        def timer(**kwargs):
            callbacks.attempted = True
            return dict(status='notification-timer-resumed', schedulingRestored=True)
        def stop(*args, **kwargs):
            callbacks.cleanup_confirmed = True
            order.append('stop')
        callbacks.run.side_effect = stop
        base = SimpleNamespace(same=Mock(), ASSET_PINS={})
        modules = dict(notification_adapter=SimpleNamespace(ReadonlyRoot=Mock(return_value=root),
            NotificationCallbacks=Mock(return_value=callbacks)), notification_resume=base,
            notification_scope=SimpleNamespace(verify_transition=Mock()),
            notification_timer_resume=SimpleNamespace(restore_timer=timer))
        reviewed = dict(public={}, publicRunning=True, authRows={}, expectedEvents=[])
        files = {'approved-snapshot.json': SUBJECT.encode(snapshot),
            'approved-scope.json': SUBJECT.encode(dict(database={}, scope=dict(capturedAt='fixed')))}
        with patch.object(SUBJECT, 'approve_snapshot'):
            result = SUBJECT.invoke(modules, {}, files, reviewed, {},
                Mock(side_effect=[True, True, ValueError('seal drift')]), apply=True)
        self.assertEqual(result['status'], 'notification-cli-refused')
        self.assertTrue(result['cleanupConfirmed'])
        self.assertFalse(result['schedulingRestored'])
        self.assertEqual(order, ['stop', 'close'])

    def test_loader_rejects_unpinned_public_dependency_without_import(self):
        files = {name: b'x' for name in SUBJECT.FILES}
        with self.assertRaises(ValueError):
            SUBJECT.check_files(files)

    def test_main_non_root_or_nonisolated_is_redacted_and_never_loads(self):
        with patch.object(SUBJECT, 'capture') as capture, patch('builtins.print') as output:
            self.assertEqual(SUBJECT.main(['a'*64, '--apply']), 1)
        capture.assert_not_called()
        self.assertNotIn('Traceback', output.call_args.args[0])
        self.assertIn('redacted', output.call_args.args[0])


if __name__ == '__main__':
    unittest.main()

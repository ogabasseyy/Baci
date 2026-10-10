import importlib.util
from pathlib import Path
import sys
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1]/'replay-complete-cutover-owner'),
    str(HERE.parents[1]/'existing-payment-projection')]
SPEC = importlib.util.spec_from_file_location('notification_adapter', HERE/'notification_adapter.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


class Tests(unittest.TestCase):
    def test_owned_cleanup_lock_does_not_depend_on_failed_seal(self):
        host = SUBJECT.NotificationCallbacks.__new__(SUBJECT.NotificationCallbacks)
        host.root = SimpleNamespace(closed=False, notification_lock=71)
        host.sealed_guard = Mock(side_effect=ValueError('seal drift'))
        info = SimpleNamespace(st_dev=1, st_ino=2, st_mode=stat.S_IFREG | 0o600,
            st_uid=0, st_gid=0, st_nlink=1)
        with patch.object(SUBJECT.os, 'fstat', return_value=info), \
                patch.object(SUBJECT.Path, 'lstat', return_value=info), patch.object(SUBJECT.fcntl, 'flock'):
            self.assertTrue(host.owned_lock())
        host.sealed_guard.assert_not_called()
        host.root.closed = True
        with self.assertRaises(ValueError):
            host.owned_lock()

    def test_quiescence_mapping_excludes_only_owned_notification_units(self):
        quiet = SimpleNamespace(UNITS=SUBJECT.ORIGINAL_UNITS, marker=object())
        host = SUBJECT.NotificationCallbacks.__new__(SUBJECT.NotificationCallbacks)
        host.public_guard = Mock()
        with patch.object(SUBJECT.PublicCallbacks, 'guard_collectors') as guard:
            host.guard_collectors({'financial_quiescence': quiet})
        mapped = guard.call_args.args[1]['financial_quiescence']
        self.assertEqual(set(quiet.UNITS)-set(mapped.UNITS), SUBJECT.OWNED)
        self.assertIs(mapped.marker, quiet.marker)
        self.assertEqual(quiet.UNITS, SUBJECT.ORIGINAL_UNITS)
        self.assertIn('baci-prefunded-background.timer', mapped.UNITS)
        host.public_guard.assert_called_once()

    def test_unreviewed_unit_inventory_refuses_instead_of_broad_exclusion(self):
        host = SUBJECT.NotificationCallbacks.__new__(SUBJECT.NotificationCallbacks)
        with self.assertRaises(ValueError):
            host.guard_collectors({'financial_quiescence': SimpleNamespace(UNITS=('new-worker.service',))})

    def test_postcredit_collector_uses_public_callback_not_financial_runner(self):
        host = SUBJECT.NotificationCallbacks.__new__(SUBJECT.NotificationCallbacks)
        host.scope_collect = Mock(return_value=dict(scope=dict(tokens=[], deliveries=[]), database=dict(role={}),
            protectedSnapshot={}))
        completed = dict(completed={}, protectedSnapshot={})
        with patch.object(SUBJECT.PublicCallbacks, 'collect_completed', return_value=completed) as collect:
            value = host.collect()
        collect.assert_called_once_with(host)
        self.assertEqual(value['activity']['activeStorefrontTokens'], 0)
        self.assertFalse(hasattr(SUBJECT.ReadonlyRoot, 'prepare'))


if __name__ == '__main__':
    unittest.main()

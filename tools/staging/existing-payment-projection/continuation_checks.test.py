import json
from pathlib import Path
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


sys.path.insert(0, str(Path(__file__).resolve().parent))
import continuation_checks as SUBJECT


class ContinuationChecksTests(unittest.TestCase):
    def setUp(self):
        self.context, self.diagnostic = Mock(), Mock()
        self.context.exclusive.return_value = self.context.verify_files.return_value = True
        self.diagnostic.WORKER, self.diagnostic.IMAGE = 'worker', 'image'
        self.diagnostic.inspect.return_value = {'State': {'ExitCode': 1, 'OOMKilled': False}}
        self.diagnostic.CONFIGURATION_SHA = SUBJECT.hashlib.sha256(b'configuration').hexdigest()
        self.diagnostic.read_regular.return_value = b'configuration'
        self.diagnostic.CONFIGURATION.lstat.return_value = SimpleNamespace(st_gid=65532, st_mode=0o100600)
        self.quiet = Mock(STOPPED={}, UNITS=[])
        self.quiet.IDENTITY = {'readOnly': True, 'otherClientTransactions': 0}
        self.quiet.DRAIN_SQL = 'fixed readonly query'
        self.context.finance = {'database': Mock(return_value=json.dumps(self.quiet.IDENTITY))}
        self.modules = dict(financial_quiescence=self.quiet,
            worker_source_authority=Mock(), financial_readiness_owner=Mock())

    def test_commit_guard_uses_only_owned_drain_not_external_database_or_provider(self):
        transaction, drain = Mock(), Mock()
        SUBJECT.guard(self.context, self.diagnostic, self.modules, transaction, drain)
        drain.verify.assert_called_once_with()
        self.context.finance['database'].assert_not_called()
        transaction.execute.assert_not_called()

    def test_ordinary_guard_uses_truthful_readonly_drain(self):
        SUBJECT.guard(self.context, self.diagnostic, self.modules)
        self.context.finance['database'].assert_called_once_with(self.quiet.DRAIN_SQL)

    def test_slow_commit_guard_refuses_without_increasing_idle_timeout(self):
        drain = Mock()
        with patch.object(SUBJECT.time, 'monotonic', side_effect=[0, 8]), self.assertRaises(ValueError):
            SUBJECT.guard(self.context, self.diagnostic, self.modules, Mock(), drain)
        drain.verify.assert_not_called()

    def test_missing_drain_configuration_drift_and_wrong_readonly_types_refuse(self):
        with self.assertRaises(ValueError):
            SUBJECT.guard(self.context, self.diagnostic, self.modules, Mock())
        self.diagnostic.read_regular.return_value = b'changed'
        with self.assertRaises(ValueError):
            SUBJECT.guard(self.context, self.diagnostic, self.modules)
        self.diagnostic.read_regular.return_value = b'configuration'
        self.context.finance['database'].return_value = '{"readOnly":1,"otherClientTransactions":0}'
        with self.assertRaises(ValueError):
            SUBJECT.guard(self.context, self.diagnostic, self.modules)


if __name__ == '__main__':
    unittest.main()

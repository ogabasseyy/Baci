import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
import sys
from types import SimpleNamespace
import unittest
from unittest.mock import MagicMock, Mock, patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'existing-payment-projection'))
import public_resume_adapter as subject
import financial_quiescence as quiet


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


HISTORY = load('adapter_history_fixture', HERE / 'public_resume_history.test.py')
INPUTS = load('adapter_application_fixture', HERE / 'application_reports.test.py')


class Tests(unittest.TestCase):
    def setUp(self):
        before, after, report = HISTORY.PROJECTION.reminder_states()
        completed = copy.deepcopy(report)
        completed.update(proofKind='financial_completion')
        del completed['financialCommitted']
        completed['appIdentity']['readOnly'] = True
        native = completed['nativeEvidence']
        native.update(proofKind='native_transfer')
        del native['financialCommitted']
        native['appIdentity']['readOnly'] = True
        committed = copy.deepcopy(after)
        committed['readOnly'] = True
        before_audit = dict(before=dict(protectedSnapshot=before))
        precommit_audit = dict(**before_audit, precommit=dict(report=report, protectedSnapshot=after))
        completed_audit = dict(**precommit_audit, reconciliation=dict(completedReport=completed,
            collection=dict(protectedSnapshot=committed), proof=dict(snapshotCompletionBound=True)))
        self.raw = {name: json.dumps(value).encode() for name, value in
            zip(subject.AUDITS, (before_audit, precommit_audit, completed_audit))}
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.raw.items()}
        pin_patch = patch.object(subject, 'AUDIT_PINS', self.pins)
        pin_patch.start()
        self.addCleanup(pin_patch.stop)
        self.root = MagicMock(context=MagicMock(), closed=False, prepared=False, owned_transaction=None, drain=None)
        self.root.context.exclusive.return_value = self.root.context.verify_files.return_value = True
        self.read_patch = patch.object(subject.PublicCallbacks, 'read', side_effect=self.read)
        self.read_patch.start()
        self.addCleanup(self.read_patch.stop)
        self.sealed = Mock(return_value=True)
        self.callbacks = subject.PublicCallbacks(self.root, self.pins, self.sealed)
        self.committed, self.completed = committed, completed

    def read(self, path, *, mode):
        self.assertEqual(mode, 0o600)
        name = next(name for name, expected in subject.AUDITS.items() if str(path) == expected)
        return self.raw[name], dict(uid=0, gid=0, mode=mode, nlink=1, regularFile=True)

    def test_three_real_paths_bind_separate_matching_audits_without_prepare_or_credit(self):
        self.assertEqual(set(self.callbacks.audits), {'before', 'precommit', 'completed'})
        self.assertEqual(len(self.callbacks.preserved), 1)
        self.root.prepare.assert_not_called()
        self.root.guard.assert_not_called()

    def test_bad_pin_missing_audit_or_inconsistent_precommit_refuses(self):
        for failure in ('pin', 'missing', 'inconsistent'):
            with self.subTest(failure=failure):
                pins, original = copy.deepcopy(self.pins), copy.deepcopy(self.raw)
                if failure == 'pin':
                    pins['completed'] = 'a' * 64
                elif failure == 'missing':
                    pins.pop('before')
                else:
                    audit = json.loads(self.raw['completed'])
                    audit['precommit']['report']['financialCommitted'] = True
                    self.raw['completed'] = json.dumps(audit).encode()
                    pins['completed'] = hashlib.sha256(self.raw['completed']).hexdigest()
                with self.assertRaises(ValueError):
                    subject.PublicCallbacks(self.root, pins, self.sealed)
                self.raw = original

    def test_postcredit_auth_changes_are_current_evidence_not_precredit_baseline(self):
        application, original, provider = INPUTS.inputs()
        current = copy.deepcopy(self.committed)
        current['permanentMetadataSha256'] = 'e' * 64
        capture = Mock(return_value=dict(application=application, protectedSnapshot=current))
        self.root.legacy.pins = {'financial_report.sql': 'a' * 64, 'financial_snapshot.sql': 'b' * 64}
        self.root.legacy.scope.return_value.__enter__.return_value = {'application_reports': SimpleNamespace(capture_application=capture)}
        self.callbacks.exclusive = Mock(return_value=True)
        self.callbacks.guard_collectors = Mock()
        with patch.object(subject.checks, 'provenance', return_value=(original, provider)) as provenance, \
                patch.object(subject.application_reports, '_fresh'):
            result = self.callbacks.collect_completed()
        self.assertEqual(result['protectedSnapshot'], current)
        self.assertEqual(provenance.call_args.args[2], subject.legacy.ROOT)
        self.assertEqual(capture.call_args.args[1], subject.legacy.ROOT / 'financial_report.sql')
        self.assertEqual(self.callbacks.guard_collectors.call_count, 2)
        self.root.prepare.assert_not_called()
        self.root.reconcile.assert_not_called()

    def guard_fixture(self):
        diagnostic = self.root.diagnostic
        diagnostic.IMAGE, diagnostic.WORKER = 'image', quiet.STOPPED['baci-prefunded-background']
        worker = dict(State=dict(ExitCode=1, OOMKilled=False))
        unit = {'state': 'failed'}
        diagnostic.inspect.side_effect = lambda identifier: worker if identifier == diagnostic.WORKER else {}
        diagnostic.worker_unit.return_value = unit
        self.root.profile = dict(worker=copy.deepcopy(worker), unit=copy.deepcopy(unit))
        diagnostic.read_regular.return_value = b'configuration'
        diagnostic.CONFIGURATION_SHA = hashlib.sha256(b'configuration').hexdigest()
        diagnostic.CONFIGURATION.lstat.return_value = SimpleNamespace(st_gid=65532, st_mode=stat.S_IFREG | 0o600)
        stopped, units = Mock(), Mock()
        controlled = SimpleNamespace(**{key: getattr(quiet, key) for key in
            ('STOPPED', 'UNITS', 'NATIVE_ID', 'NATIVE_ROOT', 'NATIVE_SEAL', 'COMPETITOR_ID', 'DRAIN_SQL', 'IDENTITY')},
            _stopped=stopped, _unit=units)
        self.root.context.finance = {'database': Mock(return_value=json.dumps(quiet.IDENTITY))}
        modules = {'financial_quiescence': controlled, 'financial_readiness_owner': SimpleNamespace(_locked=Mock()),
            'worker_source_authority': SimpleNamespace(_profile=Mock())}
        return modules, worker, stopped, units

    def test_only_exact_public_exception_preserves_all_other_writer_and_failed_worker_checks(self):
        modules, _, stopped, units = self.guard_fixture()
        self.callbacks.guard_collectors(modules)
        identifiers = [call.args[1] for call in stopped.call_args_list]
        for name, identifier in quiet.STOPPED.items():
            if name not in ('baci-prefunded-public', 'baci-prefunded-background'):
                self.assertIn(identifier, identifiers)
        self.assertIn(quiet.NATIVE_ID, identifiers)
        self.assertIn(quiet.COMPETITOR_ID, identifiers)
        self.assertEqual([call.args[1] for call in units.call_args_list],
            [name for name in quiet.UNITS if name not in ('baci-prefunded-background.service', subject.public_resume.SERVICE)])

    def test_failed_worker_or_drain_or_configuration_drift_refuses(self):
        for failure in ('exit', 'oom', 'unit', 'configuration', 'drain'):
            with self.subTest(failure=failure):
                modules, worker, _, _ = self.guard_fixture()
                if failure == 'exit':
                    worker['State']['ExitCode'] = 0
                elif failure == 'oom':
                    worker['State']['OOMKilled'] = True
                elif failure == 'unit':
                    self.root.diagnostic.worker_unit.return_value = {'state': 'active'}
                elif failure == 'configuration':
                    self.root.diagnostic.CONFIGURATION_SHA = 'a' * 64
                else:
                    self.root.context.finance['database'].return_value = json.dumps(dict(quiet.IDENTITY, otherClientTransactions=True))
                with self.assertRaises(ValueError):
                    self.callbacks.guard_collectors(modules)

    def test_changed_retained_audit_refuses_exclusive_guard(self):
        self.raw['before'] = b'foreign'
        with self.assertRaises(ValueError):
            self.callbacks.exclusive()

    def test_bootstrap_or_r2_drift_before_collection_never_submits_start(self):
        for source in ('bootstrap', 'r2'):
            with self.subTest(source=source):
                self.sealed.side_effect = ValueError(source + ' drift')
                with self.assertRaises(ValueError):
                    self.callbacks.collect_completed()
                self.assertFalse(self.callbacks.attempted)
                self.assertIsNone(self.callbacks.job)


if __name__ == '__main__':
    unittest.main()

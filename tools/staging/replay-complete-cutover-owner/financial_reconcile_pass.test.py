import copy
from contextlib import ExitStack
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import stat
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import application_reports
import financial_readiness_owner as readiness
import natural_reclaim_authority as natural
import worker_adapter
import worker_source_authority as authority

try:
    import financial_reconcile_pass as module
except ModuleNotFoundError:
    module = None

HERE = Path(__file__).resolve().parent

def fixture(name):
    spec = importlib.util.spec_from_file_location('reconcile_' + name, HERE/(name+'.test.py'))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded

REPORTS, CATALOG, DELTA, WORKER, SNAPSHOTS = [fixture(name) for name in
    ('application_reports', 'natural_reclaim_authority', 'financial_delta', 'worker_adapter', 'completion_snapshot')]

class FinancialReconcilePassTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'finite financial reconciliation pass not implemented')
        self.worker = WORKER.WorkerAdapterTests('runTest')
        self.worker.setUp()
        self.worker.now = datetime(2026, 10, 3, 7, 48, 10, tzinfo=timezone.utc).timestamp()
        self.worker.identifier = authority.BACKGROUND_CONTAINER_ID
        self.worker.manifest = authority.MANIFEST_SHA256
        self.worker.container['Id'] = self.worker.identifier
        self.worker.container['State'].update(StartedAt=self.worker.stamp(self.worker.now-60),
            FinishedAt=self.worker.stamp(self.worker.now-50))
        self.worker.scheduler = self.worker.adapter.scheduler
        self.worker.container.update(self.worker.scheduler.container_contract('background', self.worker.manifest))
        self.catalog = CATALOG.NaturalReclaimTests('runTest')
        self.catalog.setUp()
        self.approved_pin = self.catalog.pin
        self.catalog.report['capturedAt'] = self.catalog.background['capturedAt'] = '2026-10-03T07:48:10.000000Z'
        self.application, self.original, self.provider = REPORTS.inputs()
        self.pending = copy.deepcopy(self.application)
        self.pending['completedApplication']['operation'].update(transferStatus='dispatching',
            projectionStatus='unapplied', transferProviderTransactionId=None)
        self.pending['completedApplication']['treasury'].update(reservedKobo=10000, consumedKobo=0)
        self.pending['completedApplication']['goals'][0].update(displayedPrincipalKobo=0,
            canonicalPrincipalKobo=0, status='active', completedAt=None)
        for name in ('projections', 'ledgerOperations', 'contributions', 'postings', 'aliases', 'notifications'):
            self.pending['completedApplication'][name] = []
        self.pending['completedApplication']['queue'][0]['finishedAt'] = None
        self.pending['completedApplication']['unfinishedOperations'] = [{'operationId': natural.TARGET}]
        self.after = SNAPSHOTS.consistent_snapshot(REPORTS.FIXTURES.completed_fixture())
        self.after['capturedAt'] = '2026-10-03T07:48:10.000000Z'
        self.before = copy.deepcopy(self.after)
        for relation in DELTA.INSERTIONS:
            witness = self.before['allowedTargetWitnesses'][relation]
            witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
            self.before['tableRows'][relation]['count'] = witness['excludedTargetCount']
        changes = {'prefunded_card.operations': dict(transfer_status='dispatching', projection_status='unapplied',
            transfer_provider_transaction_id=None), 'prefunded_card.treasury_bindings': dict(reserved_kobo=10000,
            consumed_kobo=0), 'public.customer_savings_goals': dict(current_amount=0, status='active', completed_at=None),
            'prefunded_card.dispatch_queue': dict(finished_at=None)}
        for relation, fields in changes.items():
            witness = self.before['allowedTargetWitnesses'][relation]
            witness['targetRows'][0].update(fields)
            witness['targetRowColumnHashes'][0].update({key: hashlib.sha256(json.dumps(value,
                separators=(',', ':')).encode()).hexdigest() for key, value in fields.items()})
            witness['targetHash'] = self.before['tableRows'][relation]['sha256'] = 'b'*64
        self.phase, self.row_pin, self.events = 'completed', 'e'*64, []
        self.private_metadata = {}
        self.blobs = {name: (HERE/name).read_bytes() for name in module.FILES if (HERE/name).is_file()}
        for source, name in readiness.SOURCE_NAMES.items():
            self.blobs[name] = self.catalog.sources[source]
        self.blobs['financial_snapshot.sql'] += b'\noriginal_snapshot'
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.blobs.items()}
        self.context = SimpleNamespace(owner=SimpleNamespace(read=self.read, command=self.command),
            finance={'command': self.command, 'database': self.database}, deadline=lambda: None, lock=10)
        self.worker.after_start = lambda: self.events.append('worker-started')

    def read(self, path, pin, **kwargs):
        if path == application_reports.BASELINE_PATH:
            return b'original_snapshot;'
        if str(path) in self.worker.files:
            uid = 65532 if str(path) == authority.CONFIGURATION else 0
            mode = 0o600 if uid else 0o644 if str(path) == worker_adapter.UNIT else 0o444
            self.assertEqual(kwargs, dict(modes=(mode,), uid=uid))
            return self.worker.read(path, pin)
        raw = self.blobs[Path(path).name]
        return raw
    def metadata(self, path):
        filename = str(path)
        uid = 65532 if filename == authority.CONFIGURATION else 0
        mode = 0o600 if uid else 0o644 if filename == worker_adapter.UNIT else 0o444
        regular = filename in self.worker.files
        values = dict(st_dev=1, st_ino=1, st_mode=(stat.S_IFREG|mode) if regular else (stat.S_IFDIR|0o755),
            st_uid=uid, st_gid=uid, st_nlink=1, st_size=len(self.worker.files[filename]) if regular else 0,
            st_mtime_ns=1, st_ctime_ns=1)
        if uid: values.update(self.private_metadata)
        return SimpleNamespace(**values)

    def command(self, arguments, *, timeout=30, **kwargs):
        if arguments[:len(worker_adapter.DOCKER)+1] == [*worker_adapter.DOCKER, 'inspect']:
            return json.dumps([self.worker.inspect(arguments[-1])])
        return self.worker.command(arguments, timeout=timeout)

    def current_application(self):
        selected = self.application if self.worker.starts() else self.pending
        result = copy.deepcopy(selected)
        result['observedAt'] = self.worker.stamp(self.worker.now)
        if self.worker.starts() and self.phase == 'projection':
            result = copy.deepcopy(self.pending)
            result['observedAt'] = self.worker.stamp(self.worker.now)
            result['completedApplication']['operation'].update(transferStatus='verified_success',
                transferProviderTransactionId=natural.TRANSACTION)
            result['completedApplication']['treasury'].update(reservedKobo=0, consumedKobo=10000)
        return result

    def database(self, query):
        if 'allowedTargetWitnesses' in query:
            self.events.append('post-snapshot' if self.worker.starts() else 'baseline')
            snapshot = self.after if self.worker.starts() else self.before
            snapshot['capturedAt'] = self.worker.stamp(self.worker.now)
            return json.dumps(snapshot)
        if query == self.blobs['financial_report.sql'].decode():
            return json.dumps(self.current_application())
        if query == self.blobs['natural_reclaim_preflight.sql'].decode():
            report = copy.deepcopy(self.catalog.report)
            if self.worker.starts():
                report['phase'] = 'apply_verified_projection'
                report['operations'][1].update(rowSha256=self.row_pin, tokenSha256=None,
                    leaseExpiresAt=None, verificationFence=327, transferStatus='verified_success',
                    transferProviderTransactionId=natural.TRANSACTION)
                report['expiredPairs'] = [dict(natural.OLD_ROW)]
                report['drain']['expiredVerificationPairs'] = 1
            return json.dumps(report)
        if query == self.blobs['background_preflight.sql'].decode():
            background = copy.deepcopy(self.catalog.background)
            if self.worker.starts():
                background.update(phase='apply_verified_projection',
                    target=dict(collectionStatus='verified_success', transferStatus='verified_success',
                        projectionStatus='unapplied', transferProviderTransactionId=natural.TRANSACTION),
                    treasury=dict(budgetKobo=10000, reservedKobo=0, consumedKobo=10000))
                background['drain']['expiredVerificationPairs'] = 1
            return json.dumps(background)
        if "'rowSha256'" in query:
            return json.dumps(dict(rowCount=1, targetHash=self.after['allowedTargetWitnesses']
                ['prefunded_card.operations']['targetHash'], rowSha256=self.row_pin,
                capturedAt=self.worker.stamp(self.worker.now)))
        self.fail('unexpected database query')
    def quiet(self, context):
        self.events.append('quiescent')
        return dict(status='financial-writers-quiescent', observedAt=self.worker.stamp(self.worker.now))
    def stopped(self, *args):
        original, provider = copy.deepcopy(self.original), copy.deepcopy(self.provider)
        stamp = self.worker.stamp(self.worker.now)
        original['provenance']['sourceProofObservedAt'] = original['receiptStorage']['observedAt'] = stamp
        provider['observedAt'] = stamp
        return dict(status='stopped-provider-and-application-readonly-verified', original=original,
            provider=provider, application=self.current_application(), financialActionAttempted=False,
            newPaymentStarted=False)
    def collect_worker(self, context, *, load_scheduler):
        scheduler = load_scheduler(Path('/sealed'), {})
        return dict(status='worker-source-inputs-bound', containerId=self.worker.identifier,
            manifestSha256=self.worker.manifest, fileHashes=self.worker.pins,
            approvedCompanyBudgetKobo=10000, approvedPreservedPrincipalKobo=10000,
            observedAt=self.worker.stamp(self.worker.now)), scheduler

    def prepare_projection_snapshot(self):
        for relation in DELTA.INSERTIONS | {'public.customer_savings_goals', 'prefunded_card.dispatch_queue'}:
            self.after['allowedTargetWitnesses'][relation] = copy.deepcopy(self.before['allowedTargetWitnesses'][relation])
            self.after['tableRows'][relation] = copy.deepcopy(self.before['tableRows'][relation])
        witness = self.after['allowedTargetWitnesses']['prefunded_card.operations']
        witness['targetRows'][0]['projection_status'] = 'unapplied'
        witness['targetRowColumnHashes'][0]['projection_status'] = hashlib.sha256(b'"unapplied"').hexdigest()

    def execute(self, **kwargs):
        if self.phase == 'projection':
            self.prepare_projection_snapshot()
        outer = self
        class Clock(datetime):
            @classmethod
            def now(cls, zone=None):
                return datetime.fromtimestamp(outer.worker.now, timezone.utc)
        with ExitStack() as stack:
            stack.enter_context(patch.object(module, 'REVIEWED_CATALOG_SHA256', self.approved_pin))
            for target in (module, readiness, application_reports):
                stack.enter_context(patch.object(target, 'datetime', Clock))
            stack.enter_context(patch.object(readiness, '_locked'))
            stack.enter_context(patch.object(readiness, 'collect_financial_readiness', return_value={'summary':
                {'status':'financial-readiness-readonly-review-candidate'}, 'catalogReviewCandidate':self.catalog.report}))
            stack.enter_context(patch.object(module.stopped_provider_preflight, 'collect_stopped_provider', side_effect=self.stopped))
            stack.enter_context(patch.object(module.financial_quiescence, 'verify_financial_quiescence', side_effect=self.quiet))
            stack.enter_context(patch.object(module.worker_owner, 'collect_worker_authority', side_effect=self.collect_worker))
            stack.enter_context(patch.object(module.worker_owner, '_lstat', side_effect=self.metadata))
            stack.enter_context(patch.object(module.sealed_scheduler, 'bind_sealed_scheduler', return_value=self.worker.scheduler))
            stack.enter_context(patch.object(worker_adapter.time, 'time', side_effect=lambda: self.worker.now))
            return module.run_financial_reconcile_pass(self.context, HERE, self.pins,
                reviewed_catalog_sha256=self.catalog.pin, **kwargs)

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^financial_reconcile_pass_refused$'):
            self.execute()

    def test_one_existing_worker_after_stopped_baseline_requires_actual_full_completion(self):
        result = self.execute()
        self.assertEqual(result['summary']['status'], 'financial-reconcile-completed')
        self.assertEqual(len(self.worker.starts()), 1)
        self.assertLess(self.events.index('quiescent'), self.events.index('baseline'))
        self.assertLess(self.events.index('baseline'), self.events.index('worker-started'))
        self.assertEqual(result['completedReport']['operation']['amountKobo'], 10000)
        self.assertFalse(any('restart' in args for args, timeout in self.worker.calls))

    def test_projection_only_pins_first_protected_post_row_not_target_array_or_caller_assertion(self):
        self.phase = 'projection'
        result = self.execute()
        self.assertEqual(result['summary']['status'], 'financial-reconciliation-only')
        self.assertIs(result['summary']['financialCompleted'], False)
        self.assertEqual(result['projectionTargetRowSha256'], 'e'*64)
        self.assertEqual(result['classificationAfter']['phase'], 'apply_verified_projection')
        self.assertEqual(len(self.worker.starts()), 1)
        self.assertNotIn('completedReport', result)
        with self.assertRaises(TypeError):
            self.execute(projection_target_row_sha256='a'*64)

    def test_changed_old_principal_metadata_or_budget_refuses_after_exactly_one_pass(self):
        for change in ('old', 'metadata', 'budget'):
            with self.subTest(change=change):
                self.setUp()
                if change == 'old':
                    self.after['allowedTargetWitnesses']['public.customer_savings_goals']['excludedTargetHash'] = '1'*64
                elif change == 'metadata': self.after['permanentMetadataSha256'] = '1'*64
                else: self.application['completedApplication']['treasury']['budgetKobo'] = 20000
                self.refused()
                self.assertEqual(len(self.worker.starts()), 1)

    def test_wrong_catalog_source_native_or_pending_scope_refuses_before_worker(self):
        for change in ('catalog', 'source', 'native', 'scope', 'extra'):
            with self.subTest(change=change):
                self.setUp()
                if change == 'catalog': self.catalog.pin = '0'*64
                elif change == 'source':
                    self.blobs['storage-functions.sql'] += b'drift'
                    self.pins['storage-functions.sql'] = hashlib.sha256(self.blobs['storage-functions.sql']).hexdigest()
                elif change == 'native': self.original['provenance']['hmacSha512Verified'] = False
                elif change == 'scope': self.catalog.background['scope']['operationId'] = natural.OLD
                else: self.pins['cached-proof.json'] = 'a'*64
                self.refused()
                self.assertEqual(self.worker.starts(), [])

    def test_partial_applied_report_never_falls_back_to_reconciliation_only(self):
        self.application['completedApplication']['projections'] *= 2
        self.refused()
        self.assertEqual(len(self.worker.starts()), 1)

    def test_pending_application_operation_scope_is_checked_before_any_worker(self):
        self.pending['completedApplication']['operation']['goalId'] = natural.SCOPE['oldGoalId']
        self.refused()
        self.assertEqual(self.worker.starts(), [])

    def test_server_row_pin_bridge_must_match_first_protected_post_array_hash(self):
        self.phase = 'projection'
        database = self.database
        def changed(query):
            raw = database(query)
            if query != self.blobs['natural_reclaim_preflight.sql'].decode() and "'rowSha256'" in query:
                result = json.loads(raw)
                result['targetHash'] = '0'*64
                return json.dumps(result)
            return raw
        self.context.finance['database'] = changed
        self.refused()
        self.assertEqual(len(self.worker.starts()), 1)

    def test_worker_failure_still_captures_protected_post_state_without_retry(self):
        self.worker.log = '{"status":"failed","secret":"do-not-print"}'
        self.refused()
        self.assertIn('post-snapshot', self.events)
        self.assertEqual(len(self.worker.starts()), 1)

    def test_protected_worker_reader_rejects_wrong_private_gid_and_hardlinks_before_start(self):
        for changed in ({'st_gid':0}, {'st_nlink':2}):
            with self.subTest(changed=changed):
                self.setUp()
                self.private_metadata = changed
                self.refused()
                self.assertEqual(self.worker.starts(), [])

if __name__ == '__main__':
    unittest.main()

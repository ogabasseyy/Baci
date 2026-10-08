import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from types import SimpleNamespace
from unittest.mock import patch

import application_reports
import financial_readiness_owner as readiness
import natural_reclaim_authority as natural

try:
    import projection_preflight as module
except ModuleNotFoundError:
    module = None


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('projection_fixtures', HERE / 'financial_reconcile_pass.test.py')
FIXTURE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(FIXTURE)
NOW = datetime(2026, 10, 3, 10, 20, tzinfo=timezone.utc)


class ProjectionPreflightTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(module, 'read-only projection preflight not implemented')
        self.fixture = FIXTURE.FinancialReconcilePassTests('runTest')
        self.fixture.setUp()
        self.fixture.phase = 'projection'
        self.fixture.row_pin = module.PROJECTION_ROW_SHA256
        self.application = copy.deepcopy(self.fixture.pending)
        completed = self.application['completedApplication']
        completed['operation'].update(transferStatus='verified_success',
            transferProviderTransactionId=natural.TRANSACTION)
        completed['treasury'].update(reservedKobo=0, consumedKobo=10000)
        self.fixture.prepare_projection_snapshot()
        self.audit = dict(workerFailed=True, worker=None, baseline=self.fixture.before,
            applicationBefore=copy.deepcopy(self.fixture.pending), firstPost=self.fixture.after,
            firstPostApplication=copy.deepcopy(self.application),
            classificationBefore={'phase': 'verify_existing_transfer'})
        self.catalog = copy.deepcopy(self.fixture.catalog.report)
        self.catalog.update(phase='apply_verified_projection', catalogSha256=module.CATALOG_SHA256,
            capturedAt=NOW.isoformat(timespec='microseconds').replace('+00:00', 'Z'))
        self.catalog['operations'][1].update(rowSha256=self.fixture.row_pin,
            tokenSha256=None, leaseExpiresAt=None, verificationFence=327,
            transferStatus='verified_success', transferProviderTransactionId=natural.TRANSACTION)
        self.catalog['expiredPairs'] = [dict(natural.OLD_ROW)]
        self.catalog['drain']['expiredVerificationPairs'] = 1
        self.background = copy.deepcopy(self.fixture.catalog.background)
        self.background.update(phase='apply_verified_projection', capturedAt=self.catalog['capturedAt'],
            drain=copy.deepcopy(self.catalog['drain']),
            treasury=dict(budgetKobo=10000, reservedKobo=0, consumedKobo=10000),
            target=dict(collectionStatus='verified_success', transferStatus='verified_success',
                projectionStatus='unapplied', transferProviderTransactionId=natural.TRANSACTION))
        self.application['observedAt'] = self.catalog['capturedAt']
        self.original, self.provider = copy.deepcopy(self.fixture.original), copy.deepcopy(self.fixture.provider)
        self.original['provenance']['sourceProofObservedAt'] = self.catalog['capturedAt']
        self.original['receiptStorage']['observedAt'] = self.catalog['capturedAt']
        self.provider['observedAt'] = self.catalog['capturedAt']
        snapshot = copy.deepcopy(self.audit['firstPost'])
        snapshot['capturedAt'] = self.catalog['capturedAt']
        self.fresh = dict(capture=dict(application=self.application, protectedSnapshot=snapshot),
            bundle=dict(original=self.original, provider=self.provider), catalog=self.catalog,
            background=self.background, quiescence=dict(status='financial-writers-quiescent',
                observedAt=self.catalog['capturedAt']))
        self.row = dict(capturedAt=self.catalog['capturedAt'], rowCount=1,
            targetHash=snapshot['allowedTargetWitnesses']['prefunded_card.operations']['targetHash'],
            rowSha256=self.fixture.row_pin)
        self.blobs = dict(self.fixture.blobs)
        self.blobs['projection_preflight.py'] = (HERE / 'projection_preflight.py').read_bytes()
        self.pins = {name: hashlib.sha256(raw).hexdigest() for name, raw in self.blobs.items()}
        self.collect_count = 0
        self.row_queries = []

    def read(self, path, pin):
        return self.blobs[Path(path).name]

    def collect(self):
        self.collect_count += 1
        return copy.deepcopy(self.fresh)

    def row_reader(self, query):
        self.row_queries.append(query)
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY', query)
        self.assertIn(module.finite.ROW_QUERY, query)
        return json.dumps(self.row)

    def execute(self, **changes):
        class Clock(datetime):
            @classmethod
            def now(cls, zone=None):
                return NOW
        audit_bytes = json.dumps(self.audit).encode()
        audit_pin = hashlib.sha256(audit_bytes).hexdigest()
        def protected_read(path, pin):
            self.assertEqual(path, module.AUDIT_PATH)
            self.assertEqual(pin, audit_pin)
            return audit_bytes
        read_audit = changes.get('read_audit', protected_read)
        context = SimpleNamespace(owner=SimpleNamespace(read=changes.get('read', self.read)),
            finance={'database':self.database}, lock=10, deadline=lambda: None)
        with patch.object(module, 'datetime', Clock), patch.object(readiness, 'datetime', Clock), \
            patch.object(application_reports, 'datetime', Clock), \
            patch.object(module.finite, 'datetime', Clock), \
            patch.object(module, 'AUDIT_SHA', changes.get('audit_pin', audit_pin)), \
            patch.object(module, 'AUDIT_SIZE', len(audit_bytes)), \
            patch.object(readiness, '_protected_read', side_effect=read_audit), \
            patch.object(readiness, '_locked'), \
            patch.object(module.finite, '_bundle', side_effect=lambda *args: {
                'original':copy.deepcopy(self.original), 'provider':copy.deepcopy(self.provider)}), \
            patch.object(module.finite, '_capture', side_effect=lambda *args: changes.get('collect', self.collect)()['capture']), \
            patch.object(module.finite, '_quiet', return_value=True), \
            patch.object(natural, 'verify_catalog') as catalog_check:
            result = module.collect_projection_preflight(context, changes.get('directory', HERE), self.fixture.pins)
            self.assertTrue(all(call.args[1] == module.CATALOG_SHA256 for call in catalog_check.call_args_list))
            return result

    def database(self, query):
        if query == self.blobs['natural_reclaim_preflight.sql'].decode():
            return json.dumps(self.catalog)
        if query == self.blobs['background_preflight.sql'].decode():
            return json.dumps(self.background)
        return self.row_reader(query)

    def refused(self, **changes):
        with self.assertRaisesRegex(ValueError, '^projection_preflight_refused$'):
            self.execute(**changes)

    def test_failed_first_pass_requires_fresh_projection_proof_without_rerunning_worker(self):
        result = self.execute()
        self.assertEqual(result['summary']['phase'], 'apply_verified_projection')
        self.assertFalse(result['summary']['actionAttempted'])
        self.assertFalse(result['summary']['financialActionAuthorized'])
        self.assertEqual(result['projectionTargetRowSha256'], self.fixture.row_pin)
        self.assertEqual(len(self.row_queries), 2)
        self.assertEqual(self.fixture.worker.starts(), [])
        self.assertEqual(self.collect_count, 2)

    def test_requires_explicit_reviewed_audit_sha_and_rejects_byte_drift(self):
        self.refused(audit_pin='')
        self.refused(audit_pin='0' * 64)
        self.refused(directory=HERE.parent)

    def test_dependency_source_drift_refuses_before_collection(self):
        self.blobs['financial_reconcile_pass.py'] += b'\ndrift'
        self.refused()
        self.assertEqual(self.collect_count, 0)

    def test_retained_partial_history_and_goal_or_budget_changes_refuse(self):
        for field in ('projections', 'ledgerOperations', 'contributions', 'postings', 'aliases', 'notifications'):
            with self.subTest(field=field):
                self.audit['firstPostApplication']['completedApplication'][field] = [{}]
                self.refused()
                self.audit['firstPostApplication']['completedApplication'][field] = []
        for field, bad in (('reservedKobo', 1), ('consumedKobo', 9999), ('budgetKobo', 20000)):
            with self.subTest(field=field):
                treasury = self.audit['firstPostApplication']['completedApplication']['treasury']
                original = treasury[field]
                treasury[field] = bad
                self.refused()
                treasury[field] = original
        self.audit['firstPostApplication']['completedApplication']['goals'][0]['displayedPrincipalKobo'] = 1
        self.refused()

    def test_disallowed_retained_delta_and_full_fresh_snapshot_drift_refuse(self):
        self.audit['firstPost']['tableRows']['public.customer_savings_goals']['sha256'] = '1' * 64
        self.refused()
        self.audit['firstPost'] = copy.deepcopy(self.fixture.after)
        self.fresh['capture']['protectedSnapshot']['permanentMetadataSha256'] = '2' * 64
        self.refused()

    def test_verify_transfer_phase_and_stale_catalog_refuse(self):
        self.catalog['phase'] = 'verify_existing_transfer'
        self.refused()
        self.catalog['phase'] = 'apply_verified_projection'
        self.catalog['capturedAt'] = '2026-10-03T10:18:00.000000Z'
        self.refused()

    def test_row_witness_and_catalog_row_sha_must_independently_match(self):
        self.row['targetHash'] = '1' * 64
        self.refused()
        self.row['targetHash'] = self.fresh['capture']['protectedSnapshot']['allowedTargetWitnesses']['prefunded_card.operations']['targetHash']
        self.row['rowSha256'] = '2' * 64
        self.refused()

    def test_coordinated_alternate_row_and_catalog_pin_cannot_replace_reviewed_row(self):
        self.row['rowSha256'] = '2' * 64
        self.catalog['operations'][1]['rowSha256'] = '2' * 64
        self.refused()

    def test_production_audit_identity_and_row_pin_are_literal(self):
        self.assertEqual(module.AUDIT_SHA,
            'd1f3c7d7b1b7940731ddb196b5d7bf18e122354fc7541e70eda480e6472fc249')
        self.assertEqual(module.AUDIT_SIZE, 195682)
        self.assertEqual(str(module.AUDIT_PATH), '/root/baci-financial-reconciliation.k785s099/'
            'refused-partial-pass-4bc6d1f553b640bc910d754c961574a3.json')
        self.assertEqual(module.PROJECTION_ROW_SHA256,
            '9ab7ba2d467d2e6bfea059085e6616dbe264903d4732ac9ee49664719741ad21')

    def test_retained_transfer_and_worker_refusal_state_are_required(self):
        self.audit['workerFailed'] = False
        self.refused()
        self.audit['workerFailed'] = True
        self.audit['firstPostApplication']['completedApplication']['operation']['transferStatus'] = 'dispatching'
        self.refused()

    def test_fresh_partial_history_and_wrong_preserved_goal_refuse(self):
        self.application['completedApplication']['contributions'] = [{}]
        self.refused()
        self.application['completedApplication']['contributions'] = []
        self.application['completedApplication']['goals'][1]['canonicalPrincipalKobo'] = 9999
        self.refused()

    def test_expired_crypto_and_wrong_catalog_literal_refuse(self):
        self.original['provenance']['sourceProofObservedAt'] = '2026-10-03T10:18:00.000000Z'
        self.refused()
        self.original['provenance']['sourceProofObservedAt'] = self.catalog['capturedAt']
        self.catalog['catalogSha256'] = '1' * 64
        self.refused()

    def test_duplicate_json_keys_and_wrong_audit_size_refuse(self):
        raw = json.dumps(self.audit).encode()
        self.refused(read_audit=lambda *args: raw + b' ')
        duplicate = raw[:-1] + b',"workerFailed":true}'
        pin = hashlib.sha256(duplicate).hexdigest()
        with patch.object(module, 'AUDIT_SHA', pin), patch.object(module, 'AUDIT_SIZE', len(duplicate)), \
            patch.object(readiness, '_protected_read', return_value=duplicate):
            with self.assertRaises(ValueError):
                module._audit()

    def test_fresh_crypto_and_crosswalk_refusals_are_not_hidden(self):
        self.original['provenance']['hmacSha512Verified'] = False
        self.refused()
        self.original['provenance']['hmacSha512Verified'] = True
        self.provider['faasWalletId'] = 'foreign'
        self.refused()

    def test_final_audit_and_capture_drift_refuse(self):
        original_collect = self.collect
        def drifting_collect():
            result = original_collect()
            if self.collect_count == 2:
                result['capture']['protectedSnapshot']['tableRows']['public.synthetic_unrelated']['sha256'] = '1' * 64
            return result
        self.refused(collect=drifting_collect)
        audit_reads = 0
        def drifting_read(path, pin):
            nonlocal audit_reads
            raw = json.dumps(self.audit).encode()
            audit_reads += 1
            if audit_reads == 2:
                return raw + b' '
            return raw
        self.refused(read_audit=drifting_read)


if __name__ == '__main__':
    unittest.main()

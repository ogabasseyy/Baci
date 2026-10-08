import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
FENCE = HERE.parent / 'replay-claim-fence'
NOW = datetime(2026, 10, 3, 8, tzinfo=timezone.utc)
ACL = ['pvb_staging_replay_executor=X/pvb_staging_replay_executor',
       'pvb_staging_worker=X/pvb_staging_replay_executor']


def sha(value):
    return hashlib.sha256(value.encode()).hexdigest()


def definition():
    return ('CREATE OR REPLACE FUNCTION public.claim_piggyvest_staging_receipts(p_limit integer, p_lease_seconds integer)\n'
            ' RETURNS TABLE(receipt_id uuid, payload_sha256 text, ciphertext text, nonce text, auth_tag text, '
            'key_version text, claim_token uuid, attempts integer)\n LANGUAGE plpgsql\n SECURITY DEFINER\n'
            " SET search_path TO 'pg_catalog'\nAS $function$" + (FENCE / 'baseline-body.sql').read_text()
            + '$function$\n')


class CutoverDatabaseTests(unittest.TestCase):
    def setUp(self):
        source = HERE / 'cutover_database.py'
        if not source.is_file():
            self.fail('Bounded cutover database adapter not implemented')
        specification = importlib.util.spec_from_file_location('cutover_database_tests', source)
        self.module = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(self.module)
        self.original = definition()
        self.renderer = self.module._load_renderer()
        self.rollback_sql = self.renderer.render_transaction(self.original)
        self.commit_sql = self.renderer.render_transaction(self.original, mode='commit')
        fenced = self.commit_sql.split('$baci_fenced_definition$')[1]
        self.fenced_hash = sha(fenced)
        self.proof = dict(financialProofPassed=True, financialProofSha256='1' * 64,
                          financialProofObservedAt='2026-10-03T07:50:00Z')
        metadata = dict(oid=16487, proname='claim_piggyvest_staging_receipts', pronamespace=2200,
            proowner=123, prolang=13563, procost=100, prorows=1000, provariadic=0, prosupport='-',
            prokind='f', prosecdef=True, proleakproof=False, proisstrict=False, proretset=True,
            provolatile='v', proparallel='u', pronargs=2, pronargdefaults=0, prorettype=2249,
            proargtypes='23 23', proallargtypes=[23, 23, 2950, 25, 25, 25, 25, 25, 2950, 23],
            proargmodes=['i', 'i', 't', 't', 't', 't', 't', 't', 't', 't'],
            proargnames=['p_limit', 'p_lease_seconds', 'receipt_id', 'payload_sha256', 'ciphertext',
                         'nonce', 'auth_tag', 'key_version', 'claim_token', 'attempts'],
            proargdefaults=None, protrftypes=None, probin=None, prosqlbody=None,
            proconfig=['search_path=pg_catalog'], proacl=ACL)
        self.snapshot = dict(observedAt='2026-10-03T08:00:00Z',
            identity=dict(systemIdentifier='7686901100561231906', sessionUser='supabase_admin',
                          currentUser='supabase_admin', authenticatedUser='supabase_admin', database='postgres', localUnix=True,
                          superuser=True, readOnly=True),
            drain=dict(transactions=0, preparedTransactions=0, processingReceipts=0),
            routine=dict(oid=16487, owner='pvb_staging_replay_executor', acl=ACL, securityDefiner=True,
                         volatility='v', language='plpgsql', config=['search_path=pg_catalog'],
                         bodySha256='3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc',
                         definitionSha256='650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824',
                         metadata=metadata),
            receipts={name: dict(count=4, sha256='2' * 64) for name in (
                'receipts', 'quarantine', 'signatures')}, otherRoutinesSha256='3' * 64)
        self.current = copy.deepcopy(self.snapshot)
        self.executions = []
        self.reads = 0
        self.failure = None
        self.ack = None
        self.drift = None

    def query(self, sql):
        self.assertEqual(sql, self.module.SNAPSHOT_SQL)
        self.reads += 1
        return self.current

    def execute(self, sql):
        self.executions.append(sql)
        if sql == self.commit_sql:
            self.current['routine']['bodySha256'] = '560ca6e2881f5c6b1b51ef554a7c2abb9dcc1c5fb74f70a32b528fb1144819e3'
            self.current['routine']['definitionSha256'] = self.fenced_hash
        elif sql != self.rollback_sql:
            raise RuntimeError('Unreviewed SQL submitted')
        if self.drift:
            self.drift(self.current)
        if self.failure:
            raise RuntimeError(self.failure)
        return self.ack if self.ack is not None else ('COMMIT' if sql == self.commit_sql else 'ROLLBACK')

    def run_fence(self, mode='rollback', **options):
        with patch.object(self.module, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = NOW
            return self.module.run_fence(self.query, self.execute, self.original, self.proof,
                sha(self.rollback_sql if mode == 'rollback' else self.commit_sql), mode=mode, **options)

    def reviewed_rehearsal(self):
        result = self.run_fence()
        self.executions.clear()
        return dict(rehearsal_receipt=result['receipt'], reviewed_rehearsal_sha256=result['receiptSha256'])

    def test_default_rehearsal_restores_full_state_and_submits_only_reviewed_rollback(self):
        with patch.object(self.module, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = NOW
            result = self.module.run_fence(self.query, self.execute, self.original, self.proof, sha(self.rollback_sql))
        self.assertEqual(result['status'], 'rollback_verified_keep_stopped')
        self.assertEqual(self.executions, [self.rollback_sql])
        self.assertEqual(self.reads, 2)
        self.assertEqual(result['before'], result['after'])
        self.assertEqual(self.current, self.snapshot)

    def test_explicit_commit_requires_reviewed_rehearsal_and_changes_only_fenced_body(self):
        review = self.reviewed_rehearsal()
        result = self.run_fence('commit', **review)
        self.assertEqual(result['status'], 'fence_committed_keep_stopped')
        self.assertEqual(self.executions, [self.commit_sql])
        self.assertEqual(result['after']['routine']['definitionSha256'], self.fenced_hash)
        self.assertEqual(result['before']['routine']['metadata'], result['after']['routine']['metadata'])
        self.assertEqual(result['before']['receipts'], result['after']['receipts'])
        self.assertNotIn('restoredStateSha256', result['receipt'])
        self.assertNotEqual(result['receipt']['committedStateSha256'], result['receipt']['baselineStateSha256'])

    def test_commit_without_matching_independently_reviewed_receipt_refuses(self):
        review = self.reviewed_rehearsal()
        for options in ({}, {**review, 'reviewed_rehearsal_sha256': '0' * 64},
                        {**review, 'rehearsal_receipt': {**review['rehearsal_receipt'], 'status': 'committed'}}):
            with self.subTest(options=options):
                with self.assertRaises(ValueError):
                    self.run_fence('commit', **options)
        self.assertEqual(self.executions, [])

    def test_financial_false_before_fractional_retry_future_or_invalid_time_refuses_before_transport(self):
        for name, value in (('financialProofPassed', False), ('financialProofPassed', 1),
                            ('financialProofObservedAt', '2026-10-03T06:45:26Z'),
                            ('financialProofObservedAt', '2026-10-03T07:45:26.302324Z'),
                            ('financialProofObservedAt', '2026-10-03T08:00:01Z'),
                            ('financialProofObservedAt', 'invalid')):
            with self.subTest(name=name, value=value):
                self.proof[name] = value
                with self.assertRaises(ValueError):
                    self.run_fence()
                self.proof = dict(financialProofPassed=True, financialProofSha256='1' * 64,
                                  financialProofObservedAt='2026-10-03T07:50:00Z')
        self.assertEqual(self.reads, 0)
        self.assertEqual(self.executions, [])

    def test_wrong_physical_identity_impersonation_remote_socket_or_unsafe_snapshot_refuses(self):
        for name, value in (('systemIdentifier', '7685292944002592802'), ('sessionUser', 'postgres'),
                            ('currentUser', 'postgres'), ('authenticatedUser', 'postgres'),
                            ('database', 'foreign'), ('localUnix', False),
                            ('superuser', False), ('readOnly', False), ('superuser', 1)):
            with self.subTest(name=name):
                self.current = copy.deepcopy(self.snapshot)
                self.current['identity'][name] = value
                with self.assertRaises(ValueError):
                    self.run_fence()
        self.assertEqual(self.executions, [])

    def test_prepared_inflight_or_even_expired_processing_rows_block_without_reset(self):
        for name in self.snapshot['drain']:
            for value in (1, False):
                with self.subTest(name=name, value=value):
                    self.current = copy.deepcopy(self.snapshot)
                    self.current['drain'][name] = value
                    with self.assertRaises(ValueError):
                        self.run_fence()
        self.assertEqual(self.executions, [])

    def test_wrong_body_definition_owner_acl_definer_search_path_or_oid_blocks(self):
        for name, value in (('oid', 1), ('owner', 'postgres'), ('acl', []), ('securityDefiner', False),
                            ('volatility', 's'), ('config', ['search_path=public']),
                            ('bodySha256', '0' * 64), ('definitionSha256', '0' * 64)):
            with self.subTest(name=name):
                self.current = copy.deepcopy(self.snapshot)
                self.current['routine'][name] = value
                with self.assertRaises(ValueError):
                    self.run_fence()
        self.assertEqual(self.executions, [])

    def test_wrong_reviewed_sql_hash_or_original_source_blocks_before_transport(self):
        with patch.object(self.module, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = NOW
            for original, pin in ((self.original, '0' * 64), (self.original + 'changed', sha(self.rollback_sql))):
                with self.subTest(pin=pin):
                    with self.assertRaises(ValueError):
                        self.module.run_fence(self.query, self.execute, original, self.proof, pin)
        self.assertEqual(self.reads, 0)

    def test_postflight_detects_all_receipt_signature_routine_metadata_and_other_routine_changes(self):
        for category in ('receipts', 'quarantine', 'signatures', 'metadata', 'catalog'):
            with self.subTest(category=category):
                self.current = copy.deepcopy(self.snapshot)
                def drift(snapshot):
                    if category == 'metadata':
                        snapshot['routine']['metadata']['procost'] = 200
                    elif category == 'catalog':
                        snapshot['otherRoutinesSha256'] = '4' * 64
                    else:
                        snapshot['receipts'][category]['sha256'] = '4' * 64
                self.drift = drift
                with self.assertRaisesRegex(ValueError, 'postflight_refused_keep_stopped'):
                    self.run_fence()

    def test_changed_reviewed_baseline_blocks_commit(self):
        review = self.reviewed_rehearsal()
        self.current['receipts']['signatures']['sha256'] = '4' * 64
        with self.assertRaisesRegex(ValueError, 'rehearsal_baseline_refused'):
            self.run_fence('commit', **review)
        self.assertEqual(self.executions, [])

    def test_ambiguous_commit_is_refused_even_when_committed_and_never_sends_unfencing_sql(self):
        review = self.reviewed_rehearsal()
        self.failure = 'private-password-provider-response'
        with self.assertRaisesRegex(ValueError, '^commit_outcome_unknown_keep_stopped$'):
            self.run_fence('commit', **review)
        self.assertEqual(self.executions, [self.commit_sql])
        self.assertEqual(self.current['routine']['definitionSha256'], self.fenced_hash)

    def test_missing_or_wrong_transaction_ack_refuses_keep_stopped(self):
        self.ack = 'COMMIT'
        with self.assertRaisesRegex(ValueError, '^rollback_outcome_unknown_keep_stopped$'):
            self.run_fence()

    def test_malformed_snapshot_or_sensitive_transport_error_is_sanitized(self):
        for query in (lambda sql: {}, lambda sql: (_ for _ in ()).throw(RuntimeError('private-secret'))):
            with self.subTest(query=query), patch.object(self.module, 'datetime', wraps=datetime) as clock:
                clock.now.return_value = NOW
                with self.assertRaisesRegex(ValueError, '^snapshot_refused$'):
                    self.module.capture_snapshot(query)

    def test_expiry_and_public_clock_override_refuse(self):
        with patch.object(self.module, 'datetime', wraps=datetime) as clock:
            clock.now.return_value = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)
            with self.assertRaisesRegex(ValueError, 'fixed_deadline_expired'):
                self.module.capture_snapshot(self.query)
        with self.assertRaises(TypeError):
            self.module.capture_snapshot(self.query, now=NOW)

    def test_snapshot_observed_during_transport_is_not_mistaken_for_future_evidence(self):
        self.current['observedAt'] = '2026-10-03T08:00:01Z'
        with patch.object(self.module, 'datetime', wraps=datetime) as clock:
            clock.now.side_effect = [NOW, NOW + timedelta(seconds=2), NOW + timedelta(seconds=2)]
            result = self.module.capture_snapshot(self.query)
        self.assertEqual(result['observedAt'], '2026-10-03T08:00:01Z')

    def test_partial_or_nonboolean_full_routine_metadata_refuses(self):
        for mutate in (lambda data: data.pop('proargtypes'), lambda data: data.update(prosecdef=1)):
            with self.subTest(mutate=mutate):
                self.current = copy.deepcopy(self.snapshot)
                mutate(self.current['routine']['metadata'])
                with self.assertRaises(ValueError):
                    self.run_fence()
        self.assertEqual(self.executions, [])

    def test_snapshot_sql_preserves_full_state_and_only_counts_client_transactions_pg17(self):
        specification = importlib.util.spec_from_file_location('disposable_cutover_fixture', FENCE / 'postgres.test.py')
        fixtures = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(fixtures)
        cases = fixtures.ClaimFencePostgresTests
        cases.setUpClass()
        case = cases('test_fixture_definition_matches_parent_live_definition_pin')
        try:
            case.setUp()
            case.fixture()
            case.sql('CREATE TABLE public.piggyvest_staging_receipt_signatures(receipt_id uuid PRIMARY KEY, signature text);')
            system = case.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
            sql = self.module.SNAPSHOT_SQL.replace("'supabase_admin'", "'postgres'").replace(self.module.SYSTEM, system)
            sql = sql.replace("current_database()<>'postgres'", "current_database()<>'" + case.database + "'")
            before = json.loads(case.sql(sql).stdout)
            self.assertIs(type(before['routine']['oid']), int)
            self.assertIs(type(before['routine']['metadata']['oid']), int)
            self.assertEqual(before['routine']['bodySha256'], '3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc')
            self.assertTrue(before['identity']['readOnly'])
            self.assertEqual(before['drain']['processingReceipts'], 1)
            self.assertEqual(before['receipts']['receipts']['count'], 4)
            for backend, count in (('autovacuum worker', 0), ('client backend', 1)):
                activity = f"""FROM (VALUES (current_database(),pg_backend_pid()+1,now(),'{backend}'),
                  (current_database(),pg_backend_pid(),now(),'client backend'),
                  (current_database(),pg_backend_pid()+2,NULL::timestamptz,'client backend'),
                  ('foreign_fixture',pg_backend_pid()+3,now(),'client backend'))
                  pg_stat_activity(datname,pid,xact_start,backend_type)"""
                observed = json.loads(case.sql(sql.replace('FROM pg_stat_activity\n   WHERE', activity+'\n   WHERE')).stdout)
                self.assertEqual(observed['drain']['transactions'], count)
            case.sql("UPDATE public.piggyvest_staging_receipts SET ciphertext='different-synthetic-bytes';"
                     "INSERT INTO public.piggyvest_staging_receipt_signatures VALUES('20000000-0000-4000-8000-000000000001','synthetic');")
            after = json.loads(case.sql(sql).stdout)
            for name in ('receipts', 'signatures'):
                self.assertNotEqual(before['receipts'][name]['sha256'], after['receipts'][name]['sha256'])
            self.assertEqual(before['routine'], after['routine'])
        finally:
            case.doCleanups()
            cases.tearDownClass()


if __name__ == '__main__':
    unittest.main()

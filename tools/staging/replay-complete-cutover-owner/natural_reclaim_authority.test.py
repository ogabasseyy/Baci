import copy
from datetime import datetime, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import re
import unittest
import natural_reclaim_authority as module
HERE = Path(__file__).resolve().parent
SOURCE = HERE.parent / 'prefunded-card'
NOW = datetime(2026, 10, 3, 7, 10, tzinfo=timezone.utc)


def catalog_pin(report):
    lines = ['function:' + name + ':' + value['metadataSha256']
             for name, value in report['routines'].items()]
    lines += ['trigger:' + value['table'] + '.' + value['name'] + ':' + value['metadataSha256']
              for value in report['triggers']]
    return hashlib.sha256('\n'.join(sorted(lines)).encode()).hexdigest()


class NaturalReclaimTests(unittest.TestCase):
    def setUp(self):
        self.sources = {name: (SOURCE / name).read_bytes() if '/' not in name
            else (HERE.parents[2] / name).read_bytes() for name in module.SOURCE_FILES}
        self.report = dict(version=1, sourceClosureSha256=module.SOURCE_CLOSURE,
            phase='verify_existing_transfer', capturedAt='2026-10-03T07:09:48.000000Z',
            identity=dict(module.IDENTITY, databaseOid=5, roleOid=10),
            drain={name: 0 for name in module.DRAIN_KEYS},
            operations=[dict(module.OLD_ROW), dict(module.TARGET_ROW)],
            expiredPairs=[dict(module.OLD_ROW), dict(module.TARGET_ROW)],
            retirement=dict(module.RETIREMENT),
            retiredIntent=dict(module.RETIRED_INTENT),
            routines={}, triggers=[])
        self.report['drain']['expiredVerificationPairs'] = 2
        for name, (oid, body, returns, definer, defaults) in module.FUNCTIONS.items():
            self.report['routines'][name] = dict(oid=oid or 46418, ownerOid=10,
                owner='postgres', language='plpgsql', securityDefiner=definer,
                configuration=['search_path=pg_catalog'], acl=module.function_acl(name),
                bodySha256=body, metadataSha256=module.INTENT_GUARD_METADATA if name == module.INTENT_GUARD
                    else hashlib.sha256(name.encode()).hexdigest(),
                returnType=returns, kind='f', volatility='v', parallel='u', strict=False,
                leakproof=False, argumentDefaults=defaults)
        for (table, name), (function_oid, kind) in module.TRIGGERS.items():
            self.report['triggers'].append(dict(table=table, name=name, functionOid=function_oid,
                type=kind, enabled='O', internal=False, argumentCount=0, hasCondition=False,
                constraintTrigger=False, metadataSha256=module.INTENT_TRIGGER_METADATA.get((table, name),
                    hashlib.sha256(name.encode()).hexdigest())))
        self.pin = catalog_pin(self.report)
        self.report['catalogSha256'] = self.pin
        self.background = dict(version=1, phase=self.report['phase'], capturedAt=self.report['capturedAt'],
            identity={key: self.report['identity'][key] for key in module.BACKGROUND_IDENTITY_KEYS},
            scope=dict(module.SCOPE, workerLogin='synthetic_restricted_login'),
            blockers=['verification_leases'], drain=copy.deepcopy(self.report['drain']),
            work=dict(otherNonretiredUnfinishedOperations=0, recoveryPhaseIntents=0, scopedRecoveryCandidates=0),
            target=dict(collectionStatus='verified_success', transferStatus='dispatching', projectionStatus='unapplied'),
            principalsKobo=dict(oldGoal=10000, newGoal=0),
            treasury=dict(budgetKobo=10000, reservedKobo=10000, consumedKobo=0))

    def execute(self, **kwargs):
        return module.classify_natural_reclaim(self.report, self.background, source_files=self.sources,
            reviewed_catalog_sha256=self.pin, now=NOW, **kwargs)

    def refused(self, **kwargs):
        with self.assertRaisesRegex(ValueError, '^natural_reclaim_refused$'):
            self.execute(**kwargs)

    def test_accepts_only_exact_known_expired_pair_set_without_financial_authority(self):
        before = copy.deepcopy((self.report, self.background))
        result = self.execute()
        self.assertEqual(result['classifiedBlocker'], 'verification_leases')
        self.assertTrue(result['safelyNaturallyReclaimable'])
        self.assertFalse(result['financialActionAuthorized'])
        self.assertEqual(result['requiredIndependentProofs'],
            ['fresh_verified_native_evidence', 'quiescence', 'full_financial_baseline'])
        self.assertEqual(before, (self.report, self.background))
        self.assertNotIn('verificationToken', json.dumps(result))

    def test_projection_requires_target_pair_absent_and_independent_post_reclaim_row_pin(self):
        target = self.report['operations'][1]
        target.update(transferStatus='verified_success', transferProviderTransactionId=module.TRANSACTION,
            verificationFence=327, tokenSha256=None, leaseExpiresAt=None, rowSha256='e' * 64)
        self.report.update(phase='apply_verified_projection', expiredPairs=[dict(module.OLD_ROW)])
        self.report['drain']['expiredVerificationPairs'] = 1
        self.background.update(phase=self.report['phase'], drain=copy.deepcopy(self.report['drain']),
            target=dict(collectionStatus='verified_success', transferStatus='verified_success',
                projectionStatus='unapplied', transferProviderTransactionId=module.TRANSACTION),
            treasury=dict(budgetKobo=10000, reservedKobo=0, consumedKobo=10000))
        self.refused()
        self.assertEqual(self.execute(projection_target_row_sha256='e' * 64)['phase'], 'apply_verified_projection')
        target['tokenSha256'] = module.TARGET_ROW['tokenSha256']
        self.refused(projection_target_row_sha256='e' * 64)

    def test_extra_missing_or_changed_expired_row_is_not_ignored(self):
        for mutation in ('extra', 'missing', 'hash', 'token', 'fence', 'expiry', 'state', 'retired'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == 'extra':
                    self.report['expiredPairs'].append(dict(module.OLD_ROW, id='foreign'))
                elif mutation == 'missing':
                    self.report['expiredPairs'].pop()
                else:
                    key, value = {'hash': ('rowSha256', 'f' * 64), 'token': ('tokenSha256', 'f' * 64),
                        'fence': ('verificationFence', 327), 'expiry': ('leaseExpiresAt', 'infinity'),
                        'state': ('transferStatus', 'not_started'), 'retired': ('checkoutRetired', True)}[mutation]
                    self.report['expiredPairs'][1][key] = value
                self.refused()

    def test_retired_history_audit_and_terminal_intent_full_row_hash_are_exact(self):
        for section, key, value in [('operations', 'tokenSha256', 'e' * 64),
            ('retirement', 'rowSha256', 'e' * 64), ('retirement', 'intentId', module.TARGET),
            ('retiredIntent', 'phase', 'pending'), ('retiredIntent', 'rowSha256', 'f' * 64)]:
            with self.subTest(section=section, key=key):
                self.setUp()
                record = self.report[section][0] if section == 'operations' else self.report[section]
                record[key] = value
                self.refused()

    def test_active_malformed_dispatch_initialization_or_writer_drain_refuses(self):
        for name in module.DRAIN_KEYS - {'expiredVerificationPairs'}:
            with self.subTest(name=name):
                self.setUp()
                self.report['drain'][name] = 1
                self.background['drain'][name] = 1
                self.refused()

    def test_no_other_background_blocker_phase_work_budget_or_scope_can_be_overridden(self):
        for mutation in ('blocker', 'phase', 'work', 'budget', 'goal', 'scope'):
            with self.subTest(mutation=mutation):
                self.setUp()
                if mutation == 'blocker': self.background['blockers'].append('target_queue')
                elif mutation == 'phase': self.background['phase'] = 'foreign'
                elif mutation == 'work': self.background['work']['scopedRecoveryCandidates'] = 1
                elif mutation == 'budget': self.background['treasury']['reservedKobo'] = 9999
                elif mutation == 'goal': self.background['principalsKobo']['newGoal'] = 10000
                else: self.background['scope']['operationId'] = module.OLD
                self.refused()

    def test_wrong_physical_identity_nonreadonly_bool_coercion_or_stale_reports_refuse(self):
        for section, key, value in [('identity', 'systemIdentifier', 'foreign'), ('identity', 'readOnly', 1),
            ('identity', 'localSocket', False), ('identity', 'isolation', 'read committed'),
            ('identity', 'database', 'other'), (None, 'capturedAt', '2026-10-03T07:08:00Z'),
            (None, 'capturedAt', '2026-10-03T07:11:00Z')]:
            with self.subTest(key=key):
                self.setUp()
                (self.report[section] if section else self.report)[key] = value
                self.refused()

    def test_oid_body_acl_definer_and_full_catalog_changes_refuse(self):
        for key, value in [('oid', 1), ('bodySha256', 'f' * 64), ('securityDefiner', False),
            ('acl', ['=X/postgres']), ('configuration', ['search_path=public']),
            ('metadataSha256', 'f' * 64), ('owner', 'other')]:
            with self.subTest(key=key):
                self.setUp()
                self.report['routines']['claim_reconciliation(uuid,integer)'][key] = value
                self.refused()

    def test_immutable_guards_remain_invokers_and_intent_metadata_stays_reviewed(self):
        for name, key, value in [('reject_projection_mutation()', 'securityDefiner', True),
            (module.INTENT_GUARD, 'securityDefiner', True), (module.INTENT_GUARD, 'metadataSha256', 'f' * 64)]:
            self.setUp()
            self.report['routines'][name][key] = value
            if key == 'metadataSha256': self.report['catalogSha256'] = self.pin = catalog_pin(self.report)
            self.refused()

    def test_every_retirement_trigger_must_be_exact_enabled_and_unconditional(self):
        for index in range(len(module.TRIGGERS)):
            for key, value in [('enabled', 'D'), ('enabled', 'A'), ('functionOid', 1),
                ('type', 0), ('hasCondition', True), ('argumentCount', 1), ('metadataSha256', 'f' * 64)]:
                with self.subTest(index=index, key=key):
                    self.setUp()
                    self.report['triggers'][index][key] = value
                    if index >= len(module.TRIGGERS) - 2 and key == 'metadataSha256':
                        self.report['catalogSha256'] = self.pin = catalog_pin(self.report)
                    self.refused()

    def test_missing_catalog_review_source_bytes_or_expired_fixed_cutoff_refuse(self):
        self.pin = None
        self.refused()
        self.setUp()
        self.sources['storage-functions.sql'] += b'\n'
        self.refused()
        self.setUp()
        with self.assertRaisesRegex(ValueError, '^natural_reclaim_refused$'):
            module.classify_natural_reclaim(self.report, self.background, source_files=self.sources,
                reviewed_catalog_sha256=self.pin, now=datetime(2026, 10, 6, 15, 49, 10, tzinfo=timezone.utc))

    def test_sql_is_readonly_and_global_background_guard_is_retained(self):
        sql = (HERE / 'natural_reclaim_preflight.sql').read_text()
        self.assertIn('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY;', sql)
        self.assertTrue(sql.rstrip().endswith('ROLLBACK;'))
        self.assertNotRegex(sql, r'\b(?:INSERT|UPDATE|DELETE|TRUNCATE|COMMIT|GRANT)\b')
        self.assertIn("current_database() IS DISTINCT FROM 'postgres'", sql)
        self.assertIn(module.SOURCE_CLOSURE, sql)
        background = (HERE / 'background_preflight.sql').read_text()
        self.assertIn("(drain.payload->>'expiredVerificationPairs')::bigint<>0", background)
        self.assertLess(len(sql.splitlines()), 300)

    def test_body_pins_are_derived_from_pinned_canonical_retirement_and_claim_boundary_sources(self):
        specification = importlib.util.spec_from_file_location('natural_source_derivation', SOURCE/'checkout_retirement_patches.py')
        patches = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(patches)
        definitions = patches.definitions(SOURCE)
        bodies = {signature: body for signature, before, body, definition, definer in definitions}
        guard = next(value for value in definitions if value[0] == module.INTENT_GUARD)
        self.assertEqual(hashlib.sha256(guard[2].encode()).hexdigest(), module.FUNCTIONS[module.INTENT_GUARD][1])
        self.assertIs(guard[4], False)
        migration = self.sources[module.MIGRATION].decode()
        changes = re.findall(r"anchor:='([^']*)';\s+replacement:=\$(due|reconciliation)\$(.*?)\$\2\$;", migration, re.DOTALL)
        self.assertEqual(len(changes), 2)
        for name, (anchor, kind, replacement) in zip(module.CLAIMS, changes):
            self.assertEqual(bodies[name].count(anchor), 1)
            self.assertEqual(hashlib.sha256(bodies[name].replace(anchor, replacement).encode()).hexdigest(),
                             module.FUNCTIONS[name][1])
        for filename, names in [('storage-functions.sql', ('complete_reconciliation', 'record_transfer', 'lock_scoped_operation')),
            ('checkout-retirement-storage.sql', ('checkout_is_retired', 'guard_retired_checkout_operation', 'guard_retired_checkout_credit')),
            ('projection-storage.sql', ('reject_projection_mutation',))]:
            for name in names:
                body = re.findall(r'CREATE (?:OR REPLACE )?FUNCTION prefunded_card\.'+name+r'\s*\([\s\S]*?\$\$([\s\S]*?)\$\$;',
                                  self.sources[filename].decode())
                self.assertEqual(len(body), 1)
                signature = next(key for key in module.FUNCTIONS if key.startswith(name+'('))
                self.assertEqual(hashlib.sha256(body[0].encode()).hexdigest(), module.FUNCTIONS[signature][1])
        actual = {name: hashlib.sha256(value).hexdigest() for name, value in self.sources.items()}
        self.assertEqual(actual, module.SOURCE_FILES)
        self.assertEqual(hashlib.sha256(json.dumps(actual, sort_keys=True, separators=(',', ':')).encode()).hexdigest(), module.SOURCE_CLOSURE)
class CollectorPostgresTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        specification = importlib.util.spec_from_file_location('natural_collector_fixture',
            HERE.parent / 'replay-claim-fence/postgres.test.py')
        fixture = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(fixture)
        cls.fixture_type = fixture.ClaimFencePostgresTests
        cls.fixture_type.setUpClass()
        cls.addClassCleanup(cls.fixture_type.tearDownClass)

    def setUp(self):
        self.harness = self.fixture_type('runTest')
        self.harness.setUp()
        self.addCleanup(self.harness.doCleanups)
        self.sql = self.harness.sql
        self.sql("""CREATE SCHEMA prefunded_card; CREATE SCHEMA piggyvest_savings_ledger;
CREATE TABLE prefunded_card.operations(id uuid,verification_token uuid,verification_lease_expires_at timestamptz,
 verification_fence bigint,transfer_fence bigint,checkout_retired boolean,collection_status text,
 transfer_status text,projection_status text,transfer_provider_transaction_id text,private_note text);
CREATE TABLE prefunded_card.checkout_intents(id uuid,operation_id uuid,phase text,initialization_token uuid,initialization_lease_expires_at timestamptz);
CREATE TABLE prefunded_card.dispatch_queue(claim_token uuid,lease_expires_at timestamptz);
CREATE TABLE prefunded_card.checkout_retirements(operation_id uuid,intent_id uuid,retired_at timestamptz,approval jsonb);
CREATE TABLE prefunded_card.provider_aliases(id uuid); CREATE TABLE prefunded_card.projections(id uuid);
CREATE TABLE piggyvest_savings_ledger.operations(id uuid);""")
        self.sql(''.join('CREATE FUNCTION prefunded_card.' + name + ' RETURNS ' + returns
            + ' LANGUAGE plpgsql ' + ('SECURITY DEFINER ' if definer else '')
            + 'SET search_path=pg_catalog AS $$ BEGIN RETURN NULL; END $$;'
            for name, (oid, body, returns, definer, defaults) in module.FUNCTIONS.items()))
        self.sql(f"""INSERT INTO prefunded_card.operations VALUES
 ('{module.OLD}','10000000-0000-4000-8000-000000000001','2026-09-29T12:08:29.087723Z',1556,0,true,'pending','not_started','unapplied',NULL,'PRIVATE_ROW_MARKER'),
 ('{module.TARGET}',NULL,NULL,327,1,false,'verified_success','verified_success','unapplied','{module.TRANSACTION}',NULL);
INSERT INTO prefunded_card.checkout_intents VALUES ('{module.OLD}','{module.OLD}','retired_unconfirmed',NULL,NULL);
INSERT INTO prefunded_card.checkout_retirements VALUES ('{module.OLD}','{module.OLD}','2026-09-29T12:08:45.240803Z','{{"private":"PRIVATE_APPROVAL_MARKER"}}');""")
        self.sql(''.join('CREATE TRIGGER ' + name + ' BEFORE '
            + {7: 'INSERT', 23: 'INSERT OR UPDATE', 27: 'DELETE OR UPDATE', 34: 'TRUNCATE'}[kind]
            + ' ON ' + table + ' FOR EACH ' + ('STATEMENT' if kind == 34 else 'ROW')
            + ' EXECUTE FUNCTION prefunded_card.' + next(signature for signature, values in module.FUNCTIONS.items()
                if values[0] == function_oid) + ';' for (table, name), (function_oid, kind) in module.TRIGGERS.items()))
        self.system = self.sql('SELECT system_identifier::text FROM pg_control_system();').stdout.strip()
        self.source = (HERE / 'natural_reclaim_preflight.sql').read_text()

    def test_real_pg17_collector_preserves_numeric_oids_hashes_and_redacts_private_rows(self):
        source = self.source.replace(module.IDENTITY['systemIdentifier'], self.system).replace(
            "current_database() IS DISTINCT FROM 'postgres'",
            f"current_database() IS DISTINCT FROM '{self.harness.database}'")
        output = self.sql(source).stdout
        report = json.loads(output)
        self.assertIs(report['identity']['readOnly'], True)
        self.assertIs(type(report['identity']['databaseOid']), int)
        self.assertEqual(report['phase'], 'apply_verified_projection')
        self.assertEqual(report['drain']['expiredVerificationPairs'], 1)
        self.assertEqual(report['catalogSha256'], catalog_pin(report))
        self.assertTrue(all(type(value['oid']) is int and type(value['ownerOid']) is int
                            for value in report['routines'].values()))
        self.assertNotIn('PRIVATE_', output)
        self.assertNotIn('10000000-0000-4000-8000-000000000001', output)
        old = next(row for row in report['operations'] if row['id'] == module.OLD)
        self.assertEqual(old['tokenSha256'], hashlib.sha256(b'10000000-0000-4000-8000-000000000001').hexdigest())
        row_hash = self.sql("SET timezone='UTC'; SET datestyle='ISO, YMD'; "
            f"SELECT encode(sha256(convert_to(to_jsonb(stored)::text,'UTF8')),'hex') "
            f"FROM prefunded_card.operations stored WHERE id='{module.OLD}';").stdout.strip()
        self.assertEqual(old['rowSha256'], row_hash)

    def test_original_collector_refuses_disposable_physical_database_without_waiver(self):
        result = self.sql(self.source, checked=False)
        self.assertNotEqual(result.returncode, 0)
        self.assertIn('natural_reclaim_refused', result.stderr)
        self.assertEqual(result.stdout, '')

if __name__ == '__main__':
    unittest.main()

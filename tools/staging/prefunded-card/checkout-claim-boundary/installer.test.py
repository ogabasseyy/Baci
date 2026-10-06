import copy
import hashlib
import importlib.util
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('claim_installer', HERE / 'installer.py')
MODULE = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(MODULE)


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
        allow_nan=False, separators=(',', ':')).encode()).hexdigest()


def fixture():
    functions = {}
    for index, signature in enumerate(MODULE.SIGNATURES):
        anchor, _replacement = MODULE._patches(MODULE._source(None))[index]
        body = 'BEGIN\n' + anchor + '\nEND;'
        functions[signature] = dict(oid=101 + index, ownerOid=10, owner='postgres',
            acl=['postgres=X/postgres', 'worker=X/postgres'], configuration=['search_path=pg_catalog'],
            language='plpgsql', securityDefiner=True, catalogSha256='a' * 64,
            body=body, bodySha256=hashlib.sha256(body.encode()).hexdigest())
    return dict(version=1, capturedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'),
        sourceClosureSha256=MODULE._closure(MODULE._source(None)),
        identity=dict(systemIdentifier=MODULE.SYSTEM, database='owner_supplied_database',
            databaseOid=5, sessionUser='postgres', currentUser='postgres', roleOid=10,
            superuser=True, localSocket=True, sessionReplicationRole='origin'),
        functions=functions, unsupportedRelations=[], permanentMetadataSha256='b' * 64,
        tableRows={name: dict(oid=201 + index, count=0, sha256='c' * 64)
            for index, name in enumerate(MODULE.REQUIRED_TABLES)})


class InstallerTests(unittest.TestCase):
    def setUp(self):
        self.evidence = fixture()

    def render(self, evidence=None, **options):
        evidence = self.evidence if evidence is None else evidence
        return MODULE.render(evidence, reviewed_evidence_sha256=digest(evidence), **options)

    def receipt(self):
        return dict(version=1, evidenceSha256=digest(self.evidence),
            sourceClosureSha256=self.evidence['sourceClosureSha256'],
            rollbackSqlSha256=hashlib.sha256(self.render().encode()).hexdigest(),
            expectedFunctionsSha256=digest(MODULE._after(self.evidence, MODULE._source(None))),
            permanentMetadataSha256=self.evidence['permanentMetadataSha256'],
            tableRowsSha256=digest(self.evidence['tableRows']), rolledBack=True,
            restoredSnapshotSha256=digest({key: value for key, value in self.evidence.items() if key != 'capturedAt'}),
            postflightPassed=True, rollbackVerified=True, independentlyReviewed=True,
            reviewedAt=datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z'))

    def test_default_is_guarded_rollback_with_only_pinned_rewriter(self):
        rendered = self.render()
        self.assertTrue(rendered.endswith('ROLLBACK;\n'))
        self.assertNotIn('COMMIT;', rendered)
        self.assertIn(MODULE._source(None), rendered)
        self.assertIn('CREATE TEMP TABLE', rendered)
        self.assertNotIn('CREATE ROLE', rendered)
        self.assertNotIn('GRANT ', rendered)
        self.assertNotIn('INSERT INTO prefunded_card.', rendered)

    def test_materialized_same_owner_locks_are_between_two_exact_guards_before_pinned_rewriter(self):
        rendered = self.render()
        materialized = rendered.index('DO $materialized_locks$')
        rewriter = rendered.index('DO $claim_boundary$')
        self.assertLess(rendered.index('DO $guard$'), materialized)
        self.assertLess(materialized, rendered.index('DO $guard$', materialized))
        self.assertLess(rendered.index('DO $guard$', materialized), rewriter)
        self.assertNotIn('REFRESH MATERIALIZED VIEW', rendered)
        self.assertIn("entry.nspname,entry.relname,entry.owner_name", rendered)

    def test_materialized_file_is_in_the_reviewed_closure(self):
        pins = {name: hashlib.sha256((HERE / name).read_bytes()).hexdigest() for name in MODULE.RUNTIME_FILES}
        pins[MODULE.MIGRATION] = MODULE.SOURCE_PIN
        self.assertIn('materialized-locks.sql', pins)
        self.assertEqual(digest(pins), self.evidence['sourceClosureSha256'])

    def test_prior_materialized_refusal_closure_cannot_authorize_new_installer(self):
        self.evidence['sourceClosureSha256'] = 'da110c78710170c8b2ba7ff9b1929f8535472d0306bb9fa65d7ab0d8a25e4aa7'
        with self.assertRaisesRegex(ValueError, 'source_closure_pin'):
            self.render()

    def test_materialized_population_and_owner_pin_shape_are_strict(self):
        row = dict(oid=500, count=0, sha256='e' * 64, kind='m', populated=False,
            ownerOid=10, owner='postgres')
        self.evidence['tableRows']['public.synthetic_materialized'] = row
        self.assertTrue(self.render().endswith('ROLLBACK;\n'))
        for field, value in dict(ownerOid=0, owner='', populated='false', count=1, kind='f').items():
            evidence = copy.deepcopy(self.evidence)
            evidence['tableRows']['public.synthetic_materialized'][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'materialized_row_pin'):
                self.render(evidence)

    def test_explicit_root_staged_bytes_equal_canonical_default(self):
        source = MODULE._source(None).encode()
        self.assertEqual(self.render(), self.render(migration_source=source))

    def test_rejects_tampered_source_or_nonbytes(self):
        for value in (b'tampered', MODULE._source(None), b''):
            with self.subTest(value=type(value).__name__), self.assertRaises(ValueError):
                self.render(migration_source=value)

    def test_independent_evidence_hash_is_required(self):
        with self.assertRaisesRegex(ValueError, 'reviewed_evidence_pin'):
            MODULE.render(self.evidence, reviewed_evidence_sha256='0' * 64)

    def test_missing_extra_evidence_and_function_keys_refuse(self):
        for field in ('version', 'functions', 'tableRows'):
            changed = copy.deepcopy(self.evidence)
            changed.pop(field)
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.render(changed)
        changed = copy.deepcopy(self.evidence)
        changed['alias'] = 'not approved'
        with self.assertRaises(ValueError):
            self.render(changed)
        changed = copy.deepcopy(self.evidence)
        changed['functions']['unrelated()'] = changed['functions'][MODULE.SIGNATURES[0]]
        with self.assertRaises(ValueError):
            self.render(changed)

    def test_wrong_physical_owner_identity_refuses(self):
        for field, value in dict(systemIdentifier='other', currentUser='worker', sessionUser='worker',
                superuser=False, localSocket=False, sessionReplicationRole='replica', databaseOid=0).items():
            changed = copy.deepcopy(self.evidence)
            changed['identity'][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.render(changed)

    def test_stale_and_future_captures_refuse_without_clock_override(self):
        for seconds in (-301, 5):
            changed = copy.deepcopy(self.evidence)
            changed['capturedAt'] = (datetime.now(timezone.utc) + timedelta(seconds=seconds)).isoformat().replace('+00:00', 'Z')
            with self.subTest(seconds=seconds), self.assertRaisesRegex(ValueError, 'fresh_capture'):
                self.render(changed)

    def test_body_pin_owner_searchpath_acl_and_missing_table_refuse(self):
        for field, value in dict(bodySha256='0' * 64, ownerOid=11, owner='other',
                configuration=['search_path=public'], acl=['worker'], language='sql', securityDefiner=False).items():
            changed = copy.deepcopy(self.evidence)
            changed['functions'][MODULE.SIGNATURES[0]][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.render(changed)
        changed = copy.deepcopy(self.evidence)
        changed['tableRows'].pop(MODULE.REQUIRED_TABLES[0])
        with self.assertRaisesRegex(ValueError, 'financial_tables'):
            self.render(changed)

    def test_unsupported_relations_block_instead_of_silent_row_exclusion(self):
        self.evidence['unsupportedRelations'] = ['public.foreign_financial_table']
        with self.assertRaisesRegex(ValueError, 'unsupported_relations'):
            self.render()

    def test_patched_function_evidence_is_idempotent(self):
        source = MODULE._source(None)
        self.evidence['functions'] = MODULE._after(self.evidence, source)
        self.assertEqual(MODULE._after(self.evidence, source), self.evidence['functions'])
        self.assertTrue(self.render().endswith('ROLLBACK;\n'))

    def test_apply_requires_paired_reviewed_completed_rehearsal(self):
        with self.assertRaisesRegex(ValueError, 'rehearsal_receipt'):
            self.render(mode='apply')
        receipt = self.receipt()
        applied = self.render(mode='apply', receipt=receipt, reviewed_receipt_sha256=digest(receipt))
        self.assertTrue(applied.endswith('COMMIT;\n'))
        self.assertEqual(applied[:-8], self.render()[:-10])

    def test_missing_or_tampered_rehearsal_receipt_refuses(self):
        for field, value in dict(rollbackSqlSha256='0' * 64, evidenceSha256='0' * 64,
                tableRowsSha256='0' * 64, restoredSnapshotSha256='0' * 64, rollbackVerified=False, rolledBack=False,
                independentlyReviewed=False, expectedFunctionsSha256='0' * 64).items():
            receipt = self.receipt()
            receipt[field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                self.render(mode='apply', receipt=receipt, reviewed_receipt_sha256=digest(receipt))
        receipt = self.receipt()
        with self.assertRaisesRegex(ValueError, 'reviewed_receipt_pin'):
            self.render(mode='apply', receipt=receipt, reviewed_receipt_sha256='0' * 64)

    def test_changed_evidence_cannot_reuse_even_an_independently_reviewed_receipt(self):
        receipt = self.receipt()
        self.evidence['tableRows'][MODULE.REQUIRED_TABLES[0]]['sha256'] = 'd' * 64
        with self.assertRaisesRegex(ValueError, 'paired_rehearsal_receipt'):
            self.render(mode='apply', receipt=receipt, reviewed_receipt_sha256=digest(receipt))

    def test_capture_is_owner_guarded_read_only_and_finishes_rollback(self):
        captured = MODULE.render(mode='capture')
        self.assertIn('REPEATABLE READ READ ONLY', captured)
        self.assertIn(MODULE.SYSTEM, captured)
        self.assertIn(MODULE.DEADLINE, captured)
        self.assertNotIn('CREATE ', captured)
        self.assertTrue(captured.endswith('ROLLBACK;\n'))

    def test_unknown_mode_and_receipt_on_rollback_refuse(self):
        with self.assertRaises(ValueError):
            self.render(mode='execute')
        with self.assertRaises(ValueError):
            self.render(receipt=self.receipt())


if __name__ == '__main__':
    unittest.main()

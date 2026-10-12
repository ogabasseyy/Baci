import copy
import importlib.util
from datetime import datetime, timedelta, timezone
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
SPEC = importlib.util.spec_from_file_location('claim_scratch', HERE / 'snapshot.test.py')
SCRATCH = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(SCRATCH)
INSTALLER = SCRATCH.INSTALLER


class GuardTests(SCRATCH.Scratch):
    def test_exact_snapshot_accepts_and_stale_pin_refuses(self):
        evidence = self.snapshot()
        self.sql('BEGIN;' + self.temporary_expected(evidence) + self.snapshot_and_guard() + 'ROLLBACK;')
        evidence['capturedAt'] = (datetime.now(timezone.utc) - timedelta(seconds=301)).isoformat().replace('+00:00', 'Z')
        with self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
            self.sql('BEGIN;' + self.temporary_expected(evidence) + self.snapshot_and_guard() + 'ROLLBACK;')

    def test_changed_oid_body_owner_acl_database_and_row_pins_refuse(self):
        for field, value in dict(oid=1, bodySha256='0' * 64, ownerOid=1, acl=None).items():
            evidence = self.snapshot()
            if evidence['functions'][INSTALLER.SIGNATURES[0]][field] == value:
                value = ['unexpected=X/postgres']
            evidence['functions'][INSTALLER.SIGNATURES[0]][field] = value
            with self.subTest(field=field), self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
                self.sql('BEGIN;' + self.temporary_expected(evidence) + self.snapshot_and_guard() + 'ROLLBACK;')
        evidence = self.snapshot()
        evidence['identity']['databaseOid'] = 1
        with self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
            self.sql('BEGIN;' + self.temporary_expected(evidence) + self.snapshot_and_guard() + 'ROLLBACK;')

    def test_unrelated_financial_change_rolls_back_and_refuses(self):
        evidence = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
            self.sql('BEGIN;' + self.temporary_expected(evidence)
                + 'UPDATE public.customer_savings_goals SET current_amount=current_amount+1;'
                + self.snapshot_and_guard() + 'COMMIT;')
        self.assertEqual(evidence['tableRows'], self.snapshot()['tableRows'])

    def test_permanent_privilege_change_rolls_back_and_refuses(self):
        evidence = self.snapshot()
        with self.assertRaisesRegex(RuntimeError, 'exact fresh snapshot differs'):
            self.sql('BEGIN;' + self.temporary_expected(evidence)
                + 'GRANT SELECT ON public.customer_savings_goals TO PUBLIC;'
                + self.snapshot_and_guard() + 'COMMIT;')
        self.assertEqual(evidence['permanentMetadataSha256'], self.snapshot()['permanentMetadataSha256'])

    def core_rehearsal(self, ending):
        evidence = self.snapshot()
        source = INSTALLER._source(None)
        expected = copy.deepcopy(evidence)
        expected['functions'] = INSTALLER._after(evidence, source)
        settings = ''
        for signature, (anchor, replacement) in zip(INSTALLER.SIGNATURES, INSTALLER._patches(source)):
            name = 'claim_due' if signature == INSTALLER.SIGNATURES[0] else 'claim_reconciliation'
            pin = INSTALLER._sha(evidence['functions'][signature]['body'].replace(replacement, anchor))
            settings += f"SET LOCAL prefunded_card.claim_boundary_{name}_sha256='{pin}';"
        settings += f"SET LOCAL prefunded_card.claim_boundary_database='{self.database}';"
        settings += f"SET LOCAL prefunded_card.claim_boundary_system='{self.harness.system}';"
        self.sql('BEGIN;' + self.temporary_expected(evidence)
            + 'DO $locks$' + (HERE / 'identity.sql').read_text().split('DO $locks$')[1]
            + self.snapshot_and_guard() + (HERE / 'materialized-locks.sql').read_text()
            + 'DROP TABLE pg_temp.cb_snapshot;' + self.snapshot_and_guard() + settings + source
            + 'UPDATE pg_temp.cb_expected SET evidence=' + INSTALLER._literal(INSTALLER._json(expected)) + '::jsonb;'
            + 'DROP TABLE pg_temp.cb_snapshot;' + self.snapshot_and_guard() + ending + ';')
        return evidence, expected

    def test_disposable_local_rewriter_core_rehearsal_restores_bodies_and_every_row(self):
        before, _expected = self.core_rehearsal('ROLLBACK')
        after = self.snapshot()
        self.assertEqual(before['functions'], after['functions'])
        self.assertEqual(before['tableRows'], after['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])

    def test_disposable_local_rewriter_core_apply_and_repeat_change_only_two_bodies(self):
        before, expected = self.core_rehearsal('COMMIT')
        after = self.snapshot()
        self.assertEqual(expected['functions'], after['functions'])
        self.assertEqual(before['tableRows'], after['tableRows'])
        self.assertEqual(before['permanentMetadataSha256'], after['permanentMetadataSha256'])
        repeated, _expected = self.core_rehearsal('COMMIT')
        self.assertEqual(repeated['functions'], self.snapshot()['functions'])
        self.assertEqual(repeated['tableRows'], self.snapshot()['tableRows'])


if __name__ == '__main__':
    unittest.main()

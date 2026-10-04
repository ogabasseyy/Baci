import importlib.util
import json
import shutil
import tempfile
import unittest
from pathlib import Path


BASE = Path(__file__).parent


def load_module():
    spec = importlib.util.spec_from_file_location("foundation_install", BASE / "foundation-install.py")
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class FoundationInstallTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()

    def test_builds_a_single_guarded_transaction_from_only_the_reviewed_sources(self):
        sql = self.module.build_install_sql(BASE)

        self.assertTrue(sql.startswith("BEGIN;\n"))
        self.assertIn("7685292944002592802", sql)
        self.assertIn("2026-09-29T15:59:10Z", sql)
        self.assertGreaterEqual(sql.count("foundation_expired:2026-09-29T15:59:10Z"), 2)
        self.assertIn("SET LOCAL lock_timeout = '5s'", sql)
        self.assertIn("SET LOCAL statement_timeout = '60s'", sql)
        self.assertIn("pg_advisory_xact_lock", sql)
        self.assertLess(sql.index("foundation preflight"), sql.index("source: storage.sql"))
        self.assertIn("'foundation_missing:' || identifier", sql)
        self.assertIn("'public.merchants'", sql)
        self.assertIn("IF to_regclass('public.merchants') IS NOT NULL THEN", sql)
        self.assertIn("IF to_regclass('piggyvest_savings_ledger.bindings') IS NOT NULL THEN IF NOT EXISTS", sql)
        self.assertIn("foundation_conflict:prefunded_card_schema", sql)
        self.assertIn("foundation_conflict:inactive_rows", sql)
        self.assertLess(sql.index("source: storage.sql"), sql.index("source: treasury-storage.sql"))
        self.assertLess(sql.index("source: executor-roles.sql"), sql.index("source: checkout-storage.sql"))
        self.assertLess(sql.index("source: checkout-roles.sql"), sql.index("source: checkout-recovery.sql"))
        self.assertLess(sql.index("source: checkout-recovery.sql"), sql.index("foundation finalize executor roles"))
        self.assertLess(sql.index("foundation finalize executor roles"), sql.index("foundation postguard"))
        self.assertNotIn("fixture", sql.lower())
        self.assertNotIn(".test.sql", sql)
        self.assertIn("ALTER ROLE prefunded_treasury_operator NOLOGIN", sql)
        self.assertIn("ALTER ROLE prefunded_authorizer NOLOGIN", sql)
        self.assertIn("ALTER ROLE prefunded_evidence NOLOGIN", sql)
        self.assertTrue(sql.endswith("COMMIT;\n"))

    def test_refuses_a_changed_reviewed_source_before_emitting_sql(self):
        with tempfile.TemporaryDirectory() as temporary:
            copied = Path(temporary) / "prefunded-card"
            shutil.copytree(BASE, copied)
            (copied / "storage.sql").write_text("BEGIN;\nSELECT 'tampered';\nCOMMIT;\n")

            with self.assertRaisesRegex(ValueError, "checksum mismatch: storage.sql"):
                self.module.build_install_sql(copied)

    def test_exposes_postflight_that_only_reports_the_installation_boundary(self):
        postflight = self.module.POSTFLIGHT_SQL

        self.assertIn("prefunded_card", postflight)
        self.assertIn("checkout_reserve", postflight)
        self.assertIn("rolcanlogin", postflight)
        self.assertIn("checkoutFunctionCount", postflight)
        self.assertIn("operations", postflight)
        self.assertIn("treasuryBindings", postflight)
        self.assertIn("checkoutIntents", postflight)
        self.assertNotIn("INSERT", postflight)
        self.assertNotIn("UPDATE", postflight)
        self.assertNotIn("DELETE", postflight)

    def test_lists_only_machine_safe_preflight_identifiers(self):
        labels = self.module.ALLOWED_DIAGNOSTIC_LABELS

        self.assertIn("foundation_missing:public.merchants", labels)
        self.assertIn("foundation_missing:piggyvest_savings_ledger.apply(uuid,uuid,uuid,uuid,jsonb)", labels)
        self.assertIn("foundation_missing:pvb_staging_app_worker", labels)
        self.assertIn("foundation_conflict:prefunded_card_schema", labels)
        self.assertIn("foundation_conflict:piggyvest_savings_ledger.bindings_scope_key", labels)
        self.assertNotIn("password", " ".join(labels).lower())

    def test_regression_refuses_an_absent_contribution_source_constraint(self):
        preflight = self.module._preflight_sql()

        self.assertIn("contribution_constraint IS NULL OR contribution_constraint NOT IN", preflight)
        self.assertIn(
            "foundation_conflict:customer_savings_contributions_source_type_check",
            preflight,
        )

    def test_requires_fresh_roles_instead_of_reusing_unknown_memberships(self):
        preflight = self.module._preflight_sql()

        role_check = preflight.split("WHERE rolname = ANY", 1)[1].split("END IF", 1)[0]
        self.assertIn("prefunded_card_authorization_reader", role_check)
        self.assertIn("foundation_conflict:executor_role_state", role_check)
        self.assertNotIn("AND (rolcanlogin", role_check)

    def test_exposes_a_deterministic_diagnostic_labels_companion(self):
        companion = json.loads(self.module.DIAGNOSTIC_LABELS_JSON)

        self.assertEqual(companion["version"], 1)
        self.assertEqual(companion["labels"], list(self.module.ALLOWED_DIAGNOSTIC_LABELS))

    def test_does_not_require_a_merchant_column_on_the_provider_account_registry(self):
        integration_columns = [
            column for relation, column, _ in self.module.REQUIRED_COLUMNS
            if relation == "piggyvest_staging.integrations"
        ]

        self.assertEqual(integration_columns, ["id", "expected_provider_account_id", "enabled"])
        for relation in (
            "public.customers", "public.customer_savings_goals",
            "piggyvest_staging.wallet_goal_mappings", "piggyvest_savings_ledger.bindings",
        ):
            self.assertIn((relation, "merchant_id", "uuid"), self.module.REQUIRED_COLUMNS)

    def test_rehearsal_registry_matches_the_authoritative_migration(self):
        migration = BASE.parents[2] / "supabase/migrations/20260912090100_restrict_piggyvest_inbox_to_staging_registry.sql"
        declaration = "CREATE TABLE piggyvest_staging.integrations ("
        expected = migration.read_text().split(declaration, 1)[1].split("\n);", 1)[0]
        actual = (BASE / "foundation-prerequisites.test.sql").read_text().split(declaration, 1)[1].split("\n);", 1)[0]

        self.assertEqual(actual, expected)
        self.assertNotIn("merchant_id", actual)


if __name__ == "__main__":
    unittest.main()

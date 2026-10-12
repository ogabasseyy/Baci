import importlib.util
from datetime import datetime, timezone
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location("card_week_collector", HERE / "collector.py")
collector = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(collector)
sys.path.pop(0)
ROOT_SPEC = importlib.util.spec_from_file_location("root_collect", HERE / "root-collect.py")
root_collect = importlib.util.module_from_spec(ROOT_SPEC)
ROOT_SPEC.loader.exec_module(root_collect)


class BaselineRefusalTests(unittest.TestCase):
    def test_refuses_existing_inventory_without_fresh_collection_time(self):
        inventory = {"readOnly": True, "changesMade": False}
        with self.assertRaisesRegex(collector.Refused, "invalid_observed_at"):
            collector.collect(inventory, now="2026-10-02T12:00:00Z")

    def _baseline_inventory(self):
        from rebuild import APP_SYSTEM, RECEIPT_SYSTEM, SEALED, render_database_sql

        routine_rows = []
        for index, (signature, pin) in enumerate(SEALED["functions"].items(), start=1001):
            routine_rows.append({"signature": signature, "present": True, "oid": str(index),
                "owner": pin["owner"], "language": pin["language"],
                "securityDefiner": pin["securityDefiner"], "configuration": pin["configuration"],
                "acl": pin["acl"], "bodyMd5": pin["oldBodyMd5"]})
        intent = {"id": collector.INTENT_ID, "phase": "retired_unconfirmed", "amountKobo": 10000,
            "expiresAt": collector.OLD_DEADLINE, "goalId": collector.GOAL_ID,
            "customerId": "10000000-0000-4000-8000-000000000002",
            "merchantId": "10000000-0000-4000-8000-000000000001",
            "integrationId": "d91d9e87-8e0d-44de-9b84-1e1d709633d2",
            "treasuryBindingId": collector.TREASURY_ID}
        audit = {"intentId": collector.INTENT_ID, "operationId": collector.INTENT_ID,
            "intentBeforeSha256": "a" * 64, "operationBeforeSha256": "b" * 64}
        raw_app = {"systemIdentifier": APP_SYSTEM, "readOnly": True, "functions": routine_rows,
            "constraints": [{"table": "checkout_intents", "name": "checkout_intents_expires_at_check",
                "oid": "991", "definitionSha256": "c" * 64}],
            "state": {"intent": intent, "retiredOperation": {"id": collector.INTENT_ID,
                "retired": True, "collection": "pending", "transfer": "not_started",
                "projection": "unapplied"}, "retirementAudit": audit, "otherIntentCount": 0,
                "otherOperationCount": 0, "retirementAuditCount": 1, "principalKobo": 10000,
                "treasuryBudgetKobo": 10000, "treasuryAvailableKobo": 10000,
                "treasuryReservedKobo": 0, "treasuryConsumedKobo": 0, "newPaymentStarted": False}}
        database = root_collect.normalize_app(raw_app)
        receipt_functions = [{"signature": signature, "present": True, "oid": str(701 + index),
            "definitionSha256": format(4 + index, "064x"), "owner": "postgres",
            "language": "plpgsql", "securityDefiner": True,
            "configuration": ["search_path=pg_catalog"], "acl": "{postgres=X/postgres}"}
            for index, signature in enumerate(sorted(collector.RECEIPT_SIGNATURES))]
        units = [{"name": name, "loadState": "loaded", "activeState": "inactive",
            "fragmentPath": "/etc/systemd/system/" + name, "dropIns": [], "needDaemonReload": False}
            for name in sorted(collector.EXPECTED_UNITS)]
        inventory = {"readOnly": True, "changesMade": False,
            "observedAt": datetime.now(timezone.utc).isoformat(), "database": database,
            "checkoutState": database["checkoutState"], "receiptDatabase": {"systemIdentifier": RECEIPT_SYSTEM,
                "readOnly": True, "functions": receipt_functions},
            "runtime": {"issuerClaimPresent": False, "audienceClaimPresent": False}, "units": units,
            "files": [{"path": path, "sha256": format(index, "064x"), "size": 512,
                "oldDeadlineMentions": 1}
                for index, path in enumerate(SEALED["artifacts"], start=1)]}
        return inventory

    def test_sql_projection_normalizes_collects_and_renders_same_baseline(self):
        from rebuild import render_database_sql

        inventory = self._baseline_inventory()
        safe = collector.collect(inventory)
        sql = render_database_sql(safe, HERE.parents[3])
        self.assertTrue(all(row["present"] for row in safe["database"]["routines"].values()))
        self.assertIn(b"expected_oid oid := 1001::oid", sql)
        self.assertIn(b"intent_before_sha256='", sql)
        self.assertIn(b"2026-10-06T15:59:10Z", sql)
        self.assertIn(b"IS DISTINCT FROM 10000::bigint", sql)
        self.assertIn(b"retirementAudits", sql)
        self.assertIn(b"protected_before", sql)
        self.assertIn(b"LOCK TABLE pg_catalog.pg_proc, pg_catalog.pg_authid", sql)
        self.assertIn(b"definition IS NULL", sql)
        self.assertIn(b"IS DISTINCT FROM 'cccc", sql)
        self.assertIn(b"SET LOCAL TIME ZONE 'UTC'", sql)
        self.assertNotIn(b"<> 10000", sql)

    def test_refuses_wrong_retired_intent_id_in_live_projection(self):
        inventory = self._baseline_inventory()
        inventory["checkoutState"]["intentId"] = "another-intent"
        with self.assertRaisesRegex(collector.Refused, "checkout_retirement_drift"):
            collector.collect(inventory)

    def test_refuses_unit_dropin_or_pending_daemon_reload(self):
        for update in ({"dropIns": ["/etc/systemd/system/override.conf"]},
                       {"needDaemonReload": True}):
            with self.subTest(update=update):
                inventory = self._baseline_inventory()
                inventory["units"][0].update(update)
                with self.assertRaisesRegex(collector.Refused, "unit_predecessor_drift"):
                    collector.collect(inventory)

    def test_allows_missing_jwt_claims_during_expiry_only_preparation(self):
        safe = collector.collect(self._baseline_inventory())
        self.assertFalse(safe["runtime"]["issuerClaimPresent"])
        self.assertFalse(safe["runtime"]["audienceClaimPresent"])

    def test_refuses_malformed_jwt_claim_metadata(self):
        for field in ("issuerClaimPresent", "audienceClaimPresent"):
            with self.subTest(field=field):
                inventory = self._baseline_inventory()
                inventory["runtime"][field] = None
                with self.assertRaisesRegex(collector.Refused, "runtime_token_claim_metadata_invalid"):
                    collector.collect(inventory)


if __name__ == "__main__":
    unittest.main()

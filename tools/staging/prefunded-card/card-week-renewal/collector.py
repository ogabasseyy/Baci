"""Validate and minimize the root-collected, read-only renewal baseline."""

from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import re
import sys

from source_functions import APP_SYSTEM, DEADLINE, GOAL_ID, OLD_DEADLINE, RECEIPT_SYSTEM, Refused, SEALED


INTENT_ID = "d8bcf921-61b3-4647-90e2-5648e4d6967d"
TREASURY_ID = "ffffcb16-2e95-5cff-a591-e9cc81cf5f57"
CUSTOMER_ID = "10000000-0000-4000-8000-000000000002"
MERCHANT_ID = "10000000-0000-4000-8000-000000000001"
INTEGRATION_ID = "d91d9e87-8e0d-44de-9b84-1e1d709633d2"
EXPECTED_UNITS = {
    "baci-prefunded-public.service",
    "baci-prefunded-public-deadline.timer",
    "baci-prefunded-public-deadline.service",
    "baci-prefunded-background.service",
    "baci-prefunded-background.timer",
    "baci-prefunded-snapshot.service",
    "baci-prefunded-snapshot.timer",
    "baci-prefunded-deadline.timer",
    "baci-prefunded-deadline.service",
    "baci-prefunded-replay-deadline.timer",
    "baci-prefunded-replay-deadline.service",
}
HEX64 = re.compile(r"^[a-f0-9]{64}$")
RECEIPT_SIGNATURES = {
    "public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)",
    "public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)",
}


def require(condition: bool, reason: str) -> None:
    if not condition:
        raise Refused(reason)


def parse_utc(value: str) -> datetime:
    try:
        timestamp = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, ValueError):
        raise Refused("invalid_observed_at") from None
    require(timestamp.tzinfo is not None, "invalid_observed_at")
    return timestamp.astimezone(timezone.utc)


def _routine_map(rows: list[dict], sealed: dict) -> dict:
    require(isinstance(rows, list), "missing_routines")
    mapped = {row.get("signature"): row for row in rows if isinstance(row, dict)}
    require(len(mapped) == len(rows), "duplicate_or_invalid_routine")
    result = {}
    for signature, expected in sealed.items():
        row = mapped.get(signature)
        require(isinstance(row, dict) and row.get("present") is True,
                "missing_expected_routine")
        require(str(row.get("oid", "")).isdecimal(), "invalid_routine_oid")
        for field in ("owner", "language", "securityDefiner", "configuration", "acl"):
            require(row.get(field) == expected[field], "routine_predecessor_drift")
        require(row.get("bodyMd5") in (expected["oldBodyMd5"], expected["newBodyMd5"]),
                "routine_predecessor_drift")
        result[signature] = {
            "present": True,
            "oid": str(row["oid"]),
            "owner": row["owner"],
            "language": row["language"],
            "securityDefiner": row["securityDefiner"],
            "configuration": row["configuration"],
            "acl": row["acl"],
            "bodyMd5": row["bodyMd5"],
            "oldBodyMd5": expected["oldBodyMd5"],
        }
    return result


def collect(inventory: dict, now: str | None = None) -> dict:
    require(isinstance(inventory, dict), "invalid_inventory")
    require(inventory.get("readOnly") is True and inventory.get("changesMade") is False,
            "inventory_not_read_only")
    observed = parse_utc(inventory.get("observedAt"))
    current = parse_utc(now or datetime.now(timezone.utc).isoformat())
    age = (current - observed).total_seconds()
    require(0 <= age <= 300, "inventory_outside_freshness_window")

    database = inventory.get("database")
    require(isinstance(database, dict)
            and database.get("systemIdentifier") == APP_SYSTEM
            and database.get("readOnly") is True, "app_database_pin_mismatch")
    require(database.get("principalKobo") == 10_000, "principal_drift")
    treasury = database.get("treasury")
    require(isinstance(treasury, dict)
            and treasury.get("available") == 10_000
            and treasury.get("reserved") == 0
            and treasury.get("consumed") == 0, "treasury_drift")
    require(database.get("retired") == "retired_unconfirmed", "retired_intent_drift")

    checkout = inventory.get("checkoutState")
    require(isinstance(checkout, dict), "missing_checkout_state")
    require(checkout.get("goalId") == GOAL_ID and checkout.get("customerId") == CUSTOMER_ID
            and checkout.get("merchantId") == MERCHANT_ID
            and checkout.get("integrationId") == INTEGRATION_ID, "checkout_scope_drift")
    require(checkout.get("treasuryBindingId") == TREASURY_ID
            and checkout.get("intentId") == INTENT_ID
            and checkout.get("intentPhase") == "retired_unconfirmed"
            and checkout.get("intentAmountKobo") == 10_000
            and checkout.get("intentExpiry") == OLD_DEADLINE
            and checkout.get("operationRetired") is True
            and checkout.get("operationCollection") == "pending"
            and checkout.get("operationTransfer") == "not_started"
            and checkout.get("operationProjection") == "unapplied"
            and checkout.get("auditIntentId") == INTENT_ID
            and checkout.get("auditOperationId") == INTENT_ID
            and HEX64.fullmatch(checkout.get("intentBeforeSha256", ""))
            and HEX64.fullmatch(checkout.get("operationBeforeSha256", ""))
            and checkout.get("otherIntentCount") == 0
            and checkout.get("otherOperationCount") == 0
            and checkout.get("retirementAuditCount") == 1,
            "checkout_retirement_drift")
    require(checkout.get("principalKobo") == 10_000
            and checkout.get("companyBudgetKobo") == 10_000
            and checkout.get("newPaymentStarted") is False, "checkout_financial_drift")

    receipts = inventory.get("receiptDatabase")
    require(isinstance(receipts, dict)
            and receipts.get("systemIdentifier") == RECEIPT_SYSTEM
            and receipts.get("readOnly") is True, "receipt_database_pin_mismatch")
    receipt_functions = receipts.get("functions")
    require(isinstance(receipt_functions, list) and len(receipt_functions) == 2,
            "receipt_function_inventory_incomplete")
    require({row.get("signature") for row in receipt_functions if isinstance(row, dict)}
            == RECEIPT_SIGNATURES, "receipt_function_scope_drift")
    for row in receipt_functions:
        require(isinstance(row, dict) and row.get("present") is True
                and str(row.get("oid", "")).isdecimal()
                and isinstance(row.get("definitionSha256"), str)
                and HEX64.fullmatch(row["definitionSha256"])
                and isinstance(row.get("owner"), str) and isinstance(row.get("language"), str)
                and isinstance(row.get("securityDefiner"), bool)
                and isinstance(row.get("configuration"), list)
                and isinstance(row.get("acl"), str), "receipt_function_inventory_incomplete")

    routines = _routine_map(database.get("routines"), SEALED["functions"])
    constraints = database.get("constraints")
    require(isinstance(constraints, list), "missing_constraint_inventory")
    expiry_constraints = [row for row in constraints if isinstance(row, dict)
                          and row.get("table") == "checkout_intents"
                          and row.get("name") == "checkout_intents_expires_at_check"]
    require(len(expiry_constraints) == 1
            and str(expiry_constraints[0].get("oid", "")).isdecimal()
            and isinstance(expiry_constraints[0].get("definitionSha256"), str)
            and HEX64.fullmatch(expiry_constraints[0]["definitionSha256"]),
            "expiry_constraint_inventory_incomplete")
    runtime = inventory.get("runtime", {})
    units = inventory.get("units", [])
    require(isinstance(runtime, dict) and isinstance(units, list), "invalid_host_metadata")
    require(type(runtime.get("issuerClaimPresent")) is bool
            and type(runtime.get("audienceClaimPresent")) is bool,
            "runtime_token_claim_metadata_invalid")
    require(len(units) == len(EXPECTED_UNITS)
            and {row.get("name") for row in units if isinstance(row, dict)} == EXPECTED_UNITS,
            "unit_inventory_incomplete")
    for row in units:
        require(isinstance(row, dict) and row.get("loadState") == "loaded"
                and row.get("fragmentPath") == "/etc/systemd/system/" + row.get("name", "")
                and row.get("dropIns") == [] and row.get("needDaemonReload") is False,
                "unit_predecessor_drift")

    files = inventory.get("files")
    require(isinstance(files, list), "missing_file_inventory")
    file_map = {row.get("path"): row for row in files if isinstance(row, dict)}
    for path in SEALED["artifacts"]:
        row = file_map.get(path)
        require(isinstance(row, dict) and isinstance(row.get("sha256"), str)
                and HEX64.fullmatch(row["sha256"])
                and row.get("size", 0) > 0, "runtime_artifact_pin_missing")

    return {
        "observedAt": inventory["observedAt"],
        "ageSeconds": int(age),
        "database": {"systemIdentifier": APP_SYSTEM, "principalKobo": 10_000,
                     "treasury": treasury, "checkout": checkout, "routines": routines,
                     "expiryConstraint": expiry_constraints[0],
                     "roles": database.get("roles", [])},
        "receiptDatabase": {"systemIdentifier": RECEIPT_SYSTEM,
                            "functions": receipt_functions},
        "runtime": runtime,
        "units": units,
        "artifacts": {path: {"sha256": file_map[path]["sha256"],
                              "size": file_map[path]["size"]}
                      for path in SEALED["artifacts"]},
        "targetExpiry": DEADLINE,
        "changesMade": False,
    }


def main() -> int:
    try:
        inventory = json.loads(Path(sys.argv[1]).read_text())
        safe = collect(inventory)
    except Exception as error:
        reason = error.args[0] if isinstance(error, Refused) else "invalid_inventory"
        print(json.dumps({"status": "refused", "reason": reason, "changesMade": False}))
        return 1
    print(json.dumps({"status": "baseline_ready", "baseline": safe}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

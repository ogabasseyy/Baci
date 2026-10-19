"""Collect a fresh, read-only first-card renewal baseline on the owner host."""

from __future__ import annotations

import argparse
import base64
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess

from source_functions import APP_SYSTEM, RECEIPT_SYSTEM, SEALED
from runtime_artifacts import (ARTIFACTS, DEADLINE_TIMERS, OLD_CONDITION_EPOCH, NEW_CONDITION_EPOCH,
                               PUBLIC_SERVICE)


HERE = Path(__file__).resolve().parent
APP_CONTAINER = "baci-isolated-savings-db-1"
RECEIPT_CONTAINER = "pvb-staging-receipts-db"
DOCKER = ["/usr/bin/docker", "--host=unix:///var/run/docker.sock"]
SAFE_ENV = {"HOME": "/root", "PATH": "/usr/sbin:/usr/bin:/sbin:/bin", "LANG": "C", "LC_ALL": "C"}
UNITS = (
    "baci-prefunded-public.service", "baci-prefunded-public-deadline.timer",
    "baci-prefunded-public-deadline.service", "baci-prefunded-background.service",
    "baci-prefunded-background.timer", "baci-prefunded-snapshot.service",
    "baci-prefunded-snapshot.timer", "baci-prefunded-deadline.timer",
    "baci-prefunded-deadline.service", "baci-prefunded-replay-deadline.timer",
    "baci-prefunded-replay-deadline.service",
)


def command(args: list[str], input_text: str | None = None) -> str:
    result = subprocess.run(args, input=input_text, text=True, capture_output=True,
                            timeout=35, env=SAFE_ENV, check=False)
    if result.returncode or len(result.stdout) > 1_000_000:
        raise RuntimeError("readonly_collection_failed")
    return result.stdout


def query_database(container: str, client: str, username: str, filename: str) -> dict:
    sql = (HERE / filename).read_text()
    output = command([*DOCKER, "exec", "-i", container, client, "-XqAt",
        "-v", "ON_ERROR_STOP=1", "-v", "VERBOSITY=sqlstate", "-U", username,
        "-d", "postgres"], sql)
    try:
        report = json.loads(output)
    except (ValueError, TypeError):
        raise RuntimeError("readonly_query_output_invalid") from None
    if report.get("readOnly") is not True:
        raise RuntimeError("readonly_transaction_not_confirmed")
    return report


def file_pin(path: Path) -> tuple[dict, bytes]:
    info = path.lstat()
    if (not stat.S_ISREG(info.st_mode) or info.st_nlink != 1
            or info.st_mode & 0o022 or not 0 < info.st_size <= 16_000_000):
        raise RuntimeError("unsafe_installed_file")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor, "rb") as handle:
        before = os.fstat(handle.fileno())
        data = handle.read(16_000_001)
        after = os.fstat(handle.fileno())
    if (len(data) != info.st_size or len(data) > 16_000_000
            or (before.st_dev, before.st_ino) != (info.st_dev, info.st_ino)
            or before.st_mtime_ns != after.st_mtime_ns or before.st_ctime_ns != after.st_ctime_ns):
        raise RuntimeError("installed_file_changed_during_read")
    markers = (b"2026-09-29T15:59:10Z", b"2026-09-29 15:59:10 UTC", b"1790697550")
    pin = {"path": str(path), "sha256": hashlib.sha256(data).hexdigest(), "size": len(data),
           "oldDeadlineMentions": sum(data.count(marker) for marker in markers)}
    return pin, data


def copy_private(destination: Path, data: bytes) -> None:
    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(destination, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(data)
        handle.flush()
        os.fsync(handle.fileno())


def runtime_metadata(artifacts: dict[str, bytes], units: list[dict]) -> dict:
    flags = {"configuredFirstCardEnabled": set(), "savedCardsEnabled": set(), "autoDebitEnabled": set()}
    flag_keys = {
        "configuredFirstCardEnabled": {"firstCardEnabled", "cardCheckoutEnabled", "publicCheckoutEnabled",
            "checkoutPublicEnabled", "prefundedCardCheckoutEnabled", "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED"},
        "savedCardsEnabled": {"savedCardsEnabled", "PREFUNDED_CARD_SAVED_CARDS_ENABLED"},
        "autoDebitEnabled": {"autoDebitEnabled", "PREFUNDED_CARD_AUTODEBIT_ENABLED"},
    }
    source_dates = set()
    compiled_dates = set()
    token_expiries = set()
    issuer_claim_present = False
    audience_claim_present = False
    for path, content in artifacts.items():
        try:
            root = json.loads(content)
        except (ValueError, UnicodeError):
            root = None
        pending = [root] if root is not None else []
        while pending:
            node = pending.pop()
            if isinstance(node, dict):
                for key, value in node.items():
                    for label, names in flag_keys.items():
                        if key in names:
                            if type(value) is bool:
                                flags[label].add(value)
                            elif isinstance(value, str) and value.lower() in ("true", "false"):
                                flags[label].add(value.lower() == "true")
                    if (key in {"expiresAt", "expires_at", "expectedExpiresAt", "deadline"}
                            and isinstance(value, str) and len(value) <= 40):
                        (compiled_dates if path.endswith((".cjs", ".mjs")) else source_dates).add(value)
                    if isinstance(value, str) and key in {"appToken", "receiptToken", "restToken", "anonKey"}:
                        try:
                            parts = value.split(".")
                            payload = json.loads(base64.urlsafe_b64decode(
                                parts[1] + "=" * (-len(parts[1]) % 4)))
                            if type(payload.get("exp")) is int:
                                token_expiries.add(payload["exp"])
                            issuer_claim_present |= isinstance(payload.get("iss"), str)
                            audience_claim_present |= isinstance(payload.get("aud"), (str, list))
                        except (ValueError, TypeError, IndexError, UnicodeError):
                            pass
                    if isinstance(value, (dict, list)):
                        pending.append(value)
            elif isinstance(node, list):
                pending.extend(node)
        if path.endswith((".cjs", ".mjs")):
            for value in (b"2026-09-29T15:59:10Z", b"2026-10-06T15:59:10Z"):
                if value in content:
                    compiled_dates.add(value.decode())
    return {
        "configuredFirstCardEnabled": (next(iter(flags["configuredFirstCardEnabled"]))
            if len(flags["configuredFirstCardEnabled"]) == 1 else None),
        "savedCardsEnabled": next(iter(flags["savedCardsEnabled"])) if len(flags["savedCardsEnabled"]) == 1 else None,
        "autoDebitEnabled": next(iter(flags["autoDebitEnabled"])) if len(flags["autoDebitEnabled"]) == 1 else None,
        "sourceExpiry": sorted(source_dates), "compiledExpiry": sorted(compiled_dates),
        "unverifiedTokenExpiryEpochs": sorted(token_expiries), "issuerClaimPresent": issuer_claim_present,
        "audienceClaimPresent": audience_claim_present,
        "publicServiceActive": next((row.get("activeState") == "active" for row in units
            if row.get("name") == "baci-prefunded-public.service"), None),
        "physicalTlsVerified": None,
        "publicServiceConditionEpochs": sorted({
            int(match.group(1)) for path, content in artifacts.items()
            if path.endswith("/" + PUBLIC_SERVICE)
            for match in re.finditer(rb"^ExecCondition=[^\n]*?(?<!\d)("
                + re.escape(OLD_CONDITION_EPOCH) + rb"|" + re.escape(NEW_CONDITION_EPOCH)
                + rb")(?!\d)(?:\s|$)", content, re.MULTILINE)
        }),
    }


def normalize_app(raw: dict) -> dict:
    state = raw.get("state") or {}
    intent = state.get("intent") or {}
    operation = state.get("retiredOperation") or {}
    audit = state.get("retirementAudit") or {}
    routines = raw.get("functions") or []
    constraints = raw.get("constraints") or []
    normalized_functions = {row.get("signature"): row for row in routines if isinstance(row, dict)}
    expiry = [row for row in constraints if isinstance(row, dict)
              and row.get("table") == "checkout_intents"
              and row.get("name") == "checkout_intents_expires_at_check"]
    if len(expiry) != 1:
        raise RuntimeError("expiry_constraint_missing_or_ambiguous")
    checkout = {
        "goalId": intent.get("goalId"), "customerId": intent.get("customerId"),
        "merchantId": intent.get("merchantId"), "integrationId": intent.get("integrationId"),
        "treasuryBindingId": intent.get("treasuryBindingId"), "intentId": intent.get("id"),
        "intentPhase": intent.get("phase"), "intentAmountKobo": intent.get("amountKobo"),
        "intentExpiry": intent.get("expiresAt"), "operationRetired": operation.get("retired"),
        "operationCollection": operation.get("collection"), "operationTransfer": operation.get("transfer"),
        "operationProjection": operation.get("projection"), "auditIntentId": audit.get("intentId"),
        "auditOperationId": audit.get("operationId"),
        "intentBeforeSha256": audit.get("intentBeforeSha256"),
        "operationBeforeSha256": audit.get("operationBeforeSha256"),
        "otherIntentCount": state.get("otherIntentCount"),
        "otherOperationCount": state.get("otherOperationCount"),
        "retirementAuditCount": state.get("retirementAuditCount"),
        "principalKobo": state.get("principalKobo"),
        "companyBudgetKobo": state.get("treasuryBudgetKobo"),
        "newPaymentStarted": state.get("newPaymentStarted"),
    }
    pin_functions = {}
    for signature, expected in SEALED["functions"].items():
        row = normalized_functions.get(signature)
        if not isinstance(row, dict):
            raise RuntimeError("expected_function_not_found")
        pin_functions[signature] = {**row, "oldBodyMd5": row.get("bodyMd5")}
    return {
        "systemIdentifier": raw.get("systemIdentifier"), "readOnly": raw.get("readOnly"),
        "roles": raw.get("roles"),
        "principalKobo": state.get("principalKobo"), "retired": intent.get("phase"),
        "treasury": {"available": state.get("treasuryAvailableKobo"),
                     "reserved": state.get("treasuryReservedKobo"),
                     "consumed": state.get("treasuryConsumedKobo")},
        "checkoutState": checkout, "routines": list(pin_functions.values()),
        "constraints": constraints, "expiryConstraint": expiry[0],
    }


def collect(output: Path, artifact_output: Path) -> None:
    if os.geteuid() != 0:
        raise RuntimeError("root_required")
    if output.exists() or artifact_output.exists():
        raise RuntimeError("output_path_exists")
    app = query_database(APP_CONTAINER, "/nix/var/nix/profiles/default/bin/psql", "postgres", "app-baseline.sql")
    receipt = query_database(RECEIPT_CONTAINER, "psql", "supabase_admin", "receipt-baseline.sql")
    if app.get("systemIdentifier") != APP_SYSTEM or receipt.get("systemIdentifier") != RECEIPT_SYSTEM:
        raise RuntimeError("database_system_identifier_mismatch")
    database = normalize_app(app)
    file_rows = []
    artifact_bytes = {}
    artifact_output.mkdir(mode=0o700, parents=True)
    for source, relative in ARTIFACTS.items():
        pin, content = file_pin(Path(source))
        file_rows.append(pin)
        artifact_bytes[source] = content
        copy_private(artifact_output / relative, content)
    unit_rows = []
    for name in sorted(UNITS):
        properties = command(["/usr/bin/systemctl", "show", name, "-p", "LoadState", "-p",
            "ActiveState", "-p", "FragmentPath", "-p", "DropInPaths", "-p", "NeedDaemonReload"])
        values = dict(line.split("=", 1) for line in properties.splitlines() if "=" in line)
        fragment = Path(values.get("FragmentPath", ""))
        row = {"name": name, "loadState": values.get("LoadState"),
            "activeState": values.get("ActiveState"), "fragmentPath": str(fragment),
            "dropIns": [part for part in values.get("DropInPaths", "").split() if part],
            "needDaemonReload": values.get("NeedDaemonReload") == "yes"}
        if name in DEADLINE_TIMERS or name == PUBLIC_SERVICE:
            pin, content = file_pin(fragment)
            row.update(sha256=pin["sha256"], size=pin["size"])
            copy_private(artifact_output / "units" / name, content)
            if name == PUBLIC_SERVICE:
                artifact_bytes[str(fragment)] = content
        unit_rows.append(row)
    receipt_db = {"systemIdentifier": receipt.get("systemIdentifier"),
        "readOnly": receipt.get("readOnly"), "signatureTable": receipt.get("signatureTable"),
        "functions": receipt.get("functions")}
    inventory = {"readOnly": True, "changesMade": False,
        "observedAt": datetime.now(timezone.utc).isoformat(), "database": database,
        "checkoutState": database["checkoutState"], "receiptDatabase": receipt_db,
        "runtime": runtime_metadata(artifact_bytes, unit_rows),
        "units": unit_rows, "files": file_rows}
    output.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as handle:
        json.dump(inventory, handle, separators=(",", ":"), sort_keys=True)
        handle.write("\n")
        handle.flush()
        os.fsync(handle.fileno())


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True, type=Path)
    parser.add_argument("--artifacts", required=True, type=Path)
    args = parser.parse_args()
    output_preexisting = args.output.exists() or args.output.is_symlink()
    artifacts_preexisting = args.artifacts.exists() or args.artifacts.is_symlink()
    try:
        collect(args.output, args.artifacts)
    except Exception as error:
        if not output_preexisting and (args.output.exists() or args.output.is_symlink()):
            args.output.unlink()
        if not artifacts_preexisting and args.artifacts.exists() and not args.artifacts.is_symlink():
            import shutil
            shutil.rmtree(args.artifacts)
        print(json.dumps({"status": "refused", "reason": str(error)[:80],
                          "readOnly": True, "changesMade": False}))
        return 1
    print(json.dumps({"status": "baseline_collected", "inventory": str(args.output),
                      "stagedArtifacts": str(args.artifacts), "readOnly": True,
                      "changesMade": False, "secretsPrinted": False}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())

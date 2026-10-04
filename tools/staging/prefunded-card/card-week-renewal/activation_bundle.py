"""Assemble a pinned public/worker candidate without applying or starting it."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import stat
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from public_artifact import validate_archive
import public_projection as checkout_projection
from source_functions import DEADLINE, GOAL_ID, Refused, _require


APP_SHA256 = "882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2"
APP_MANIFEST_SHA256 = "42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8"
LAUNCHER_SHA256 = "d0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03"
SOURCE_MANIFEST_SHA256 = "4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7"
WORKER_MANIFEST_SHA256 = "fccc5fe11de7a7e18c5a0c38309fb57e9013729e76d31d609bc652dab77f8d6a"
WORKER_OUTPUTS = {
    "background.cjs": "f738f98b7cd847fed8da38841e0bfa4e4c66d95bd0e938e51ac6ef607d55ce83",
    "snapshot.cjs": "fd25dbfa07d191495d9bb2efab4aa0fb39d7febd056f185f2c1b9e14a4ac72bf",
    "readiness.cjs": "16a051e6cb50c867dac420bc578a27ac44216d67039122b66ac80aba571a1d33",
}
INTENT_ID = "d8bcf921-61b3-4647-90e2-5648e4d6967d"
def _digest(content: bytes) -> str:
    return hashlib.sha256(content).hexdigest()


def _read(path: Path, expected: str, limit: int) -> bytes:
    metadata = path.lstat()
    _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
             and metadata.st_size <= limit and not metadata.st_mode & 0o022,
             "unsafe_activation_input")
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, "rb") as handle:
        before = os.fstat(handle.fileno())
        content = handle.read(limit + 1)
        after = os.fstat(handle.fileno())
    _require(len(content) == metadata.st_size and len(content) <= limit
             and (before.st_dev, before.st_ino) == (metadata.st_dev, metadata.st_ino)
             and (before.st_size, before.st_mtime_ns) == (after.st_size, after.st_mtime_ns)
             and _digest(content) == expected, "activation_input_pin_mismatch")
    return content


def _candidate_read(root: Path, relative: str, limit: int) -> bytes:
    name = PurePosixPath(relative)
    _require(not name.is_absolute() and all(part not in ("", ".", "..") for part in name.parts),
             "activation_candidate_path_refused")
    path = root
    for part in name.parts[:-1]:
        path = path / part
        metadata = path.lstat()
        _require(stat.S_ISDIR(metadata.st_mode), "activation_candidate_path_refused")
    path = path / name.parts[-1]
    metadata = path.lstat()
    _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
             and metadata.st_size <= limit and not metadata.st_mode & 0o022,
             "unsafe_activation_candidate")
    content = path.read_bytes()
    _require(len(content) == metadata.st_size, "unsafe_activation_candidate")
    return content


def _write(root: Path, name: str, content: bytes) -> None:
    relative = PurePosixPath(name)
    _require(not relative.is_absolute() and all(part not in ("", ".", "..") for part in relative.parts),
             "activation_output_path_refused")
    path = root.joinpath(*relative.parts)
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, "wb") as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())


def _json(content: bytes) -> dict:
    def unique(pairs):
        value = {}
        for key, item in pairs:
            if key in value:
                raise ValueError()
            value[key] = item
        return value
    try:
        value = json.loads(content, object_pairs_hook=unique,
            parse_constant=lambda _value: (_ for _ in ()).throw(ValueError()))
    except (ValueError, UnicodeError):
        raise Refused("activation_metadata_invalid") from None
    _require(isinstance(value, dict), "activation_metadata_invalid")
    return value


def _renew_dates(value):
    if isinstance(value, dict):
        return {key: (DEADLINE if key == "expiresAt" and item == "2026-09-29T15:59:10Z"
                      else _renew_dates(item)) for key, item in value.items()}
    if isinstance(value, list):
        return [_renew_dates(item) for item in value]
    return value


def _validate_checkout(activation: bytes, activation_source_sha: str, checkout: bytes) -> None:
    old_deadline, new_deadline = b"2026-09-29T15:59:10Z", DEADLINE.encode()
    text = activation
    import re
    pattern = re.compile(rb'(?P<prefix>"(?:expiresAt|expires_at)"\s*:\s*")'
        + re.escape(new_deadline) + rb'(?P<suffix>")')
    original, count = pattern.subn(lambda match: match.group("prefix") + old_deadline
                                    + match.group("suffix"), text)
    _require(count > 0 and activation_source_sha == checkout_projection.ACTIVATION_SHA256
             and _digest(original) == checkout_projection.ACTIVATION_SHA256,
             "activation_source_predecessor_mismatch")
    try:
        projected = checkout_projection.project_checkout(original,
            checkout_projection.DEADLINE_EPOCH - 1)
        expected = _renew_dates(checkout_projection.parsed(projected))
        actual = checkout_projection.parsed(checkout)
    except Exception as error:
        raise Refused("public_checkout_schema_refused") from error
    _require(actual == expected, "public_checkout_scope_or_config_drift")


def _candidate_inputs(candidate: Path) -> tuple[dict, dict, dict[str, bytes]]:
    meta = _json(_candidate_read(candidate, "candidate.json", 131072))
    _require(meta.get("status") == "expiry_rebuild_prepared"
             and meta.get("deadline") == DEADLINE
             and meta.get("changesApplied") is False
             and meta.get("servicesRestarted") is False
             and meta.get("newPaymentStarted") is False, "renewal_candidate_state_refused")
    _require(meta.get("artifacts", {}).get("activationFlags") == {
        "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED": "true",
        "PREFUNDED_CARD_PUBLIC_ENABLED": "false",
        "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED": "false",
        "onlyFirstCardEndpointEnabled": True,
        "savedCardsConfigChanged": False, "autoDebitConfigChanged": False,
    }, "activation_flag_scope_refused")
    observed = meta.get("baselineObservedAt")
    from datetime import datetime, timezone
    try:
        timestamp = datetime.fromisoformat(observed.replace("Z", "+00:00"))
        age = (datetime.now(timezone.utc) - timestamp.astimezone(timezone.utc)).total_seconds()
    except (AttributeError, ValueError, TypeError):
        raise Refused("renewal_candidate_freshness_refused") from None
    _require(0 <= age <= 300, "renewal_candidate_freshness_refused")
    files = {}
    artifacts = meta.get("artifacts", {}).get("artifacts", [])
    required = {"/etc/baci/prefunded-card/activation.prepared.json": "activation.prepared.json",
                "/opt/baci-prefunded-public/config/checkout.json": "public/checkout.json",
                "/opt/baci-prefunded-public/receipt.json": "public/receipt.json"}
    activation_source_sha = None
    for row in artifacts:
        if isinstance(row, dict) and row.get("sourcePath") in required:
            path = row.get("candidatePath", "")
            content = _candidate_read(candidate / "artifacts", path, 16_000_000)
            _require(_digest(content) == row.get("candidateSha256"), "renewed_config_pin_mismatch")
            files[required[row["sourcePath"]]] = content
            if row["sourcePath"] == "/etc/baci/prefunded-card/activation.prepared.json":
                activation_source_sha = row.get("sourceSha256")
    _require(set(files) == set(required.values()), "renewed_config_set_incomplete")
    receipt = _json(files['public/receipt.json'])
    _require(receipt.get('archiveSha256') == APP_SHA256
             and receipt.get('manifestSha256') == APP_MANIFEST_SHA256
             and receipt.get('deadline') == DEADLINE and receipt.get('mutationsEnabled') is False,
             'readonly_public_receipt_contract_refused')
    _validate_checkout(files["activation.prepared.json"], activation_source_sha,
                       files["public/checkout.json"])
    endpoint_env = _candidate_read(candidate / "artifacts", "first-card-endpoint.env", 4096)
    _require(endpoint_env == ("PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\n"
        "PREFUNDED_CARD_PUBLIC_ENABLED=false\n"
        "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false\n").encode(),
        "activation_flag_scope_refused")
    files["first-card-endpoint.env"] = endpoint_env
    units = meta.get("artifacts", {}).get("unitArtifacts", [])
    unit_files = {}
    for row in units:
        if isinstance(row, dict) and row.get("name") in {
                "baci-prefunded-public.service", "baci-prefunded-public-deadline.timer"}:
            content = _candidate_read(candidate / "artifacts", row.get("candidatePath", ""), 1_000_000)
            _require(_digest(content) == row.get("candidateSha256"), "renewed_unit_pin_mismatch")
            unit_files[row["name"]] = content
    _require(set(unit_files) == {"baci-prefunded-public.service", "baci-prefunded-public-deadline.timer"},
             "renewed_public_unit_set_incomplete")
    sql = _candidate_read(candidate, "database-renewal.sql", 16_000_000)
    _require(_digest(sql) == meta.get("databaseSqlSha256") and sql.rstrip().endswith(b"COMMIT;"),
             "renewal_sql_pin_mismatch")
    return meta, {"units": unit_files, "sql": sql}, files


def assemble(candidate: Path, archive_path: Path, manifest_path: Path, source_manifest_path: Path,
             launcher_path: Path, worker_root: Path, rehearsal_path: Path, output: Path) -> dict:
    _require(not output.exists() and not output.is_symlink(), "activation_output_exists")
    archive = _read(archive_path, APP_SHA256, 268435456)
    archive_manifest = _read(manifest_path, APP_MANIFEST_SHA256, 16777216)
    app_files = validate_archive(archive, archive_manifest, APP_SHA256, APP_MANIFEST_SHA256)
    launcher = _read(launcher_path, LAUNCHER_SHA256, 1_000_000)
    _require(app_files.get("launch-public.cjs") == launcher, "launcher_archive_mismatch")
    source = _read(source_manifest_path, SOURCE_MANIFEST_SHA256, 1_000_000)
    source_meta = _json(source)
    _require(source_meta.get("version") == 2 and len(source_meta.get("sources", {})) == 56
             and isinstance(source_meta.get("rewrites"), dict), "source_closure_incomplete")
    worker_manifest_bytes = _read(worker_root / "artifact.manifest.json", WORKER_MANIFEST_SHA256, 1_000_000)
    worker_meta = _json(worker_manifest_bytes)
    _require(worker_meta.get("status") == "compiled-artifact-only"
             and worker_meta.get("deadline") == DEADLINE
             and worker_meta.get("financialBounds") == {"companySandboxBudgetKobo": 10000,
                 "originalPrincipalKobo": 10000, "principalMutation": False}
             and worker_meta.get("changesApplied") is False
             and worker_meta.get("providerWrites") is False
             and worker_meta.get("runtimeActivated") is False
             and worker_meta.get("externalExternals") == ["pg-native"], "worker_artifact_scope_refused")
    workers = {}
    for name, digest in WORKER_OUTPUTS.items():
        workers[name] = _read(worker_root / name, digest, 2_000_000)
    rehearsal = _json(rehearsal_path.read_bytes())
    candidate_meta, generated, configs = _candidate_inputs(candidate)
    _require(rehearsal == {"status": "rollback_rehearsal_passed",
             "databaseSqlSha256": candidate_meta["databaseSqlSha256"], "exitCode": 0,
             "rollbackConfirmed": True, "protectedStateUnchanged": True,
             "committed": False, "newPaymentStarted": False}, "sql_rehearsal_evidence_refused")
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        for name, content in app_files.items():
            _write(output, "app/" + name, content)
        for name, content in configs.items():
            _write(output, "configs/" + name, content)
        for name, content in generated["units"].items():
            _write(output, "units/" + name, content)
        for name, content in workers.items():
            _write(output, "workers/" + name, content)
        _write(output, "database-renewal.sql", generated["sql"])
        _write(output, "source-manifest.json", source)
        _write(output, "worker-artifact.manifest.json", worker_manifest_bytes)
        manifest = {"status": "prepared-inactive", "deadline": DEADLINE,
            "goalId": GOAL_ID, "retiredIntentId": INTENT_ID,
            "preservedPrincipalKobo": 10000, "approvedCompanyBudgetKobo": 10000,
            "publicArchiveSha256": APP_SHA256, "publicManifestSha256": APP_MANIFEST_SHA256,
            "launcherSha256": LAUNCHER_SHA256, "sourceManifestSha256": SOURCE_MANIFEST_SHA256,
            "workerManifestSha256": WORKER_MANIFEST_SHA256,
            "databaseSqlSha256": candidate_meta["databaseSqlSha256"],
            "firstCardOnly": True, "savedCardsEnabled": False, "autoDebitEnabled": False,
            "financialReplayEnabled": False, "cardReady": False, "publicStarted": False,
            "changesApplied": False, "newPaymentStarted": False}
        _write(output, "activation-candidate.json",
            json.dumps(manifest, sort_keys=True, separators=(",", ":")).encode())
        return manifest
    except BaseException:
        import shutil
        shutil.rmtree(output)
        raise


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    for argument in ("candidate", "archive", "manifest", "source-manifest", "launcher",
                     "worker-root", "rehearsal", "output"):
        parser.add_argument("--" + argument, required=True)
    args = parser.parse_args(argv)
    try:
        manifest = assemble(*(Path(getattr(args, name.replace("-", "_"))) for name in
            ("candidate", "archive", "manifest", "source-manifest", "launcher", "worker-root", "rehearsal", "output")))
        print(json.dumps({"status": manifest["status"], "cardReady": False,
            "publicStarted": False, "financialReplayEnabled": False,
            "newPaymentStarted": False, "deadline": DEADLINE}))
        return 0
    except Exception as error:
        reason = error.args[0] if isinstance(error, Refused) else "activation_bundle_refused"
        print(json.dumps({"status": "refused", "reason": reason,
            "changesApplied": False, "publicStarted": False, "newPaymentStarted": False}))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

"""Build private, byte-pinned runtime and deadline-timer candidates."""

from __future__ import annotations

import hashlib
import os
from pathlib import Path
import re
import stat
import tempfile

from source_functions import DEADLINE, OLD_DEADLINE, Refused, _require


ARTIFACTS = {
    "/etc/baci/prefunded-card/activation.prepared.json": "activation.prepared.json",
    "/opt/baci-prefunded-public/config/checkout.json": "public/checkout.json",
    "/opt/baci-prefunded-public/receipt.json": "public/receipt.json",
    "/opt/baci-prefunded-public/app/launch-public.cjs": "public/launch-public.cjs",
    "/opt/baci-prefunded-workers/config/background.json": "workers/background.json",
    "/opt/baci-prefunded-workers/config/snapshot.json": "workers/snapshot.json",
    "/opt/baci-prefunded-workers/code/background.cjs": "workers/background.cjs",
    "/opt/baci-prefunded-workers/code/snapshot.cjs": "workers/snapshot.cjs",
}
HEX64 = re.compile(r"^[a-f0-9]{64}$")
JSON_EXPIRY = re.compile(
    rb'(?P<prefix>"(?:expiresAt|expires_at)"\s*:\s*")'
    + OLD_DEADLINE.encode() + rb'(?P<suffix>")'
)
RECEIPT_PATH = "/opt/baci-prefunded-public/receipt.json"
RECEIPT_DEADLINE = re.compile(
    rb'(?P<prefix>"deadline"\s*:\s*")'
    + OLD_DEADLINE.encode() + rb'(?P<suffix>")'
)
CODE_EXPIRY = re.compile(
    rb'(?P<prefix>(?:expiresAt|expires_at|expectedExpiresAt|deadline)'
    rb'["\']?\s*[:=]\s*["\'])'
    + OLD_DEADLINE.encode() + rb'(?P<suffix>["\'])'
)
UNIT_DEADLINE = b"OnCalendar=2026-09-29 15:59:10 UTC"
UNIT_TARGET = b"OnCalendar=2026-10-06 15:59:10 UTC"
PUBLIC_SERVICE = "baci-prefunded-public.service"
OLD_CONDITION_EPOCH = b"1790697550"
NEW_CONDITION_EPOCH = b"1791302350"
DEADLINE_TIMERS = {
    "baci-prefunded-public-deadline.timer",
    "baci-prefunded-deadline.timer",
    "baci-prefunded-replay-deadline.timer",
}


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _private_regular_file(path: Path, expected_sha: str) -> bytes:
    metadata = path.lstat()
    _require(stat.S_ISREG(metadata.st_mode) and metadata.st_nlink == 1
             and not metadata.st_mode & 0o022 and 0 < metadata.st_size <= 16_000_000,
             "unsafe_artifact_file")
    data = path.read_bytes()
    _require(_sha(data) == expected_sha and len(data) == metadata.st_size,
             "staged_artifact_pin_mismatch")
    return data


def _expiry_hits(data: bytes, path: str, expected_hits: int) -> bytes:
    pattern = RECEIPT_DEADLINE if path == RECEIPT_PATH else (
        JSON_EXPIRY if path.endswith(".json") else CODE_EXPIRY)
    matches = list(pattern.finditer(data))
    current_pattern = re.compile(pattern.pattern.replace(OLD_DEADLINE.encode(), DEADLINE.encode()))
    current_matches = list(current_pattern.finditer(data))
    markers = (OLD_DEADLINE.encode(), b"2026-09-29 15:59:10 UTC", b"1790697550")
    total_markers = sum(data.count(marker) for marker in markers)
    allowed_current = path in (RECEIPT_PATH, '/opt/baci-prefunded-public/config/checkout.json')
    _require(type(expected_hits) is int and expected_hits == total_markers
             and (matches or (allowed_current and current_matches)),
             "expiry_occurrence_map_mismatch")
    spans = {(match.start(), match.end()) for match in matches}
    for marker in markers:
        offset = 0
        while True:
            found = data.find(marker, offset)
            if found < 0:
                break
            _require(any(start <= found < end for start, end in spans),
                     "unclassified_expiry_literal")
            offset = found + len(marker)
    _require(data.count(DEADLINE.encode()) == len(current_matches), "unclassified_expiry_literal")
    candidate = pattern.sub(lambda match: match.group("prefix") + DEADLINE.encode()
                            + match.group("suffix"), data)
    _require(candidate != data or (expected_hits == 0 and current_matches), "expiry_rebuild_incomplete")
    return candidate


def _public_service_condition(data: bytes) -> bytes:
    if OLD_CONDITION_EPOCH not in data:
        _require(data.count(NEW_CONDITION_EPOCH) == 1
                 and any(line.startswith(b"ExecCondition=") and NEW_CONDITION_EPOCH in line
                         for line in data.splitlines()), "public_service_condition_predecessor_drift")
        return data
    lines = data.splitlines(keepends=True)
    matches = [index for index, line in enumerate(lines)
               if line.startswith(b"ExecCondition=")
               and line.count(OLD_CONDITION_EPOCH) == 1]
    _require(len(matches) == 1 and data.count(OLD_CONDITION_EPOCH) == 1,
             "public_service_condition_predecessor_drift")
    index = matches[0]
    lines[index] = lines[index].replace(OLD_CONDITION_EPOCH, NEW_CONDITION_EPOCH, 1)
    return b"".join(lines)


def _write_private(path: Path, contents: bytes) -> None:
    path.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
    descriptor, temporary_name = tempfile.mkstemp(prefix=".renewal-", dir=path.parent)
    try:
        os.fchmod(descriptor, 0o600)
        with os.fdopen(descriptor, "wb") as handle:
            handle.write(contents)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary_name, path)
    except Exception:
        try:
            os.unlink(temporary_name)
        except OSError:
            pass
        raise


def prepare_artifacts(inventory: dict, artifact_root: Path, output: Path) -> dict:
    inventory_files = {row["path"]: row for row in inventory.get("files", [])
                       if isinstance(row, dict) and isinstance(row.get("path"), str)}
    public_paths = ('/opt/baci-prefunded-public/config/checkout.json', RECEIPT_PATH)
    mixed_public = any(inventory_files.get(path, {}).get('oldDeadlineMentions') == 0 for path in public_paths)
    if mixed_public:
        from mixed_public_contract import validate_mixed_public
        def captured(source):
            row = inventory_files.get(source, {})
            return _private_regular_file(artifact_root / ARTIFACTS[source], row.get('sha256'))
        def unit(name):
            rows = [row for row in inventory.get('units', []) if row.get('name') == name]
            _require(len(rows) == 1, 'mixed_public_units_refused')
            return _private_regular_file(artifact_root / 'units' / name, rows[0].get('sha256'))
        validate_mixed_public(captured('/etc/baci/prefunded-card/activation.prepared.json'),
            captured(public_paths[0]), captured(RECEIPT_PATH),
            captured('/opt/baci-prefunded-public/app/launch-public.cjs'),
            unit(PUBLIC_SERVICE), unit('baci-prefunded-public-deadline.timer'))
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    manifest = {"deadline": DEADLINE, "changesApplied": False, "artifacts": [],
        "unitArtifacts": [], "sourceRebuildRequired": []}
    for source_path, relative in ARTIFACTS.items():
        row = inventory_files.get(source_path)
        _require(isinstance(row, dict) and isinstance(row.get("sha256"), str)
                 and HEX64.fullmatch(row["sha256"]), "runtime_artifact_pin_missing")
        original = _private_regular_file(artifact_root / relative, row["sha256"])
        if source_path.endswith((".cjs", ".mjs")):
            manifest["sourceRebuildRequired"].append({"sourcePath": source_path,
                "sourceSha256": row["sha256"], "oldDeadlineMentions": row.get("oldDeadlineMentions")})
            continue
        candidate = _expiry_hits(original, source_path, row.get("oldDeadlineMentions"))
        _write_private(output / relative, candidate)
        manifest["artifacts"].append({"sourcePath": source_path, "sourceSha256": row["sha256"],
            "candidateSha256": _sha(candidate), "changedExpiryFields": row["oldDeadlineMentions"],
            "candidatePath": relative})
    units = {row.get("name"): row for row in inventory.get("units", []) if isinstance(row, dict)}
    for name in sorted(DEADLINE_TIMERS):
        row = units.get(name)
        _require(isinstance(row, dict) and isinstance(row.get("sha256"), str)
                 and HEX64.fullmatch(row["sha256"])
                 and row.get("dropIns") == [] and row.get("needDaemonReload") is False
                 and row.get("fragmentPath") == "/etc/systemd/system/" + name,
                 "deadline_timer_pin_missing")
        relative = "units/" + name
        original = _private_regular_file(artifact_root / relative, row["sha256"])
        allowed_states = ((1, 0), (0, 1)) if mixed_public and name == 'baci-prefunded-public-deadline.timer' else ((1, 0),)
        _require((original.count(UNIT_DEADLINE), original.count(UNIT_TARGET)) in allowed_states,
                 "deadline_timer_predecessor_drift")
        candidate = original.replace(UNIT_DEADLINE, UNIT_TARGET, 1)
        _write_private(output / relative, candidate)
        manifest["unitArtifacts"].append({"name": name, "sourceSha256": row["sha256"],
            "candidateSha256": _sha(candidate), "candidatePath": relative})
    service = units.get(PUBLIC_SERVICE)
    _require(isinstance(service, dict) and isinstance(service.get("sha256"), str)
             and HEX64.fullmatch(service["sha256"])
             and service.get("dropIns") == [] and service.get("needDaemonReload") is False
             and service.get("fragmentPath") == "/etc/systemd/system/" + PUBLIC_SERVICE,
             "public_service_unit_pin_missing")
    service_path = "units/" + PUBLIC_SERVICE
    service_source = _private_regular_file(artifact_root / service_path, service["sha256"])
    _require(mixed_public or OLD_CONDITION_EPOCH in service_source,
             'public_service_condition_predecessor_drift')
    service_candidate = _public_service_condition(service_source)
    _write_private(output / service_path, service_candidate)
    manifest["unitArtifacts"].append({"name": PUBLIC_SERVICE,
        "sourceSha256": service["sha256"], "candidateSha256": _sha(service_candidate),
        "candidatePath": service_path,
        "changedField": "ExecCondition epoch 1790697550 -> 1791302350"})
    _write_private(output / "first-card-endpoint.env", (
        "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\n"
        "PREFUNDED_CARD_PUBLIC_ENABLED=false\n"
        "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false\n").encode())
    manifest["activationFlags"] = {"PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED": "true",
        "PREFUNDED_CARD_PUBLIC_ENABLED": "false",
        "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED": "false",
        "onlyFirstCardEndpointEnabled": True,
        "savedCardsConfigChanged": False, "autoDebitConfigChanged": False}
    return manifest

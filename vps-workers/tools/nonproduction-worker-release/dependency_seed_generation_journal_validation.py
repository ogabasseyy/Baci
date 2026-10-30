"""Strict schema checks for the disconnected seed-unit recovery journal."""
from __future__ import annotations

import re

SHA = re.compile(r"^[0-9a-f]{40}$")
TXID = re.compile(r"^[0-9a-f]{32}$")
ID = re.compile(r"^[1-9][0-9]{0,19}$")
UNIT = re.compile(r"^baci-worker-seed-([0-9a-f]{12})-([0-9a-f]{32})\.service$")
FENCE_KEYS = {"repository", "workflow", "ref", "sha", "run_id", "run_attempt", "job_id", "status"}
LEGACY_ALIAS_KEYS = {
    "schema", "phase", "transaction_id", "fence", "unit", "source_path",
    "source_dev", "source_ino", "resource_dev", "resource_ino", "scratch_root_dev",
    "scratch_root_ino", "scratch_name", "scratch_dev", "scratch_ino", "cache_dev",
    "cache_ino", "store_dev", "store_ino", "builder_uid", "builder_gid",
    "alias_name", "alias_state", "alias_source_dev", "alias_source_ino",
    "placeholder_dev", "placeholder_ino",
}


def is_legacy_alias_record(value: object) -> bool:
    """Identify the former schema-1 alias journal without trusting its contents."""
    return (isinstance(value, dict) and value.get("schema") == 1
            and set(value) == LEGACY_ALIAS_KEYS)


def valid_record(value: object, resource_identity: tuple[int, int],
                 scratch_identity: tuple[int, int]) -> bool:
    expected = {
        "schema", "phase", "transaction_id", "fence", "unit", "source_path",
        "source_dev", "source_ino", "resource_dev", "resource_ino", "scratch_root_dev",
        "scratch_root_ino", "scratch_name", "scratch_dev", "scratch_ino", "cache_dev",
        "cache_ino", "store_dev", "store_ino", "builder_uid", "builder_gid",
        "egress_socket_dev", "egress_socket_ino",
    }
    if not isinstance(value, dict) or set(value) != expected or value.get("schema") != 2:
        return False
    fence = value.get("fence")
    sha = fence.get("sha") if isinstance(fence, dict) else None
    unit_match = UNIT.fullmatch(value.get("unit", "")) if isinstance(value.get("unit"), str) else None
    return (
        value.get("phase") in ("prepared", "running", "drained")
        and isinstance(value.get("transaction_id"), str) and TXID.fullmatch(value["transaction_id"])
        and isinstance(fence, dict) and set(fence) == FENCE_KEYS
        and fence.get("repository") == "ogabasseyy/Baci"
        and fence.get("workflow") == ".github/workflows/production-release.yml"
        and fence.get("ref") == "refs/heads/main" and fence.get("status") == "in_progress"
        and isinstance(fence.get("run_id"), str) and ID.fullmatch(fence["run_id"])
        and isinstance(fence.get("job_id"), str) and ID.fullmatch(fence["job_id"])
        and type(fence.get("run_attempt")) is int and fence["run_attempt"] > 0
        and SHA.fullmatch(str(sha or "")) and unit_match is not None
        and unit_match.group(1) == sha[:12]
        and isinstance(value.get("source_path"), str) and value["source_path"].startswith("/")
        and all(type(value.get(key)) is int and value[key] >= 0 for key in
                ("source_dev", "source_ino", "resource_dev", "resource_ino", "builder_uid", "builder_gid"))
        and (value["resource_dev"], value["resource_ino"]) == resource_identity
        and (value["scratch_root_dev"], value["scratch_root_ino"]) == scratch_identity
        and value.get("scratch_name") == f"seed-{value['transaction_id']}"
        and all(value.get(key) is None or type(value.get(key)) is int and value[key] >= 0
                for key in ("scratch_dev", "scratch_ino", "cache_dev", "cache_ino", "store_dev", "store_ino"))
        and ((value["scratch_dev"] is None and value["scratch_ino"] is None)
             or (type(value["scratch_dev"]) is int and type(value["scratch_ino"]) is int))
        and ((value["cache_dev"] is None and value["cache_ino"] is None)
             or (type(value["cache_dev"]) is int and type(value["cache_ino"]) is int))
        and ((value["store_dev"] is None and value["store_ino"] is None)
             or (type(value["store_dev"]) is int and type(value["store_ino"]) is int))
        and value["builder_uid"] > 0 and value["builder_gid"] > 0
        and all(type(value.get(key)) is int and value[key] >= 0
                for key in ("egress_socket_dev", "egress_socket_ino"))
    )

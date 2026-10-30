"""Closed-schema experiment failure formatting; never renders raw errors."""
from __future__ import annotations

import subprocess

from worker_release_actual_dependency_resources import (
    MAX_TREE_BYTES, MAX_TREE_ENTRIES, ResourceEntryLimitExceeded,
)
from worker_release_dependency_diagnostics import format_policy_line_shapes
from worker_release_dependency_evidence_shape import (
    OFFLINE_STORE_SUBTYPES, safe_errno_category, validate_os_error,
)


def failure_diagnostic_impl(stage: str, error: BaseException) -> str:
    from worker_release_actual_dependency_guard import (
        MonitorFailure, PAYLOAD_CHECKS, PAYLOAD_REJECTIONS, RESOURCE_CHECKS,
        STAGES, TREE_CHECKS,
    )

    entry_metadata = None
    materialization_metadata = None
    store_subtype = getattr(error, "safe_subtype", None)
    if store_subtype not in OFFLINE_STORE_SUBTYPES:
        store_subtype = None
    resource_check = tree_check = payload_check = None
    hardlink_roots = hardlink_group_count = None
    move_reason = getattr(error, "safe_reason", None)
    move_substage = getattr(error, "safe_substage", None)
    from worker_release_actual_seed_move_measure import MOVE_REASONS, MOVE_SUBSTAGES
    if move_reason in MOVE_REASONS and move_substage in MOVE_SUBSTAGES:
        return (f"experiment failure stage=seed-move-measurement category=measurement-failed "
                f"reason={move_reason} substage={move_substage}")
    if isinstance(error, MonitorFailure):
        stage, category, exit_code = error.stage, error.category, error.exit_code
        os_error = error.os_error
        entry_metadata = error.entries_seen, error.entry_limit
        resource_check = error.resource_check
    else:
        stage = stage if stage in STAGES else "experiment"
        exit_code, os_error = None, None
        if isinstance(error, ResourceEntryLimitExceeded):
            entry_metadata = error.entries_seen, error.limit
        materialization_check = getattr(error, "safe_materialization_check", None)
        materialization_entries = getattr(error, "safe_materialization_entries", None)
        materialization_bytes = getattr(error, "safe_materialization_bytes", None)
        materialization_entry_limit = getattr(error, "safe_materialization_entry_limit", None)
        materialization_byte_limit = getattr(error, "safe_materialization_byte_limit", None)
        if (materialization_check in {"within-bounds", "bytes-bound", "entry-bound", "both", "unsafe-entry"}
                and type(materialization_entries) is int and 0 <= materialization_entries <= MAX_TREE_ENTRIES + 1
                and type(materialization_bytes) is int and 0 <= materialization_bytes <= MAX_TREE_BYTES + 1
                and type(materialization_entry_limit) is int
                and 1 <= materialization_entry_limit <= MAX_TREE_ENTRIES
                and type(materialization_byte_limit) is int
                and 0 <= materialization_byte_limit <= MAX_TREE_BYTES):
            materialization_metadata = (materialization_check, materialization_entries,
                                        materialization_bytes, materialization_entry_limit,
                                        materialization_byte_limit)
        if isinstance(error, subprocess.CalledProcessError):
            category, exit_code = "subprocess-exit", error.returncode
        elif isinstance(error, subprocess.TimeoutExpired):
            category = "subprocess-timeout"
        elif isinstance(error, OSError):
            category = safe_errno_category(error.errno)
        elif isinstance(error, (ValueError, TypeError)):
            category = "invalid-result"
        elif isinstance(error, RuntimeError):
            message = str(error)
            roots = getattr(error, "safe_roots", None)
            if (isinstance(roots, tuple) and roots
                    and all(root in {"web", "worker", "other"} for root in roots)):
                hardlink_roots = "+".join(roots)
                count = getattr(error, "safe_group_count", None)
                if type(count) is int and 1 <= count <= MAX_TREE_ENTRIES:
                    hardlink_group_count = count
                payload_check, category = "external-hardlink", "payload-invalid"
            payload_rejection = PAYLOAD_REJECTIONS.get(message)
            if hardlink_roots is None and payload_rejection is not None:
                payload_check, category = payload_rejection
            tree_check = {
                "measured tree contains an unsafe entry or exceeds entry bound": "unsafe-entry-or-entry-limit",
                "measured tree contains a shared file inode": "shared-file-inode",
            }.get(message)
            categories = (
                ("launcher is unavailable", "runtime-unavailable"),
                ("could not identify exactly one", "runtime-pin-invalid"),
                ("installation exceeds entry bound", "runtime-entry-bound"),
                ("has too many entries", "materialization-entry-bound"),
                ("expected checkout SHA is invalid", "input-invalid"),
                ("does not match dispatched SHA", "checkout-mismatch"),
                ("Node 24 runtime is unavailable", "runtime-unavailable"),
                ("exceeds configured", "configured-bound"),
                ("unsafe entry", "filesystem-entry-invalid"),
                ("shared file inode", "filesystem-entry-invalid"),
                ("unavailable", "expected-output-missing"),
                ("disk cap", "disk-cap"),
                ("free-space reserve", "free-space-reserve"),
                ("free-inode reserve", "free-inode-reserve"),
                ("entry cap", "entry-cap"),
                ("tree changed repeatedly", "transient-tree-churn"),
                ("differs from exact source lock", "lock-graph-drift"),
                ("source lock does not pin", "lock-graph-invalid"),
                ("measured tree exceeds", "tree-size-bound"),
                ("did not produce", "expected-output-missing"),
                ("receipt metadata cache changed", "policy-receipt-cache-changed"),
                ("receipt", "policy-receipt"), ("timed out", "deadline"),
            )
            if payload_check is None:
                category = next((label for marker, label in categories if marker in message), "runtime-error")
            if store_subtype is not None:
                category = "filesystem-entry-invalid"
        else:
            category = "operation-error"
    suffix = f" exit={exit_code}" if isinstance(exit_code, int) else ""
    if isinstance(error, MonitorFailure) and error.evidence is not None:
        evidence = error.evidence
        suffix += (f" evidence={evidence['classification']} phrase_lines={evidence['phrase_lines']}"
                   f" recognized_lines={evidence['recognized_lines']}")
        suffix += format_policy_line_shapes(evidence)
    if os_error is not None:
        try:
            os_error = validate_os_error(os_error)
            number = os_error["errno"]
            suffix += f" errno={number if number is not None else 'unknown'}"
            suffix += f" substage={os_error['substage']}"
        except (TypeError, ValueError):
            pass
    if entry_metadata is not None:
        seen, limit = entry_metadata
        if (type(seen) is int and 1 <= seen <= MAX_TREE_ENTRIES + 1
                and type(limit) is int and 1 <= limit <= MAX_TREE_ENTRIES):
            suffix += f" entries_seen={seen} entry_limit={limit}"
    if materialization_metadata is not None:
        check, entries, byte_count, entry_limit, byte_limit = materialization_metadata
        suffix += (f" materialization_check={check} materialized_entries={entries}"
                   f" materialized_bytes={byte_count} materialized_entry_limit={entry_limit}"
                   f" materialized_byte_limit={byte_limit}")
    for key, value in (("store_check", store_subtype), ("resource_check", resource_check),
                       ("tree_check", tree_check), ("payload_check", payload_check)):
        allowed = (OFFLINE_STORE_SUBTYPES if key == "store_check" else
                   RESOURCE_CHECKS if key == "resource_check" else
                   TREE_CHECKS if key == "tree_check" else PAYLOAD_CHECKS)
        if value in allowed:
            suffix += f" {key}={value}"
    if hardlink_roots is not None:
        suffix += f" hardlink_roots={hardlink_roots}"
    if hardlink_group_count is not None:
        suffix += f" external_hardlink_groups={hardlink_group_count}"
    return f"experiment failure stage={stage} category={category}{suffix}"

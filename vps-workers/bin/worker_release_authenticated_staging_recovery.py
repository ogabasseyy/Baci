"""Proof-gated cleanup for interrupted disconnected authenticated staging."""
from __future__ import annotations

import re
from pathlib import Path
from typing import Callable

from worker_release_lifecycle import release_lock
from worker_release_source_view_journal import SourceViewJournal, SourceViewRejected
from worker_release_stage_journal import StageJournal
from worker_release_dependency_supervisor_journal import BuilderUnitJournal
from worker_release_dependency_supervisor_lifecycle import recover_and_clear_builder
from worker_release_authenticated_seed_generation import recover_for_stage
from worker_release_systemd_extractor import RESOURCE_ROOT


def _prove_extractor_collected(transaction_id: str, extractor_uid: int) -> None:
    """Stop the journal-derived extractor instance and prove its exact unit gone."""
    import re
    import subprocess
    import time
    from worker_release_dependency_supervisor_cgroup import (
        CgroupProofRejected, preflight_cgroup_root, prove_collected_unit,
        require_exact_unit_cgroup_absent, stop_unit,
    )

    if not re.fullmatch(r"[0-9a-f]{32}", transaction_id):
        raise SourceViewRejected("extractor transaction identity is invalid")
    unit = f"baci-worker-source-extract@{transaction_id}.service"
    cgroup_root = Path("/sys/fs/cgroup")
    try:
        trusted_root = preflight_cgroup_root(cgroup_root)
    except Exception as error:
        raise SourceViewRejected("extractor cgroup boundary is unavailable") from error
    deadline = time.monotonic() + 30

    def query(*args: str) -> str:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise SourceViewRejected("extractor recovery deadline expired")
        try:
            result = subprocess.run(
                ("/usr/bin/systemctl", *args), check=True, stdin=subprocess.DEVNULL,
                stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                timeout=min(1.0, remaining), text=True, env={"PATH": "/usr/bin:/bin"},
            )
        except (OSError, subprocess.SubprocessError) as error:
            raise SourceViewRejected("extractor systemd proof query failed") from error
        value = result.stdout.strip()
        if len(value) > 256 or "\n" in value or "\r" in value:
            raise SourceViewRejected("extractor systemd proof exceeded its fixed bound")
        return value

    stop_unit("/usr/bin/systemctl", unit)
    while time.monotonic() < deadline:
        try:
            load = query("show", "--property=LoadState", "--value", unit)
            active = query("show", "--property=ActiveState", "--value", unit)
            if load == "loaded" and active in ("inactive", "failed"):
                try:
                    subprocess.run(("/usr/bin/systemctl", "reset-failed", unit), check=False,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                                   stderr=subprocess.DEVNULL, timeout=1,
                                   env={"PATH": "/usr/bin:/bin"})
                except (OSError, subprocess.SubprocessError):
                    pass
            require_exact_unit_cgroup_absent(cgroup_root, unit, trusted_root=trusted_root)
            prove_collected_unit(unit, None, root=cgroup_root, uid=extractor_uid,
                                 deadline=deadline, query=query, trusted_root=trusted_root)
            return
        except CgroupProofRejected:
            stop_unit("/usr/bin/systemctl", unit)
            time.sleep(min(0.1, max(0.0, deadline - time.monotonic())))
    raise SourceViewRejected("extractor unit and cgroup quiescence were not proven")


def _stage_recovery_records(worker_root: Path, result_root: Path, *, worker_gid: int):
    """Read and reconcile every durable journal that can own staged bytes."""
    import pwd

    extractor_uid = pwd.getpwnam("baci-release-extractor").pw_uid
    with SourceViewJournal(worker_root, result_root) as source_journal, BuilderUnitJournal(
            worker_root, owner_uid=0) as builder_journal:
        source_record = source_journal.pending_record()
        builder_record = builder_journal.read()
        with StageJournal(worker_root, owner_uid=0, stage_uid=extractor_uid,
                          stage_gid=worker_gid, resource_root=RESOURCE_ROOT,
                          resource_uid=extractor_uid) as journal:
            stage_record = journal._load()
    if stage_record is None and (source_record is not None or builder_record is not None):
        raise SourceViewRejected("source or builder journal exists without its stage transaction journal")
    records = [item for item in (source_record, builder_record, stage_record) if item is not None]
    if not records:
        return None, ()
    fence = records[0]["fence"]
    if any(item.get("fence") != fence for item in records[1:]):
        raise SourceViewRejected("builder, source view, and stage journals have different fences")
    return fence, tuple(records)


def stage_recovery_status(worker_root: Path, result_root: Path, *, worker_gid: int,
                          view_root: Path):
    """Expose only the exact interrupted-stage fence; never mutate during status."""
    from worker_release_runtime_view_journal import list_all_runtime_view_records

    fence, records = _stage_recovery_records(worker_root, result_root, worker_gid=worker_gid)
    runtime_records = list_all_runtime_view_records(view_root)
    if fence is None:
        if runtime_records:
            raise SourceViewRejected("runtime verifier views exist without a stage fence")
        return {"pending": False}

    stage_record = next((record for record in records if "incoming_name" in record), None)
    matching_views = ()
    if stage_record is None and runtime_records:
        raise SourceViewRejected("runtime verifier views exist without an incoming-stage journal")
    if stage_record is not None:
        candidate = Path(worker_root) / "releases" / stage_record["incoming_name"]
        path_records = tuple(item for item in runtime_records if item.candidate_path == candidate)
        if stage_record.get("incoming_dev") is None and path_records:
            raise SourceViewRejected("runtime verifier view targets an unpinned stage candidate")
        matching_views = tuple(
            item for item in path_records
            if item.candidate_identity == (stage_record["incoming_dev"], stage_record["incoming_ino"])
        )
        if len(matching_views) != len(path_records):
            raise SourceViewRejected("runtime verifier view inode does not match the journaled candidate")
        if len(matching_views) != len(runtime_records):
            raise SourceViewRejected("unmatched runtime verifier records block stage recovery")
    target = {"sha": fence["sha"], "run_id": str(fence["run_id"]),
              "run_attempt": fence["run_attempt"], "job_id": str(fence["job_id"])}
    return {"pending": True, "target": target}


def recover_interrupted_stage(
    worker_root: Path, lock_path: Path, result_root: Path, *, worker_gid: int,
    terminal_attempt_proven: Callable[[dict[str, object]], bool],
    current_link: str = "current", expected_target: dict[str, object] | None = None,
    view_root: Path,
) -> str:
    """Clean only this transaction's source view and journal-owned stage.

    Terminal-attempt proof is supplied only from the fixed authenticated
    dispatcher. Quiescence is established here from journal-derived units,
    exact cgroups, process-table scans, and runtime-view records.
    """
    import pwd
    import os
    from worker_release_runtime_view_journal import (
        list_all_runtime_view_records, list_runtime_view_records_for_candidate,
    )
    from worker_release_runtime_view_recovery import recover_runtime_view

    extractor_uid = pwd.getpwnam("baci-release-extractor").pw_uid
    with release_lock(lock_path, expected_owner_uid=0):
        with SourceViewJournal(worker_root, result_root) as source_journal, BuilderUnitJournal(
                worker_root, owner_uid=0) as builder_journal:
            source_record = source_journal.pending_record()
            with StageJournal(worker_root, owner_uid=0, stage_uid=extractor_uid,
                              stage_gid=worker_gid, resource_root=RESOURCE_ROOT,
                              resource_uid=extractor_uid) as journal:
                stage_record = journal._load()
                builder_record = builder_journal.read()
                if stage_record is None and (source_record is not None or builder_record is not None):
                    raise SourceViewRejected(
                        "source or builder journal exists without its stage transaction journal")
                if source_record is None and stage_record is None and builder_record is None:
                    if (not isinstance(expected_target, dict)
                            or set(expected_target) != {"sha", "run_id", "run_attempt", "job_id"}
                            or not re.fullmatch(r"[0-9a-f]{40}", str(expected_target.get("sha", "")))
                            or not re.fullmatch(r"[1-9][0-9]{0,19}", str(expected_target.get("run_id", "")))
                            or type(expected_target.get("run_attempt")) is not int
                            or expected_target["run_attempt"] < 1
                            or not re.fullmatch(r"[1-9][0-9]{0,19}", str(expected_target.get("job_id", "")))
                            or terminal_attempt_proven(expected_target) is not True):
                        raise SourceViewRejected("empty stage recovery lacks terminal-attempt proof")
                    if list_all_runtime_view_records(view_root):
                        raise SourceViewRejected("runtime verifier views remain without stage journals")
                    return "clean"
                records = [item for item in (source_record, stage_record, builder_record)
                           if item is not None]
                fence = records[0]["fence"]
                if any(item["fence"] != fence for item in records[1:]):
                    raise SourceViewRejected("builder, source view, and stage journals have different fences")
                if (not isinstance(expected_target, dict)
                        or set(expected_target) != {"sha", "run_id", "run_attempt", "job_id"}
                        or not isinstance(expected_target.get("sha"), str)
                        or not re.fullmatch(r"[0-9a-f]{40}", expected_target["sha"])
                        or not re.fullmatch(r"[1-9][0-9]{0,19}", str(expected_target.get("run_id")))
                        or type(expected_target.get("run_attempt")) is not int
                        or expected_target["run_attempt"] < 1
                        or not re.fullmatch(r"[1-9][0-9]{0,19}", str(expected_target.get("job_id")))
                        or expected_target.get("sha") != fence.get("sha")
                        or str(expected_target.get("run_id")) != str(fence.get("run_id"))
                        or expected_target.get("run_attempt") != fence.get("run_attempt")
                        or str(expected_target.get("job_id")) != str(fence.get("job_id"))
                        or fence.get("repository") != "ogabasseyy/Baci"
                        or fence.get("workflow") != ".github/workflows/production-release.yml"
                        or fence.get("ref") != "refs/heads/main"):
                    raise SourceViewRejected("stage recovery target does not match the exact durable fence")
                if terminal_attempt_proven(fence) is not True:
                    raise SourceViewRejected("interrupted stage requires terminal-attempt proof")
                if stage_record is None:
                    raise SourceViewRejected("interrupted stage lacks its transaction journal")
                extractor_txid = stage_record["transaction_id"]
                _prove_extractor_collected(extractor_txid, extractor_uid)
                extractor_quiesced = True

                if stage_record is not None and stage_record.get("result_state") == "created":
                    if (source_record is None or source_record.get("phase") != "ready"
                            or source_record.get("transaction_id") != stage_record.get("transaction_id")
                            or source_record.get("fence") != fence):
                        raise SourceViewRejected("seed recovery lacks its ready root-owned source view")
                    source_identity = (source_record.get("view_dev"), source_record.get("view_ino"))
                    if any(type(value) is not int for value in source_identity):
                        raise SourceViewRejected("seed recovery lacks a pinned source-view identity")
                    recover_for_stage(
                        stage_record, resource_root=RESOURCE_ROOT,
                        resource_owner_uid=extractor_uid,
                        source_path=result_root / str(source_record["view_name"]),
                        source_identity=source_identity,
                    )

                def other_resources_quiesced(_fence: dict[str, object]) -> bool:
                    return extractor_quiesced is True

                if builder_record is not None:
                    recover_and_clear_builder(
                        builder_journal, fence,
                        terminal_attempt_proven=lambda _fence: True,
                        other_resources_quiesced=other_resources_quiesced,
                        result_root=result_root,
                    )
                if stage_record is None:
                    if list_all_runtime_view_records(view_root):
                        raise SourceViewRejected("runtime verifier views exist without an incoming-stage journal")
                else:
                    candidate_path = Path(worker_root) / "releases" / stage_record["incoming_name"]
                    candidate_dev = stage_record.get("incoming_dev")
                    candidate_ino = stage_record.get("incoming_ino")
                    all_views = list_all_runtime_view_records(view_root)
                    path_views = tuple(item for item in all_views if item.candidate_path == candidate_path)
                    if path_views and (candidate_dev is None or candidate_ino is None):
                        raise SourceViewRejected("runtime verifier view targets an unpinned stage candidate")
                    candidate_views = list_runtime_view_records_for_candidate(
                        candidate_path, candidate_dev, candidate_ino, view_root=view_root,
                    ) if candidate_dev is not None and candidate_ino is not None else ()
                    if len(candidate_views) != len(path_views) or len(candidate_views) != len(all_views):
                        raise SourceViewRejected("unmatched runtime verifier records block stage recovery")
                    for view_record in candidate_views:
                        recover_runtime_view(view_record, view_root=view_root)
                    remaining = list_runtime_view_records_for_candidate(
                        candidate_path, candidate_dev, candidate_ino, view_root=view_root,
                    ) if candidate_dev is not None and candidate_ino is not None else ()
                    if remaining:
                        raise SourceViewRejected("runtime verifier view recovery did not clear its exact record")
                if source_record is not None:
                    source_journal.cleanup(fence=fence, terminal_proven=True,
                                           processes_quiesced=True)
                if stage_record is not None:
                    journal.recover(terminal_attempt_proven=lambda _fence: True,
                                    resources_quiesced=lambda _fence: True,
                                    current_link=current_link)
                    return "recovered"
                if builder_record is not None:
                    return "builder-recovered"
                return "source-view-cleaned"


__all__ = ["recover_interrupted_stage"]

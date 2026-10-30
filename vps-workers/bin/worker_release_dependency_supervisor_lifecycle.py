"""Stage-owned cleanup/recovery for the disconnected builder journal.

Every public operation requires the caller to hold the release lock.
"""
from __future__ import annotations

import os
import stat
from pathlib import Path
from typing import Any, Callable

from worker_release_dependency_artifacts import BuilderRejected
from worker_release_dependency_builder import (
    BUILD_INPUT_ROOT, BUILD_RESULTS_ROOT, BUILD_ROOT, MAX_BUILD_SCRATCH_BYTES,
    MAX_BUILD_SCRATCH_ENTRIES, _remove_private_tree,
)
from worker_release_dependency_fs import directory_usage
from worker_release_dependency_supervisor_journal import (
    BuilderJournalRejected, BuilderUnitJournal, recover_recorded_builder,
)


class BuilderLifecycleRejected(RuntimeError):
    """A builder unit or its durable resources cannot be safely finalized."""


def invoke_builder_runner(runner, command, scratch: Path, unit: str, *,
                          input_root: Path, result_dir: Path) -> None:
    """Pass build resource identities only to the fixed supervised adapter."""
    if getattr(runner, "accepts_build_resources", False):
        runner(command, scratch, unit, input_root=input_root, result_dir=result_dir)
    else:
        runner(command, scratch, unit)


def fixed_builder_runner_factory(identity, unit_journal):
    """Bind the dedicated builder identity and fixed runtime paths to a stage."""
    from worker_release_dependency_builder import BUILD_ROOT, _builder_identity
    from worker_release_dependency_supervisor import fixed_builder_runner

    uid, gid = _builder_identity()
    return fixed_builder_runner(identity.sha, uid, gid, fence=identity.fence(),
                                unit_journal=unit_journal, usage_root=BUILD_ROOT)


def _resource_path(record: dict[str, Any], field: str, root: Path) -> Path:
    raw = record.get(field)
    if not isinstance(raw, str):
        raise BuilderLifecycleRejected("builder journal lacks a durable resource path")
    path = Path(raw)
    if path.parent != root or path.name in ("", ".", ".."):
        raise BuilderLifecycleRejected("builder journal resource escaped its fixed root")
    root_info = root.lstat()
    if (not stat.S_ISDIR(root_info.st_mode) or root_info.st_uid != 0
            or root_info.st_mode & 0o022):
        raise BuilderLifecycleRejected("builder resource root is not trusted")
    return path


def _resource_specs(record: dict[str, Any], build_root: Path,
                    result_root: Path) -> tuple[tuple[Path, str, int, int], ...]:
    scratch = _resource_path(record, "scratch_path", build_root)
    input_root = _resource_path(record, "input_path", build_root)
    result = _resource_path(record, "result_path", result_root)
    if Path(record["source_path"]).parent != input_root:
        raise BuilderLifecycleRejected("builder source is outside its recorded input root")
    return (
        (scratch, "scratch", record["uid"], record["gid"]),
        (input_root, "input_path", 0, record["input_path_gid"]),
        (result, "result_path", 0, record["result_path_gid"]),
    )


def _matches_recorded_inode(path: Path, record: dict[str, Any], field: str) -> os.stat_result:
    try:
        info = path.lstat()
    except OSError as error:
        raise BuilderLifecycleRejected("journaled builder resource is unavailable") from error
    if (not stat.S_ISDIR(info.st_mode)
            or (info.st_dev, info.st_ino) != (record.get(f"{field}_dev"), record.get(f"{field}_ino"))):
        raise BuilderLifecycleRejected("journaled builder resource inode changed")
    return info


def clear_completed_builder(journal: BuilderUnitJournal, fence: dict[str, object], *,
                            build_root: Path = BUILD_ROOT,
                            result_root: Path = BUILD_RESULTS_ROOT) -> None:
    """Clear only after the stage consumer removed all three exact build trees."""
    record = journal.read()
    if record is None:
        return
    if record.get("fence") != fence or record.get("phase") != "drained":
        raise BuilderLifecycleRejected("successful stage lacks a drained matching builder journal")
    specs = _resource_specs(record, build_root, result_root)

    def absent(owned: dict[str, Any]) -> bool:
        for path, _kind, _uid, _gid in specs:
            try:
                path.lstat()
            except FileNotFoundError:
                continue
            return False
        return True

    try:
        journal.clear(fence, resources_removed=absent)
    except BuilderJournalRejected as error:
        raise BuilderLifecycleRejected("builder resource cleanup is not proven") from error


def recover_and_clear_builder(
    journal: BuilderUnitJournal, fence: dict[str, object], *,
    terminal_attempt_proven: Callable[[dict[str, object]], bool],
    other_resources_quiesced: Callable[[dict[str, object]], bool],
    build_root: Path = BUILD_ROOT,
    result_root: Path = BUILD_RESULTS_ROOT,
) -> str:
    """Stop the exact unit, then remove only its recorded scratch/input/result trees."""
    record = journal.read()
    if record is None:
        return "clean"
    if record.get("fence") != fence or terminal_attempt_proven(fence) is not True:
        raise BuilderLifecycleRejected("builder recovery lacks the exact terminal attempt")
    try:
        recover_recorded_builder(
            journal, fence, terminal_attempt_proven=lambda _fence: True,
        )
    except BuilderJournalRejected as error:
        raise BuilderLifecycleRejected("recorded builder unit could not be drained") from error
    if other_resources_quiesced(fence) is not True:
        raise BuilderLifecycleRejected("non-builder staging resources are not quiesced")
    record = journal.read()
    if record is None or record.get("phase") != "drained":
        raise BuilderLifecycleRejected("builder drain was not durably recorded")
    for path, field, expected_uid, expected_gid in _resource_specs(record, build_root, result_root):
        try:
            path.lstat()
        except FileNotFoundError:
            continue
        info = _matches_recorded_inode(path, record, field)
        if info.st_uid != expected_uid or info.st_gid != expected_gid or info.st_mode & 0o022:
            raise BuilderLifecycleRejected("builder resource owner or mode changed")
        directory_usage(path, max_entries=MAX_BUILD_SCRATCH_ENTRIES,
                        max_bytes=MAX_BUILD_SCRATCH_BYTES)
        try:
            _remove_private_tree(path)
        except (OSError, BuilderRejected) as error:
            raise BuilderLifecycleRejected("journaled builder resource cleanup failed") from error
        try:
            path.lstat()
        except FileNotFoundError:
            continue
        raise BuilderLifecycleRejected("journaled builder resource remains after cleanup")
    clear_completed_builder(journal, fence, build_root=build_root,
                            result_root=result_root)
    return "recovered"


__all__ = ["BuilderLifecycleRejected", "clear_completed_builder",
           "fixed_builder_runner_factory", "invoke_builder_runner",
           "recover_and_clear_builder"]

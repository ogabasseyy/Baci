"""Proof-gated cleanup for interrupted disconnected authenticated staging."""
from __future__ import annotations

from pathlib import Path
from typing import Callable

from worker_release_lifecycle import release_lock
from worker_release_source_view_journal import SourceViewJournal, SourceViewRejected
from worker_release_stage_journal import StageJournal
from worker_release_dependency_supervisor_journal import BuilderUnitJournal
from worker_release_dependency_supervisor_lifecycle import recover_and_clear_builder
from worker_release_systemd_extractor import RESOURCE_ROOT


def recover_interrupted_stage(
    worker_root: Path, lock_path: Path, result_root: Path, *, worker_gid: int,
    terminal_attempt_proven: Callable[[dict[str, object]], bool],
    resources_quiesced: Callable[[dict[str, object]], bool],
    current_link: str = "current",
) -> str:
    """Clean only this transaction's source view and journal-owned stage.

    Both callbacks are trusted proof providers, not hints. The quiescence proof
    must include the source extractor, dependency-builder unit/cgroup, and any
    process that can mutate the fixed builder result filesystem.
    """
    import pwd
    import os

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
                if source_record is None and stage_record is None and builder_record is None:
                    return "clean"
                records = [item for item in (source_record, stage_record, builder_record)
                           if item is not None]
                fence = records[0]["fence"]
                if any(item["fence"] != fence for item in records[1:]):
                    raise SourceViewRejected("builder, source view, and stage journals have different fences")
                if terminal_attempt_proven(fence) is not True:
                    raise SourceViewRejected("interrupted stage requires terminal-attempt proof")
                if builder_record is not None:
                    recover_and_clear_builder(
                        builder_journal, fence,
                        terminal_attempt_proven=lambda _fence: True,
                        other_resources_quiesced=resources_quiesced,
                        result_root=result_root,
                    )
                elif resources_quiesced(fence) is not True:
                    raise SourceViewRejected("interrupted stage requires process-quiescence proof")
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

"""Build immutable generations from the installer's fixed source manifest."""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Protocol

from worker_release_broker_generation import GenerationFile


class InstallRecord(Protocol):
    destination: Path
    content: bytes
    mode: int
    group: str


STABLE_FILES = frozenset({
    # These are the fixed, versioned-launch ABI. Keep them immutable after
    # installation; all mutable runtime logic belongs to an atomic generation.
    "start-broker.sh", "worker_release_broker_launcher.py",
    "worker_release_archive_extract_launcher.py",
})
EXTRACTOR_READ_FILES = frozenset({
    "worker_release_archive_extract_child.py", "worker_release_archive.py",
    "worker_release_broker_common.py",
})


def split_install_records(records: Iterable[InstallRecord], helper_root: Path,
                          group_id) -> tuple[tuple[InstallRecord, ...], tuple[GenerationFile, ...]]:
    """Separate stable control files from immutable serving generation files."""
    stable: list[InstallRecord] = []
    generation: list[GenerationFile] = []
    for item in records:
        try:
            relative = item.destination.relative_to(helper_root).as_posix()
        except ValueError:
            stable.append(item)
            continue
        if relative in STABLE_FILES:
            stable.append(item)
            continue
        if relative in EXTRACTOR_READ_FILES:
            generation.append(GenerationFile(relative, item.content, 0o440,
                                             group_id("baci-release-extractor")))
        else:
            generation.append(GenerationFile(relative, item.content, item.mode,
                                             group_id(item.group)))
    if not generation or not any(item.path == "worker_release_broker.py" for item in generation):
        raise RuntimeError("fixed broker generation is incomplete")
    return tuple(stable), tuple(generation)


__all__ = ["STABLE_FILES", "split_install_records"]

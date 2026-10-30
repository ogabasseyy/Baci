"""Disposable broker-generation fixture for the root/systemd extractor CI test."""
from __future__ import annotations

import hashlib
import os
import pwd
import tempfile
from contextlib import contextmanager
from pathlib import Path
from typing import Callable, Iterator

from worker_release_broker_generation import (
    GenerationFile,
    clear_generation_pointer,
    current_generation,
    publish_generation,
    switch_generation,
)
from worker_release_source_snapshot import pin_source_snapshot
from worker_release_stage_journal import StageJournal
from worker_release_systemd_extractor import EXTRACTOR, RESOURCE_ROOT, UNIT_PREFIX, extract_frozen_source
from worker_release_systemd_test_support import (
    systemd_system_manager_available,
    systemd_unit_failure_summary,
)

HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
BROKER_STATE_ROOT = Path("/var/lib/baci-worker-broker")
POINTER_ROOT = BROKER_STATE_ROOT / "pointer"


def _require_absent(path: Path) -> None:
    if path.exists() or path.is_symlink():
        raise RuntimeError("refusing to overlay existing broker fixture state")


def _remove_generation(path: Path) -> None:
    """Remove only the fixture's flat, exact generation payload."""
    expected = {
        "generation.json",
        "worker_release_archive_extract_child.py",
        "worker_release_archive.py",
        "worker_release_broker_common.py",
    }
    if path.is_symlink() or not path.is_dir() or set(os.listdir(path)) != expected:
        raise RuntimeError("disposable broker generation changed unexpectedly")
    for name in expected:
        item = path / name
        if item.is_symlink() or not item.is_file():
            raise RuntimeError("disposable broker generation contains an unexpected entry")
        item.unlink()
    path.rmdir()


@contextmanager
def disposable_extractor_generation(*, extractor_gid: int) -> Iterator[str]:
    """Publish the three-file closure required by the fixed extractor launcher.

    Callers must opt in with the dedicated disposable-CI environment marker;
    the default is to refuse all writes to global system paths.
    """
    if os.environ.get("WORKER_RELEASE_EXTRACT_CI_FIXTURE") != "1" or os.geteuid() != 0:
        raise RuntimeError("disposable extractor fixture requires its root-CI opt-in")

    generation_collection = HELPER_ROOT / "generations"
    _require_absent(generation_collection)
    _require_absent(BROKER_STATE_ROOT)
    _require_absent(POINTER_ROOT)

    digest: str | None = None
    state_root_created = False
    pointer_created = False
    try:
        os.mkdir(BROKER_STATE_ROOT, 0o755)
        state_root_created = True
        os.chown(BROKER_STATE_ROOT, 0, 0)
        os.chmod(BROKER_STATE_ROOT, 0o755)
        os.mkdir(POINTER_ROOT, 0o711)
        pointer_created = True
        os.chown(POINTER_ROOT, 0, 0)
        os.chmod(POINTER_ROOT, 0o711)

        generation_files = (
            GenerationFile("worker_release_archive_extract_child.py",
                           (Path(__file__).parent / "worker_release_archive_extract_child.py").read_bytes(),
                           0o440, extractor_gid),
            GenerationFile("worker_release_archive.py",
                           (Path(__file__).parent / "worker_release_archive.py").read_bytes(),
                           0o440, extractor_gid),
            GenerationFile("worker_release_broker_common.py",
                           (Path(__file__).parent / "worker_release_broker_common.py").read_bytes(),
                           0o440, extractor_gid),
        )
        digest = publish_generation(HELPER_ROOT, generation_files)
        switch_generation(HELPER_ROOT, digest, expected_current=None,
                          state_root=POINTER_ROOT, state_mode=0o711)
        yield digest
    finally:
        if pointer_created and digest is not None:
            selected = current_generation(HELPER_ROOT, state_root=POINTER_ROOT,
                                          state_mode=0o711)
            if selected == digest:
                clear_generation_pointer(HELPER_ROOT, expected_current=digest,
                                         state_root=POINTER_ROOT, state_mode=0o711)
            elif selected is not None:
                raise RuntimeError("disposable broker pointer changed unexpectedly")
        if pointer_created:
            POINTER_ROOT.rmdir()
        if digest is not None:
            _remove_generation(generation_collection / digest)
        if generation_collection.exists():
            lock = generation_collection / ".install.lock"
            if lock.exists() and not lock.is_symlink() and lock.is_file():
                lock.unlink()
            generation_collection.rmdir()
        if state_root_created:
            BROKER_STATE_ROOT.rmdir()


def run_systemd_extractor_case(test_case, *, archive_bytes: Callable[[], bytes],
                               fence: dict[str, str], source_sha: str) -> None:
    """Exercise the real fixed unit against the disposable generation."""
    account = pwd.getpwnam(EXTRACTOR)
    if not systemd_system_manager_available():
        test_case.fail("CI requires a reachable systemd system manager")
    test_case.assertEqual(list(RESOURCE_ROOT.iterdir()), [],
                          "unknown resource trees must block extraction")
    with disposable_extractor_generation(extractor_gid=account.pw_gid):
        with tempfile.TemporaryDirectory(dir=Path.home()) as temporary:
            journal_root = Path(temporary)
            (journal_root / "releases").mkdir(mode=0o700)
            bundle = archive_bytes()
            digest = hashlib.sha256(bundle).hexdigest()
            with StageJournal(journal_root, owner_uid=0, stage_uid=account.pw_uid,
                              stage_gid=os.getgid(), resource_root=RESOURCE_ROOT,
                              resource_uid=account.pw_uid) as journal:
                journal_state = journal.begin(fence, digest)
                transaction_id = journal_state["transaction_id"]
                try:
                    receipt = extract_frozen_source(journal, bundle, digest)
                except Exception as error:
                    test_case.fail(
                        f"extractor unit failed ({type(error).__name__}); systemd state: "
                        f"{systemd_unit_failure_summary(f'{UNIT_PREFIX}{transaction_id}.service')}"
                    )
                source = receipt["snapshot"]
                test_case.assertEqual(receipt["source_sha"], source_sha)
                test_case.assertEqual((source / "pnpm-lock.yaml").read_bytes(), b"root lock\n")
                test_case.assertEqual((source / "vps-workers/pnpm-lock.yaml").read_bytes(),
                                      b"worker lock\n")
                test_case.assertEqual((source / ".baci-source-sha").read_text(),
                                      source_sha + "\n")
                test_case.assertEqual(source.stat().st_uid, account.pw_uid)
                test_case.assertEqual(source.stat().st_gid, os.getgid())
                test_case.assertEqual(source.stat().st_mode & 0o777, 0o550)
                with pin_source_snapshot(source, trusted_root=RESOURCE_ROOT,
                                         owner_uid=account.pw_uid) as pin:
                    pin.verify_unchanged()
                test_case.assertEqual(
                    journal.recover(terminal_attempt_proven=lambda _fence: True,
                                    resources_quiesced=lambda _fence: True),
                    "discarded",
                )
    test_case.assertEqual(list(RESOURCE_ROOT.iterdir()), [])

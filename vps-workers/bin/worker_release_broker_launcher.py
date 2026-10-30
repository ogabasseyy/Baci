"""Stable, root-owned launcher for immutable broker generations.

This file is invoked with ``python -I`` and intentionally imports only the
standard library until it has pinned and checked the active generation.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
STATE_ROOT = Path("/var/lib/baci-worker-broker")
POINTER_ROOT = STATE_ROOT / "pointer"
TRANSACTION_ROOT = STATE_ROOT / "transaction"
JOURNAL_PATH = TRANSACTION_ROOT / "upgrade-journal.json"
PYTHON = "/usr/bin/python3"
HEX_256 = re.compile(r"^[0-9a-f]{64}$")
DIR_FLAGS = os.O_RDONLY | getattr(os, "O_DIRECTORY", 0) | getattr(os, "O_NOFOLLOW", 0)
MAX_GENERATION_FILES = 512
MAX_GENERATION_FILE_BYTES = 16 * 1024 * 1024
MAX_GENERATION_BYTES = 96 * 1024 * 1024


def _open_directory(path: Path, *, expected_mode: int | None = None) -> int:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))):
        raise RuntimeError("fixed broker path is invalid")
    current = os.open("/", DIR_FLAGS)
    try:
        for index, component in enumerate(path.parts[1:]):
            child = os.open(component, DIR_FLAGS, dir_fd=current)
            info = os.fstat(child)
            final = index == len(path.parts) - 2
            mode = stat.S_IMODE(info.st_mode)
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid != 0
                    or info.st_mode & 0o022
                    or final and expected_mode is not None and mode != expected_mode):
                os.close(child)
                raise RuntimeError("fixed broker directory metadata is unsafe")
            os.close(current)
            current = child
        return current
    except BaseException:
        os.close(current)
        raise


def _read_regular(parent_fd: int, name: str, *, mode: int, maximum: int) -> bytes:
    fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=parent_fd)
    try:
        info = os.fstat(fd)
        if (not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_gid != 0
                or stat.S_IMODE(info.st_mode) != mode or info.st_nlink != 1
                or info.st_size > maximum):
            raise RuntimeError("broker generation manifest metadata is unsafe")
        chunks = bytearray()
        while chunk := os.read(fd, min(65536, maximum + 1 - len(chunks))):
            chunks.extend(chunk)
            if len(chunks) > maximum:
                raise RuntimeError("broker generation manifest exceeds its bound")
        return bytes(chunks)
    finally:
        os.close(fd)


def _manifest_parts(value: object) -> tuple[str, ...]:
    if (not isinstance(value, str) or not value or value.startswith("/")
            or "\\" in value or "\x00" in value):
        raise RuntimeError("broker generation manifest path is invalid")
    parts = tuple(value.split("/"))
    if any(part in {"", ".", ".."} for part in parts):
        raise RuntimeError("broker generation manifest path is invalid")
    return parts


def _verify_manifest_files(generation_fd: int, raw: bytes, digest: str, *,
                           owner_uid: int = 0, root_gid: int = 0) -> None:
    """Verify every generation byte and member before importing its modules."""
    try:
        document = json.loads(raw)
        files = document["files"]
        if (not isinstance(document, dict) or set(document) != {"version", "digest", "files"}
                or type(document["version"]) is not int or document["version"] != 1
                or document["digest"] != digest or not isinstance(files, list)
                or not 1 <= len(files) <= MAX_GENERATION_FILES
                or json.dumps(document, sort_keys=True, separators=(",", ":")).encode() + b"\n" != raw):
            raise ValueError
        payload = json.dumps({"version": 1, "files": files}, sort_keys=True,
                             separators=(",", ":")).encode("utf-8")
        if hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, KeyError):
        raise RuntimeError("broker generation manifest does not match its pointer") from None

    entries: dict[str, dict[str, object]] = {}
    expected_dirs: set[str] = set()
    total = 0
    for entry in files:
        if (not isinstance(entry, dict) or set(entry) != {"path", "mode", "gid", "size", "sha256"}
                or type(entry["mode"]) is not int or entry["mode"] not in (0o440, 0o550, 0o640, 0o750)
                or type(entry["gid"]) is not int or entry["gid"] < 0
                or type(entry["size"]) is not int or not 0 <= entry["size"] <= MAX_GENERATION_FILE_BYTES
                or not isinstance(entry["sha256"], str) or not HEX_256.fullmatch(entry["sha256"])):
            raise RuntimeError("broker generation manifest entry is invalid")
        parts = _manifest_parts(entry["path"])
        path = "/".join(parts)
        if path in entries or path == "generation.json":
            raise RuntimeError("broker generation manifest has duplicate paths")
        entries[path] = entry
        expected_dirs.update("/".join(parts[:index]) for index in range(1, len(parts)))
        total += entry["size"]
        if total > MAX_GENERATION_BYTES:
            raise RuntimeError("broker generation exceeds its fixed size limit")

    found_files: set[str] = set()
    found_dirs: set[str] = set()

    def visit(directory_fd: int, prefix: tuple[str, ...]) -> None:
        for name in os.listdir(directory_fd):
            parts = (*prefix, name)
            path = "/".join(parts)
            named = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
            if stat.S_ISDIR(named.st_mode):
                info = (named.st_uid, named.st_gid, stat.S_IMODE(named.st_mode))
                if path not in expected_dirs or info != (owner_uid, root_gid, 0o555):
                    raise RuntimeError("broker generation has an unexpected directory")
                child_fd = os.open(name, DIR_FLAGS, dir_fd=directory_fd)
                try:
                    opened = os.fstat(child_fd)
                    if (named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino):
                        raise RuntimeError("broker generation directory changed during verification")
                    found_dirs.add(path)
                    visit(child_fd, parts)
                finally:
                    os.close(child_fd)
            elif stat.S_ISREG(named.st_mode) and path in entries:
                entry = entries[path]
                fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=directory_fd)
                try:
                    opened = os.fstat(fd)
                    if ((named.st_dev, named.st_ino) != (opened.st_dev, opened.st_ino)
                            or opened.st_uid != owner_uid or opened.st_gid != entry["gid"]
                            or stat.S_IMODE(opened.st_mode) != entry["mode"]
                            or opened.st_nlink != 1 or opened.st_size != entry["size"]):
                        raise RuntimeError("broker generation file metadata differs from manifest")
                    content = bytearray()
                    while chunk := os.read(fd, min(65536, MAX_GENERATION_FILE_BYTES + 1 - len(content))):
                        content.extend(chunk)
                        if len(content) > MAX_GENERATION_FILE_BYTES:
                            raise RuntimeError("broker generation file exceeds its fixed bound")
                    after = os.fstat(fd)
                    named_after = os.stat(name, dir_fd=directory_fd, follow_symlinks=False)
                    if ((opened.st_dev, opened.st_ino, opened.st_size, opened.st_mtime_ns,
                         opened.st_ctime_ns, opened.st_mode, opened.st_uid, opened.st_gid,
                         opened.st_nlink) !=
                            (after.st_dev, after.st_ino, after.st_size, after.st_mtime_ns,
                             after.st_ctime_ns, after.st_mode, after.st_uid, after.st_gid,
                             after.st_nlink)
                            or (named_after.st_dev, named_after.st_ino) != (opened.st_dev, opened.st_ino)
                            or hashlib.sha256(content).hexdigest() != entry["sha256"]):
                        raise RuntimeError("broker generation file differs from manifest")
                    found_files.add(path)
                finally:
                    os.close(fd)
            elif path == "generation.json" and stat.S_ISREG(named.st_mode):
                found_files.add(path)
            else:
                raise RuntimeError("broker generation contains an unlisted member")

    visit(generation_fd, ())
    if found_files != set(entries) | {"generation.json"} or found_dirs != expected_dirs:
        raise RuntimeError("broker generation members do not match manifest")


def _pin_generation(root: Path, pointer_root: Path) -> tuple[str, Path]:
    """Validate pointer and manifest before adding the generation to sys.path."""
    root_fd = _open_directory(root, expected_mode=0o755)
    pointer_fd = _open_directory(pointer_root, expected_mode=0o711)
    try:
        pointer = os.stat("current", dir_fd=pointer_fd, follow_symlinks=False)
        target = os.readlink("current", dir_fd=pointer_fd)
        after = os.stat("current", dir_fd=pointer_fd, follow_symlinks=False)
        prefix = str(root / "generations") + "/"
        if (not stat.S_ISLNK(pointer.st_mode) or pointer.st_uid != 0
                or (pointer.st_dev, pointer.st_ino) != (after.st_dev, after.st_ino)
                or not target.startswith(prefix) or len(target) != len(prefix) + 64):
            raise RuntimeError("broker generation pointer is invalid")
        digest = target[len(prefix):]
        if not HEX_256.fullmatch(digest):
            raise RuntimeError("broker generation pointer digest is invalid")
        generations_fd = os.open("generations", DIR_FLAGS, dir_fd=root_fd)
        try:
            generations_info = os.fstat(generations_fd)
            if (generations_info.st_uid, generations_info.st_gid,
                    stat.S_IMODE(generations_info.st_mode)) != (0, 0, 0o755):
                raise RuntimeError("broker generation collection metadata is unsafe")
            generation_fd = os.open(digest, DIR_FLAGS, dir_fd=generations_fd)
        finally:
            os.close(generations_fd)
        try:
            generation_info = os.fstat(generation_fd)
            if (generation_info.st_uid, generation_info.st_gid,
                    stat.S_IMODE(generation_info.st_mode)) != (0, 0, 0o555):
                raise RuntimeError("broker generation directory is unsafe")
            raw = _read_regular(generation_fd, "generation.json", mode=0o444,
                                maximum=256 * 1024)
            _verify_manifest_files(generation_fd, raw, digest)
        finally:
            os.close(generation_fd)
    finally:
        os.close(pointer_fd)
        os.close(root_fd)
    generation_path = root / "generations" / digest
    # Import paths are added only after the standard-library verifier checked
    # the full content manifest and exact tree membership.
    sys.path.insert(0, str(generation_path))
    return digest, generation_path


def _arguments(argv: list[str]) -> tuple[int, int, int]:
    if len(argv) != 6 or argv[0] != "--release-uid" or argv[2] != "--worker-uid" or argv[4] != "--worker-gid":
        raise RuntimeError("broker launcher arguments are invalid")
    values = argv[1], argv[3], argv[5]
    if any(not value.isdecimal() for value in values):
        raise RuntimeError("broker launcher identities are invalid")
    release_uid, worker_uid, worker_gid = map(int, values)
    if release_uid <= 0 or worker_uid <= 0 or worker_gid <= 0:
        raise RuntimeError("broker launcher identities are invalid")
    return release_uid, worker_uid, worker_gid


def command(argv: list[str], *, root: Path = HELPER_ROOT,
            pointer_root: Path = POINTER_ROOT,
            transaction_root: Path = TRANSACTION_ROOT) -> tuple[str, list[str], dict[str, str]]:
    release_uid, worker_uid, worker_gid = _arguments(argv)
    digest, generation_path = _pin_generation(root, pointer_root)
    # Imports happen only after validating and pinning the exact immutable
    # generation directory. The generation is also fully verified by the
    # upgrade API before recovery or service startup.
    from worker_release_broker_generation import verify_generation
    from worker_release_broker_upgrade import recover_before_start
    from worker_release_broker_upgrade_control import SystemdBrokerControl

    verify_generation(root, digest)
    selected = recover_before_start(
        root, control=SystemdBrokerControl(), journal_path=transaction_root / "upgrade-journal.json",
        state_root=pointer_root, state_mode=0o711, transaction_root=transaction_root,
    )
    if selected is not None:
        digest = selected
        generation_path = root / "generations" / digest
        # Re-pin after recovery can switch the pointer to the previous digest.
        if str(generation_path) not in sys.path:
            sys.path.insert(0, str(generation_path))
        verify_generation(root, digest)
    broker = generation_path / "worker_release_broker.py"
    return PYTHON, [PYTHON, "-I", str(broker), "--release-uid", str(release_uid),
                    "--worker-uid", str(worker_uid), "--worker-gid", str(worker_gid),
                    "--generation-digest", digest], {
                        "PATH": "/usr/bin:/bin", "LC_ALL": "C",
                    }


def main(argv: list[str] | None = None) -> int:
    executable, arguments, environment = command(sys.argv[1:] if argv is None else argv)
    os.execve(executable, arguments, environment)
    return 127


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception:
        sys.stderr.write("worker broker generation startup rejected\n")
        raise SystemExit(1)

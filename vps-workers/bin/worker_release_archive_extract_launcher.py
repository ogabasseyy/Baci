"""Resolve the fixed current generation without granting journal access."""
from __future__ import annotations

import grp
import hashlib
import json
import os
import re
import stat
import sys
from pathlib import Path

HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
POINTER_ROOT = Path("/var/lib/baci-worker-broker/pointer")
PYTHON = "/usr/bin/python3"
TXID = re.compile(r"^[0-9a-f]{32}$")
HEX_256 = re.compile(r"^[0-9a-f]{64}$")
DIR_FLAGS = os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW
MAX_MANIFEST_BYTES = 256 * 1024
MAX_MANIFEST_FILES = 512
MAX_FILE_BYTES = 16 * 1024 * 1024
MAX_GENERATION_BYTES = 96 * 1024 * 1024


def _open_absolute_directory(path: Path, *, uid: int, gid: int, mode: int) -> int:
    if not path.is_absolute() or path != Path(os.path.normpath(str(path))) or ".." in path.parts:
        raise RuntimeError("fixed extractor directory path is invalid")
    current = os.open("/", DIR_FLAGS)
    try:
        for index, component in enumerate(path.parts[1:], start=1):
            child = os.open(component, DIR_FLAGS, dir_fd=current)
            info = os.fstat(child)
            final = index == len(path.parts) - 1
            if (not stat.S_ISDIR(info.st_mode) or info.st_uid not in {0, uid} or info.st_mode & 0o022
                    or final and (info.st_gid != gid or stat.S_IMODE(info.st_mode) != mode)):
                os.close(child)
                raise RuntimeError("fixed extractor ancestor metadata is unsafe")
            os.close(current)
            current = child
        return current
    except BaseException:
        os.close(current)
        raise


def _open_dir(parent: int, name: str, *, uid: int, gid: int, mode: int) -> int:
    fd = os.open(name, DIR_FLAGS, dir_fd=parent)
    info = os.fstat(fd)
    if (not stat.S_ISDIR(info.st_mode) or (info.st_uid, info.st_gid) != (uid, gid)
            or stat.S_IMODE(info.st_mode) != mode):
        os.close(fd)
        raise RuntimeError("fixed extractor generation directory is unsafe")
    return fd


def _read_fd(fd: int, maximum: int) -> bytes:
    chunks = bytearray()
    while chunk := os.read(fd, min(65536, maximum + 1 - len(chunks))):
        chunks.extend(chunk)
        if len(chunks) > maximum:
            raise RuntimeError("extractor generation file exceeds its fixed bound")
    return bytes(chunks)


def _verified_extractor_files(generation_fd: int, digest: str, *, owner_uid: int,
                              owner_gid: int, extractor_gid: int) -> None:
    manifest_fd = os.open("generation.json", os.O_RDONLY | os.O_NOFOLLOW,
                          dir_fd=generation_fd)
    try:
        info = os.fstat(manifest_fd)
        raw = _read_fd(manifest_fd, MAX_MANIFEST_BYTES)
        if (not stat.S_ISREG(info.st_mode) or (info.st_uid, info.st_gid) !=
                (owner_uid, owner_gid) or stat.S_IMODE(info.st_mode) != 0o444
                or info.st_nlink != 1):
            raise RuntimeError("extractor generation manifest is outside read-only policy")
    finally:
        os.close(manifest_fd)
    try:
        document = json.loads(raw)
        if (not isinstance(document, dict) or set(document) != {"version", "digest", "files"}
                or document["version"] != 1 or document["digest"] != digest
                or not isinstance(document["files"], list)
                or not 1 <= len(document["files"]) <= MAX_MANIFEST_FILES):
            raise ValueError
        canonical = json.dumps({"version": 1, "files": document["files"]}, sort_keys=True,
                               separators=(",", ":")).encode("utf-8")
        if hashlib.sha256(canonical).hexdigest() != digest:
            raise ValueError
        if json.dumps(document, sort_keys=True, separators=(",", ":")).encode() + b"\n" != raw:
            raise ValueError
    except (UnicodeDecodeError, json.JSONDecodeError, TypeError, ValueError, KeyError):
        raise RuntimeError("extractor generation manifest does not match its pointer") from None

    entries = {}
    total = 0
    for item in document["files"]:
        if (not isinstance(item, dict) or set(item) != {"path", "mode", "gid", "size", "sha256"}
                or not isinstance(item["path"], str) or item["path"].startswith("/")
                or "\\" in item["path"] or "\x00" in item["path"]
                or any(part in ("", ".", "..") for part in item["path"].split("/"))
                or type(item["mode"]) is not int or item["mode"] not in (0o440, 0o550, 0o640, 0o750)
                or type(item["gid"]) is not int or item["gid"] < 0
                or type(item["size"]) is not int or not 0 <= item["size"] <= MAX_FILE_BYTES
                or not isinstance(item["sha256"], str) or not HEX_256.fullmatch(item["sha256"])
                or item["path"] in entries):
            raise RuntimeError("extractor generation manifest entry is invalid")
        entries[item["path"]] = item
        total += item["size"]
        if total > MAX_GENERATION_BYTES:
            raise RuntimeError("extractor generation manifest exceeds its total bound")

    for name in ("worker_release_archive_extract_child.py", "worker_release_archive.py",
                 "worker_release_broker_common.py"):
        item = entries.get(name)
        if (item is None or item["gid"] != extractor_gid or item["mode"] != 0o440):
            raise RuntimeError("extractor generation closure is missing from its manifest")
        before = os.stat(name, dir_fd=generation_fd, follow_symlinks=False)
        fd = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=generation_fd)
        try:
            file_info = os.fstat(fd)
            content = _read_fd(fd, MAX_FILE_BYTES)
            after = os.stat(name, dir_fd=generation_fd, follow_symlinks=False)
            if (not stat.S_ISREG(file_info.st_mode)
                    or (file_info.st_uid, file_info.st_gid) != (owner_uid, extractor_gid)
                    or stat.S_IMODE(file_info.st_mode) != 0o440 or file_info.st_nlink != 1
                    or file_info.st_size != item["size"]
                    or hashlib.sha256(content).hexdigest() != item["sha256"]
                    or (before.st_dev, before.st_ino) != (file_info.st_dev, file_info.st_ino)
                    or (after.st_dev, after.st_ino) != (file_info.st_dev, file_info.st_ino)):
                raise RuntimeError("extractor generation file differs from its manifest")
        finally:
            os.close(fd)


def resolve_generation(*, helper_root: Path = HELPER_ROOT, pointer_root: Path = POINTER_ROOT,
                       owner_uid: int = 0, owner_gid: int = 0,
                       extractor_gid: int | None = None) -> tuple[str, str]:
    """Return exact digest and child path from root-owned pinned directories."""
    root_fd = _open_absolute_directory(helper_root, uid=owner_uid, gid=owner_gid, mode=0o755)
    pointer_fd = _open_absolute_directory(pointer_root, uid=owner_uid, gid=owner_gid, mode=0o711)
    try:
        link = os.stat("current", dir_fd=pointer_fd, follow_symlinks=False)
        target = os.readlink("current", dir_fd=pointer_fd)
        after_link = os.stat("current", dir_fd=pointer_fd, follow_symlinks=False)
        prefix = str(helper_root / "generations") + "/"
        if (not stat.S_ISLNK(link.st_mode) or link.st_uid != owner_uid
                or (link.st_dev, link.st_ino) != (after_link.st_dev, after_link.st_ino)
                or not target.startswith(prefix) or not HEX_256.fullmatch(target[len(prefix):])):
            raise RuntimeError("current broker generation pointer is invalid")
        digest = target[len(prefix):]
        generations_fd = _open_dir(root_fd, "generations", uid=owner_uid, gid=owner_gid, mode=0o755)
        try:
            generation_fd = _open_dir(generations_fd, digest, uid=owner_uid, gid=owner_gid, mode=0o555)
            try:
                extractor_gid = (grp.getgrnam("baci-release-extractor").gr_gid
                                 if extractor_gid is None else extractor_gid)
                _verified_extractor_files(generation_fd, digest, owner_uid=owner_uid,
                                          owner_gid=owner_gid, extractor_gid=extractor_gid)
            finally:
                os.close(generation_fd)
        finally:
            os.close(generations_fd)
    finally:
        os.close(pointer_fd)
        os.close(root_fd)
    return digest, str(helper_root / "generations" / digest / "worker_release_archive_extract_child.py")


def command(argv: list[str]) -> tuple[str, list[str], dict[str, str]]:
    if len(argv) != 1 or not TXID.fullmatch(argv[0]):
        raise RuntimeError("extractor transaction identity is invalid")
    _digest, child = resolve_generation()
    return PYTHON, [PYTHON, "-I", "-B", child, argv[0]], {
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
        sys.stderr.write("worker source extractor generation rejected\n")
        raise SystemExit(1)

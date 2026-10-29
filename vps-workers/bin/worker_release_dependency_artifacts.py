"""Bounded manifests and portable containment checks for dependency candidates."""
from __future__ import annotations

import hashlib
import os
import re
import stat
import subprocess
from pathlib import Path, PurePosixPath

MAX_PAYLOAD_BYTES = 1024 * 1024 * 1024
MAX_ENTRIES = 200_000
MAX_PATH_BYTES = 1024
MANIFEST_NAME = "dependency-build-manifest.json"
SMOKE_NAME = ".candidate-smoke.json"
SHA_RE = re.compile(r"^[0-9a-f]{40}$")


class BuilderRejected(RuntimeError):
    pass


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def _exclude_source_name(name: str) -> bool:
    return name in (".npmrc", ".netrc", ".git-credentials") or name.startswith(".env") or name.endswith(".env")


def copy_source_tree(source: Path, destination: Path, *, max_bytes: int = 512 * 1024 * 1024,
                     max_entries: int = 200_000, preserve_executable: bool = False,
                     allow_hardlinks: bool = False) -> None:
    """Copy bounded regular content through no-follow dirfds, omitting credentials."""
    source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    destination_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0))
    counters = {"bytes": 0, "entries": 0}

    def visit(input_fd: int, output_fd: int) -> None:
        before_dir = os.fstat(input_fd)
        for name in sorted(os.listdir(input_fd)):
            if _exclude_source_name(name):
                continue
            if name in ("", ".", "..") or "/" in name or "\\" in name:
                raise BuilderRejected("source tree contains an unsafe entry name")
            info = os.stat(name, dir_fd=input_fd, follow_symlinks=False)
            counters["entries"] += 1
            if counters["entries"] > max_entries:
                raise BuilderRejected("source input has too many entries")
            if stat.S_ISDIR(info.st_mode):
                child_in = os.open(name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0), dir_fd=input_fd)
                try:
                    opened_dir = os.fstat(child_in)
                    if (info.st_dev, info.st_ino) != (opened_dir.st_dev, opened_dir.st_ino):
                        raise BuilderRejected("source directory changed while copying")
                    os.mkdir(name, 0o700, dir_fd=output_fd)
                    child_out = os.open(name, os.O_RDONLY | os.O_DIRECTORY | getattr(os, "O_NOFOLLOW", 0), dir_fd=output_fd)
                    try:
                        visit(child_in, child_out)
                    finally:
                        os.close(child_out)
                finally:
                    os.close(child_in)
            elif stat.S_ISREG(info.st_mode):
                if (info.st_nlink != 1 and not allow_hardlinks) or info.st_size < 0:
                    raise BuilderRejected("source input contains a shared or invalid file")
                counters["bytes"] += info.st_size
                if counters["bytes"] > max_bytes:
                    raise BuilderRejected("source input exceeds size limit")
                input_file = os.open(name, os.O_RDONLY | getattr(os, "O_NOFOLLOW", 0), dir_fd=input_fd)
                output_file = -1
                try:
                    opened = os.fstat(input_file)
                    if (info.st_dev, info.st_ino) != (opened.st_dev, opened.st_ino):
                        raise BuilderRejected("source file changed while copying")
                    output_mode = 0o700 if preserve_executable and info.st_mode & 0o111 else 0o600
                    output_file = os.open(name, os.O_WRONLY | os.O_CREAT | os.O_EXCL | getattr(os, "O_NOFOLLOW", 0), output_mode, dir_fd=output_fd)
                    copied = 0
                    while True:
                        block = os.read(input_file, min(1024 * 1024, info.st_size - copied + 1))
                        if not block:
                            break
                        copied += len(block)
                        if copied > info.st_size:
                            raise BuilderRejected("source file grew while copying")
                        view = memoryview(block)
                        while view:
                            written = os.write(output_file, view)
                            if written <= 0:
                                raise BuilderRejected("source snapshot write failed")
                            view = view[written:]
                    after = os.fstat(input_file)
                    if copied != info.st_size or info.st_mtime_ns != after.st_mtime_ns or info.st_ctime_ns != after.st_ctime_ns:
                        raise BuilderRejected("source file changed while copying")
                finally:
                    if output_file >= 0:
                        os.close(output_file)
                    os.close(input_file)
            else:
                raise BuilderRejected("source tree contains a link or special file")
        after_dir = os.fstat(input_fd)
        if (before_dir.st_dev, before_dir.st_ino) != (after_dir.st_dev, after_dir.st_ino) or before_dir.st_mtime_ns != after_dir.st_mtime_ns or before_dir.st_ctime_ns != after_dir.st_ctime_ns:
            raise BuilderRejected("source directory changed while copying")

    try:
        visit(source_fd, destination_fd)
    finally:
        os.close(destination_fd)
        os.close(source_fd)


def make_read_only_input(root: Path) -> None:
    for current, dirs, files in os.walk(root, topdown=False, followlinks=False):
        current_path = Path(current)
        for name in files:
            path = current_path / name
            if not stat.S_ISREG(path.lstat().st_mode):
                raise BuilderRejected("source copy contains a link or special file")
            path.chmod(0o444)
        for name in dirs:
            path = current_path / name
            if not stat.S_ISDIR(path.lstat().st_mode):
                raise BuilderRejected("source copy contains a link or special file")
            path.chmod(0o555)
        current_path.chmod(0o555)


def _portable_relative_path(relative: str) -> None:
    if not relative or len(relative.encode("utf-8")) > MAX_PATH_BYTES or "\\" in relative:
        raise BuilderRejected("dependency payload contains a non-portable path")
    path = PurePosixPath(relative)
    if path.is_absolute() or any(part in ("", ".", "..") for part in relative.split("/")):
        raise BuilderRejected("dependency payload contains an unsafe path")


def _validate_symlink(root: Path, link: Path) -> str:
    relative = link.relative_to(root).as_posix()
    _portable_relative_path(relative)
    target = os.readlink(link)
    if not target or target.startswith("/") or "\\" in target or len(target.encode("utf-8")) > MAX_PATH_BYTES:
        raise BuilderRejected("dependency payload contains a non-portable symlink")
    # Reject traversal above the payload even if later components would return
    # inside it. This keeps link behavior stable across extraction tools.
    stack = relative.split("/")[:-1]
    for part in target.split("/"):
        if part in ("", "."):
            continue
        if part == "..":
            if not stack:
                raise BuilderRejected("dependency symlink escapes payload root")
            stack.pop()
        else:
            stack.append(part)
    try:
        resolved = link.resolve(strict=True)
        resolved.relative_to(root.resolve(strict=True))
    except (OSError, RuntimeError, ValueError) as exc:
        raise BuilderRejected("dependency symlink is broken, cyclic, or escapes payload") from exc
    if not (resolved.is_file() or resolved.is_dir()):
        raise BuilderRejected("dependency symlink target is not a regular file or directory")
    return target


def validate_payload(payload: Path) -> tuple[list[dict[str, str | int]], int]:
    if not payload.is_dir() or payload.is_symlink():
        raise BuilderRejected("payload root must be a real directory")
    root = payload.resolve(strict=True)
    entries: list[dict[str, str | int]] = []
    expanded = 0
    pending = [root]
    while pending:
        current = pending.pop()
        with os.scandir(current) as scanner:
            children = sorted(scanner, key=lambda item: item.name)
        for child in children:
            path = Path(child.path)
            relative = path.relative_to(root).as_posix()
            _portable_relative_path(relative)
            info = path.lstat()
            if stat.S_ISDIR(info.st_mode):
                if info.st_mode & 0o6022:
                    raise BuilderRejected("dependency payload directory has unsafe write or set-id bits")
                pending.append(path)
                entry: dict[str, str | int] = {"path": relative, "kind": "directory", "mode": stat.S_IMODE(info.st_mode)}
            elif stat.S_ISREG(info.st_mode):
                if info.st_mode & 0o6022:
                    raise BuilderRejected("dependency payload file has unsafe write or set-id bits")
                if info.st_nlink != 1:
                    raise BuilderRejected("dependency payload contains a shared hardlinked file")
                expanded += info.st_size
                entry = {"path": relative, "kind": "file", "mode": stat.S_IMODE(info.st_mode), "size": info.st_size, "sha256": sha256_file(path)}
            elif stat.S_ISLNK(info.st_mode):
                target = _validate_symlink(root, path)
                expanded += len(target.encode("utf-8"))
                entry = {"path": relative, "kind": "symlink", "target": target}
            else:
                raise BuilderRejected("dependency payload contains a special file")
            if expanded > MAX_PAYLOAD_BYTES:
                raise BuilderRejected("dependency payload exceeds size limit")
            entries.append(entry)
            if len(entries) > MAX_ENTRIES:
                raise BuilderRejected("dependency payload has too many entries")
    entries.sort(key=lambda item: str(item["path"]))
    return entries, expanded


def verify_runtime_candidates(payload: Path) -> dict[str, str]:
    """Run only fixed package smoke commands inside the unprivileged sandbox."""
    web = payload / "web"
    web_tsx = web / "node_modules" / ".bin" / "tsx"
    worker_node_modules = payload / "root" / "node_modules"
    dotenv = worker_node_modules / "dotenv"
    try:
        web_tsx.resolve(strict=True).relative_to(payload.resolve(strict=True))
        dotenv.resolve(strict=True).relative_to(payload.resolve(strict=True))
    except (OSError, RuntimeError, ValueError) as exc:
        raise BuilderRejected("web tsx or worker dotenv dependency is absent or escapes payload") from exc
    if not web_tsx.is_file() or not os.access(web_tsx, os.X_OK) or not dotenv.is_dir():
        raise BuilderRejected("web tsx or worker dotenv dependency is not runnable")
    env = {"PATH": "/usr/bin:/bin", "HOME": "/nonexistent", "NODE_ENV": "production"}
    try:
        result = subprocess.run((str(web_tsx), "--version"), cwd=web, env=env, check=True, capture_output=True, text=True, timeout=20)
        subprocess.run(("/usr/bin/node", "--input-type=module", "-e", "import('dotenv').then(m => { if (typeof m.config !== 'function') process.exit(2) })"), cwd=payload / "root", env=env, check=True, capture_output=True, text=True, timeout=20)
    except (OSError, subprocess.SubprocessError) as exc:
        raise BuilderRejected("dependency runtime smoke check failed") from exc
    if not result.stdout.strip():
        raise BuilderRejected("web tsx smoke check returned no version")
    return {"web_tsx": "passed", "worker_dotenv": "passed"}


def payload_manifest(payload: Path, expected_sha: str, lockfiles: dict[str, str], smoke: dict[str, str]) -> dict[str, object]:
    if not SHA_RE.fullmatch(expected_sha):
        raise BuilderRejected("expected commit SHA is invalid")
    if smoke != {"web_tsx": "passed", "worker_dotenv": "passed"}:
        raise BuilderRejected("required runtime smoke evidence is incomplete")
    entries, expanded = validate_payload(payload)
    return {
        "schema": 1,
        "requested_commit_sha": expected_sha,
        "exact_sha_provenance_verified": False,
        "source_provenance": "broker-attestation-required",
        "builder": "credential-free-systemd-proposal-v1",
        "pnpm_version": "11.7.0",
        "lifecycle_scripts": "disabled",
        "runtime_ready": False,
        "smoke_checks": smoke,
        "symlink_validation": "portable-contained",
        "lockfiles": lockfiles,
        "expanded_bytes": expanded,
        "entries": entries,
    }

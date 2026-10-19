#!/usr/bin/env python3
"""Reproducible source snapshot for the isolated staging funding build.

Captures tracked files plus untracked (non-ignored) files from a worktree,
writes a sorted tarball alongside a SHA-256 manifest, and can re-verify an
extracted tree against that manifest. Refuses to include environment files.
"""

import argparse
import hashlib
import json
import subprocess
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path


VERSION = 1
EXCLUDED_DIR_PARTS = frozenset({"__pycache__", ".playwright-cli"})
EXCLUDED_BASENAMES = frozenset({".DS_Store"})


class Refused(RuntimeError):
    pass


def _git_list(root: Path, arguments: list[str]) -> list[str]:
    completed = subprocess.run(
        ["git", "-C", str(root), *arguments],
        check=False,
        capture_output=True,
        text=False,
        timeout=120,
    )
    if completed.returncode != 0:
        raise Refused("Worktree file listing failed.")
    return [
        entry.decode("utf-8", "surrogateescape")
        for entry in completed.stdout.split(b"\0")
        if entry
    ]


def collect_files(root: Path) -> list[str]:
    tracked = _git_list(root, ["ls-files", "-z"])
    untracked = _git_list(root, ["ls-files", "--others", "--exclude-standard", "-z"])
    selected = []
    for path in sorted(set(tracked) | set(untracked)):
        parts = Path(path).parts
        if not parts or Path(path).is_absolute() or ".." in parts:
            raise Refused("Worktree path escapes the snapshot root.")
        if EXCLUDED_DIR_PARTS & set(parts):
            continue
        if parts[-1] in EXCLUDED_BASENAMES:
            continue
        if parts[-1] == ".env" or parts[-1].startswith(".env."):
            raise Refused("Environment files must never enter a snapshot.")
        selected.append(path)
    if not selected:
        raise Refused("Snapshot file set is empty.")
    return selected


def hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def snapshot(root: Path, output: Path) -> dict[str, object]:
    root = root.resolve(strict=True)
    if not (root / ".git").exists() and not (root / ".git").is_symlink():
        raise Refused("Snapshot root is not a worktree.")
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    tarball = output / f"funding-source-{stamp}.tar.gz"
    manifest_path = output / f"funding-source-{stamp}.manifest.json"
    if tarball.exists() or manifest_path.exists():
        raise Refused("Snapshot output already exists.")
    head = subprocess.run(
        ["git", "-C", str(root), "rev-parse", "HEAD"],
        check=False,
        capture_output=True,
        text=True,
        timeout=30,
    )
    files = []
    for relative in collect_files(root):
        absolute = root / relative
        if absolute.is_symlink() or not absolute.is_file():
            raise Refused(f"Snapshot entry is not a regular file: {relative}")
        digest, size = hash_file(absolute)
        files.append({"path": relative, "sha256": digest, "size": size})
    with tarfile.open(tarball, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for entry in files:
            info = archive.gettarinfo(str(root / entry["path"]), arcname=entry["path"])
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            with open(root / entry["path"], "rb") as handle:
                archive.addfile(info, handle)
    tarball_digest, tarball_size = hash_file(tarball)
    manifest = {
        "version": VERSION,
        "head": head.stdout.strip() if head.returncode == 0 else "unknown",
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "count": len(files),
        "files": files,
        "tarballSha256": tarball_digest,
        "tarballSize": tarball_size,
    }
    manifest_path.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")
    return {"manifest": str(manifest_path), "tarball": str(tarball), **manifest}


def verify(tarball: Path, manifest_path: Path, tree: Path) -> dict[str, object]:
    manifest = json.loads(manifest_path.read_bytes())
    if manifest.get("version") != VERSION or not isinstance(manifest.get("files"), list):
        raise Refused("Snapshot manifest is invalid.")
    digest, _ = hash_file(tarball)
    if digest != manifest.get("tarballSha256"):
        raise Refused("Snapshot tarball hash differs.")
    checked = 0
    for entry in manifest["files"]:
        relative = entry["path"]
        absolute = tree / relative
        if absolute.is_symlink() or not absolute.is_file():
            raise Refused(f"Snapshot entry missing: {relative}")
        actual, _ = hash_file(absolute)
        if actual != entry["sha256"]:
            raise Refused(f"Snapshot entry differs: {relative}")
        checked += 1
    if checked != manifest.get("count"):
        raise Refused("Snapshot entry count differs.")
    return {"checked": checked, "tarballSha256": digest}


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="command", required=True)
    create = subparsers.add_parser("create")
    create.add_argument("--root", type=Path, required=True)
    create.add_argument("--out", type=Path, required=True)
    check = subparsers.add_parser("verify")
    check.add_argument("--tarball", type=Path, required=True)
    check.add_argument("--manifest", type=Path, required=True)
    check.add_argument("--tree", type=Path, required=True)
    parsed = parser.parse_args(arguments)
    try:
        if parsed.command == "create":
            result = snapshot(parsed.root, parsed.out)
            print(
                json.dumps(
                    {
                        "result": "snapshotted",
                        "count": result["count"],
                        "tarballSha256": result["tarballSha256"],
                    }
                )
            )
        else:
            result = verify(parsed.tarball, parsed.manifest, parsed.tree)
            print(
                json.dumps(
                    {
                        "result": "verified",
                        "checked": result["checked"],
                        "tarballSha256": result["tarballSha256"],
                    }
                )
            )
    except (OSError, RuntimeError, ValueError):
        print("Funding source snapshot refused.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

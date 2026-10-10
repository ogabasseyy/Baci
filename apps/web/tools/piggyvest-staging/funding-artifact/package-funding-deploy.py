#!/usr/bin/env python3
"""Package a verified Next standalone build into a deploy tree tarball.

Arranges standalone output plus static/public overlays into the fixed
funding-service layout, writes a SHA-256 manifest, and refuses inputs that
are incomplete or contain environment files. Runs unprivileged.
"""

import argparse
import hashlib
import json
import shutil
import sys
import tarfile
from datetime import UTC, datetime
from pathlib import Path


VERSION = 1


class Refused(RuntimeError):
    pass


def _is_environment_file(path: Path) -> bool:
    return path.name == ".env" or path.name.startswith(".env.")


def _require_no_environment_files(root: Path) -> None:
    for entry in root.rglob("*"):
        if _is_environment_file(entry):
            raise Refused("Deploy input contains an environment file.")


def _copy_into(source: Path, target: Path) -> None:
    if source.is_symlink() or not source.is_dir():
        raise Refused("Deploy input is incomplete.")
    target.mkdir(parents=True, exist_ok=True)
    for child in sorted(source.iterdir()):
        destination = target / child.name
        if child.is_symlink() or child.is_file():
            shutil.copy2(child, destination, follow_symlinks=False)
        elif child.is_dir():
            shutil.copytree(child, destination, symlinks=True)
        else:
            raise Refused("Deploy input has an unsupported entry.")


def _hash_file(path: Path) -> tuple[str, int]:
    digest = hashlib.sha256()
    size = 0
    with open(path, "rb") as handle:
        for block in iter(lambda: handle.read(65536), b""):
            digest.update(block)
            size += len(block)
    return digest.hexdigest(), size


def package(build_web: Path, output: Path) -> dict[str, object]:
    standalone = build_web / ".next" / "standalone"
    static = build_web / ".next" / "static"
    public = build_web / "public"
    server = standalone / "apps" / "web" / "server.js"
    modules = standalone / "node_modules"
    if not server.is_file() or server.is_symlink():
        raise Refused("Standalone server entrypoint is missing.")
    if not modules.is_dir() or modules.is_symlink():
        raise Refused("Standalone dependencies are missing.")
    if not static.is_dir() or not public.is_dir():
        raise Refused("Static or public overlay is missing.")
    for root in (standalone, static, public):
        _require_no_environment_files(root)
    output.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now(UTC).strftime("%Y%m%d")
    tarball = output / f"funding-deploy-{stamp}.tar.gz"
    manifest_path = output / f"funding-deploy-{stamp}.manifest.json"
    if tarball.exists() or manifest_path.exists():
        raise Refused("Deploy output already exists.")
    deploy = output / f"funding-deploy-{stamp}.tree"
    if deploy.exists():
        raise Refused("Deploy tree already exists.")
    deploy.mkdir()
    _copy_into(standalone, deploy)
    _copy_into(static, deploy / "apps" / "web" / ".next" / "static")
    _copy_into(public, deploy / "apps" / "web" / "public")
    entries = []
    total = 0
    for path in sorted(deploy.rglob("*")):
        relative = path.relative_to(deploy).as_posix()
        if path.is_symlink():
            entries.append(
                {"path": relative, "link": True, "target": str(path.readlink())}
            )
        elif path.is_file():
            digest, size = _hash_file(path)
            entries.append({"path": relative, "sha256": digest, "size": size})
            total += size
        elif not path.is_dir():
            raise Refused("Deploy tree has an unsupported entry.")
    with tarfile.open(tarball, "w:gz", format=tarfile.PAX_FORMAT) as archive:
        for entry in sorted(entries, key=lambda item: item["path"]):
            info = archive.gettarinfo(str(deploy / entry["path"]), arcname=entry["path"])
            info.uid = 0
            info.gid = 0
            info.uname = "root"
            info.gname = "root"
            if entry.get("link"):
                archive.addfile(info)
            else:
                with open(deploy / entry["path"], "rb") as handle:
                    archive.addfile(info, handle)
    tarball_digest, tarball_size = _hash_file(tarball)
    manifest = {
        "version": VERSION,
        "createdAt": datetime.now(UTC).isoformat(timespec="seconds"),
        "count": len(entries),
        "bytes": total,
        "files": sorted(entries, key=lambda item: item["path"]),
        "tarballSha256": tarball_digest,
        "tarballSize": tarball_size,
    }
    manifest_path.write_text(json.dumps(manifest) + "\n", encoding="utf-8")
    return {"manifest": str(manifest_path), "tarball": str(tarball), **manifest}


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--build-web", type=Path, required=True)
    parser.add_argument("--out", type=Path, required=True)
    parsed = parser.parse_args(arguments)
    try:
        result = package(parsed.build_web, parsed.out)
        print(
            json.dumps(
                {
                    "result": "packaged",
                    "count": result["count"],
                    "bytes": result["bytes"],
                    "tarballSha256": result["tarballSha256"],
                }
            )
        )
    except (OSError, RuntimeError):
        print("Funding deploy packaging refused.", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

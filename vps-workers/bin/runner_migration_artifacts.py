"""Artifact and GitHub API validation helpers for the release runner migration."""
from __future__ import annotations

import json
import shutil
import tarfile
import urllib.error
import urllib.request
from pathlib import Path, PurePosixPath
from typing import Callable

MAX_ARCHIVE_BYTES = 1_000_000_000
MAX_MEMBER_COUNT = 30_000
REPOSITORY_URL = "https://github.com/ogabasseyy/Baci"
RUNNER_NAME = "baci-release-01"
RUNNER_LABEL = "baci-release"
POLICY_PATH = Path(__file__).resolve().parents[2] / "infra/cwv-runner/policy.json"


def runner_artifact(policy_path: Path = POLICY_PATH) -> tuple[str, str, str]:
    policy = json.loads(policy_path.read_text(encoding="utf-8"))
    runner = policy["supplyChain"]["runner"]
    version, url, digest = runner.get("version"), runner.get("url"), runner.get("sha256")
    if not isinstance(version, str) or not version or not isinstance(url, str) or not url.startswith("https://github.com/actions/runner/releases/download/v"):
        raise RuntimeError("runner artifact policy is invalid")
    if not isinstance(digest, str) or len(digest) != 64 or any(char not in "0123456789abcdef" for char in digest):
        raise RuntimeError("runner artifact digest policy is invalid")
    if not url.endswith(f"actions-runner-linux-x64-{version}.tar.gz"):
        raise RuntimeError("runner artifact URL does not match the pinned Linux x64 version")
    return version, url, digest


def validate_archive_members(archive: tarfile.TarFile) -> list[tuple[tarfile.TarInfo, str]]:
    members = archive.getmembers()
    if not members or len(members) > MAX_MEMBER_COUNT:
        raise RuntimeError("runner archive has an invalid member count")
    normalized: list[tuple[tarfile.TarInfo, str]] = []
    seen: set[str] = set()
    links: set[str] = set()
    total_size = 0
    for member in members:
        raw = member.name
        if "\x00" in raw or "\\" in raw or raw.startswith("/"):
            raise RuntimeError("runner archive contains an unsafe path")
        while raw.startswith("./"):
            raw = raw[2:]
        if raw in ("", "."):
            if not member.isdir():
                raise RuntimeError("runner archive root entry is invalid")
            continue
        path = PurePosixPath(raw)
        if any(part in ("", ".", "..") for part in path.parts) or path.is_absolute():
            raise RuntimeError("runner archive contains an unsafe path")
        key = path.as_posix().rstrip("/")
        if key in seen:
            raise RuntimeError("runner archive contains duplicate paths")
        seen.add(key)
        if member.isdir():
            pass
        elif member.isfile():
            total_size += member.size
            if member.size < 0 or total_size > MAX_ARCHIVE_BYTES:
                raise RuntimeError("runner archive exceeds the expanded-size limit")
        elif member.issym():
            if not member.linkname or "\x00" in member.linkname or "\\" in member.linkname or member.linkname.startswith("/"):
                raise RuntimeError("runner archive contains an unsafe symlink")
            resolved = PurePosixPath(key).parent.joinpath(member.linkname)
            stack: list[str] = []
            for part in resolved.parts:
                if part in ("", "."):
                    continue
                if part == "..":
                    if not stack:
                        raise RuntimeError("runner archive symlink escapes its root")
                    stack.pop()
                else:
                    stack.append(part)
            if not stack:
                raise RuntimeError("runner archive symlink targets its root")
            links.add(key)
        else:
            raise RuntimeError("runner archive contains a hard link or special file")
        normalized.append((member, key))
    for _, key in normalized:
        parts = PurePosixPath(key).parts
        if any(PurePosixPath(*parts[:index]).as_posix() in links for index in range(1, len(parts))):
            raise RuntimeError("runner archive places an entry below a symlink")
    return normalized


def extract_runner_archive(archive_path: Path, target: Path) -> None:
    if target.exists() or target.is_symlink():
        raise RuntimeError("dedicated runner installation path already exists; refusing overwrite")
    target.mkdir(mode=0o700, parents=False)
    try:
        with tarfile.open(archive_path, mode="r:gz") as archive:
            members = validate_archive_members(archive)
            for member, relative in members:
                if member.isdir():
                    (target / relative).mkdir(mode=0o700, parents=True, exist_ok=True)
            for member, relative in members:
                destination = target / relative
                if member.isfile():
                    destination.parent.mkdir(mode=0o700, parents=True, exist_ok=True)
                    source = archive.extractfile(member)
                    if source is None:
                        raise RuntimeError("runner archive member could not be read")
                    with source, destination.open("xb") as output:
                        shutil.copyfileobj(source, output, length=1024 * 1024)
                    mode = (member.mode & 0o755) | 0o600
                    destination.chmod(mode)
            for member, relative in members:
                if member.issym():
                    (target / relative).symlink_to(member.linkname)
        required = (target / "config.sh", target / "run.sh", target / "runsvc.sh", target / "bin/Runner.Listener")
        if not all(path.is_file() and not path.is_symlink() for path in required):
            raise RuntimeError("pinned runner archive is missing required regular files")
    except Exception:
        shutil.rmtree(target, ignore_errors=True)
        raise


def request_github_runner_token(kind: str, admin_token: str, *, opener: Callable[..., object] = urllib.request.urlopen) -> str:
    if kind not in ("registration-token", "remove-token") or not admin_token or len(admin_token) > 4096:
        raise RuntimeError("GitHub runner token request is invalid")
    request = urllib.request.Request(
        f"https://api.github.com/repos/ogabasseyy/Baci/actions/runners/{kind}",
        data=b"{}", headers={"authorization": f"Bearer {admin_token}", "accept": "application/vnd.github+json",
        "content-type": "application/json", "x-github-api-version": "2022-11-28"}, method="POST")
    try:
        with opener(request, timeout=15) as response:
            if response.status != 201:
                raise RuntimeError("GitHub refused the short-lived runner token request")
            payload = json.loads(response.read(8193))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        raise RuntimeError("GitHub short-lived runner token request failed") from error
    token = payload.get("token") if isinstance(payload, dict) else None
    if not isinstance(token, str) or not token or len(token) > 512:
        raise RuntimeError("GitHub returned an invalid short-lived runner token")
    return token


def verify_github_runner_registration(admin_token: str, *, opener: Callable[..., object] = urllib.request.urlopen) -> None:
    request = urllib.request.Request("https://api.github.com/repos/ogabasseyy/Baci/actions/runners?per_page=100",
        headers={"authorization": f"Bearer {admin_token}", "accept": "application/vnd.github+json", "x-github-api-version": "2022-11-28"})
    try:
        with opener(request, timeout=15) as response:
            if response.status != 200:
                raise RuntimeError("GitHub runner registration could not be verified")
            payload = json.loads(response.read(256 * 1024 + 1))
    except (urllib.error.URLError, TimeoutError, ValueError, OSError) as error:
        raise RuntimeError("GitHub runner registration verification failed") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("runners"), list):
        raise RuntimeError("GitHub runner registration response is invalid")
    matches = [runner for runner in payload["runners"] if isinstance(runner, dict) and runner.get("name") == RUNNER_NAME]
    if len(matches) != 1:
        raise RuntimeError("GitHub did not report exactly one dedicated runner registration")
    labels = matches[0].get("labels")
    label_names = [label.get("name") for label in labels if isinstance(label, dict)] if isinstance(labels, list) else []
    if label_names != [RUNNER_LABEL]:
        raise RuntimeError("GitHub runner labels are not isolated to baci-release")

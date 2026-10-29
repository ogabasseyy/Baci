#!/usr/bin/env python3
"""Untrusted archive parser for the fixed, systemd-confined extractor unit."""
from __future__ import annotations

import hashlib
import json
import os
import re
import socket
import sys
import tempfile
from pathlib import Path

HELPER_ROOT = Path("/usr/local/lib/baci-worker-broker")
RESOURCE_ROOT = Path("/run/baci-worker-release-extract/resources")
CONTROL_ROOT = Path("/run/baci-worker-release-extract/control")
MAX_HEADER_BYTES = 4096
MAX_ARCHIVE_BYTES = 256 * 1024 * 1024
sys.path.insert(0, str(HELPER_ROOT))
from worker_release_archive import extract_github_tarball
from worker_release_broker_common import MAX_ARCHIVE_COMPRESSED_BYTES, MAX_ARCHIVE_ENTRIES


def _receive_archive(connection: socket.socket, target, size: int) -> str:
    if size < 0 or size > MAX_ARCHIVE_BYTES:
        raise ValueError("archive size is outside the fixed limit")
    digest = hashlib.sha256()
    remaining = size
    while remaining:
        block = connection.recv(min(1024 * 1024, remaining))
        if not block:
            raise ValueError("archive input ended early")
        target.write(block)
        digest.update(block)
        remaining -= len(block)
    return digest.hexdigest()


def extract(transaction_id: str) -> int:
    if not re.fullmatch(r"[0-9a-f]{32}", transaction_id):
        raise ValueError("transaction identity is invalid")
    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(20)
    try:
        sock.connect(str(CONTROL_ROOT / f"{transaction_id}.sock"))
        sock.sendall(f"READY {transaction_id}\n".encode("ascii"))
        line = bytearray()
        while not line.endswith(b"\n"):
            part = sock.recv(1)
            if not part or len(line) >= MAX_HEADER_BYTES:
                raise ValueError("extract request header is incomplete")
            line.extend(part)
        request = json.loads(line)
        sha, digest, size, destination = (request.get("sha"), request.get("archive_sha256"),
                                           request.get("archive_bytes"), request.get("destination"))
        if (not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha)
                or not isinstance(digest, str) or not re.fullmatch(r"[0-9a-f]{64}", digest)
                or type(size) is not int or not 0 < size <= min(MAX_ARCHIVE_BYTES, MAX_ARCHIVE_COMPRESSED_BYTES)
                or destination != f".{sha}.source.{transaction_id}"):
            raise ValueError("extract request is outside the fixed archive contract")
        output = RESOURCE_ROOT / destination
        with tempfile.TemporaryFile(mode="w+b", dir=RESOURCE_ROOT) as archive:
            if _receive_archive(sock, archive, size) != digest:
                raise ValueError("archive digest does not match the fixed request")
            archive.seek(0)
            count = extract_github_tarball(archive, str(output))
        if not 0 < count <= MAX_ARCHIVE_ENTRIES:
            raise ValueError("extractor entry count exceeds the fixed limit")
        sock.sendall(f"DONE {count}\n".encode("ascii"))
        return count
    finally:
        sock.close()


def main(argv: list[str]) -> int:
    if len(argv) != 1:
        return 2
    try:
        extract(argv[0])
        return 0
    except Exception:
        return 1


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))

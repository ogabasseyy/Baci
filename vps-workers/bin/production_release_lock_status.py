#!/usr/bin/env python3
"""Read-only, boolean-only Unix-socket view of the private release lock.

This helper is a deployment draft: install the root server only after its
service sandbox can see the exact lock path. The client fails closed when the
socket is unavailable or the peer does not return one exact status token.
"""

from __future__ import annotations

import argparse
import os
import pwd
import socket
import stat
import struct
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import production_release_lock_status_fs as filesystem

StatusError = filesystem.StatusError

LOCK_VIEW_DIRECTORY = Path("/run/baci-worker-release-status/lock-state")
LOCK_FILENAME = "pending-production-release.json"
LOCK_PATH = LOCK_VIEW_DIRECTORY / LOCK_FILENAME
STATUS_RUNTIME_DIRECTORY = Path("/run/baci-worker-release-status")
SOCKET_PATH = "/run/baci-worker-release-status/lock-status.sock"
DEPLOY_ACCOUNT_NAMES = ("bassey", "baci-worker")
RELEASE_ACCOUNT_NAME = "baci-release"
MAX_LINE = 32


def _validate_mountinfo(text: str) -> None:
    filesystem.validate_mountinfo(text, view_directory=LOCK_VIEW_DIRECTORY)


def _unescape_mountinfo_field(value: str) -> str:
    return filesystem._unescape_mountinfo_field(value)


def _verify_readonly_bind_view() -> None:
    filesystem.verify_readonly_bind_view(view_directory=LOCK_VIEW_DIRECTORY)


def read_lock_status(*, release_uid: int, root_uid: int = 0) -> str:
    """Return only the status of the preconfigured, read-only lock projection."""
    _verify_readonly_bind_view()
    return filesystem.read_lock_status_at(
        lock_path=LOCK_PATH,
        lock_filename=LOCK_FILENAME,
        view_directory=LOCK_VIEW_DIRECTORY,
        runtime_directory=STATUS_RUNTIME_DIRECTORY,
        release_uid=release_uid,
        root_uid=root_uid,
    )


def _peer_uid(connection: socket.socket) -> int:
    if hasattr(socket, "SO_PEERCRED"):
        credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _pid, uid, _gid = struct.unpack("3i", credentials)
        return uid
    if hasattr(socket, "LOCAL_PEERCRED"):
        credentials = connection.getsockopt(getattr(socket, "SOL_LOCAL", 0), socket.LOCAL_PEERCRED, 256)
        _version, uid = struct.unpack_from("=II", credentials)
        return uid
    raise StatusError("kernel peer credential API is unavailable")


def serve_connection(connection: socket.socket, *, deploy_uids: set[int], release_uid: int,
                     root_uid: int = 0) -> None:
    """Serve one exact request to one configured UID; never return lock data."""
    try:
        connection.settimeout(2)
        if not deploy_uids or any(uid <= 0 for uid in deploy_uids) or _peer_uid(connection) not in deploy_uids:
            raise StatusError("unauthorized peer")
        request = connection.recv(MAX_LINE + 1)
        if request != b"status\n":
            raise StatusError("invalid status request")
        status = read_lock_status(release_uid=release_uid, root_uid=root_uid)
        connection.sendall(f"{status}\n".encode("ascii"))
    except Exception:
        try:
            connection.sendall(b"unavailable\n")
        except OSError:
            pass


def query_status(socket_path: str = SOCKET_PATH, *, timeout: float = 2.0) -> str:
    """Request the boolean status and reject every other response."""
    try:
        with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as connection:
            connection.settimeout(timeout)
            connection.connect(socket_path)
            connection.sendall(b"status\n")
            response = connection.recv(MAX_LINE + 1)
    except OSError as error:
        raise StatusError("release lock status endpoint is unavailable") from error
    if response not in (b"locked\n", b"unlocked\n"):
        raise StatusError("release lock status response is invalid")
    return response[:-1].decode("ascii")


def bind_status_socket(path: str, *, root_uid: int = 0) -> socket.socket:
    """Bind a connectable socket; SO_PEERCRED enforces the read-only audience."""
    socket_path = Path(path)
    parent = socket_path.parent.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or stat.S_ISLNK(parent.st_mode) or parent.st_uid != root_uid or
            parent.st_mode & 0o022):
        raise StatusError("status socket parent metadata is untrusted")
    try:
        old = socket_path.lstat()
    except FileNotFoundError:
        old = None
    if old is not None:
        if not stat.S_ISSOCK(old.st_mode) or old.st_uid != root_uid:
            raise StatusError("refusing to replace a non-root status socket")
        socket_path.unlink()
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(str(socket_path))
        if os.geteuid() == 0:
            os.chown(socket_path, root_uid, root_uid)
        elif os.geteuid() != root_uid:
            raise StatusError("status socket owner does not match its configured UID")
        os.chmod(socket_path, 0o666)
        listener.listen(4)
        return listener
    except Exception:
        listener.close()
        try:
            socket_path.unlink()
        except FileNotFoundError:
            pass
        raise


def serve_forever(listener: socket.socket, *, deploy_uids: set[int], release_uid: int,
                  root_uid: int = 0) -> None:
    if (os.geteuid() != root_uid or not deploy_uids or any(uid <= 0 or uid == release_uid for uid in deploy_uids) or
            release_uid <= 0):
        raise StatusError("status endpoint identity is invalid")
    while True:
        connection, _ = listener.accept()
        with connection:
            serve_connection(connection, deploy_uids=deploy_uids, release_uid=release_uid,
                             root_uid=root_uid)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("query", "serve"))
    try:
        args = parser.parse_args(argv)
        if args.command == "query":
            print(query_status())
            return 0
        release_uid = pwd.getpwnam(RELEASE_ACCOUNT_NAME).pw_uid
        deploy_uids = {pwd.getpwnam(name).pw_uid for name in DEPLOY_ACCOUNT_NAMES}
        if len(deploy_uids) != len(DEPLOY_ACCOUNT_NAMES):
            raise StatusError("deploy identities are not distinct")
        listener = bind_status_socket(SOCKET_PATH)
        try:
            serve_forever(listener, deploy_uids=deploy_uids, release_uid=release_uid)
        finally:
            listener.close()
        return 0
    except StatusError as error:
        print(f"release lock status: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())

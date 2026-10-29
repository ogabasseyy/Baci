#!/usr/bin/env python3
"""Linux Unix-socket peer credential gate and safe GitHub tarball extractor.

This is a prototype host component. Production must install it root-owned,
create its socket in a root-owned runtime directory, and provide a fixed
dispatcher callback. It never accepts a command or filesystem path from a
client request.
"""

import json
import base64
import hashlib
import io
import os
import grp
import pwd
import socket
import fcntl
import stat
import subprocess
import struct
import re
import sys
import argparse
import tarfile
import shutil
import time
import signal
import tempfile
from typing import Callable, BinaryIO, Any

# Helper modules import the facade by its canonical name. Register the live
# entrypoint before importing them so `python worker_release_broker.py` and
# `import worker_release_broker` share one module object and one patch surface.
_broker_module = sys.modules[__name__]
_existing_broker_module = sys.modules.get("worker_release_broker")
if _existing_broker_module is not None and _existing_broker_module is not _broker_module:
    raise ImportError("worker release broker is already loaded under a different module object")
sys.modules["worker_release_broker"] = _broker_module

from worker_release_readiness import ReadinessRejected, collect_worker_readiness

from worker_release_broker_common import (
    BrokerProtocolError, MAX_REQUEST_BYTES, MAX_REPLY_BYTES, MAX_ARCHIVE_COMPRESSED_BYTES,
    MAX_ARCHIVE_EXPANDED_BYTES, MAX_ARCHIVE_ENTRIES, MAX_EXTRACTION_SECONDS,
    DISPATCHER_TIMEOUT_SECONDS, BROKER_OPERATION_BUDGET_SECONDS,
    BROKER_CLIENT_TIMEOUT_SECONDS, WORKER_ROOT, TRUSTED_NODE,
    TRUSTED_DISPATCHER, TRUSTED_HEALTH_CHECK,
)


def _read_one_request(connection: socket.socket) -> dict[str, Any]:
    data = bytearray()
    while True:
        chunk = connection.recv(min(4096, MAX_REQUEST_BYTES + 1 - len(data)))
        if not chunk:
            raise BrokerProtocolError("incomplete request")
        newline = chunk.find(b"\n")
        if newline >= 0:
            data.extend(chunk[:newline])
            if chunk[newline + 1 :] or len(data) > MAX_REQUEST_BYTES:
                raise BrokerProtocolError("request must be one bounded JSON line")
            break
        data.extend(chunk)
        if len(data) > MAX_REQUEST_BYTES:
            raise BrokerProtocolError("request exceeds size limit")
    try:
        request = json.loads(data)
    except (UnicodeDecodeError, json.JSONDecodeError):
        raise BrokerProtocolError("request is not valid JSON") from None
    if not isinstance(request, dict):
        raise BrokerProtocolError("request must be a JSON object")
    return request


def _peer_uid(connection: socket.socket) -> int:
    if hasattr(socket, "SO_PEERCRED"):
        credentials = connection.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, struct.calcsize("3i"))
        _pid, uid, _gid = struct.unpack("3i", credentials)
        return uid
    # macOS uses LOCAL_PEERCRED (struct xucred) for development-host tests.
    if hasattr(socket, "LOCAL_PEERCRED"):
        credentials = connection.getsockopt(getattr(socket, "SOL_LOCAL", 0), socket.LOCAL_PEERCRED, 256)
        _version, uid = struct.unpack_from("=II", credentials)
        return uid
    raise BrokerProtocolError("kernel peer credential API is unavailable")


def serve_connection(
    connection: socket.socket,
    *,
    expected_release_uid: int,
    dispatch: Callable[[int, dict[str, Any]], dict[str, Any]],
) -> None:
    """Handle one request; peer UID comes exclusively from kernel credentials."""
    try:
        connection.settimeout(15)
        uid = _peer_uid(connection)
        if uid != expected_release_uid:
            raise BrokerProtocolError("unauthorized peer")
        request = _read_one_request(connection)
        # Longest fixed quiescence acquisition is 630s; leave room for the
        # pointer operation, service health check, and cleanup before reply.
        connection.settimeout(BROKER_CLIENT_TIMEOUT_SECONDS)
        response = dispatch(uid, request)
        if not isinstance(response, dict):
            raise BrokerProtocolError("invalid broker result")
        payload = json.dumps(response, separators=(",", ":")).encode("utf-8") + b"\n"
        if len(payload) > MAX_REPLY_BYTES:
            raise BrokerProtocolError("broker result exceeds size limit")
        connection.sendall(payload)
    except Exception as error:
        # Do not echo dispatcher errors, which could contain tokens or provider data.
        code = "unauthorized" if str(error) == "unauthorized peer" else "rejected"
        try:
            connection.sendall(json.dumps({"ok": False, "error": code}).encode("ascii") + b"\n")
        except OSError:
            pass


def serve_forever(
    listener: socket.socket,
    *,
    expected_release_uid: int,
    dispatch: Callable[[int, dict[str, Any]], dict[str, Any]],
) -> None:
    if expected_release_uid <= 0 or not isinstance(expected_release_uid, int):
        raise ValueError("invalid trusted release UID")
    while True:
        connection, _address = listener.accept()
        with connection:
            serve_connection(connection, expected_release_uid=expected_release_uid, dispatch=dispatch)


from worker_release_staging import (
    _assert_root_owned_executable, _run_as_worker_extractor, _freeze_release_tree,
    _stage_archive, _validate_staged_release,
)


from worker_release_state import (
    _read_current_sha, _load_release_state, _write_release_state,
    _record_promotion_failure, _record_promotion_success, _promotion_restore_confirmed,
)


from worker_release_gigl import (
    _run_gigl_capability_smoke, _write_gigl_capability_latch,
    _validate_gigl_release_sha, _acquire_gigl_tracking_lock,
)

from worker_release_broker_dispatch import make_fixed_release_dispatch

if sys.modules.get("worker_release_broker") is not sys.modules[__name__]:
    raise ImportError("worker release broker facade identity is inconsistent")


def bind_broker_socket(path: str, *, release_gid: int, backlog: int = 8) -> socket.socket:
    """Bind a private broker socket; caller must run as root in a trusted dir."""
    if not os.path.isabs(path) or path == "/" or not isinstance(release_gid, int) or release_gid < 0:
        raise ValueError("invalid trusted broker socket configuration")
    parent = os.path.dirname(path)
    parent_stat = os.stat(parent, follow_symlinks=False)
    if not stat.S_ISDIR(parent_stat.st_mode) or parent_stat.st_uid != 0 or parent_stat.st_mode & 0o022:
        raise PermissionError("broker socket parent must be root-owned and not group/world writable")
    try:
        existing = os.lstat(path)
    except FileNotFoundError:
        existing = None
    if existing is not None:
        if not stat.S_ISSOCK(existing.st_mode) or existing.st_uid != 0:
            raise PermissionError("refusing to replace a non-root broker socket")
        os.unlink(path)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        listener.bind(path)
        os.chown(path, 0, release_gid)
        os.chmod(path, 0o660)
        listener.listen(backlog)
        return listener
    except Exception:
        listener.close()
        try:
            os.unlink(path)
        except FileNotFoundError:
            pass
        raise


def run_service(release_uid: int, worker_uid: int, worker_gid: int, socket_path: str = "/run/baci-worker-release/broker.sock") -> None:
    if os.geteuid() != 0:
        raise PermissionError("worker release broker must run as root")
    release_account = pwd.getpwuid(release_uid)
    worker_account = pwd.getpwuid(worker_uid)
    if release_account.pw_name != "baci-release" or worker_account.pw_name != "baci-worker" or worker_account.pw_gid != worker_gid:
        raise PermissionError("configured UIDs do not map to the dedicated accounts")
    release_gid = grp.getgrnam("baci-release").gr_gid
    if release_account.pw_gid != release_gid or release_gid == worker_gid:
        raise PermissionError("release and worker account groups must be distinct")
    for account in (release_account.pw_name, worker_account.pw_name):
        groups = {grp.getgrgid(gid).gr_name for gid in os.getgrouplist(account, pwd.getpwnam(account).pw_gid)}
        if groups.intersection({"docker", "sudo"}):
            raise PermissionError("dedicated accounts cannot belong to docker or sudo")
    if socket_path != "/run/baci-worker-release/broker.sock":
        raise ValueError("broker socket path is fixed")
    listener = bind_broker_socket(socket_path, release_gid=release_gid)
    try:
        dispatch = make_fixed_release_dispatch(release_uid=release_uid, worker_uid=worker_uid, worker_gid=worker_gid)
        serve_forever(listener, expected_release_uid=release_uid, dispatch=dispatch)
    finally:
        listener.close()
        try:
            os.unlink(socket_path)
        except FileNotFoundError:
            pass


# Public facade imports preserve the historical broker API.
from worker_release_archive import (
    _open_directory_chain, _safe_relative_parts, extract_github_tarball,
)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Root-owned Baci worker release broker")
    parser.add_argument("--release-uid", type=int, required=True)
    parser.add_argument("--worker-uid", type=int, required=True)
    parser.add_argument("--worker-gid", type=int, required=True)
    arguments = parser.parse_args()
    try:
        run_service(arguments.release_uid, arguments.worker_uid, arguments.worker_gid)
    except Exception:
        # Host journal receives no request, credential, or upstream response data.
        sys.stderr.write("worker release broker stopped: trusted startup or dispatch failure\n")
        sys.exit(1)

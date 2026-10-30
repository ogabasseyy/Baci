"""Synthetic archive and trusted lease-helper fixtures for broker integration."""
import base64
import hashlib
import io
import json
import os
import socket
import threading
import tarfile
from pathlib import Path

import worker_release_quiesce_lease as lease_module
import worker_release_broker as broker

SHA_OLD = "b" * 40
SHA_NEW = "a" * 40
RUN_ID = "123456"
RUN_ATTEMPT = 2
JOB_ID = "654321"


def synthetic_archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        entries = {
            "Baci-abcdef/vps-workers/bin/fixture-worker.sh": (b"#!/bin/sh\nprintf 'worker-ok\\n'\n", 0o755),
            "Baci-abcdef/.github/scripts/gigl-dotenv.sh": (b"# dotenv reader\n", 0o644),
            "Baci-abcdef/vps-workers/jobs/run-cache-invalidation-cron.mjs": (b"export {};\n", 0o644),
            "Baci-abcdef/vps-workers/lib/fixture-helper.sh": (b"# helper\n", 0o644),
            "Baci-abcdef/vps-workers/config/worker.json": (b"{}\n", 0o644),
            "Baci-abcdef/vps-workers/systemd/fixture-worker.service": (b"[Service]\n", 0o644),
        }
        for name, (payload, mode) in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(payload)
            info.mode = mode
            archive.addfile(info, io.BytesIO(payload))
    return output.getvalue()


def write_fake_lease_helper(root):
    helper_dir = root / "trusted-helper"
    helper_dir.mkdir(mode=0o700)
    marker = helper_dir / "cleanup.marker"
    helper = helper_dir / "lease.sh"
    helper.write_text(
        "#!/bin/bash\n"
        "set -eu\n"
        f"trap 'printf cleaned > {marker}' EXIT\n"
        "printf 'READY\\n'\n"
        "cat >/dev/null\n"
    )
    helper.chmod(0o755)
    support = []
    for name in ("strict-helper.sh", "lock-keeper.py"):
        path = helper_dir / name
        path.write_text("# synthetic trusted support fixture\n")
        path.chmod(0o644)
        support.append(str(path))
    lease_module.LEASE_HELPER_PATH = str(helper)
    lease_module.LEASE_SUPPORT_PATHS = tuple(support)
    return marker


def make_request(operation, *, archive=None):
    request = {
        "operation": operation,
        "sourceSha": SHA_NEW,
        "oidcToken": "synthetic-oidc-token",
        "githubToken": "synthetic-github-token",
    }
    if archive is not None:
        request["archiveBase64"] = base64.b64encode(archive).decode("ascii")
        request["archiveSha256"] = hashlib.sha256(archive).hexdigest()
    return request


def broker_roundtrip(listener, release_uid, request, *, dispatch_fn, uid=None, gid=None):
    """Use a real child process so Linux SO_PEERCRED sees the selected UID."""
    server_error = []

    def serve_one():
        try:
            connection, _ = listener.accept()
            with connection:
                broker.serve_connection(
                    connection,
                    expected_release_uid=release_uid,
                    dispatch=dispatch_fn,
                )
        except BaseException as error:
            server_error.append(error)

    thread = threading.Thread(target=serve_one, daemon=True)
    thread.start()
    socket_address = listener.getsockname()
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read_fd)
        os.closerange(3, write_fd)
        os.closerange(write_fd + 1, 4096)
        try:
            os.setgroups([])
            if gid is not None:
                os.setgid(gid)
            if uid is not None:
                os.setuid(uid)
            with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                client.connect(socket_address)
                client.sendall(json.dumps(request, separators=(",", ":")).encode() + b"\n")
                result = bytearray()
                while not result.endswith(b"\n"):
                    chunk = client.recv(4096)
                    if not chunk:
                        break
                    result.extend(chunk)
            os.write(write_fd, bytes(result))
            os._exit(0)
        except BaseException as error:
            os.write(write_fd, f"{type(error).__name__}: {error}\n".encode())
            os._exit(2)
    os.close(write_fd)
    with os.fdopen(read_fd, "rb") as result_pipe:
        raw = result_pipe.read()
    _pid, status = os.waitpid(child, 0)
    thread.join(timeout=10)
    if thread.is_alive():
        raise RuntimeError("broker socket handler did not finish")
    if server_error:
        raise server_error[0]
    if not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
        raise RuntimeError(f"synthetic broker client failed: {raw!r}")
    return json.loads(raw)

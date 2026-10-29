#!/usr/bin/env python3
"""Offline Linux integration for the disposable worker-release broker flow.

Runs the real Linux peer-credential gate, archive staging, fixed dispatcher
logic, lease manager, and release lifecycle against synthetic identities and
fixtures. A temporary dispatcher response and health probe replace GitHub/OIDC
and production worker health. All state is rooted in a private /run directory.
"""
import argparse
import base64
import hashlib
import io
import json
import os
import pwd
import socket
import stat
import subprocess
import sys
import tarfile
import tempfile
import threading
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

BIN = Path(__file__).resolve().parents[2] / "bin"
sys.path.insert(0, str(BIN))
import worker_release_broker as broker  # noqa: E402
import worker_release_quiesce_lease as lease_module  # noqa: E402


SHA_OLD = "b" * 40
SHA_NEW = "a" * 40
RUN_ID = "123456"
RUN_ATTEMPT = 2
JOB_ID = "654321"


def observed_dispatch(peer, request):
    try:
        return dispatch(peer, request)
    except BaseException as error:
        dispatch_errors.append(error)
        raise


def synthetic_archive():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        entries = {
            "Baci-abcdef/vps-workers/bin/fixture-worker.sh": (b"#!/bin/sh\nprintf 'worker-ok\\n'\n", 0o755),
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


def broker_roundtrip(listener, release_uid, request, *, uid=None, gid=None):
    """Use a real child process so Linux SO_PEERCRED sees the selected UID."""
    server_error = []

    def serve_one():
        try:
            connection, _ = listener.accept()
            with connection:
                broker.serve_connection(
                    connection,
                    expected_release_uid=release_uid,
                    dispatch=lambda peer, value: observed_dispatch(peer, value),
                )
        except BaseException as error:  # surface server-thread errors to caller
            server_error.append(error)

    thread = threading.Thread(target=serve_one, daemon=True)
    thread.start()
    socket_address = listener.getsockname()
    read_fd, write_fd = os.pipe()
    child = os.fork()
    if child == 0:
        os.close(read_fd)
        # The broker lease helper owns open pipes in the server process. A
        # forked client must not accidentally retain those descriptors while
        # it waits for the broker's response.
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


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--release-uid", type=int, required=True)
    parser.add_argument("--release-gid", type=int, required=True)
    parser.add_argument("--worker-uid", type=int, required=True)
    parser.add_argument("--worker-gid", type=int, required=True)
    args = parser.parse_args()
    if not sys.platform.startswith("linux") or not hasattr(socket, "SO_PEERCRED"):
        parser.error("Linux SO_PEERCRED is required")
    if os.geteuid() != 0:
        parser.error("run as root in a disposable Linux VM/container")
    if min(args.release_uid, args.release_gid, args.worker_uid, args.worker_gid) <= 0:
        parser.error("UIDs and GIDs must be positive non-root IDs")
    if args.release_uid == args.worker_uid or args.release_gid == args.worker_gid:
        parser.error("release and worker identities must be distinct")
    for uid in (args.release_uid, args.worker_uid):
        try:
            name = pwd.getpwuid(uid).pw_name
        except KeyError:
            parser.error(f"UID {uid} must belong to an existing disposable test account")
        if name in {"baci-release", "baci-worker"}:
            parser.error("production account names are not allowed")

    # /run is root-owned on Linux. Keeping this under a private temporary
    # directory exercises the production ancestry checks without touching any
    # production path or persistent host state.
    with tempfile.TemporaryDirectory(prefix="baci-broker-e2e-", dir="/run") as raw_root:
        root = Path(raw_root)
        # The release/worker test accounts must traverse this disposable
        # directory to reach the synthetic socket and fixture paths.
        root.chmod(0o755)
        marker = write_fake_lease_helper(root)
        worker_root = root / "worker-root"
        releases = worker_root / "releases"
        releases.mkdir(parents=True, mode=0o755)
        worker_root.chmod(0o755)
        releases.chmod(0o755)
        for sha in (SHA_OLD,):
            release = releases / sha
            release.mkdir(mode=0o550)
            (release / "worker.txt").write_text("prior synthetic worker\n")
            (release / "worker.txt").chmod(0o440)
            os.chown(release, 0, args.worker_gid)
            os.chown(release / "worker.txt", 0, args.worker_gid)
        current = worker_root / "current"
        current.symlink_to(Path("releases") / SHA_OLD)

        socket_path = root / "broker.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(socket_path))
        os.chmod(socket_path, 0o666)  # only this private disposable socket
        listener.listen(4)
        listener.settimeout(15)

        synthetic_archive_bytes = synthetic_archive()
        fake_node = root / "node"
        fake_health = root / "health-check"
        fake_node.write_text("synthetic dispatcher executable\n")
        fake_health.write_text("synthetic health executable\n")
        fake_node.chmod(0o755)
        fake_health.chmod(0o755)
        broker.WORKER_ROOT = str(worker_root)
        broker.TRUSTED_NODE = str(fake_node)
        broker.TRUSTED_DISPATCHER = str(fake_node)
        broker.TRUSTED_HEALTH_CHECK = str(fake_health)

        def synthetic_run(command, **kwargs):
            if command[0] == str(fake_health):
                return SimpleNamespace(returncode=0, stdout=b"", stderr=b"")
            auth_request = json.loads(kwargs["input"].decode().strip())
            receipt = {
                "operation": auth_request["operation"],
                "sourceSha": auth_request["sourceSha"],
                "runId": RUN_ID,
                "runAttempt": RUN_ATTEMPT,
                "jobId": JOB_ID,
                "repository": "ogabasseyy/Baci",
                "workflow": ".github/workflows/production-release.yml",
                "ref": "refs/heads/main",
                "status": "in_progress",
            }
            if auth_request["operation"] == "stage":
                receipt["archiveBase64"] = base64.b64encode(synthetic_archive_bytes).decode("ascii")
                receipt["archiveSha256"] = hashlib.sha256(synthetic_archive_bytes).hexdigest()
            return SimpleNamespace(returncode=0, stdout=json.dumps(receipt).encode(), stderr=b"")

        dispatch = None
        lease_manager = lease_module.WorkerQuiesceLeaseManager()
        try:
            with patch.object(broker, "_assert_root_owned_executable", lambda _path: None), \
                 patch.object(broker.subprocess, "run", synthetic_run), \
                 patch.object(lease_module, "WorkerQuiesceLeaseManager", lambda: lease_manager):
                dispatch = broker.make_fixed_release_dispatch(
                    release_uid=args.release_uid,
                    worker_uid=args.worker_uid,
                    worker_gid=args.worker_gid,
                )
                # Keep reference to actual fixed dispatch for the socket handler.
                globals()["dispatch"] = dispatch
                globals()["dispatch_errors"] = []

                rejected = broker_roundtrip(
                    listener, args.release_uid, make_request("preflight"),
                    uid=args.worker_uid, gid=args.worker_gid,
                )
                if rejected != {"ok": False, "error": "unauthorized"}:
                    raise AssertionError("worker UID reached trusted dispatch")
                print("PASS kernel SO_PEERCRED rejects worker UID before dispatch")

                staged = broker_roundtrip(
                    listener, args.release_uid, make_request("stage", archive=synthetic_archive_bytes),
                    uid=args.release_uid, gid=args.release_gid,
                )
                if staged.get("ok") is not True or staged.get("entryCount") < 1:
                    raise AssertionError(f"synthetic stage failed: {staged}")
                staged_release = releases / SHA_NEW
                staged_path = staged_release / "bin" / "fixture-worker.sh"
                for path in (
                    staged_path,
                    staged_release / "jobs/run-cache-invalidation-cron.mjs",
                    staged_release / "lib/fixture-helper.sh",
                    staged_release / "config/worker.json",
                    staged_release / "systemd/fixture-worker.service",
                ):
                    if not path.is_file():
                        raise AssertionError(f"worker runtime path was not materialized: {path}")
                if staged_path.stat().st_uid != 0 or stat.S_IMODE(staged_path.stat().st_mode) != 0o550:
                    raise AssertionError("staged worker executable is not root-owned and immutable to worker")
                print("PASS GitHub-shaped worker archive stages at the expected runtime paths")

                preflight = broker_roundtrip(
                    listener, args.release_uid, make_request("preflight"),
                    uid=args.release_uid, gid=args.release_gid,
                )
                if preflight.get("ok") is not True:
                    raise AssertionError(f"preflight failed: {preflight}")
                print("PASS staged release preflight")

                promoted = broker_roundtrip(
                    listener, args.release_uid, make_request("promote"),
                    uid=args.release_uid, gid=args.release_gid,
                )
                if promoted.get("ok") is not True or promoted.get("previousSha") != SHA_OLD:
                    raise AssertionError(f"promotion failed: {promoted}")
                if os.readlink(current) != f"releases/{SHA_NEW}":
                    raise AssertionError("promotion did not atomically switch the current pointer")
                worker_run = subprocess.run(
                    [str(current / "bin/fixture-worker.sh")], capture_output=True,
                    text=True, check=True,
                )
                if worker_run.stdout != "worker-ok\n":
                    raise AssertionError("staged worker executable did not run from current/bin")
                state_path = worker_root / "release-state.json"
                state = json.loads(state_path.read_text())
                if state.get("status") != "promoted" or state.get("sha") != SHA_NEW:
                    raise AssertionError("promotion did not persist fenced lifecycle state")
                if marker.exists():
                    raise AssertionError("quiescence helper ended before health completed")
                print("PASS promote holds quiescence lease and writes fenced state")

                health = broker_roundtrip(
                    listener, args.release_uid, make_request("health"),
                    uid=args.release_uid, gid=args.release_gid,
                )
                if health.get("ok") is not True or health.get("healthy") is not True:
                    error = dispatch_errors[-1] if dispatch_errors else "no dispatch exception captured"
                    raise AssertionError(f"health check failed: {health}; dispatch exception: {error!r}")
                if not marker.exists() or marker.read_text() != "cleaned":
                    raise AssertionError("health completion did not release and clean the lease helper")
                print("PASS health uses the retained lease then confirms helper cleanup")

                rollback = broker_roundtrip(
                    listener, args.release_uid, make_request("rollback"),
                    uid=args.release_uid, gid=args.release_gid,
                )
                if rollback.get("ok") is not True or rollback.get("sourceSha") != SHA_OLD:
                    raise AssertionError(f"rollback failed: {rollback}")
                if os.readlink(current) != f"releases/{SHA_OLD}":
                    raise AssertionError("rollback did not restore the exact recorded prior SHA")
                state = json.loads(state_path.read_text())
                if state.get("status") != "rolled_back" or state.get("sha") != SHA_NEW:
                    raise AssertionError("rollback did not retain fenced release history")
                if marker.read_text() != "cleaned":
                    raise AssertionError("rollback helper cleanup was not confirmed")
                print("PASS rollback reacquires lease, restores prior SHA, and confirms cleanup")
        finally:
            if dispatch is not None:
                try:
                    lease_manager.close()
                except Exception as cleanup_error:
                    print(f"CLEANUP ERROR {cleanup_error}", file=sys.stderr)
            listener.close()
            try:
                socket_path.unlink()
            except FileNotFoundError:
                pass
            # The temporary directory is deleted by TemporaryDirectory after
            # any active helper has confirmed its cleanup.
    print("PASS temporary state removed; network and production paths untouched")


if __name__ == "__main__":
    main()

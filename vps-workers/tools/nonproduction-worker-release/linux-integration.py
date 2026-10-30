#!/usr/bin/env python3
"""Disposable Linux integration checks for broker peer UID isolation.

Requires root plus two already-provisioned, nonproduction Unix identities.
Only temporary directories and sockets are created; no host accounts,
services, production paths, credentials, or network APIs are touched.
"""
import argparse
import io
import json
import os
import pwd
import socket
import stat
import sys
import tarfile
import tempfile
import threading
from pathlib import Path

BIN = Path(__file__).resolve().parents[2] / "bin"
sys.path.insert(0, str(BIN))
from worker_release_broker import (  # noqa: E402
    _stage_archive,
    serve_connection,
)


def archive_bytes():
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        payload = b"synthetic worker fixture\n"
        info = tarfile.TarInfo("fixture/worker.txt")
        info.size = len(payload)
        archive.addfile(info, io.BytesIO(payload))
    return output.getvalue()


def peer_uid_check(root, release_uid, release_gid, worker_uid, worker_gid):
    path = str(Path(root) / "broker.sock")
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    listener.bind(path)
    os.chmod(path, 0o666)  # synthetic socket; production mode is outside this test
    listener.listen(4)
    listener.settimeout(4)
    def serve_once(expected, output):
        conn, _ = listener.accept()
        with conn:
            serve_connection(connection=conn, expected_release_uid=expected,
                             dispatch=lambda peer, request: output.append((peer, request)) or {"ok": True})

    try:
        for uid, gid, should_pass, label in (
            (release_uid, release_gid, True, "release UID accepted"),
            (worker_uid, worker_gid, False, "worker UID rejected"),
        ):
            seen = []
            thread = threading.Thread(target=serve_once, args=(release_uid, seen), daemon=True)
            thread.start()
            read_fd, write_fd = os.pipe()
            pid = os.fork()
            if pid == 0:
                os.close(read_fd)
                try:
                    os.setgroups([])
                    os.setgid(gid)
                    os.setuid(uid)
                    with socket.socket(socket.AF_UNIX, socket.SOCK_STREAM) as client:
                        client.connect(path)
                        client.sendall(b'{"operation":"preflight"}\n')
                        data = bytearray()
                        while not data.endswith(b"\n"):
                            block = client.recv(4096)
                            if not block:
                                break
                            data.extend(block)
                    os.write(write_fd, bytes(data))
                    os._exit(0)
                except BaseException as error:
                    try:
                        os.write(write_fd, f"child setup/connect failed: {type(error).__name__}: {error}\n".encode())
                    except OSError:
                        pass
                    os._exit(2)
            os.close(write_fd)
            with os.fdopen(read_fd, "rb") as result:
                raw_response = result.read()
            _pid, status = os.waitpid(pid, 0)
            thread.join(timeout=3)
            if thread.is_alive() or not os.WIFEXITED(status) or os.WEXITSTATUS(status) != 0:
                raise RuntimeError(f"{label}: client failed (exit={os.waitstatus_to_exitcode(status)}; output={raw_response!r})")
            try:
                response = json.loads(raw_response)
            except (UnicodeDecodeError, json.JSONDecodeError) as error:
                raise RuntimeError(f"{label}: invalid broker response {raw_response!r}") from error
            if should_pass:
                if response != {"ok": True} or len(seen) != 1 or seen[0][0] != release_uid:
                    raise AssertionError("release UID was not accepted from kernel credentials")
            elif response != {"ok": False, "error": "unauthorized"} or seen:
                raise AssertionError("worker UID was not rejected before dispatch")
            print(f"PASS {label}")
    finally:
        listener.close()
        os.unlink(path)


def staging_check(root, worker_uid, worker_gid):
    releases = Path(root) / "releases"
    releases.mkdir(mode=0o750)
    releases.chmod(0o755)  # worker may traverse, but cannot create sibling stages
    sha = "a" * 40
    count = _stage_archive(archive_bytes(), str(releases), sha, worker_uid, worker_gid)
    staged = releases / sha
    file = staged / "worker.txt"
    if count != 1 or file.read_bytes() != b"synthetic worker fixture\n":
        raise AssertionError("synthetic archive did not stage correctly")
    if staged.stat().st_uid != 0 or stat.S_IMODE(staged.stat().st_mode) != 0o550:
        raise AssertionError("staged root is not root-owned and immutable to worker")
    if file.stat().st_uid != 0 or stat.S_IMODE(file.stat().st_mode) != 0o440:
        raise AssertionError("staged content is not root-owned and immutable to worker")
    print("PASS worker-UID extraction and root-owned immutable publication")


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
    with tempfile.TemporaryDirectory(prefix="baci-linux-broker-it-") as temp:
        os.chmod(temp, 0o755)  # allow disposable test identities to reach fixtures
        peer_uid_check(temp, args.release_uid, args.release_gid,
                       args.worker_uid, args.worker_gid)
        staging_check(temp, args.worker_uid, args.worker_gid)
    print("PASS temporary fixture cleanup; no persistent host state changed")


if __name__ == "__main__":
    main()

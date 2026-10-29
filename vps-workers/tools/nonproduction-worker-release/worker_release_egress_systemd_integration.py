#!/usr/bin/env python3
"""Disposable Linux/systemd integration proof for the disconnected egress prototype."""
from __future__ import annotations

import os
from pathlib import Path
import pwd
import grp
import re
import socket
import subprocess
import sys
import tempfile
import threading

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from worker_release_egress_broker import EgressBroker
from worker_release_egress_protocol import EgressRejected, encode_request, read_tls_client_hello
import worker_release_egress_broker as broker_module

SYNTHETIC_REPLY = b"synthetic-registry-response-v1"
_SAFE_DIAGNOSTIC = re.compile(r"[^A-Za-z0-9 _.,:=/@+()\-]")


def _safe_diagnostic(stdout: str, stderr: str, *, limit: int = 300) -> str:
    """Bound systemd fixture diagnostics to safe, printable synthetic evidence."""
    combined = " ".join(f"{stdout} {stderr}".split())
    filtered = _SAFE_DIAGNOSTIC.sub("?", combined)
    return filtered[-limit:] or "no diagnostic output"


def _run_host_fixture() -> int:
    if os.geteuid() != 0 or Path("/proc/1/comm").read_text().strip() != "systemd":
        raise RuntimeError("requires root on a disposable systemd Linux VM")
    if not hasattr(socket, "SO_PEERCRED"):
        raise RuntimeError("Linux SO_PEERCRED is required")
    broker = EgressBroker.for_dedicated_bridge_account()
    peer_uid, peer_gid = broker.expected_peer_uid, broker.expected_peer_gid

    with tempfile.TemporaryDirectory(prefix="worker-egress-systemd-") as scratch:
        os.chmod(scratch, 0o711)
        socket_path = Path(scratch) / "broker.sock"
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(socket_path))
        os.chmod(socket_path, 0o666)
        listener.listen(8)
        listener.settimeout(0.2)
        stopping = threading.Event()
        accepted = []
        registry_served = []
        registry_rejected = []
        synthetic_threads = []
        accepted_lock = threading.Lock()

        def synthetic_connect(host, port, **_kwargs):
            if host != "registry.npmjs.org" or port != 443:
                raise RuntimeError("synthetic connector received an unexpected destination")
            upstream, registry = socket.socketpair()
            with accepted_lock:
                accepted.append((upstream, registry))

            def serve_registry():
                try:
                    registry.settimeout(3)
                    read_tls_client_hello(registry, "registry.npmjs.org")
                    registry.sendall(SYNTHETIC_REPLY)
                    registry_served.append(True)
                except EgressRejected:
                    # Bridge or broker closed before forwarding a mismatched SNI.
                    registry_rejected.append(True)
                finally:
                    registry.close()

            thread = threading.Thread(target=serve_registry, daemon=True)
            synthetic_threads.append(thread)
            thread.start()
            return upstream

        accept_thread = threading.Thread(target=broker.serve,
                                         args=(listener, stopping), daemon=True)
        accept_thread.start()
        try:
            # Ensure the peer credential gate rejects a root caller even when
            # its request would otherwise be approved. The connector count must
            # remain zero before the authorized systemd bridge is launched.
            malicious = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            malicious.connect(str(socket_path))
            malicious.sendall(encode_request("registry.npmjs.org", 443))
            malicious.settimeout(2)
            if malicious.recv(1) != b"\x01":
                raise RuntimeError("broker did not reject unauthorized peer UID/GID")
            malicious.close()
            if accepted:
                raise RuntimeError("unauthorized broker peer reached synthetic connector")

            # Patch only this test process's network connector. This fixture
            # does not resolve DNS or open any Internet connection.
            original_connect = broker_module.connect_public
            broker_module.connect_public = synthetic_connect
            try:
                unit = f"worker-egress-prototype-{os.getpid()}"
                command = [
                    "/usr/bin/systemd-run", "--quiet", "--system", "--wait", "--pipe",
                    "--collect", f"--unit={unit}", f"--uid={peer_uid}",
                    f"--gid={peer_gid}", "--property=PrivateNetwork=yes",
                    "--property=NoNewPrivileges=yes",
                    "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                    "/usr/bin/python3", str(Path(__file__).with_name("worker_release_egress_systemd_client.py").resolve()), "--client",
                    str(socket_path), str(os.stat("/proc/self/ns/net").st_ino),
                ]
                result = subprocess.run(command, check=False, capture_output=True,
                                        text=True, timeout=45)
                if result.returncode != 0:
                    detail = _safe_diagnostic(result.stdout, result.stderr)
                    raise RuntimeError(
                        f"systemd child failed (exit={result.returncode}; diagnostic={detail})")
            finally:
                broker_module.connect_public = original_connect
            for thread in synthetic_threads:
                thread.join(timeout=3)
                if thread.is_alive():
                    raise RuntimeError("synthetic registry fixture did not drain")
            if len(accepted) != 3 or len(registry_served) != 1 or len(registry_rejected) != 2:
                raise RuntimeError("synthetic TLS route or SNI rejection evidence was incomplete")
        finally:
            stopping.set()
            listener.close()
            accept_thread.join(timeout=2)
            for upstream, registry in accepted:
                for sock in (upstream, registry):
                    try:
                        sock.close()
                    except OSError:
                        pass
    return 0


def _host_mode() -> int:
    if os.geteuid() != 0 or Path("/proc/1/comm").read_text().strip() != "systemd":
        raise RuntimeError("requires root on a disposable systemd Linux VM")
    account = "baci-worker-egress-bridge"
    try:
        pwd.getpwnam(account)
        raise RuntimeError("dedicated integration account already exists")
    except KeyError:
        pass
    try:
        grp.getgrnam(account)
        raise RuntimeError("dedicated integration group already exists")
    except KeyError:
        pass
    subprocess.run(("/usr/sbin/groupadd", "--system", account), check=True,
                   stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                   stderr=subprocess.DEVNULL)
    group_created = True
    user_created = False
    try:
        subprocess.run(("/usr/sbin/useradd", "--system", "--no-create-home",
                        "--home-dir", "/nonexistent", "--shell", "/usr/sbin/nologin",
                        "--gid", account, account), check=True,
                       stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                       stderr=subprocess.DEVNULL)
        user_created = True
        return _run_host_fixture()
    finally:
        if user_created:
            subprocess.run(("/usr/sbin/userdel", account), check=False,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)
        if group_created:
            subprocess.run(("/usr/sbin/groupdel", account), check=False,
                           stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL,
                           stderr=subprocess.DEVNULL)


if __name__ == "__main__":
    try:
        raise SystemExit(_host_mode())
    except Exception as error:
        if isinstance(error, RuntimeError):
            detail = _safe_diagnostic(str(error), "")
            print(f"egress systemd integration failed: {detail}", file=sys.stderr)
        else:
            print(f"egress systemd integration failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)

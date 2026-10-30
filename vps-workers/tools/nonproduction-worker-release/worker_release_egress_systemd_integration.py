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
from worker_release_egress_fixture_staging import FIXTURE_MODULES, stage_fixture_modules

def _safe_diagnostic(stdout: str, stderr: str, *, limit: int = 300) -> str:
    """Bound systemd fixture diagnostics to safe, printable synthetic evidence."""
    combined = " ".join(f"{stdout} {stderr}".split())
    filtered = _SAFE_DIAGNOSTIC.sub("?", combined)
    return filtered[-limit:] or "no diagnostic output"


def _namespace_failure_category(text: str) -> str:
    """Reduce disposable systemd namespace evidence to a fixed CI category."""
    value = text.lower()
    if not value.strip():
        return "journal-unavailable"
    if not any(marker in value for marker in (
            "mount namespac", "step namespace", "namespace setup", "failed to mount")):
        return "failure-unclassified"
    if "operation not permitted" in value or "permission denied" in value:
        return "namespace-permission"
    if "no such file or directory" in value or "not found" in value:
        return "namespace-path-missing"
    if "read-only file system" in value or "mount point is not" in value:
        return "namespace-mount-conflict"
    return "namespace-failure-unclassified"


def _approved_socket_properties(host_socket: Path, isolated_alias: Path) -> tuple[str, str]:
    """Mask host /run and expose only its approved socket at a separate alias."""
    host_socket = Path(host_socket)
    isolated_alias = Path(isolated_alias)
    resolved_alias = Path(os.path.realpath(isolated_alias))
    if (not host_socket.is_absolute() or host_socket.parent != Path("/run")
            or host_socket != Path(os.path.normpath(str(host_socket)))
            or not isolated_alias.is_absolute()
            or isolated_alias == Path("/run")
            or Path("/run") in isolated_alias.parents
            or isolated_alias == Path("/var/run")
            or Path("/var/run") in isolated_alias.parents
            or isolated_alias != Path(os.path.normpath(str(isolated_alias)))
            or resolved_alias == Path("/run") or Path("/run") in resolved_alias.parents):
        raise RuntimeError("egress fixture socket paths are outside fixed mount policy")
    return ("--property=InaccessiblePaths=/run",
            f"--property=BindReadOnlyPaths={host_socket}:{isolated_alias}")


def _unit_journal_text(unit: str) -> str:
    """Read a small bounded boot-journal slice for one generated fixture unit."""
    if not re.fullmatch(r"worker-egress-prototype-[0-9]{1,10}", unit):
        return ""
    bin_path = HERE.parents[1] / "bin"
    if str(bin_path) not in sys.path:
        sys.path.insert(0, str(bin_path))
    from worker_release_bounded_process import run_bounded_capture

    try:
        result = run_bounded_capture(
            ("/usr/bin/journalctl", "--no-pager", "--output=short", "--lines=20",
             f"--grep={unit}"),
            timeout=2, max_stream_bytes=4096,
            env={"PATH": "/usr/bin:/bin", "LC_ALL": "C"},
        )
    except Exception:
        return ""
    return result.stdout + result.stderr


def _run_host_fixture() -> int:
    if os.geteuid() != 0 or Path("/proc/1/comm").read_text().strip() != "systemd":
        raise RuntimeError("requires root on a disposable systemd Linux VM")
    if not hasattr(socket, "SO_PEERCRED"):
        raise RuntimeError("Linux SO_PEERCRED is required")
    broker = EgressBroker.for_dedicated_bridge_account()
    peer_uid, peer_gid = broker.expected_peer_uid, broker.expected_peer_gid

    with tempfile.TemporaryDirectory(prefix="worker-egress-systemd-") as scratch:
        os.chmod(scratch, 0o711)
        scratch_root = Path(scratch)
        fixture_root = scratch_root / "fixture"
        fixture_client = stage_fixture_modules(Path(__file__).absolute().parents[3], fixture_root,
                                                 owner_uid=0, owner_gid=0)
        socket_path = Path(f"/run/baci-worker-egress-approved-{os.getpid()}.sock")
        socket_alias = scratch_root / "approved-egress.sock"
        if socket_path.exists() or socket_path.is_symlink():
            raise RuntimeError("approved host socket fixture path already exists")
        if socket_alias.exists() or socket_alias.is_symlink():
            raise RuntimeError("approved socket alias fixture path already exists")
        listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        listener.bind(str(socket_path))
        os.chmod(socket_path, 0o666)
        approved_identity = socket_path.lstat()
        listener.listen(8)
        listener.settimeout(0.2)
        hidden_host_socket = Path(f"/run/baci-worker-egress-hidden-{os.getpid()}.sock")
        if hidden_host_socket.exists() or hidden_host_socket.is_symlink():
            raise RuntimeError("hidden host socket fixture path already exists")
        hidden_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        hidden_listener.bind(str(hidden_host_socket))
        os.chmod(hidden_host_socket, 0o666)
        hidden_identity = hidden_host_socket.lstat()
        hidden_listener.listen(1)
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
                    "/usr/bin/systemd-run", "--system", "--wait", "--pipe",
                    "--collect", f"--unit={unit}", f"--uid={peer_uid}",
                    f"--gid={peer_gid}", "--property=PrivateNetwork=yes",
                    *_approved_socket_properties(socket_path, socket_alias),
                    "--property=NoNewPrivileges=yes",
                    "--property=PrivateUsers=yes", "--property=SupplementaryGroups=",
                    "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
                    "/usr/bin/python3", str(fixture_client), "--client",
                    str(socket_alias), str(os.stat("/proc/self/ns/net").st_ino),
                    str(hidden_host_socket),
                ]
                result = subprocess.run(command, check=False, capture_output=True,
                                        text=True, timeout=45)
                if result.returncode != 0:
                    journal = _unit_journal_text(unit)
                    category = _namespace_failure_category(
                        result.stdout + "\n" + result.stderr + "\n" + journal)
                    raise RuntimeError(
                        f"systemd child failed (exit={result.returncode}; category={category})")
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
            hidden_listener.close()
            for path, identity in ((socket_path, approved_identity),
                                   (hidden_host_socket, hidden_identity)):
                try:
                    current = path.lstat()
                except FileNotFoundError:
                    continue
                if ((current.st_dev, current.st_ino, current.st_uid, current.st_mode)
                        != (identity.st_dev, identity.st_ino, identity.st_uid, identity.st_mode)):
                    raise RuntimeError("Unix socket fixture path changed before cleanup")
                path.unlink()
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

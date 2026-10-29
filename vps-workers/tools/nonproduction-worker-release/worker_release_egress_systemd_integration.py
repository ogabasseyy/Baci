#!/usr/bin/env python3
"""Disposable Linux/systemd integration proof for the disconnected egress prototype."""
from __future__ import annotations

import json
import os
from pathlib import Path
import pwd
import grp
import socket
import struct
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


def _client_hello(host: str) -> bytes:
    name = host.encode("ascii")
    names = b"\x00" + len(name).to_bytes(2, "big") + name
    sni = len(names).to_bytes(2, "big") + names
    extensions = b"\x00\x00" + len(sni).to_bytes(2, "big") + sni
    body = (b"\x03\x03" + b"R" * 32 + b"\x00" + b"\x00\x02\x13\x01"
            + b"\x01\x00" + len(extensions).to_bytes(2, "big") + extensions)
    handshake = b"\x01" + len(body).to_bytes(3, "big") + body
    return b"\x16\x03\x01" + len(handshake).to_bytes(2, "big") + handshake


def _recv_exact(sock: socket.socket, count: int) -> bytes:
    data = bytearray()
    while len(data) < count:
        chunk = sock.recv(count - len(data))
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def _request(host: str, port: int) -> bytes:
    payload = json.dumps({"host": host, "port": port, "schema": 1},
                         sort_keys=True, separators=(",", ":")).encode("ascii")
    return struct.pack("!I", len(payload)) + payload


def _read_headers(sock: socket.socket) -> bytes:
    data = bytearray()
    while b"\r\n\r\n" not in data and len(data) < 4096:
        chunk = sock.recv(1024)
        if not chunk:
            break
        data.extend(chunk)
    return bytes(data)


def _client_mode(broker_path: str, expected_netns_inode: int) -> int:
    """Runs only inside PrivateNetwork; exercise loopback bridge and broker IPC."""
    if os.stat("/proc/self/ns/net").st_ino == expected_netns_inode:
        raise RuntimeError("PrivateNetwork unit did not enter a distinct network namespace")
    broker_path_obj = Path(broker_path)

    def broker_connector():
        connection = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        connection.connect(str(broker_path_obj))
        return connection

    from worker_release_egress_bridge import EgressBridge
    bridge = EgressBridge(broker_connector=broker_connector)
    listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    listener.setsockopt(socket.SOL_SOCKET, socket.SO_REUSEADDR, 1)
    listener.bind(("127.0.0.1", 0))
    listener.listen(8)
    stopping = threading.Event()
    server = threading.Thread(target=bridge.serve, args=(listener, stopping),
                              kwargs={"max_connections": 4}, daemon=True)
    server.start()
    address = listener.getsockname()

    def bridge_request(authority: str, host_header: str) -> bytes:
        client = socket.create_connection(address, timeout=3)
        client.settimeout(3)
        client.sendall((f"CONNECT {authority} HTTP/1.1\r\nHost: {host_header}\r\n\r\n")
                       .encode("ascii"))
        response = _read_headers(client)
        client.close()
        return response

    try:
        app = socket.create_connection(address, timeout=3)
        app.settimeout(3)
        app.sendall(b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\n"
                    b"Host: registry.npmjs.org:443\r\n\r\n")
        if _read_headers(app) != b"HTTP/1.1 200 Connection Established\r\n\r\n":
            raise RuntimeError("approved synthetic CONNECT was not accepted")
        app.sendall(_client_hello("registry.npmjs.org"))
        if _recv_exact(app, len(SYNTHETIC_REPLY)) != SYNTHETIC_REPLY:
            raise RuntimeError("approved synthetic TLS route did not return its fixture response")
        app.close()

        wrong_sni = socket.create_connection(address, timeout=3)
        wrong_sni.settimeout(3)
        wrong_sni.sendall(b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\n"
                          b"Host: registry.npmjs.org:443\r\n\r\n")
        if _read_headers(wrong_sni) != b"HTTP/1.1 200 Connection Established\r\n\r\n":
            raise RuntimeError("approved CONNECT was not established before TLS SNI check")
        wrong_sni.sendall(_client_hello("attacker.test"))
        if wrong_sni.recv(1) != b"":
            raise RuntimeError("bridge did not close a wrong-SNI TLS connection")
        wrong_sni.close()

        for authority, host in (
            ("registry.npmjs.org.evil:443", "registry.npmjs.org.evil:443"),
            ("registry.npmjs.org:444", "registry.npmjs.org:444"),
            ("127.0.0.1:443", "127.0.0.1:443"),
        ):
            if not bridge_request(authority, host).startswith(b"HTTP/1.1 502"):
                raise RuntimeError("bridge accepted a forbidden CONNECT destination")

        # Test the broker boundary directly from the authorized bridge UID so
        # invalid host, port, and IP requests cannot be attributed to the parser.
        for host, port in (("attacker.test", 443), ("registry.npmjs.org", 444),
                           ("127.0.0.1", 443)):
            ipc = broker_connector()
            ipc.settimeout(3)
            ipc.sendall(_request(host, port))
            if ipc.recv(1) != b"\x01":
                raise RuntimeError("broker accepted a forbidden destination request")
            ipc.close()

        direct_ipc = broker_connector()
        direct_ipc.settimeout(3)
        direct_ipc.sendall(encode_request("registry.npmjs.org", 443))
        if direct_ipc.recv(1) != b"\x00":
            raise RuntimeError("broker did not establish the approved IPC request")
        direct_ipc.sendall(b"\x02" + _client_hello("attacker.test"))
        if direct_ipc.recv(1) != b"":
            raise RuntimeError("broker did not close a forged-ready wrong-SNI IPC peer")
        direct_ipc.close()

        # PrivateNetwork=yes must deny a direct socket path that bypasses the
        # bridge/broker. A public routable destination is used; no data is sent.
        direct = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        direct.settimeout(1)
        try:
            result = direct.connect_ex(("1.1.1.1", 443))
            if result == 0:
                raise RuntimeError("PrivateNetwork unit obtained direct TCP egress")
        finally:
            direct.close()
    finally:
        stopping.set()
        listener.close()
        server.join(timeout=2)
    return 0


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
                    "/usr/bin/python3", str(Path(__file__).resolve()), "--client",
                    str(socket_path), str(os.stat("/proc/self/ns/net").st_ino),
                ]
                result = subprocess.run(command, check=False, capture_output=True,
                                        text=True, timeout=45)
                if result.returncode != 0:
                    raise RuntimeError(
                        f"systemd egress fixture failed (exit {result.returncode})")
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
        raise SystemExit(_client_mode(sys.argv[2], int(sys.argv[3]))
                          if len(sys.argv) == 4 and sys.argv[1] == "--client"
                          else _host_mode())
    except Exception as error:
        print(f"egress systemd integration failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)

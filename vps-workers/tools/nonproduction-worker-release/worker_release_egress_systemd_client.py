#!/usr/bin/env python3
"""Unprivileged side of the disposable egress systemd integration fixture."""
from __future__ import annotations

import json
import os
from pathlib import Path
import socket
import struct
import sys
import threading

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SEED_BIN = Path("/run/baci-seed-bin")
if SEED_BIN.is_dir():
    sys.path.insert(0, str(SEED_BIN))

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


def _client_mode(broker_path: str, expected_netns_inode: int,
                 hidden_host_socket: str) -> int:
    """Runs only inside PrivateNetwork; exercise loopback bridge and broker IPC."""
    if os.stat("/proc/self/ns/net").st_ino == expected_netns_inode:
        raise RuntimeError("PrivateNetwork unit did not enter a distinct network namespace")
    hidden = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    hidden.settimeout(1)
    try:
        hidden.connect(hidden_host_socket)
    except OSError:
        pass
    else:
        raise RuntimeError("host /run Unix socket remained reachable inside the unit")
    finally:
        hidden.close()
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



if __name__ == "__main__":
    try:
        try:
            from worker_release_egress_protocol import encode_request
        except ModuleNotFoundError as error:
            category = ("startup protocol module unavailable"
                        if error.name == "worker_release_egress_protocol"
                        else "startup import dependency unavailable")
            print(f"egress client integration failed: {category}", file=sys.stderr)
            raise SystemExit(1)
        except ImportError:
            print("egress client integration failed: startup import unavailable", file=sys.stderr)
            raise SystemExit(1)
        if len(sys.argv) != 5 or sys.argv[1] != "--client":
            raise RuntimeError("client fixture arguments are invalid")
        raise SystemExit(_client_mode(sys.argv[2], int(sys.argv[3]), sys.argv[4]))
    except Exception as error:
        if isinstance(error, RuntimeError):
            message = " ".join(str(error).split())[:240]
            print(f"egress client integration failed: {message}", file=sys.stderr)
        else:
            print(f"egress client integration failed: {type(error).__name__}", file=sys.stderr)
        raise SystemExit(1)

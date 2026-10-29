from __future__ import annotations

import json
import errno
import os
import socket
import struct
import sys
import threading
import subprocess
import time
from types import SimpleNamespace
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_egress_broker as broker_module
from worker_release_egress_bridge import EgressBridge
from worker_release_egress_broker import EgressBroker, peer_credentials
from worker_release_egress_protocol import (
    EgressRejected, connect_public, encode_request, parse_connect_request,
    public_sockaddrs, read_tls_client_hello,
)


def answer(address: str, family: int = socket.AF_INET):
    sockaddr = (address, 443) if family == socket.AF_INET else (address, 443, 0, 0)
    return (family, socket.SOCK_STREAM, socket.IPPROTO_TCP, "", sockaddr)


def client_hello(host: str, *, ech: bool = False) -> bytes:
    name = host.encode("ascii")
    names = b"\x00" + len(name).to_bytes(2, "big") + name
    sni = len(names).to_bytes(2, "big") + names
    extensions = b"\x00\x00" + len(sni).to_bytes(2, "big") + sni
    if ech:
        extensions += b"\xfe\x0d\x00\x00"
    body = (b"\x03\x03" + b"R" * 32 + b"\x00" + b"\x00\x02\x13\x01"
            + b"\x01\x00" + len(extensions).to_bytes(2, "big") + extensions)
    handshake = b"\x01" + len(body).to_bytes(3, "big") + body
    return b"\x16\x03\x01" + len(handshake).to_bytes(2, "big") + handshake


class FakeConnectedSocket:
    def __init__(self, family, socktype, proto):
        self.family, self.socktype, self.proto = family, socktype, proto
        self.connected = None
        self.closed = False

    def settimeout(self, _timeout):
        pass

    def setblocking(self, _blocking):
        pass

    def connect_ex(self, sockaddr):
        self.connected = sockaddr
        return 0

    def connect(self, sockaddr):
        self.connected = sockaddr

    def close(self):
        self.closed = True


class EgressProtocolTests(unittest.TestCase):
    @unittest.skipUnless(hasattr(socket, "SO_PEERCRED"), "Linux AF_UNIX peer credentials are required")
    def test_peer_credential_reader_reports_socketpair_identity(self):
        left, right = socket.socketpair()
        try:
            _pid, uid, gid = peer_credentials(left)
            self.assertEqual(uid, os.geteuid())
            self.assertEqual(gid, os.getegid())
        finally:
            left.close()
            right.close()

    def test_only_exact_connect_authority_is_accepted(self):
        valid = (b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\n"
                 b"Host: registry.npmjs.org:443\r\nProxy-Connection: Keep-Alive\r\n\r\n")
        self.assertEqual(parse_connect_request(valid), ("registry.npmjs.org", 443))
        rejects = (
            valid.replace(b"registry.npmjs.org:443", b"registry.npmjs.org.evil:443"),
            valid.replace(b"registry.npmjs.org:443", b"registry.npmjs.org:444"),
            valid.replace(b"registry.npmjs.org:443", b"127.0.0.1:443"),
            valid.replace(b"registry.npmjs.org:443", b"registry.npmjs.org@evil.test:443"),
            valid.replace(b"HTTP/1.1", b"HTTP/1.0"),
            valid + b"TLS-PREFACE",
            valid.replace(b"Proxy-Connection: Keep-Alive\r\n", b"Proxy-Authorization: secret\r\n"),
            valid.replace(b"Host: registry.npmjs.org:443\r\n",
                          b"Host: registry.npmjs.org:443\r\nHost: registry.npmjs.org:443\r\n"),
        )
        for request in rejects:
            with self.subTest(request=request[:80]), self.assertRaises(EgressRejected):
                parse_connect_request(request)

    def test_allowlist_rejects_wildcards_and_noncanonical_hostnames(self):
        for hosts in (("*.npmjs.org",), ("registry.npmjs.org.",),
                      ("https://registry.npmjs.org",), ("registry.npmjs.org", "registry.npmjs.org")):
            with self.subTest(hosts=hosts), self.assertRaises(EgressRejected):
                EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                             allowed_hosts=hosts)

    def test_public_ip_filter_rejects_private_and_special_address_answers(self):
        forbidden = (
            "10.0.0.1", "172.16.0.1", "192.168.1.1", "127.0.0.1", "169.254.1.1",
            "0.0.0.0", "224.0.0.1", "100.64.0.1", "192.0.2.1", "198.51.100.1",
            "203.0.113.1", "::1", "fc00::1", "fe80::1", "2001:db8::1", "ff02::1",
            "::ffff:8.8.8.8",
        )
        for address in forbidden:
            family = socket.AF_INET6 if ":" in address else socket.AF_INET
            with self.subTest(address=address), self.assertRaises(EgressRejected):
                with patch.object(broker_module, "connect_public"):
                    from worker_release_egress_protocol import _validated_sockaddrs
                    _validated_sockaddrs("registry.npmjs.org", 443,
                                         [answer(address, family)], ("registry.npmjs.org",))

    def test_mixed_public_and_private_dns_answers_fail_as_a_whole(self):
        calls = []

        with self.assertRaises(EgressRejected):
            from worker_release_egress_protocol import _validated_sockaddrs
            _validated_sockaddrs("registry.npmjs.org", 443,
                                 [answer("8.8.8.8"), answer("127.0.0.1")],
                                 ("registry.npmjs.org",))

    def test_bounded_dns_result_is_vetted_and_sockaddr_is_used_once(self):
        made = []

        def factory(family, socktype, proto):
            created = FakeConnectedSocket(family, socktype, proto)
            made.append(created)
            return created

        capture = lambda command, **kwargs: subprocess.CompletedProcess(
            command, 0, "8.8.8.8 STREAM registry.npmjs.org\n", "")
        connected = connect_public("registry.npmjs.org", 443, capture=capture,
                                   socket_factory=factory)
        self.assertIs(connected, made[0])
        self.assertEqual(connected.connected, ("8.8.8.8", 443))
        self.assertEqual(len(made), 1)

    def test_ip_resolution_is_not_attempted_for_unapproved_host_or_port(self):
        called = []
        capture = lambda *_a, **_k: called.append(True)
        for host, port in (("attacker.test", 443), ("registry.npmjs.org", 8443)):
            with self.subTest(host=host, port=port), self.assertRaises(EgressRejected):
                public_sockaddrs(host, port, capture=capture)
        self.assertEqual(called, [])

    def test_dns_uses_bounded_subprocess_and_fails_closed_on_timeout(self):
        seen = []

        def timed_out(command, **kwargs):
            seen.append((command, kwargs))
            raise TimeoutError("synthetic bounded resolver timeout")

        with self.assertRaises(EgressRejected):
            public_sockaddrs("registry.npmjs.org", 443, capture=timed_out)
        self.assertEqual(len(seen), 1)
        command, kwargs = seen[0]
        self.assertEqual(command, ("/usr/bin/getent", "ahosts", "registry.npmjs.org"))
        self.assertEqual(kwargs["timeout"], 3.0)
        self.assertEqual(kwargs["max_stream_bytes"], 32 * 1024)

    def test_connect_attempts_share_one_aggregate_deadline(self):
        addresses = [(item[0], item[1], item[2], item[4])
                     for item in (answer("8.8.8.8"), answer("1.1.1.1"))]
        made = []

        class PendingSocket(FakeConnectedSocket):
            def connect_ex(self, sockaddr):
                self.connected = sockaddr
                if len(made) == 1:
                    time.sleep(0.03)
                    return errno.ECONNREFUSED
                return errno.EINPROGRESS

        def factory(*args):
            sock = PendingSocket(*args)
            made.append(sock)
            return sock

        waits = []
        def select_fn(_read, write, _exceptional, timeout):
            waits.append(timeout)
            return ([], [], [])

        with patch("worker_release_egress_protocol.public_sockaddrs", return_value=tuple(addresses)):
            with self.assertRaises(EgressRejected):
                connect_public("registry.npmjs.org", 443, timeout=0.05,
                               socket_factory=factory, select_fn=select_fn)
        self.assertEqual(len(made), 2)
        self.assertTrue(all(sock.closed for sock in made))
        self.assertEqual(len(waits), 1)
        self.assertLess(waits[0], 0.04)  # second address gets only the deadline remainder

    def test_tls_client_hello_sni_must_match_exact_connect_authority(self):
        hello = client_hello("registry.npmjs.org")
        left, right = socket.socketpair()
        right.sendall(hello)
        self.assertEqual(read_tls_client_hello(left, "registry.npmjs.org"), hello)
        left.close()
        right.close()

        handshake = hello[5:]
        fragmented = (b"\x16\x03\x01\x00\x02" + handshake[:2]
                      + b"\x16\x03\x01" + (len(handshake) - 2).to_bytes(2, "big")
                      + handshake[2:])
        left, right = socket.socketpair()
        right.sendall(fragmented)
        self.assertEqual(read_tls_client_hello(left, "registry.npmjs.org"), fragmented)
        left.close()
        right.close()

        left, right = socket.socketpair()
        right.sendall(client_hello("attacker.test"))
        with self.assertRaisesRegex(EgressRejected, "SNI"):
            read_tls_client_hello(left, "registry.npmjs.org")
        left.close()
        right.close()

    def test_tls_client_hello_rejects_missing_or_malformed_sni(self):
        left, right = socket.socketpair()
        right.sendall(b"\x16\x03\x01\x00\x04\x01\x00\x00\x00")
        with self.assertRaises(EgressRejected):
            read_tls_client_hello(left, "registry.npmjs.org")
        left.close()
        right.close()

    def test_tls_client_hello_rejects_ech_even_with_an_approved_outer_sni(self):
        left, right = socket.socketpair()
        right.sendall(client_hello("registry.npmjs.org", ech=True))
        with self.assertRaisesRegex(EgressRejected, "Encrypted ClientHello"):
            read_tls_client_hello(left, "registry.npmjs.org")
        left.close()
        right.close()

    def test_broker_enforces_global_and_per_peer_connection_caps(self):
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              max_connections=2, max_connections_per_peer=2)
        self.assertTrue(broker._admit_peer(1001, 1001))
        self.assertTrue(broker._admit_peer(1001, 1001))
        self.assertFalse(broker._admit_peer(1002, 1002))  # global cap applies across identities
        broker._release_peer(1001, 1001)
        self.assertTrue(broker._admit_peer(1001, 1001))
        broker._release_peer(1001, 1001)
        broker._release_peer(1001, 1001)
        self.assertEqual((broker._active_connections, broker._active_peers), (0, {}))

        per_peer = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                                max_connections=3, max_connections_per_peer=1)
        self.assertTrue(per_peer._admit_peer(1001, 1001))
        self.assertFalse(per_peer._admit_peer(1001, 1001))
        self.assertTrue(per_peer._admit_peer(1002, 1002))
        per_peer._release_peer(1001, 1001)
        per_peer._release_peer(1002, 1002)

    def test_dedicated_bridge_identity_factory_rejects_shared_supplementary_groups(self):
        user = SimpleNamespace(pw_uid=1001, pw_gid=1002, pw_dir="/nonexistent",
                               pw_shell="/usr/sbin/nologin")
        group = SimpleNamespace(gr_gid=1002, gr_mem=[])
        with patch.object(broker_module.pwd, "getpwnam", return_value=user), \
                patch.object(broker_module.grp, "getgrnam", return_value=group), \
                patch.object(broker_module.os, "getgrouplist", return_value=[1002]):
            broker = EgressBroker.for_dedicated_bridge_account()
        self.assertEqual((broker.expected_peer_uid, broker.expected_peer_gid), (1001, 1002))

        with patch.object(broker_module.pwd, "getpwnam", return_value=user), \
                patch.object(broker_module.grp, "getgrnam", return_value=group), \
                patch.object(broker_module.os, "getgrouplist", return_value=[1002, 1003]), \
                self.assertRaisesRegex(EgressRejected, "not isolated"):
            EgressBroker.for_dedicated_bridge_account()

    def test_bridge_listener_closes_connections_over_its_worker_cap(self):
        bridge = EgressBridge(broker_connector=lambda: None)
        entered = threading.Event()
        release = threading.Event()
        calls = []

        def hold_one(_client):
            calls.append(True)
            entered.set()
            release.wait(timeout=3)

        bridge.handle_connection = hold_one
        listener = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        listener.bind(("127.0.0.1", 0))
        listener.listen(4)
        stopping = threading.Event()
        worker = threading.Thread(target=bridge.serve,
                                  args=(listener, stopping),
                                  kwargs={"max_connections": 1}, daemon=True)
        worker.start()
        first = second = None
        try:
            first = socket.create_connection(listener.getsockname(), timeout=2)
            self.assertTrue(entered.wait(timeout=2))
            second = socket.create_connection(listener.getsockname(), timeout=2)
            second.settimeout(2)
            self.assertEqual(second.recv(1), b"")
            self.assertEqual(calls, [True])
        finally:
            release.set()
            stopping.set()
            listener.close()
            for client in (first, second):
                if client is not None:
                    client.close()
            worker.join(timeout=2)
        self.assertFalse(worker.is_alive())

    def test_broker_rejects_wrong_peer_before_dns_or_connect(self):
        left, right = socket.socketpair()
        called = []
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              capture=lambda *_a, **_k: called.append(True))
        try:
            broker._handle_authenticated(right, uid=1002, gid=1001)
            self.assertEqual(left.recv(1), b"\x01")
            self.assertEqual(called, [])
        finally:
            left.close()
            right.close()

    def test_broker_rejects_unapproved_host_before_dns_or_connect(self):
        left, right = socket.socketpair()
        called = []
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              capture=lambda *_a, **_k: called.append(True))
        payload = b'{"host":"registry.npmjs.org.evil","port":443,"schema":1}'
        try:
            left.sendall(struct.pack("!I", len(payload)) + payload)
            broker._handle_authenticated(right, uid=1001, gid=1001)
            self.assertEqual(left.recv(1), b"\x01")
            self.assertEqual(called, [])
        finally:
            left.close()
            right.close()

    def test_broker_rejects_duplicate_json_fields(self):
        left, right = socket.socketpair()
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001)
        payload = (b'{"host":"registry.npmjs.org","host":"attacker.test",'
                   b'"port":443,"schema":1}')
        try:
            left.sendall(struct.pack("!I", len(payload)) + payload)
            broker._handle_authenticated(right, uid=1001, gid=1001)
            self.assertEqual(left.recv(1), b"\x01")
        finally:
            left.close()
            right.close()

    def test_broker_requires_bridge_ready_ack_before_tunnel_relay(self):
        left, right = socket.socketpair()
        upstream = FakeConnectedSocket(socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP)
        relayed = []
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              relay=lambda *_s: relayed.append(True))
        payload = encode_request("registry.npmjs.org", 443)

        def handle():
            with patch.object(broker_module, "connect_public", return_value=upstream):
                broker._handle_authenticated(right, uid=1001, gid=1001)

        worker = threading.Thread(target=handle, daemon=True)
        worker.start()
        try:
            left.sendall(payload)
            self.assertEqual(left.recv(1), b"\x00")
            left.sendall(b"\x16")  # TLS bytes without the bridge's SNI-validation ack.
            worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(relayed, [])
            self.assertTrue(upstream.closed)
        finally:
            left.close()
            right.close()

    def test_broker_revalidates_sni_from_direct_same_uid_ipc_peer(self):
        left, right = socket.socketpair()
        upstream, registry = socket.socketpair()
        relayed = []
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              relay=lambda *_s: relayed.append(True))

        def handle():
            with patch.object(broker_module, "connect_public", return_value=upstream):
                broker._handle_authenticated(right, uid=1001, gid=1001)

        worker = threading.Thread(target=handle, daemon=True)
        worker.start()
        try:
            left.sendall(encode_request("registry.npmjs.org", 443))
            self.assertEqual(left.recv(1), b"\x00")
            left.sendall(b"\x02" + client_hello("attacker.test"))
            worker.join(timeout=2)
            self.assertFalse(worker.is_alive())
            self.assertEqual(relayed, [])
            self.assertEqual(registry.recv(1), b"")
        finally:
            for sock in (left, right, upstream, registry):
                sock.close()

    def test_bridge_does_not_forward_tls_for_an_unapproved_sni(self):
        app, bridge_side = socket.socketpair()
        broker_server, broker_client = socket.socketpair()
        forwarded = []

        def fake_broker():
            header = broker_server.recv(4)
            length = struct.unpack("!I", header)[0]
            remaining = bytearray()
            while len(remaining) < length:
                remaining.extend(broker_server.recv(length - len(remaining)))
            broker_server.sendall(b"\x00")
            broker_server.settimeout(2)
            while True:
                chunk = broker_server.recv(4096)
                if not chunk:
                    break
                forwarded.append(chunk)

        broker_thread = threading.Thread(target=fake_broker, daemon=True)
        broker_thread.start()
        bridge = EgressBridge(broker_connector=lambda: broker_client)
        bridge_thread = threading.Thread(target=bridge.handle_connection,
                                         args=(bridge_side,), daemon=True)
        bridge_thread.start()
        try:
            app.settimeout(2)
            app.sendall(b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\n"
                        b"Host: registry.npmjs.org:443\r\n\r\n")
            response = bytearray()
            while not response.endswith(b"\r\n\r\n"):
                response.extend(app.recv(1024))
            self.assertEqual(bytes(response),
                             b"HTTP/1.1 200 Connection Established\r\n\r\n")
            app.sendall(client_hello("attacker.test"))
            bridge_thread.join(timeout=2)
            broker_thread.join(timeout=2)
            self.assertFalse(bridge_thread.is_alive())
            self.assertFalse(broker_thread.is_alive())
            self.assertEqual(forwarded, [])
        finally:
            for sock in (app, bridge_side, broker_server, broker_client):
                try:
                    sock.close()
                except OSError:
                    pass

    def test_bridge_and_broker_tunnel_only_after_policy_acceptance(self):
        app, bridge_side = socket.socketpair()
        broker_side, broker_client = socket.socketpair()
        upstream, registry = socket.socketpair()
        relay = lambda left, right: __import__(
            "worker_release_egress_protocol").relay_tunnel(
                left, right, idle_timeout=2, total_timeout=5)
        broker = EgressBroker(expected_peer_uid=1001, expected_peer_gid=1001,
                              relay=relay)
        bridge = EgressBridge(broker_connector=lambda: broker_client, relay=relay)
        broker_thread = threading.Thread(
            target=broker._handle_authenticated,
            kwargs={"client": broker_side, "uid": 1001, "gid": 1001}, daemon=True)
        broker_thread.start()
        try:
            with patch.object(broker_module, "connect_public", return_value=upstream):
                bridge_thread = threading.Thread(target=bridge.handle_connection,
                                                 args=(bridge_side,), daemon=True)
                bridge_thread.start()
                app.settimeout(2)
                app.sendall(b"CONNECT registry.npmjs.org:443 HTTP/1.1\r\n"
                            b"Host: registry.npmjs.org:443\r\n\r\n")
                response = bytearray()
                while not response.endswith(b"\r\n\r\n"):
                    response.extend(app.recv(1024))
                self.assertEqual(bytes(response),
                                 b"HTTP/1.1 200 Connection Established\r\n\r\n")
                hello = client_hello("registry.npmjs.org")
                app.sendall(hello)
                registry.settimeout(2)
                self.assertEqual(registry.recv(1024), hello)
                registry.sendall(b"synthetic-tls-server-data")
                self.assertEqual(app.recv(128), b"synthetic-tls-server-data")
        finally:
            for sock in (app, bridge_side, broker_side, broker_client, upstream, registry):
                try:
                    sock.close()
                except OSError:
                    pass
            bridge_thread.join(timeout=2)
            broker_thread.join(timeout=2)
        self.assertFalse(bridge_thread.is_alive())
        self.assertFalse(broker_thread.is_alive())


if __name__ == "__main__":
    unittest.main()

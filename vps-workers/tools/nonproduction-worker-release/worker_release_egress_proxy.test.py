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
import worker_release_egress_network as network_module
from worker_release_egress_bridge import EgressBridge
from worker_release_egress_broker import EgressBroker, peer_credentials
from worker_release_egress_protocol import (
    EgressRejected, connect_public, encode_request, parse_connect_request,
    public_sockaddrs, read_tls_client_hello,
)


from worker_release_egress_test_support import FakeConnectedSocket, answer, client_hello


class EgressProtocolTests(unittest.TestCase):
    @unittest.skipUnless(sys.platform.startswith("linux"), "Linux AF_UNIX peer credentials are required")

    def test_peer_credential_reader_reports_socketpair_identity(self):
        left, right = socket.socketpair()
        try:
            _pid, uid, gid = peer_credentials(left)
            self.assertEqual(uid, os.geteuid())
            self.assertEqual(gid, os.getegid())
        finally:
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


if __name__ == "__main__":
    unittest.main()

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

    def test_relay_flushes_data_before_forwarding_peer_half_close(self):
        from worker_release_egress_protocol import relay_tunnel

        app, bridge = socket.socketpair()
        upstream, registry = socket.socketpair()
        failures = []

        def relay():
            try:
                relay_tunnel(bridge, upstream, idle_timeout=2, total_timeout=5)
            except Exception as error:
                failures.append(error)

        thread = threading.Thread(target=relay, daemon=True)
        thread.start()
        app.settimeout(2)
        registry.sendall(b"response-before-fin")
        registry.close()
        self.assertEqual(app.recv(128), b"response-before-fin")
        app.shutdown(socket.SHUT_WR)
        self.assertEqual(app.recv(1), b"")
        thread.join(timeout=2)
        self.assertFalse(thread.is_alive())
        self.assertEqual(failures, [])
        for sock in (app, bridge, upstream):
            sock.close()


if __name__ == "__main__":
    unittest.main()

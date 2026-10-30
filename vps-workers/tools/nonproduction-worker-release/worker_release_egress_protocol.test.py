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
                    from worker_release_egress_network import _validated_sockaddrs
                    _validated_sockaddrs("registry.npmjs.org", 443,
                                         [answer(address, family)], ("registry.npmjs.org",))

    def test_mixed_public_and_private_dns_answers_fail_as_a_whole(self):
        calls = []

        with self.assertRaises(EgressRejected):
            from worker_release_egress_network import _validated_sockaddrs
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

        with patch.object(network_module, "public_sockaddrs", return_value=tuple(addresses)):
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


if __name__ == "__main__":
    unittest.main()

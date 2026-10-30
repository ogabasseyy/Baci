"""Loopback HTTP CONNECT bridge for the synthetic private-network fixture."""
from __future__ import annotations

import socket
import threading
import time
from typing import Callable

from worker_release_egress_protocol import (
    DEFAULT_ALLOWED_HOSTS, EgressRejected, MAX_HEADER_BYTES, encode_request,
    exact_host_allowlist, parse_connect_request, read_tls_client_hello, relay_tunnel,
)

_PROXY_SUCCESS = b"HTTP/1.1 200 Connection Established\r\n\r\n"
_PROXY_FAILURE = b"HTTP/1.1 502 Bad Gateway\r\nConnection: close\r\nContent-Length: 0\r\n\r\n"


class EgressBridge:
    """Translate one strict local CONNECT request into the broker IPC protocol."""

    def __init__(self, *, broker_connector: Callable[[], object],
                 allowed_hosts=DEFAULT_ALLOWED_HOSTS,
                 relay: Callable = relay_tunnel):
        self.broker_connector = broker_connector
        self.allowed_hosts = exact_host_allowlist(allowed_hosts)
        self.relay = relay

    def handle_connection(self, client) -> None:
        broker = None
        accepted = False
        try:
            client.settimeout(10)
            request = _read_headers(client)
            host, port = parse_connect_request(request, self.allowed_hosts)
            broker = self.broker_connector()
            broker.settimeout(10)
            broker.sendall(encode_request(host, port))
            response = broker.recv(1)
            if response != b"\x00":
                raise EgressRejected("host egress broker rejected request")
            client.sendall(_PROXY_SUCCESS)
            accepted = True
            # Keep CONNECT authority and the end-to-end TLS hostname bound
            # together; a client cannot tunnel another SNI through the allowed IP.
            client_hello = read_tls_client_hello(client, host)
            broker.sendall(b"\x02")
            broker.sendall(client_hello)
            self.relay(client, broker)
        except (EgressRejected, OSError, ValueError, UnicodeError):
            if not accepted:
                try:
                    client.sendall(_PROXY_FAILURE)
                except OSError:
                    pass
        finally:
            if broker is not None:
                try:
                    broker.close()
                except OSError:
                    pass

    def serve(self, listener, stopping: threading.Event, *, max_connections: int = 4) -> None:
        """Bound accepted bridge workers; overload is closed without queuing."""
        if type(max_connections) is not int or not 1 <= max_connections <= 64:
            raise EgressRejected("bridge connection bound is invalid")
        slots = threading.BoundedSemaphore(max_connections)
        listener.settimeout(0.2)
        while not stopping.is_set():
            try:
                client, _address = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if not slots.acquire(blocking=False):
                client.close()
                continue

            def run(sock=client):
                try:
                    self.handle_connection(sock)
                finally:
                    try:
                        sock.close()
                    finally:
                        slots.release()

            try:
                threading.Thread(target=run, daemon=True).start()
            except RuntimeError:
                client.close()
                slots.release()


def _read_headers(client) -> bytes:
    result = bytearray()
    deadline = time.monotonic() + 10
    while len(result) <= MAX_HEADER_BYTES:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise EgressRejected("proxy request time bound exceeded")
        client.settimeout(remaining)
        chunk = client.recv(min(2048, MAX_HEADER_BYTES + 1 - len(result)))
        if not chunk:
            raise EgressRejected("proxy request ended before headers")
        result.extend(chunk)
        marker = result.find(b"\r\n\r\n")
        if marker >= 0:
            if marker + 4 != len(result):
                raise EgressRejected("proxy request contains pipelined bytes")
            return bytes(result)
    raise EgressRejected("proxy request exceeds its bound")


__all__ = ["EgressBridge"]

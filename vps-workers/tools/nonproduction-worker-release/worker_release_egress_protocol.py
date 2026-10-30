"""Small, fixed protocol shared by the disposable egress bridge and broker."""
from __future__ import annotations

import ipaddress
import re
import select
import socket
import struct
import time

MAX_REQUEST_BYTES = 4096
MAX_HEADER_BYTES = 8192
MAX_HEADER_COUNT = 32
MAX_TUNNEL_BYTES = 2 * 1024 * 1024 * 1024
MAX_CLIENT_HELLO_BYTES = 65_536
CONNECT_TIMEOUT_SECONDS = 10.0
IDLE_TIMEOUT_SECONDS = 30.0
MAX_TUNNEL_SECONDS = 600.0
DEFAULT_ALLOWED_HOSTS = ("registry.npmjs.org",)
_LABEL = re.compile(r"^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$")


class EgressRejected(RuntimeError):
    """A request crossed a fixed egress policy boundary."""


def normalize_hostname(value: object) -> str:
    if (not isinstance(value, str) or not value or len(value) > 253
            or value != value.strip() or value.endswith(".") or not value.isascii()):
        raise EgressRejected("egress hostname is invalid")
    host = value.lower()
    try:
        ipaddress.ip_address(host)
    except ValueError:
        pass
    else:
        raise EgressRejected("egress IP literals are forbidden")
    labels = host.split(".")
    if len(labels) < 2 or any(not _LABEL.fullmatch(label) for label in labels):
        raise EgressRejected("egress hostname is invalid")
    return host


def exact_host_allowlist(hosts=DEFAULT_ALLOWED_HOSTS) -> frozenset[str]:
    if isinstance(hosts, (str, bytes)):
        raise EgressRejected("egress host allowlist is invalid")
    normalized = tuple(normalize_hostname(host) for host in hosts)
    if not normalized or len(set(normalized)) != len(normalized):
        raise EgressRejected("egress host allowlist is invalid")
    return frozenset(normalized)


def parse_connect_request(data: bytes, allowed_hosts=DEFAULT_ALLOWED_HOSTS) -> tuple[str, int]:
    """Parse one strict CONNECT request; reject pipelining and credentials."""
    allowed = exact_host_allowlist(allowed_hosts)
    if not isinstance(data, bytes) or len(data) > MAX_HEADER_BYTES:
        raise EgressRejected("proxy request exceeds its bound")
    marker = data.find(b"\r\n\r\n")
    if marker < 0 or marker + 4 != len(data):
        raise EgressRejected("proxy request is incomplete or contains pipelined data")
    try:
        lines = data[:-4].decode("ascii").split("\r\n")
    except UnicodeDecodeError as error:
        raise EgressRejected("proxy request is not ASCII") from error
    if not 2 <= len(lines) <= MAX_HEADER_COUNT + 1:
        raise EgressRejected("proxy request header count is invalid")
    request = lines[0].split(" ")
    if len(request) != 3 or request[0] != "CONNECT" or request[2] != "HTTP/1.1":
        raise EgressRejected("only HTTP/1.1 CONNECT is supported")
    authority = request[1]
    if authority.count(":") != 1:
        raise EgressRejected("proxy authority is invalid")
    host_text, port_text = authority.rsplit(":", 1)
    host = normalize_hostname(host_text)
    if host not in allowed or not port_text.isascii() or not port_text.isdigit():
        raise EgressRejected("proxy destination is not allowed")
    port = int(port_text)
    if port != 443 or port_text != "443":
        raise EgressRejected("proxy destination port is not allowed")
    headers: dict[str, str] = {}
    for line in lines[1:]:
        if not line or line[0] in " \t" or ":" not in line:
            raise EgressRejected("proxy request header is invalid")
        key, value = line.split(":", 1)
        key, value = key.lower(), value.strip()
        if key not in {"host", "proxy-connection", "connection"} or key in headers:
            raise EgressRejected("proxy request header is not allowed")
        if (not value or any((ord(char) < 0x20 and char != "\t") or ord(char) == 0x7f
                             for char in value)):
            raise EgressRejected("proxy request header is invalid")
        headers[key] = value
    if headers.get("host") != authority:
        raise EgressRejected("proxy host header does not match authority")
    return host, port



def recv_exact(sock, count: int, *, deadline: float | None = None) -> bytes:
    if type(count) is not int or count < 0 or count > MAX_REQUEST_BYTES:
        raise EgressRejected("egress protocol length is invalid")
    parts = bytearray()
    while len(parts) < count:
        if deadline is not None:
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise EgressRejected("egress protocol time bound exceeded")
            sock.settimeout(remaining)
        chunk = sock.recv(count - len(parts))
        if not chunk:
            raise EgressRejected("egress protocol request was truncated")
        parts.extend(chunk)
    return bytes(parts)


def encode_request(host: str, port: int) -> bytes:
    host = normalize_hostname(host)
    if port != 443:
        raise EgressRejected("proxy destination port is not allowed")
    import json
    payload = json.dumps({"host": host, "port": port, "schema": 1},
                         sort_keys=True, separators=(",", ":")).encode("ascii")
    if len(payload) > MAX_REQUEST_BYTES:
        raise EgressRejected("egress protocol request exceeds its bound")
    return struct.pack("!I", len(payload)) + payload


def relay_tunnel(left, right, *, max_bytes=MAX_TUNNEL_BYTES,
                 idle_timeout=IDLE_TIMEOUT_SECONDS, total_timeout=MAX_TUNNEL_SECONDS) -> None:
    """Relay both directions with aggregate byte, idle, and wall-clock bounds."""
    if (type(max_bytes) is not int or max_bytes < 1
            or idle_timeout <= 0 or total_timeout <= 0):
        raise EgressRejected("egress relay bounds are invalid")
    sockets = (left, right)
    for sock in sockets:
        sock.setblocking(False)
    readers = set(sockets)
    shutdown_pending = set()
    buffers = {left: bytearray(), right: bytearray()}
    total = 0
    started = time.monotonic()
    last_activity = started
    while readers or buffers[left] or buffers[right] or shutdown_pending:
        now = time.monotonic()
        if now - started >= total_timeout or now - last_activity >= idle_timeout:
            raise EgressRejected("egress tunnel time bound exceeded")
        read_sockets = [sock for sock in readers if len(buffers[sock]) < 65_536]
        write_sockets = [sock for sock in sockets if buffers[sock]]
        timeout = min(1.0, total_timeout - (now - started), idle_timeout - (now - last_activity))
        readable, writable, _ = select.select(read_sockets, write_sockets, [], max(0, timeout))
        for source in readable:
            try:
                chunk = source.recv(65_536)
            except BlockingIOError:
                continue
            if not chunk:
                readers.discard(source)
                destination = right if source is left else left
                if buffers[destination]:
                    shutdown_pending.add(destination)
                else:
                    try:
                        destination.shutdown(socket.SHUT_WR)
                    except OSError:
                        pass
                continue
            total += len(chunk)
            if total > max_bytes:
                raise EgressRejected("egress tunnel byte bound exceeded")
            destination = right if source is left else left
            buffers[destination].extend(chunk)
            last_activity = time.monotonic()
        for destination in writable:
            try:
                sent = destination.send(buffers[destination])
            except BlockingIOError:
                continue
            if sent <= 0:
                raise EgressRejected("egress tunnel write failed")
            del buffers[destination][:sent]
            last_activity = time.monotonic()
            if not buffers[destination] and destination in shutdown_pending:
                shutdown_pending.discard(destination)
                try:
                    destination.shutdown(socket.SHUT_WR)
                except OSError:
                    pass



from worker_release_egress_network import (
    DNS_TIMEOUT_SECONDS, MAX_DNS_ADDRESSES, MAX_DNS_OUTPUT_BYTES,
    connect_public, public_sockaddrs,
)
from worker_release_egress_tls import read_tls_client_hello

"""Small, fixed protocol shared by the disposable egress bridge and broker."""
from __future__ import annotations

import ipaddress
import errno
import os
from pathlib import Path
import re
import select
import socket
import struct
import sys
import threading
import time

MAX_REQUEST_BYTES = 4096
MAX_HEADER_BYTES = 8192
MAX_HEADER_COUNT = 32
MAX_TUNNEL_BYTES = 2 * 1024 * 1024 * 1024
MAX_CLIENT_HELLO_BYTES = 65_536
CONNECT_TIMEOUT_SECONDS = 10.0
DNS_TIMEOUT_SECONDS = 3.0
MAX_DNS_OUTPUT_BYTES = 32 * 1024
MAX_DNS_ADDRESSES = 32
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


_BIN = Path(__file__).resolve().parents[2] / "bin"
if str(_BIN) not in sys.path:
    sys.path.insert(0, str(_BIN))
from worker_release_bounded_process import run_bounded_capture


def _validated_sockaddrs(host: str, port: int, answers, allowed_hosts):
    host = normalize_hostname(host)
    if host not in exact_host_allowlist(allowed_hosts) or type(port) is not int or port != 443:
        raise EgressRejected("egress destination is not allowed")
    if not answers:
        raise EgressRejected("allowed registry returned no addresses")
    result = []
    seen = set()
    for answer in answers:
        try:
            family, socktype, proto, _canonname, sockaddr = answer
            if family not in (socket.AF_INET, socket.AF_INET6) or socktype != socket.SOCK_STREAM:
                raise ValueError
            address = sockaddr[0]
            ip = ipaddress.ip_address(address)
            if (getattr(ip, "scope_id", None) is not None or not ip.is_global
                    or ip.is_multicast or ip.is_unspecified or ip.is_loopback
                    or ip.is_link_local or getattr(ip, "ipv4_mapped", None) is not None
                    or int(sockaddr[1]) != port
                    or (family == socket.AF_INET6 and len(sockaddr) > 3 and sockaddr[3] != 0)):
                raise ValueError
            item = (family, socktype, proto, sockaddr)
        except (IndexError, TypeError, ValueError) as error:
            raise EgressRejected("allowed registry resolved to a nonpublic address") from error
        if item not in seen:
            seen.add(item)
            result.append(item)
            if len(result) > MAX_DNS_ADDRESSES:
                raise EgressRejected("allowed registry returned too many addresses")
    return tuple(result)


def _getent_answers(host: str, port: int, *, capture=run_bounded_capture):
    """Use a bounded child for DNS so libc resolver stalls cannot hang the broker."""
    if type(port) is not int or port != 443:
        raise EgressRejected("egress destination is not allowed")
    try:
        result = capture(("/usr/bin/getent", "ahosts", host), timeout=DNS_TIMEOUT_SECONDS,
                         max_stream_bytes=MAX_DNS_OUTPUT_BYTES)
    except (OSError, RuntimeError, ValueError) as error:
        raise EgressRejected("allowed registry DNS lookup failed") from error
    except Exception as error:
        # Bounded-capture failures include timeout/output/cleanup failures. Do not
        # expose captured resolver output to the IPC caller.
        raise EgressRejected("allowed registry DNS lookup failed") from error
    if result.returncode != 0 or not isinstance(result.stdout, str):
        raise EgressRejected("allowed registry DNS lookup failed")
    answers = []
    for line in result.stdout.splitlines():
        try:
            fields = line.split()
            if len(fields) < 2 or fields[1] not in {"STREAM", "DGRAM", "RAW"}:
                raise ValueError
            address = ipaddress.ip_address(fields[0])
            if isinstance(address, ipaddress.IPv4Address):
                answers.append((socket.AF_INET, socket.SOCK_STREAM, socket.IPPROTO_TCP,
                                "", (str(address), port)))
            else:
                answers.append((socket.AF_INET6, socket.SOCK_STREAM, socket.IPPROTO_TCP,
                                "", (str(address), port, 0, 0)))
            if len(answers) > MAX_DNS_ADDRESSES:
                raise EgressRejected("allowed registry returned too many addresses")
        except ValueError as error:
            raise EgressRejected("allowed registry DNS response is invalid") from error
    return answers


def public_sockaddrs(host: str, port: int,
                     allowed_hosts=DEFAULT_ALLOWED_HOSTS, *, capture=run_bounded_capture):
    """Resolve through bounded getent and reject the complete answer set if any IP is unsafe."""
    host = normalize_hostname(host)
    if host not in exact_host_allowlist(allowed_hosts) or type(port) is not int or port != 443:
        raise EgressRejected("egress destination is not allowed")
    answers = _getent_answers(host, port, capture=capture)
    return _validated_sockaddrs(host, port, answers, allowed_hosts)


def connect_public(host: str, port: int, *, timeout=CONNECT_TIMEOUT_SECONDS,
                   socket_factory=socket.socket, allowed_hosts=DEFAULT_ALLOWED_HOSTS,
                   capture=run_bounded_capture, select_fn=select.select):
    if type(timeout) not in (int, float) or timeout <= 0 or timeout > CONNECT_TIMEOUT_SECONDS:
        raise EgressRejected("egress connection time bound is invalid")
    addresses = public_sockaddrs(host, port, allowed_hosts, capture=capture)
    deadline = time.monotonic() + timeout
    last_error = None
    for family, socktype, proto, sockaddr in addresses:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        upstream = socket_factory(family, socktype, proto)
        try:
            upstream.setblocking(False)
            result = upstream.connect_ex(sockaddr)
            if result == 0:
                return upstream
            if result not in (errno.EINPROGRESS, errno.EWOULDBLOCK, errno.EALREADY, errno.EINTR):
                last_error = OSError(result, "connect failed")
                upstream.close()
                continue
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                upstream.close()
                break
            _readable, writable, exceptional = select_fn([], [upstream], [upstream], remaining)
            if not writable and not exceptional:
                upstream.close()
                break
            error_number = upstream.getsockopt(socket.SOL_SOCKET, socket.SO_ERROR)
            if error_number == 0 and writable:
                return upstream
            last_error = OSError(error_number or errno.ECONNREFUSED, "connect failed")
        except OSError as error:
            last_error = error
        try:
            upstream.close()
        except OSError:
            pass
    raise EgressRejected("allowed registry connection failed") from last_error


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
    buffers = {left: bytearray(), right: bytearray()}
    total = 0
    started = time.monotonic()
    last_activity = started
    while readers or buffers[left] or buffers[right]:
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


def read_tls_client_hello(sock, expected_hostname: str) -> bytes:
    """Read a bounded TLS ClientHello and require one exact matching SNI name."""
    expected = normalize_hostname(expected_hostname)
    wire = bytearray()
    handshake = bytearray()
    hello_size = None
    deadline = time.monotonic() + CONNECT_TIMEOUT_SECONDS
    while hello_size is None or len(handshake) < hello_size:
        header = _recv_fixed(sock, 5, deadline=deadline)
        wire.extend(header)
        if header[0] != 22 or header[1] != 3 or header[2] not in (1, 2, 3, 4):
            raise EgressRejected("TLS ClientHello record is invalid")
        record_size = int.from_bytes(header[3:5], "big")
        if record_size < 1 or record_size > 16_384:
            raise EgressRejected("TLS ClientHello record exceeds its bound")
        body = _recv_fixed(sock, record_size, deadline=deadline)
        wire.extend(body)
        handshake.extend(body)
        if len(wire) > MAX_CLIENT_HELLO_BYTES or len(handshake) > MAX_CLIENT_HELLO_BYTES:
            raise EgressRejected("TLS ClientHello exceeds its bound")
        if hello_size is None and len(handshake) >= 4:
            if handshake[0] != 1:
                raise EgressRejected("TLS first handshake message is not ClientHello")
            hello_size = 4 + int.from_bytes(handshake[1:4], "big")
            if hello_size < 42 or hello_size > MAX_CLIENT_HELLO_BYTES:
                raise EgressRejected("TLS ClientHello length is invalid")
        if hello_size is not None and len(handshake) > hello_size:
            raise EgressRejected("TLS record contains data after ClientHello")
    if _client_hello_sni(bytes(handshake[:hello_size])) != expected:
        raise EgressRejected("TLS SNI does not match the approved registry host")
    return bytes(wire)


def _recv_fixed(sock, count: int, *, deadline: float) -> bytes:
    result = bytearray()
    while len(result) < count:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise EgressRejected("TLS ClientHello time bound exceeded")
        sock.settimeout(remaining)
        block = sock.recv(count - len(result))
        if not block:
            raise EgressRejected("TLS ClientHello was truncated")
        result.extend(block)
    return bytes(result)


def _client_hello_sni(message: bytes) -> str:
    if len(message) < 4 or message[0] != 1 or int.from_bytes(message[1:4], "big") != len(message) - 4:
        raise EgressRejected("TLS ClientHello framing is invalid")
    body = memoryview(message)[4:]
    offset = 0

    def take(size: int) -> memoryview:
        nonlocal offset
        if type(size) is not int or size < 0 or offset + size > len(body):
            raise EgressRejected("TLS ClientHello fields are truncated")
        value = body[offset:offset + size]
        offset += size
        return value

    take(2 + 32)
    session_length = int.from_bytes(take(1), "big")
    take(session_length)
    cipher_length = int.from_bytes(take(2), "big")
    if cipher_length < 2 or cipher_length % 2:
        raise EgressRejected("TLS ClientHello cipher list is invalid")
    take(cipher_length)
    compression_length = int.from_bytes(take(1), "big")
    if compression_length < 1:
        raise EgressRejected("TLS ClientHello compression list is invalid")
    take(compression_length)
    if offset == len(body):
        raise EgressRejected("TLS ClientHello has no SNI extension")
    extension_length = int.from_bytes(take(2), "big")
    if offset + extension_length != len(body):
        raise EgressRejected("TLS ClientHello extension block is invalid")
    extension_end = offset + extension_length
    sni_values: list[str] = []
    saw_sni = False
    while offset < extension_end:
        extension_type = int.from_bytes(take(2), "big")
        size = int.from_bytes(take(2), "big")
        extension = take(size)
        # ECH (including its standardized GREASE form) can carry a different
        # inner SNI than the visible outer ClientHello name. Older draft code
        # points are rejected too; there is no ECH requirement in this prototype.
        if extension_type in {0xFE0D, 0xFFCE}:
            raise EgressRejected("TLS Encrypted ClientHello is not allowed")
        if extension_type != 0:
            continue
        if saw_sni or len(extension) < 2:
            raise EgressRejected("TLS ClientHello SNI extension is invalid")
        saw_sni = True
        names_size = int.from_bytes(extension[:2], "big")
        if names_size != len(extension) - 2:
            raise EgressRejected("TLS ClientHello SNI name list is invalid")
        cursor = 2
        while cursor < len(extension):
            if cursor + 3 > len(extension):
                raise EgressRejected("TLS ClientHello SNI name is truncated")
            name_type = extension[cursor]
            name_size = int.from_bytes(extension[cursor + 1:cursor + 3], "big")
            cursor += 3
            if cursor + name_size > len(extension):
                raise EgressRejected("TLS ClientHello SNI name is truncated")
            if name_type == 0:
                try:
                    sni_values.append(bytes(extension[cursor:cursor + name_size]).decode("ascii"))
                except UnicodeDecodeError as error:
                    raise EgressRejected("TLS ClientHello SNI name is invalid") from error
            cursor += name_size
    if len(sni_values) != 1:
        raise EgressRejected("TLS ClientHello must carry one server name")
    return normalize_hostname(sni_values[0])

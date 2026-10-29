"""Bounded TLS ClientHello parsing with strict SNI and ECH policy."""
from __future__ import annotations

import time

from worker_release_egress_protocol import (
    CONNECT_TIMEOUT_SECONDS, EgressRejected, MAX_CLIENT_HELLO_BYTES,
    normalize_hostname,
)

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

"""Shared synthetic helpers for disconnected egress protocol tests."""
from __future__ import annotations

import socket

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

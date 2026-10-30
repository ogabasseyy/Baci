"""Bounded DNS resolution and public-address-only connection logic."""
from __future__ import annotations

import errno
import ipaddress
from pathlib import Path
import select
import socket
import sys
import time

from worker_release_egress_protocol import (
    CONNECT_TIMEOUT_SECONDS, DEFAULT_ALLOWED_HOSTS, EgressRejected,
    exact_host_allowlist, normalize_hostname,
)

DNS_TIMEOUT_SECONDS = 3.0
MAX_DNS_OUTPUT_BYTES = 32 * 1024
MAX_DNS_ADDRESSES = 32

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

"""Host-side, exact-host egress broker prototype for synthetic tests only."""
from __future__ import annotations

import json
import grp
import os
import pwd
import socket
import struct
import threading
import time
from typing import Callable

from worker_release_egress_protocol import (
    DEFAULT_ALLOWED_HOSTS, EgressRejected, MAX_REQUEST_BYTES, connect_public,
    exact_host_allowlist, read_tls_client_hello, recv_exact, relay_tunnel,
)


def _unique_object(pairs):
    value = {}
    for key, item in pairs:
        if key in value:
            raise ValueError("duplicate broker request field")
        value[key] = item
    return value


def peer_credentials(client) -> tuple[int, int, int]:
    """Read Linux AF_UNIX peer credentials; absence is a hard failure."""
    option = getattr(socket, "SO_PEERCRED", None)
    if option is None:
        raise EgressRejected("broker peer credentials are unavailable")
    try:
        raw = client.getsockopt(socket.SOL_SOCKET, option, struct.calcsize("3i"))
        if len(raw) != struct.calcsize("3i"):
            raise ValueError
        pid, uid, gid = struct.unpack("=iII", raw)
    except (OSError, ValueError) as error:
        raise EgressRejected("broker peer credentials are unavailable") from error
    if pid <= 0 or uid < 0 or gid < 0:
        raise EgressRejected("broker peer credentials are invalid")
    return pid, uid, gid


class EgressBroker:
    """Serve requests only for the fixed dedicated bridge account identity."""

    def __init__(self, *, expected_peer_uid: int, expected_peer_gid: int,
                 allowed_hosts=DEFAULT_ALLOWED_HOSTS,
                 socket_factory: Callable = socket.socket,
                 capture: Callable | None = None,
                 relay: Callable = relay_tunnel,
                 max_connections: int = 8, max_connections_per_peer: int = 4):
        if (type(expected_peer_uid) is not int or expected_peer_uid <= 0
                or type(expected_peer_gid) is not int or expected_peer_gid <= 0
                or type(max_connections) is not int or not 1 <= max_connections <= 64
                or type(max_connections_per_peer) is not int
                or not 1 <= max_connections_per_peer <= max_connections):
            raise EgressRejected("broker peer identity is invalid")
        self.expected_peer_uid = expected_peer_uid
        self.expected_peer_gid = expected_peer_gid
        self.allowed_hosts = exact_host_allowlist(allowed_hosts)
        self.socket_factory = socket_factory
        self.capture = capture
        self.relay = relay
        self.max_connections = max_connections
        self.max_connections_per_peer = max_connections_per_peer
        self._connection_lock = threading.Lock()
        self._active_connections = 0
        self._active_peers: dict[tuple[int, int], int] = {}
        self._server_slots = threading.BoundedSemaphore(max_connections)

    @classmethod
    def for_dedicated_bridge_account(cls, **kwargs):
        """Resolve and validate the provisioned bridge-only account contract."""
        account = "baci-worker-egress-bridge"
        try:
            user = pwd.getpwnam(account)
            group = grp.getgrnam(account)
            supplementary = os.getgrouplist(account, user.pw_gid)
        except (KeyError, OSError) as error:
            raise EgressRejected("dedicated bridge identity is unavailable") from error
        if (user.pw_uid <= 0 or user.pw_gid != group.gr_gid
                or user.pw_dir != "/nonexistent" or not user.pw_shell.endswith("/nologin")
                or group.gr_mem or sorted(set(supplementary)) != [group.gr_gid]):
            raise EgressRejected("dedicated bridge identity is not isolated")
        return cls(expected_peer_uid=user.pw_uid, expected_peer_gid=group.gr_gid, **kwargs)

    def _admit_peer(self, uid: int, gid: int) -> bool:
        key = (uid, gid)
        with self._connection_lock:
            current = self._active_peers.get(key, 0)
            if (self._active_connections >= self.max_connections
                    or current >= self.max_connections_per_peer):
                return False
            self._active_connections += 1
            self._active_peers[key] = current + 1
            return True

    def _release_peer(self, uid: int, gid: int) -> None:
        key = (uid, gid)
        with self._connection_lock:
            current = self._active_peers.get(key, 0)
            if current <= 0 or self._active_connections <= 0:
                raise RuntimeError("broker connection accounting underflow")
            if current == 1:
                del self._active_peers[key]
            else:
                self._active_peers[key] = current - 1
            self._active_connections -= 1

    def serve(self, listener, stopping: threading.Event) -> None:
        """Bound accepted connection workers; overload is closed without queuing."""
        listener.settimeout(0.2)
        while not stopping.is_set():
            try:
                client, _address = listener.accept()
            except socket.timeout:
                continue
            except OSError:
                return
            if not self._server_slots.acquire(blocking=False):
                client.close()
                continue

            def run(sock=client):
                try:
                    self.handle_connection(sock)
                finally:
                    try:
                        sock.close()
                    finally:
                        self._server_slots.release()

            try:
                threading.Thread(target=run, daemon=True).start()
            except RuntimeError:
                client.close()
                self._server_slots.release()

    def handle_connection(self, client) -> None:
        try:
            _pid, uid, gid = peer_credentials(client)
        except EgressRejected:
            _reject(client)
            return
        if uid != self.expected_peer_uid or gid != self.expected_peer_gid:
            _reject(client)
            return
        if not self._admit_peer(uid, gid):
            _reject(client)
            return
        try:
            self._handle_authenticated(client, uid=uid, gid=gid)
        finally:
            self._release_peer(uid, gid)

    def _handle_authenticated(self, client, *, uid: int, gid: int) -> None:
        upstream = None
        accepted = False
        try:
            if uid != self.expected_peer_uid or gid != self.expected_peer_gid:
                raise EgressRejected("broker peer identity is not allowed")
            deadline = time.monotonic() + 10
            length = struct.unpack("!I", recv_exact(client, 4, deadline=deadline))[0]
            if not 1 <= length <= MAX_REQUEST_BYTES:
                raise EgressRejected("broker request length is invalid")
            payload = recv_exact(client, length, deadline=deadline)
            request = json.loads(payload.decode("ascii"), object_pairs_hook=_unique_object)
            if (not isinstance(request, dict) or set(request) != {"host", "port", "schema"}
                    or type(request.get("schema")) is not int or request["schema"] != 1
                    or type(request.get("port")) is not int or request["port"] != 443
                    or not isinstance(request.get("host"), str)
                    or request["host"] not in self.allowed_hosts):
                raise EgressRejected("broker request is not allowed")
            host = request["host"]
            connect_kwargs = {"socket_factory": self.socket_factory,
                              "allowed_hosts": self.allowed_hosts}
            if self.capture is not None:
                connect_kwargs["capture"] = self.capture
            upstream = connect_public(host, 443, **connect_kwargs)
            client.sendall(b"\x00")
            accepted = True
            if recv_exact(client, 1, deadline=time.monotonic() + 10) != b"\x02":
                raise EgressRejected("bridge did not complete TLS target validation")
            # The bridge is not a trust boundary: a same-UID IPC peer can forge
            # its ready marker. Independently parse SNI here, then forward the
            # consumed ClientHello before relaying subsequent TLS bytes.
            client_hello = read_tls_client_hello(client, host)
            upstream.sendall(client_hello)
            self.relay(client, upstream)
        except (EgressRejected, OSError, ValueError, TypeError, UnicodeError,
                RecursionError, json.JSONDecodeError):
            if not accepted:
                _reject(client)
        finally:
            if upstream is not None:
                try:
                    upstream.close()
                except OSError:
                    pass


def _reject(client) -> None:
    try:
        client.sendall(b"\x01")
    except OSError:
        pass


__all__ = ["EgressBroker", "peer_credentials", "public_sockaddrs"]

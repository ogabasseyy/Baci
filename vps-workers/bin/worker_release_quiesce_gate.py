"""Live broker-owned authorization socket for core service starts."""
from __future__ import annotations

import os
import socket
import stat
import threading
from pathlib import Path
from typing import Callable

from worker_release_recovery_latch import GATE_SOCKET_PATH, SERVICES


class HealthGateServer:
    """Authorize only fixed core units while their broker lease is alive."""

    def __init__(self, *, worker_uid: int, worker_gid: int, authorize: Callable[[str], bool],
                 path: Path = GATE_SOCKET_PATH, owner_uid: int = 0):
        self.worker_uid = worker_uid
        self.worker_gid = worker_gid
        self.authorize = authorize
        self.path = Path(path)
        self.owner_uid = owner_uid
        self._socket: socket.socket | None = None
        self._thread: threading.Thread | None = None
        self._stopping = threading.Event()

    def start(self) -> None:
        parent = self.path.parent.lstat()
        if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != self.owner_uid
                or parent.st_gid != self.worker_gid or stat.S_IMODE(parent.st_mode) != 0o710):
            raise PermissionError("worker health gate directory is untrusted")
        try:
            existing = self.path.lstat()
        except FileNotFoundError:
            existing = None
        if existing is not None:
            if not stat.S_ISSOCK(existing.st_mode) or existing.st_uid != self.owner_uid or existing.st_gid != self.worker_gid:
                raise PermissionError("stale worker health gate path is untrusted")
            self.path.unlink()
        server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        server.bind(str(self.path))
        os.chown(self.path, self.owner_uid, self.worker_gid)
        os.chmod(self.path, 0o660)
        server.listen(8)
        server.settimeout(0.2)
        self._socket = server
        self._thread = threading.Thread(target=self._serve, name="worker-health-gate", daemon=True)
        self._thread.start()

    def _peer_uid(self, client: socket.socket) -> int | None:
        if hasattr(socket, "SO_PEERCRED"):
            import struct
            _, uid, _ = struct.unpack("3i", client.getsockopt(socket.SOL_SOCKET, socket.SO_PEERCRED, 12))
            return uid
        if hasattr(socket, "LOCAL_PEERCRED"):
            import struct
            _, uid = struct.unpack_from("=II", client.getsockopt(getattr(socket, "SOL_LOCAL", 0), socket.LOCAL_PEERCRED, 256))
            return uid
        return None

    def _serve(self) -> None:
        assert self._socket is not None
        while not self._stopping.is_set():
            try:
                client, _ = self._socket.accept()
            except TimeoutError:
                continue
            except OSError:
                break
            with client:
                client.settimeout(1)
                try:
                    request = client.recv(64)
                    unit = request[:-1].decode("ascii") if request.endswith(b"\n") else ""
                    allowed = self._peer_uid(client) == self.worker_uid and unit in SERVICES and self.authorize(unit)
                    client.sendall(b"ALLOW\n" if allowed else b"DENY\n")
                except (OSError, UnicodeDecodeError):
                    continue

    def close(self) -> None:
        self._stopping.set()
        if self._socket is not None:
            self._socket.close()
            self._socket = None
        if self._thread is not None:
            self._thread.join(timeout=2)
            if self._thread.is_alive():
                raise RuntimeError("worker health gate did not stop")
            self._thread = None
        try:
            metadata = self.path.lstat()
            if stat.S_ISSOCK(metadata.st_mode) and metadata.st_uid == self.owner_uid and metadata.st_gid == self.worker_gid:
                self.path.unlink()
        except FileNotFoundError:
            pass


__all__ = ["HealthGateServer"]

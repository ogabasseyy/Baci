"""Fixed root-owned seed egress listener hosted by the release broker."""
from __future__ import annotations

import grp
import os
import socket
import stat
import threading
from pathlib import Path

from worker_release_egress_identity import egress_identity
from worker_release_egress_broker import EgressBroker

EGRESS_DIRECTORY = Path("/run/baci-worker-egress")
EGRESS_SOCKET = EGRESS_DIRECTORY / "broker.sock"
SOCKET_MODE = 0o660
DIRECTORY_MODE = 0o711


class EgressHostRejected(RuntimeError):
    """The fixed host egress listener cannot start or stop safely."""


def _directory_identity() -> tuple[int, int, int, int]:
    try:
        run_info = Path("/run").lstat()
        directory = EGRESS_DIRECTORY.lstat()
    except OSError as error:
        raise EgressHostRejected("tmpfiles did not provision the egress directory") from error
    if (not stat.S_ISDIR(run_info.st_mode) or run_info.st_uid != 0 or run_info.st_mode & 0o022
            or not stat.S_ISDIR(directory.st_mode) or stat.S_ISLNK(directory.st_mode)
            or directory.st_uid != 0 or directory.st_gid != 0
            or stat.S_IMODE(directory.st_mode) != DIRECTORY_MODE):
        raise EgressHostRejected("fixed egress directory ownership or mode is unsafe")
    return directory.st_dev, directory.st_ino, directory.st_uid, directory.st_gid


def _existing_socket(gid: int) -> os.stat_result | None:
    try:
        info = EGRESS_SOCKET.lstat()
    except FileNotFoundError:
        return None
    if (not stat.S_ISSOCK(info.st_mode) or info.st_uid != 0 or info.st_gid != gid
            or stat.S_IMODE(info.st_mode) != SOCKET_MODE or info.st_nlink != 1):
        raise EgressHostRejected("existing egress socket is not the exact stale broker inode")
    probe = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    try:
        probe.settimeout(0.25)
        try:
            probe.connect(str(EGRESS_SOCKET))
        except ConnectionRefusedError:
            return info
        except FileNotFoundError:
            return None
        except OSError as error:
            raise EgressHostRejected("existing egress socket state is ambiguous") from error
        raise EgressHostRejected("another egress broker is already listening")
    finally:
        probe.close()


class RunningEgressBroker:
    """The listener and accept thread share the root broker's lifecycle."""

    def __init__(self, listener: socket.socket, directory_identity: tuple[int, ...],
                 socket_identity: tuple[int, ...], stopping: threading.Event,
                 server_thread: threading.Thread, failure: list[BaseException]):
        self.listener = listener
        self.directory_identity = directory_identity
        self.socket_identity = socket_identity
        self.stopping = stopping
        self.server_thread = server_thread
        self.failure = failure

    def close(self) -> None:
        self.stopping.set()
        try:
            self.listener.close()
        finally:
            self.server_thread.join(timeout=2)
        if self.server_thread.is_alive():
            raise EgressHostRejected("egress accept thread did not stop")
        _verify_socket_before_unlink(self.directory_identity, self.socket_identity)
        os.unlink(EGRESS_SOCKET)
        if self.failure:
            raise EgressHostRejected("egress broker thread failed") from self.failure[0]


def start_egress_broker(stopping: threading.Event) -> RunningEgressBroker:
    """Start the exact-host broker; callers supply the parent service stop event."""
    if os.geteuid() != 0 or not isinstance(stopping, threading.Event):
        raise EgressHostRejected("egress broker requires the root broker lifecycle")
    uid, gid = egress_identity()
    group = grp.getgrgid(gid)
    directory_identity = _directory_identity()
    stale = _existing_socket(gid)
    if stale is not None:
        current = EGRESS_SOCKET.lstat()
        if _socket_stat_identity(current) != _socket_stat_identity(stale):
            raise EgressHostRejected("stale egress socket changed before cleanup")
        os.unlink(EGRESS_SOCKET)
    listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    created_inode = None
    try:
        listener.bind(str(EGRESS_SOCKET))
        created = EGRESS_SOCKET.lstat()
        created_inode = (created.st_dev, created.st_ino)
        os.chown(EGRESS_SOCKET, 0, group.gr_gid, follow_symlinks=False)
        os.chmod(EGRESS_SOCKET, SOCKET_MODE, follow_symlinks=False)
        listener.listen(8)
        socket_info = EGRESS_SOCKET.lstat()
        if (not stat.S_ISSOCK(socket_info.st_mode) or socket_info.st_uid != 0
                or socket_info.st_gid != gid or stat.S_IMODE(socket_info.st_mode) != SOCKET_MODE):
            raise EgressHostRejected("new egress socket ownership or mode is unsafe")
        socket_identity = _socket_stat_identity(socket_info)
        if _directory_identity() != directory_identity:
            raise EgressHostRejected("egress socket parent changed during setup")
        broker = EgressBroker(expected_peer_uid=uid, expected_peer_gid=gid)
        failure: list[BaseException] = []

        def serve() -> None:
            try:
                broker.serve(listener, stopping)
                if not stopping.is_set():
                    raise EgressHostRejected("egress accept loop stopped unexpectedly")
            except BaseException as error:
                failure.append(error)
                stopping.set()

        server_thread = threading.Thread(target=serve, name="baci-seed-egress", daemon=True)
        server_thread.start()
        return RunningEgressBroker(listener, directory_identity, socket_identity,
                                   stopping, server_thread, failure)
    except BaseException:
        listener.close()
        if created_inode is not None:
            try:
                info = EGRESS_SOCKET.lstat()
                if stat.S_ISSOCK(info.st_mode) and (info.st_dev, info.st_ino) == created_inode:
                    os.unlink(EGRESS_SOCKET)
            except FileNotFoundError:
                pass
        raise


def _socket_stat_identity(info: os.stat_result) -> tuple[int, ...]:
    return (info.st_dev, info.st_ino, info.st_uid, info.st_gid,
            stat.S_IFMT(info.st_mode), stat.S_IMODE(info.st_mode), info.st_nlink)


def _verify_socket_before_unlink(directory_identity: tuple[int, ...],
                                 socket_identity: tuple[int, ...]) -> None:
    if _directory_identity() != directory_identity:
        raise EgressHostRejected("egress socket parent changed before cleanup")
    try:
        info = EGRESS_SOCKET.lstat()
    except OSError as error:
        raise EgressHostRejected("egress socket disappeared before cleanup") from error
    if _socket_stat_identity(info) != socket_identity:
        raise EgressHostRejected("egress socket inode changed before cleanup")


__all__ = ["EGRESS_DIRECTORY", "EGRESS_SOCKET", "EgressHostRejected",
           "RunningEgressBroker", "start_egress_broker"]

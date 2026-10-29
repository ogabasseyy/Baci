"""Bounded, process-group-cleaned subprocess capture for worker tooling."""
from __future__ import annotations

import os
import selectors
import signal
import subprocess
import time
from typing import Mapping, Sequence

MAX_STREAM_BYTES = 1024 * 1024
MAX_POST_KILL_DRAIN_SECONDS = 2.0


class BoundedCaptureError(RuntimeError):
    """A child exceeded output, time, or cleanup bounds; text is never in its message."""

    def __init__(self, stdout: bytes, stderr: bytes):
        self.stdout = stdout.decode("utf-8", errors="replace")
        self.stderr = stderr.decode("utf-8", errors="replace")
        super().__init__("bounded subprocess capture rejected")


class OutputLimitExceeded(BoundedCaptureError):
    pass


class ProcessTimedOut(BoundedCaptureError):
    pass


class ProcessCleanupTimedOut(BoundedCaptureError):
    pass


def _kill_process_group(process: subprocess.Popen[bytes]) -> None:
    try:
        os.killpg(process.pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def run_bounded_capture(
    command: Sequence[str], *, cwd=None, env: Mapping[str, str] | None = None,
    timeout: float, max_stream_bytes: int = MAX_STREAM_BYTES,
) -> subprocess.CompletedProcess[str]:
    """Bound output, then kill every process in the dedicated group before return."""
    if (not command or timeout <= 0 or type(max_stream_bytes) is not int
            or not 1 <= max_stream_bytes <= MAX_STREAM_BYTES):
        raise ValueError("bounded subprocess limits are invalid")
    if not hasattr(os, "waitid") or not hasattr(os, "WNOWAIT"):
        raise RuntimeError("non-reaping process-exit observation is unavailable")

    process = None
    selector = None
    streams = {}
    buffers: dict[int, bytearray] = {}
    group_killed = False
    leader_exited = False
    cleanup_failed = False
    failure: type[BoundedCaptureError] | None = None
    cleanup_deadline: float | None = None
    stdout = stderr = b""
    return_code = 125

    def kill_group(reason: type[BoundedCaptureError] | None = None) -> None:
        nonlocal group_killed, cleanup_deadline, failure
        if reason is not None and failure is None:
            failure = reason
        if process is None or group_killed:
            return
        # The leader is deliberately not reaped until after this signal. This
        # pins the PID/PGID so a reused numeric group ID cannot be signaled.
        _kill_process_group(process)
        group_killed = True
        cleanup_deadline = time.monotonic() + MAX_POST_KILL_DRAIN_SECONDS

    def leader_has_exited() -> bool:
        assert process is not None
        info = os.waitid(os.P_PID, process.pid, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        return info is not None and info.si_pid == process.pid

    try:
        process = subprocess.Popen(
            command, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
            stdout=subprocess.PIPE, stderr=subprocess.PIPE, close_fds=True,
            start_new_session=True,
        )
        assert process.stdout is not None and process.stderr is not None
        stdout_fd, stderr_fd = process.stdout.fileno(), process.stderr.fileno()
        streams = {stdout_fd: process.stdout, stderr_fd: process.stderr}
        buffers = {fd: bytearray() for fd in streams}
        selector = selectors.DefaultSelector()
        for fd in streams:
            os.set_blocking(fd, False)
            selector.register(fd, selectors.EVENT_READ)
        deadline = time.monotonic() + timeout

        while True:
            now = time.monotonic()
            if not leader_exited and now >= deadline:
                kill_group(ProcessTimedOut)
            if not leader_exited and leader_has_exited():
                leader_exited = True
                # Also clean up background descendants after a successful
                # command, including ones that closed inherited stdio.
                kill_group()
            if leader_exited and not streams:
                break
            if (group_killed and cleanup_deadline is not None
                    and now >= cleanup_deadline):
                if streams:
                    failure = ProcessCleanupTimedOut
                break
            wait_for = 0.05
            if not group_killed:
                wait_for = min(wait_for, max(0.0, deadline - now))
            elif cleanup_deadline is not None:
                wait_for = min(wait_for, max(0.0, cleanup_deadline - now))
            assert selector is not None
            for key, _mask in selector.select(wait_for):
                fd = key.fd
                stream, buffer = streams[fd], buffers[fd]
                try:
                    chunk = os.read(fd, 65536)
                except BlockingIOError:
                    continue
                if not chunk:
                    selector.unregister(fd)
                    streams.pop(fd)
                    stream.close()
                    continue
                available = max_stream_bytes - len(buffer)
                if available > 0:
                    buffer.extend(chunk[:available])
                if len(chunk) > available:
                    kill_group(OutputLimitExceeded)

        stdout = bytes(buffers[stdout_fd])
        stderr = bytes(buffers[stderr_fd])
        if not group_killed:
            kill_group()
        try:
            return_code = process.wait(timeout=MAX_POST_KILL_DRAIN_SECONDS)
        except subprocess.TimeoutExpired:
            kill_group()
            try:
                return_code = process.wait(timeout=MAX_POST_KILL_DRAIN_SECONDS)
            except subprocess.TimeoutExpired:
                cleanup_failed = True
        if streams:
            failure = ProcessCleanupTimedOut
    finally:
        # Covers selector/setup/read failures: terminate and reap the leader
        # before closing our pipe descriptors on every exceptional path.
        if process is not None and process.returncode is None:
            kill_group()
            try:
                process.wait(timeout=MAX_POST_KILL_DRAIN_SECONDS)
            except subprocess.TimeoutExpired:
                kill_group()
                try:
                    process.wait(timeout=MAX_POST_KILL_DRAIN_SECONDS)
                except subprocess.TimeoutExpired:
                    cleanup_failed = True
        if selector is not None:
            selector.close()
        for stream in streams.values():
            try:
                stream.close()
            except OSError:
                pass
        if process is not None:
            for stream in (process.stdout, process.stderr):
                if stream is not None and not stream.closed:
                    stream.close()
    if cleanup_failed:
        raise ProcessCleanupTimedOut(stdout, stderr)
    if failure is not None:
        raise failure(stdout, stderr)
    return subprocess.CompletedProcess(
        command, return_code, stdout.decode("utf-8", errors="replace"),
        stderr.decode("utf-8", errors="replace"),
    )

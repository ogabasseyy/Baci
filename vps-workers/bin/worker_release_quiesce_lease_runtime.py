"""Bounded pipe protocol helpers for the fixed worker service supervisor."""
from __future__ import annotations
import os
import select
import subprocess
import time


def await_ready(process: subprocess.Popen[bytes], *, deadline: float, rejected: type[Exception]) -> None:
    await_line(process, b"READY\n", deadline=deadline, rejected=rejected,
               timeout_message="worker quiescence acquisition timed out")


def await_line(process: subprocess.Popen[bytes], expected: bytes, *, deadline: float,
               rejected: type[Exception], timeout_message: str = "worker quiescence protocol timed out",
               allow_exit: bool = False) -> None:
    if process.stdout is None:
        raise rejected("trusted quiescence helper protocol is unavailable")
    try:
        payload = bytearray()
        descriptor = process.stdout.fileno()
        while not payload.endswith(b"\n"):
            remaining = deadline - time.monotonic()
            if remaining <= 0:
                raise rejected(timeout_message)
            ready, _, _ = select.select([descriptor], [], [], remaining)
            if not ready:
                raise rejected(timeout_message)
            chunk = os.read(descriptor, 1)
            if not chunk:
                raise rejected("worker quiescence acquisition was not confirmed")
            payload.extend(chunk)
            if len(payload) > 64:
                raise rejected("worker quiescence helper protocol is invalid")
        if bytes(payload) != expected or (not allow_exit and process.poll() is not None):
            raise rejected("worker quiescence acquisition was not confirmed")
    except OSError:
        raise rejected("worker quiescence acquisition protocol failed") from None


def abandon_start(process: subprocess.Popen[bytes], *, cleanup_seconds: float) -> bool:
    if process.stdin is not None and not process.stdin.closed:
        try:
            process.stdin.close()
        except OSError:
            pass
    try:
        code = process.wait(timeout=cleanup_seconds)
        if process.stdout is not None:
            process.stdout.close()
        return code == 0
    except subprocess.TimeoutExpired:
        return False

"""Secretless fixed categories for local runtime-verifier launcher failures."""
from __future__ import annotations

import threading
import re

MAX_CAPTURE_BYTES = 4096


class BoundedLauncherStderr:
    """Drain launcher stderr while retaining only a bounded prefix."""

    def __init__(self, stream) -> None:
        self._stream = stream
        self._prefix = bytearray()
        self._thread = threading.Thread(target=self._drain, daemon=True)
        self._thread.start()

    def _drain(self) -> None:
        while True:
            chunk = self._stream.read(1024)
            if not chunk:
                return
            remaining = MAX_CAPTURE_BYTES - len(self._prefix)
            if remaining > 0:
                self._prefix.extend(chunk[:remaining])

    def category(self) -> str:
        self._thread.join(timeout=1)
        text = bytes(self._prefix).decode("utf-8", errors="replace").lower()
        if any(value in text for value in ("unknown assignment", "unknown property", "invalid value",
                                           "cannot set property", "property is not supported")):
            return "unit-property-rejected"
        if any(value in text for value in ("failed to connect to bus", "no medium found",
                                           "timed out waiting for response")):
            return "manager-unavailable"
        if any(value in text for value in ("access denied", "operation not permitted")):
            return "manager-permission-denied"
        if any(value in text for value in ("already loaded", "already exists")):
            return "unit-name-conflict"
        if any(value in text for value in ("failed to start transient", "job failed", "failed to start")):
            return "unit-start-rejected"
        return "unit-launch-rejected"

    def property_hint(self, allowed_properties: tuple[str, ...]) -> str | None:
        """Return a property only when it is one of the fixed submitted keys."""
        self._thread.join(timeout=1)
        text = bytes(self._prefix).decode("utf-8", errors="replace").lower()
        return next((name for name in allowed_properties
                     if re.search(rf"\b{re.escape(name.lower())}\b", text)), None)


__all__ = ["BoundedLauncherStderr", "MAX_CAPTURE_BYTES"]

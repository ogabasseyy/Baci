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


def summarize_unit_exit(values: dict[str, str], *, expected_cgroup: str) -> str:
    """Describe only fixed systemd exit enums; never return raw paths or output."""
    result = values.get("Result", "")
    code = values.get("ExecMainCode", "")
    status = values.get("ExecMainStatus", "")
    main_pid = values.get("MainPID", "")
    cgroup = values.get("ControlGroup", "")
    result = result if result in {
        "success", "exit-code", "signal", "timeout", "resources", "protocol",
    } else "other"
    # systemctl show renders waitid CLD_* values numerically (CLD_EXITED=1).
    code = {"1": "exited", "2": "killed", "3": "dumped", "4": "trapped"}.get(code, "other")
    status = status if re.fullmatch(r"[0-9]{1,3}", status) else "other"
    main_pid = ("zero" if main_pid == "0" else
                "nonzero" if re.fullmatch(r"[0-9]{1,10}", main_pid) else "other")
    expected_name = expected_cgroup.rsplit("/", 1)[-1]
    actual_name = cgroup.rsplit("/", 1)[-1]
    if cgroup == expected_cgroup:
        cgroup = "match"
    elif not cgroup:
        cgroup = "empty"
    elif actual_name == expected_name.removesuffix(".service"):
        cgroup = "service-suffix-omitted"
    elif actual_name == expected_name:
        cgroup = "basename-only"
    elif cgroup.startswith("/system.slice/"):
        cgroup = "system-slice-other"
    else:
        cgroup = "other"
    return (f"result={result},code={code},status={status},"
            f"main_pid={main_pid},cgroup={cgroup}")


__all__ = ["BoundedLauncherStderr", "MAX_CAPTURE_BYTES", "summarize_unit_exit"]

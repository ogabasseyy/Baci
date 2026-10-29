"""Bounded systemd probes shared by extractor tests."""
from __future__ import annotations

import subprocess


def systemd_system_manager_available(run=None) -> bool:
    """Probe manager reachability without requiring the host to be healthy."""
    runner = run or subprocess.run
    try:
        result = runner(
            ("systemctl", "--system", "show", "--property=Version", "--value"),
            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
            text=True, timeout=5, check=False,
        )
    except (OSError, subprocess.TimeoutExpired):
        return False
    return result.returncode == 0 and bool(result.stdout.strip())


def systemd_unit_failure_summary(unit: str, run=None) -> str:
    """Return fixed, non-sensitive lifecycle categories for failed fixture units."""
    runner = run or subprocess.run

    def property_value(name: str) -> str:
        try:
            result = runner(("systemctl", "--system", "show", f"--property={name}", "--value", unit),
                            stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.DEVNULL, text=True, timeout=3, check=False)
        except (OSError, subprocess.TimeoutExpired):
            return "unavailable"
        return result.stdout.strip() if result.returncode == 0 else "unavailable"

    def category(value: str, allowed: set[str]) -> str:
        return value if value in allowed else ("unavailable" if value == "unavailable" else "other")

    expected_group = f"/system.slice/{unit}"
    control_group = property_value("ControlGroup")
    cgroup = ("expected-system-slice" if control_group == expected_group else
              "empty" if not control_group else "other")
    main_pid = property_value("MainPID")
    pid = "zero" if main_pid == "0" else "positive" if main_pid.isdigit() else "unavailable"
    exec_status = property_value("ExecMainStatus")
    status = "zero" if exec_status == "0" else "nonzero" if exec_status.isdigit() else "unavailable"
    return (f"load={category(property_value('LoadState'), {'loaded', 'not-found', 'masked', 'error'})} "
            f"active={category(property_value('ActiveState'), {'active', 'activating', 'deactivating', 'inactive', 'failed', 'maintenance'})} "
            f"result={category(property_value('Result'), {'success', 'resources', 'timeout', 'exit-code', 'signal', 'core-dump', 'watchdog', 'protocol', 'start-limit-hit', 'condition', 'exec-condition'})} "
            f"condition={category(property_value('ConditionResult'), {'yes', 'no'})} "
            f"main_pid={pid} exec_code={category(property_value('ExecMainCode'), {'exited', 'killed', 'dumped'})} "
            f"exec_status={status} cgroup={cgroup}")

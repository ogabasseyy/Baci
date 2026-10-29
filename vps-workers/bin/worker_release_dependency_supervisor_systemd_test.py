"""Real disposable systemd/cgroup tests for the dependency builder supervisor."""
from __future__ import annotations

import os
import pwd
import re
import shutil
import subprocess
import sys
import tempfile
import unittest
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_dependency_supervisor as supervisor
import worker_release_dependency_sandbox as sandbox
import worker_release_dependency_supervisor_contract as unit_contract
from worker_release_descriptor_cgroup import require_process_member
from worker_release_dependency_supervisor_cgroup import open_unit_cgroup
from worker_release_dependency_supervisor_journal import (
    BuilderJournalRejected, BuilderUnitJournal, recover_recorded_builder,
)
from worker_release_dependency_systemd_startup import (
    SystemdStartupRejected, wait_for_systemd,
)

FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": "a" * 40, "run_id": "1", "run_attempt": 1, "job_id": "2"}


class SystemdStartupWaitTests(unittest.TestCase):
    def test_degraded_exit_status_is_accepted_when_manager_version_is_reachable(self):
        def query(kind, _timeout):
            return (1, "degraded") if kind == "state" else (0, "systemd 255")
        self.assertEqual(wait_for_systemd(query, lambda: None), ("degraded", "systemd 255"))

    def test_retries_starting_and_transient_cgroup_preflight_until_ready(self):
        now = [0.0]
        responses = iter([
            (1, "starting"),
            (0, "systemd 255"),
            (0, "starting"),
            (0, "systemd 255"),
            (0, "running"),
            (0, "systemd 255"),
        ])
        preflights = [0]

        def query(_kind, _timeout):
            return next(responses)

        def preflight():
            preflights[0] += 1
            if preflights[0] == 1:
                raise RuntimeError("temporary cgroup startup delay")

        def sleep(duration):
            now[0] += duration

        state, version = wait_for_systemd(
            query, preflight, timeout=2, poll=0.25,
            clock=lambda: now[0], sleep=sleep,
        )
        self.assertEqual((state, version), ("running", "systemd 255"))
        self.assertEqual(preflights[0], 3)
        self.assertGreater(now[0], 0)

    def test_starting_is_allowed_after_bounded_probe_window(self):
        now = [0.0]
        query = lambda kind, _timeout: (1, "starting") if kind == "state" else (0, "systemd 255")
        state, _version = wait_for_systemd(
            query, lambda: None, timeout=2, poll=0.25, starting_grace=1,
            clock=lambda: now[0], sleep=lambda duration: now.__setitem__(0, now[0] + duration),
        )
        self.assertEqual(state, "starting")
        self.assertGreaterEqual(now[0], 1)

    def test_timeout_fails_closed_when_manager_never_reaches_ready_state(self):
        now = [0.0]
        calls = [0]

        def query(kind, _timeout):
            calls[0] += 1
            return (1, "starting") if kind == "state" else (0, "systemd 255")

        def sleep(duration):
            now[0] += duration

        with self.assertRaisesRegex(SystemdStartupRejected, "state=starting"):
            wait_for_systemd(query, lambda: None, timeout=1, poll=0.25,
                             clock=lambda: now[0], sleep=sleep)
        self.assertGreaterEqual(calls[0], 4)
        self.assertGreaterEqual(now[0], 1)

def execute_canonical_unit(command, script: str, process_factory):
    """Keep shipped canonical sandbox arguments and replace only payload argv."""
    actual = tuple(command)
    builder_entrypoint = str(Path(supervisor.__file__).with_name(
        "worker_release_dependency_builder.py"))
    entrypoint_index = actual.index(builder_entrypoint)
    safe_command = (*actual[:entrypoint_index - 1], "/usr/bin/python3", "-c", script)
    return process_factory(safe_command, stdin=subprocess.DEVNULL,
                           stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                           env={"PATH": "/usr/bin:/bin"})


@unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux")
                     and os.environ.get("WORKER_RELEASE_BUILDER_SYSTEMD_REQUIRE") == "1",
                     "requires disposable root/systemd/cgroup-v2 workflow")
class BuilderSupervisorSystemdTests(unittest.TestCase):
    def setUp(self):
        systemctl = shutil.which("systemctl")
        if systemctl is None:
            self.fail("CI requires systemctl")

        def query(kind: str, timeout: float) -> tuple[int, str]:
            command = ((systemctl, "is-system-running") if kind == "state" else
                       (systemctl, "show", "--property=Version", "--value"))
            result = subprocess.run(command, check=False, stdin=subprocess.DEVNULL,
                                    stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                    timeout=timeout, text=True)
            return result.returncode, result.stdout.strip()

        try:
            self.manager_state, self.systemd_version = wait_for_systemd(
                query, lambda: supervisor.preflight_cgroup_root(supervisor.CGROUP_ROOT),
            )
        except SystemdStartupRejected as error:
            self.fail(f"CI systemd manager/cgroup v2 unavailable: {error}")
        self.builder = pwd.getpwnam("nobody")
        self.units = set()
        self.temp = tempfile.TemporaryDirectory(dir="/run")
        self.root = Path(self.temp.name)
        self.root.chmod(0o711)
        self.scratch = self.root / "scratch"
        self.scratch.mkdir(mode=0o700)
        os.chown(self.scratch, self.builder.pw_uid, self.builder.pw_gid)
        self.source = self.root / "source"
        self.source.mkdir(mode=0o555)
        os.chown(self.source, 0, 0)
        (self.root / "pnpm-cache-seed").mkdir(mode=0o555)
        receipt = self.root / ".baci-policy-verification.json"
        receipt.write_text("{}")
        receipt.chmod(0o444)
        self.worker_root = self.root / "worker"
        self.worker_root.mkdir(mode=0o700)
        self.inaccessible_root = self.root / "blocked-host-paths"
        self.inaccessible_root.mkdir(mode=0o700)
        self.blocked_paths = {}
        for name in ("runtime", "releases", "locks"):
            path = self.inaccessible_root / name
            path.mkdir(mode=0o700)
            self.blocked_paths[name] = path

    def tearDown(self):
        systemctl = shutil.which("systemctl")
        for unit in self.units:
            if systemctl is None or not re.fullmatch(
                    r"baci-worker-deps-[0-9a-f]{12}-[0-9a-f]{32}\.service", unit):
                continue
            for action in (("kill", "--kill-whom=all", "--signal=KILL", unit),
                           ("stop", unit), ("reset-failed", unit)):
                subprocess.run((systemctl, *action), check=False, stdin=subprocess.DEVNULL,
                               stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=5)
        self.temp.cleanup()

    def sandbox_boundary_paths(self):
        stack = ExitStack()
        for module in (sandbox, unit_contract):
            stack.enter_context(patch.object(module, "WORKER_RUNTIME", self.blocked_paths["runtime"]))
            stack.enter_context(patch.object(module, "WORKER_RELEASES", self.blocked_paths["releases"]))
            stack.enter_context(patch.object(module, "WORKER_LOCKS", self.blocked_paths["locks"]))
        return stack

    @staticmethod
    def unit_state_metadata(unit: str) -> str:
        values = []
        for prop in ("LoadState", "ActiveState", "SubState", "Result", "ExecMainCode",
                     "ExecMainStatus", "MainPID", "ControlGroup"):
            try:
                value = supervisor._systemctl("show", f"--property={prop}", "--value", unit)
            except supervisor.BuilderSupervisorRejected:
                value = "unavailable"
            if not re.fullmatch(r"[A-Za-z0-9._/-]{0,128}", value):
                value = "invalid"
            values.append(f"{prop}={value}")
        return ",".join(values)

    def run_unit(self, script: str, *, cap: int = supervisor.MAX_SCRATCH_BYTES):
        unit = f"baci-worker-deps-{'a' * 12}-{'b' * 32}.service"
        self.units.add(unit)
        with self.sandbox_boundary_paths(), BuilderUnitJournal(self.worker_root, owner_uid=0) as journal:
            journal.begin(FENCE, unit, self.source, self.scratch,
                          self.builder.pw_uid, self.builder.pw_gid)
            canonical = sandbox.systemd_command(
                self.source, self.scratch, "a" * 40, self.builder.pw_uid,
                self.builder.pw_gid, unit)
            with (patch.object(supervisor, "MAX_SCRATCH_BYTES", cap),
                  patch.object(supervisor, "_spawn_unit",
                               side_effect=lambda _cmd, **kwargs: execute_canonical_unit(
                                   canonical, script,
                                   lambda argv, **kw: subprocess.Popen(argv, **kw)))):
                try:
                    supervisor.supervise_builder_unit(
                        self.source, self.scratch, "a" * 40, self.builder.pw_uid,
                        self.builder.pw_gid, unit, usage_root=self.scratch,
                        unit_journal=journal,
                    )
                except supervisor.BuilderSupervisorRejected as error:
                    error.add_note(self.unit_state_metadata(unit))
                    raise

    def test_success_returns_only_after_unit_cgroup_is_empty(self):
        self.run_unit("import time; time.sleep(2)")
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_bound_violation_kills_descendant_and_proves_cgroup_empty(self):
        script = (
            "import subprocess,time,pathlib; time.sleep(1); "
            "subprocess.Popen(['/usr/bin/python3','-c','import time; time.sleep(60)']); "
            "pathlib.Path('" + str(self.scratch / "oversize") + "').write_bytes(b'xx'); "
            "time.sleep(60)"
        )
        with self.assertRaisesRegex(supervisor.BuilderSupervisorRejected, "scratch exceeded"):
            self.run_unit(script, cap=1)
        self.assertEqual(list(self.scratch.iterdir()), [])

    def test_recovery_requires_terminal_proof_and_drains_recorded_unit(self):
        unit = f"baci-worker-deps-{'a' * 12}-{'c' * 32}.service"
        self.units.add(unit)
        script = "import subprocess,time; subprocess.Popen(['/usr/bin/python3','-c','import time; time.sleep(60)']); time.sleep(60)"
        with self.sandbox_boundary_paths():
            command = list(sandbox.systemd_command(self.source, self.scratch, "a" * 40,
                                                   self.builder.pw_uid, self.builder.pw_gid, unit))
        entrypoint = str(Path(supervisor.__file__).with_name("worker_release_dependency_builder.py"))
        command = command[:command.index(entrypoint) - 1] + ["/usr/bin/python3", "-c", script]
        command.remove("--wait")
        command.remove("--pipe")
        with self.sandbox_boundary_paths(), BuilderUnitJournal(self.worker_root, owner_uid=0) as journal:
            journal.begin(FENCE, unit, self.source, self.scratch,
                          self.builder.pw_uid, self.builder.pw_gid)
            started = subprocess.run(command, check=False, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=15)
            if started.returncode != 0:
                self.fail(f"synthetic systemd unit launch returned {started.returncode}; "
                          f"{self.unit_state_metadata(unit)}")
            active = supervisor._systemctl("show", "--property=ActiveState", "--value", unit)
            self.assertEqual(active, "active", self.unit_state_metadata(unit))
            control_group = supervisor._systemctl("show", "--property=ControlGroup", "--value", unit)
            self.assertEqual(control_group, supervisor._control_group(unit))
            cgroup_fd, cgroup_info = open_unit_cgroup(supervisor.CGROUP_ROOT, unit)
            try:
                main_pid = int(supervisor._systemctl("show", "--property=MainPID", "--value", unit))
                self.assertGreater(main_pid, 0)
                require_process_member(cgroup_fd, cgroup_info.st_dev, cgroup_info.st_ino, main_pid)
            finally:
                os.close(cgroup_fd)
            with self.assertRaisesRegex(BuilderJournalRejected, "terminal-run proof"):
                recover_recorded_builder(journal, FENCE,
                                         terminal_attempt_proven=lambda _fence: False)
            self.assertEqual(supervisor._systemctl("show", "--property=ActiveState", "--value", unit),
                             "active", self.unit_state_metadata(unit))
            self.assertEqual(recover_recorded_builder(
                journal, FENCE, terminal_attempt_proven=lambda _fence: True), "drained")
            self.assertEqual(journal.read()["phase"], "drained")


if __name__ == "__main__":
    unittest.main()

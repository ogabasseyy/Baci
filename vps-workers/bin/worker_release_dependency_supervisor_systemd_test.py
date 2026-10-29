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
from worker_release_descriptor_cgroup import CgroupProofRejected, require_process_member
from worker_release_dependency_supervisor_cgroup import open_unit_cgroup
from worker_release_dependency_supervisor_journal import (
    BuilderJournalRejected, BuilderUnitJournal, recover_recorded_builder,
)

FENCE = {"repository": "org/repo", "workflow": "release.yml", "ref": "refs/heads/main",
         "sha": "a" * 40, "run_id": "1", "run_attempt": 1, "job_id": "2"}


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
        try:
            state = subprocess.run((systemctl, "is-system-running"), check=False,
                                   stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                   stderr=subprocess.DEVNULL, timeout=5, text=True).stdout.strip()
            version = subprocess.run((systemctl, "show", "--property=Version", "--value"),
                                     check=True, stdin=subprocess.DEVNULL,
                                     stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                                     timeout=5, text=True).stdout.strip()
            supervisor.preflight_cgroup_root(supervisor.CGROUP_ROOT)
        except (OSError, subprocess.SubprocessError, CgroupProofRejected) as error:
            self.fail(f"CI requires a responsive systemd manager and cgroup v2: {error}")
        if state not in ("running", "degraded") or not version:
            self.fail(f"CI systemd manager is unavailable (state={state or 'empty'})")
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

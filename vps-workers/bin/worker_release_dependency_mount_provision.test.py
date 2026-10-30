"""Host-free tests for the persistent dependency-builder mount provisioner."""
from __future__ import annotations

import os
import stat
import subprocess
import tempfile
import unittest
from contextlib import redirect_stdout
from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import worker_release_dependency_mount_provision as provision

UUID = "01234567-89ab-cdef-0123-456789abcdef"


class BuilderMountProvisionTests(unittest.TestCase):
    def test_mount_unit_is_fixed_and_persistent_for_only_canonical_uuid(self):
        payload = provision.mount_unit_contents(UUID).decode("ascii")
        self.assertIn(f"What=/dev/disk/by-uuid/{UUID}\n", payload)
        self.assertIn(f"Where={provision.BUILD_ROOT}\n", payload)
        self.assertIn("Type=ext4\n", payload)
        self.assertIn("Options=nosuid,nodev,noexec\n", payload)
        self.assertIn("WantedBy=local-fs.target", payload)
        for invalid in ("../etc/passwd", "not-a-uuid", UUID.upper() + "/x"):
            with self.subTest(invalid=invalid), self.assertRaisesRegex(
                    provision.BuilderRejected, "UUID is malformed"):
                provision.mount_unit_contents(invalid)
        with self.assertRaisesRegex(provision.BuilderRejected, "target differs"):
            provision.mount_unit_contents(UUID, target=Path("/tmp/alternate"))

    def test_current_measured_floor_blocks_all_production_mount_changes(self):
        with self.assertRaisesRegex(provision.BuilderRejected, "measured dependency graph"):
            provision.require_capacity_policy()

    def test_cli_dry_run_fails_closed_when_capacity_policy_is_not_satisfied(self):
        output = StringIO()
        with redirect_stdout(output):
            status = provision.main(["--device-uuid", UUID])
        self.assertEqual(status, 2)
        self.assertEqual(output.getvalue().strip(),
                         '{"category": "capacity-policy-rejected", "status": "rejected"}')

    def test_capacity_guard_rejects_ceiling_at_or_below_graph_floor(self):
        for maximum, floor in ((100, 100), (99, 100), (0, 100)):
            with self.subTest(maximum=maximum), self.assertRaisesRegex(
                    provision.BuilderRejected, "measured dependency graph"):
                provision.require_capacity_policy(minimum=1, maximum=maximum,
                                                  observed_floor=floor)

    def test_install_provisions_mount_then_checks_effective_unit_and_device(self):
        target = Path("/tmp/baci-builder-mount-test")
        unit_dir = Path("/tmp/baci-systemd-unit-test")
        calls = []
        values = {
            "What": f"/dev/disk/by-uuid/{UUID}", "Where": str(target),
            "Type": "ext4", "Options": "nosuid,nodev,noexec",
        }

        def runner(command, **kwargs):
            calls.append(command)
            if command[0] == "/usr/bin/systemctl" and command[1] == "show":
                property_name = command[2].split("=", 1)[1]
                return SimpleNamespace(stdout=values[property_name])
            if command[0] == "/usr/bin/findmnt":
                return SimpleNamespace(stdout=f"{UUID} ext4 rw,nosuid,nodev,noexec {target}\n")
            return SimpleNamespace(stdout="")

        capacity = SimpleNamespace(f_blocks=4, f_frsize=1024)
        with (patch.object(provision, "BUILD_ROOT", target),
              patch.object(provision, "SYSTEMD_UNIT_DIR", unit_dir),
              patch.object(provision, "MIN_BUILD_FILESYSTEM_BYTES", 1024),
              patch.object(provision, "MAX_BUILD_FILESYSTEM_BYTES", 8192),
              patch.object(provision, "require_capacity_policy"),
              patch.object(provision.os, "geteuid", return_value=0),
              patch.object(provision, "_write_new_unit") as write_unit,
              patch.object(provision.os.path, "ismount", return_value=True),
              patch.object(provision.os, "statvfs", return_value=capacity),
              patch.object(provision, "_prepare_mount_root") as prepare_root):
            provision.install_builder_mount(UUID, runner=runner, unit_dir=unit_dir,
                                            target=target)

        write_unit.assert_called_once()
        prepare_root.assert_called_once_with(target)
        self.assertEqual(calls[:2], [
            ("/usr/bin/systemctl", "daemon-reload"),
            ("/usr/bin/systemctl", "enable", "--now", provision.UNIT_NAME),
        ])
        self.assertEqual(calls[-1][0:2], ("/usr/bin/findmnt", "--noheadings"))

    def test_install_rejects_wrong_effective_mount_without_claiming_success(self):
        target = Path("/tmp/baci-builder-mount-test")
        unit_dir = Path("/tmp/baci-systemd-unit-test")
        values = {
            "What": "/dev/disk/by-uuid/aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
            "Where": str(target), "Type": "ext4", "Options": "nosuid,nodev,noexec",
        }

        def runner(command, **_kwargs):
            if command[0] == "/usr/bin/systemctl" and command[1] == "show":
                return SimpleNamespace(stdout=values[command[2].split("=", 1)[1]])
            return SimpleNamespace(stdout=f"{UUID} ext4 rw,nosuid,nodev,noexec {target}\n")

        with (patch.object(provision, "BUILD_ROOT", target),
              patch.object(provision, "SYSTEMD_UNIT_DIR", unit_dir),
              patch.object(provision, "MIN_BUILD_FILESYSTEM_BYTES", 1024),
              patch.object(provision, "MAX_BUILD_FILESYSTEM_BYTES", 8192),
              patch.object(provision, "require_capacity_policy"),
              patch.object(provision.os, "geteuid", return_value=0),
              patch.object(provision, "_write_new_unit"),
              patch.object(provision.os.path, "ismount", return_value=True)):
            with self.assertRaisesRegex(provision.BuilderRejected, "differs from the fixed"):
                provision.install_builder_mount(UUID, runner=runner, unit_dir=unit_dir,
                                                target=target)

    @unittest.skipUnless(os.geteuid() == 0, "requires root-owned unit-directory fixture")
    def test_unit_writer_rejects_nonidentical_existing_unit(self):
        with tempfile.TemporaryDirectory() as temporary:
            unit_dir = Path(temporary)
            unit = unit_dir / "builder.mount"
            unit.write_text("changed\n", encoding="ascii")
            unit.chmod(0o644)
            with self.assertRaisesRegex(provision.BuilderRejected, "not the exact fixed"):
                provision._write_new_unit(unit, b"expected\n")


if __name__ == "__main__":
    unittest.main()

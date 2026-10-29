"""Focused regressions for the fixed systemd extractor contract."""
from __future__ import annotations

import unittest
from pathlib import Path

import worker_release_systemd_contract as contract
import worker_release_systemd_extractor as supervisor


class ContractRegressionTests(unittest.TestCase):
    def test_process_identity_accepts_only_exact_uid_gid_and_primary_group(self):
        uid, gid = 1201, 1202

        def status(groups):
            return (f"Uid:\t{uid}\t{uid}\t{uid}\t{uid}\n"
                    f"Gid:\t{gid}\t{gid}\t{gid}\t{gid}\n"
                    f"Groups:\t{groups}\n")

        self.assertIsNone(supervisor._credential_mismatch(status(""), uid, gid))
        self.assertIsNone(supervisor._credential_mismatch(status(str(gid)), uid, gid))
        self.assertEqual(supervisor._credential_mismatch(status(f"{gid} 44"), uid, gid),
                         "supplementary-groups")
        self.assertEqual(supervisor._credential_mismatch(
            status("").replace(f"{uid}\t{uid}\t{uid}\t{uid}", "1\t1\t1\t1"), uid, gid), "uid")

    def test_template_pins_instance_service_to_fixed_system_slice(self):
        properties = contract.expected_properties(
            extractor=supervisor.EXTRACTOR, resource_root=supervisor.RESOURCE_ROOT,
            control_root=supervisor.CONTROL_ROOT,
        )
        unit_source = (Path(__file__).resolve().parents[1] / "systemd"
                       / "baci-worker-source-extract@.service").read_text()
        self.assertEqual(properties["Slice"], "system.slice")
        self.assertIn("Slice=system.slice", unit_source.splitlines())

    def test_control_group_diagnostic_is_a_fixed_path_class(self):
        unit = "baci-worker-source-extract@" + "a" * 32 + ".service"
        self.assertEqual(contract.control_group_category(f"/system.slice/{unit}", unit=unit),
                         "expected-system-slice")
        self.assertEqual(contract.control_group_category(
            f"/system.slice/baci-worker-source-extract.slice/{unit}", unit=unit),
            "nested-template-slice")
        self.assertEqual(contract.control_group_category("", unit=unit), "empty")
        self.assertEqual(contract.control_group_category(
            "/system.slice/other.service", unit=unit), "other")


if __name__ == "__main__":
    unittest.main()

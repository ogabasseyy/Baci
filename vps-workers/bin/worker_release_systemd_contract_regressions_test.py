"""Focused regressions for the fixed systemd extractor contract."""
from __future__ import annotations

import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

import worker_release_systemd_contract as contract
import worker_release_systemd_extractor as supervisor


class ContractRegressionTests(unittest.TestCase):
    def test_process_identity_accepts_only_exact_uid_gid_and_primary_group(self):
        uid, gid = 1201, 1202

        def status(groups):
            return (f"Uid:\t{uid}\t{uid}\t{uid}\t{uid}\n"
                    f"Gid:\t{gid}\t{gid}\t{gid}\t{gid}\n"
                    f"Groups:\t{groups}\n")

        self.assertIsNone(contract.credential_mismatch(status(""), uid, gid))
        self.assertIsNone(contract.credential_mismatch(status(str(gid)), uid, gid))
        self.assertEqual(contract.credential_mismatch(status(f"{gid} 44"), uid, gid),
                         "supplementary-groups")
        self.assertEqual(contract.credential_mismatch(
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

    def test_removed_cgroup_is_accepted_only_after_inactive_unit_and_exact_path_absence(self):
        transaction_id = "a" * 32
        unit = f"{supervisor.UNIT_PREFIX}{transaction_id}.service"
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "system.slice").mkdir()

            def systemctl(*args, **_kwargs):
                return {"ActiveState": "inactive", "ControlGroup": ""}[args[3]]

            with patch.object(supervisor, "CGROUP_ROOT", root), \
                 patch.object(supervisor, "_run", side_effect=systemctl):
                self.assertTrue(contract.unit_cgroup_removed(
                    unit, transaction_id, cgroup_root=root, run=systemctl))
                instance = root / "system.slice" / unit
                instance.mkdir()
                self.assertFalse(contract.unit_cgroup_removed(
                    unit, transaction_id, cgroup_root=root, run=systemctl))
                instance.rmdir()
                with patch.object(supervisor, "_run", side_effect=lambda *args, **_kwargs:
                                  "active" if args[3] == "ActiveState" else ""):
                    self.assertFalse(contract.unit_cgroup_removed(
                        unit, transaction_id, cgroup_root=root,
                        run=lambda *args, **_kwargs:
                        "active" if args[3] == "ActiveState" else ""))

    def test_removed_cgroup_fallback_requires_verified_contract_and_no_live_uid(self):
        transaction_id = "b" * 32
        unit = f"{supervisor.UNIT_PREFIX}{transaction_id}.service"
        info = type("CgroupInfo", (), {"st_dev": 1, "st_ino": 2})()
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "system.slice").mkdir()
            run = lambda *args, **_kwargs: "inactive" if args[3] == "ActiveState" else ""
            with patch.object(contract, "require_empty_cgroup", side_effect=FileNotFoundError), \
                 patch.object(contract, "assert_no_uid_processes") as no_uid_processes:
                contract.require_cgroup_empty_after_stop(
                    10, info, unit=unit, transaction_id=transaction_id, extractor_uid=1201,
                    contract_verified=True, cgroup_root=root, run=run,
                )
                no_uid_processes.assert_called_once_with(1201)
                with self.assertRaises(FileNotFoundError):
                    contract.require_cgroup_empty_after_stop(
                        10, info, unit=unit, transaction_id=transaction_id, extractor_uid=1201,
                        contract_verified=False, cgroup_root=root, run=run,
                    )

    def test_removed_cgroup_proof_rechecks_state_after_uid_scan(self):
        transaction_id = "c" * 32
        unit = f"{supervisor.UNIT_PREFIX}{transaction_id}.service"
        info = type("CgroupInfo", (), {"st_dev": 1, "st_ino": 2})()
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "system.slice").mkdir()
            state = {"active": "inactive", "control_group": ""}

            def run(*args, **_kwargs):
                return state["active"] if args[3] == "ActiveState" else state["control_group"]

            def restart_after_scan(_uid):
                state["active"] = "active"
                state["control_group"] = f"/system.slice/{unit}"

            with patch.object(contract, "require_empty_cgroup", side_effect=FileNotFoundError), \
                 patch.object(contract, "assert_no_uid_processes", side_effect=restart_after_scan):
                with self.assertRaisesRegex(contract.UnitContractRejected, "changed during"):
                    contract.require_cgroup_empty_after_stop(
                        10, info, unit=unit, transaction_id=transaction_id, extractor_uid=1201,
                        contract_verified=True, cgroup_root=root, run=run,
                    )

    def test_uid_scan_error_fails_closed_without_accepting_removed_cgroup(self):
        transaction_id = "e" * 32
        unit = f"{supervisor.UNIT_PREFIX}{transaction_id}.service"
        info = type("CgroupInfo", (), {"st_dev": 1, "st_ino": 2})()
        with TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "system.slice").mkdir()
            run = lambda *args, **_kwargs: "inactive" if args[3] == "ActiveState" else ""
            with patch.object(contract, "require_empty_cgroup", side_effect=FileNotFoundError), \
                 patch.object(contract, "assert_no_uid_processes",
                              side_effect=RuntimeError("scan unavailable")):
                with self.assertRaisesRegex(RuntimeError, "scan unavailable"):
                    contract.require_cgroup_empty_after_stop(
                        10, info, unit=unit, transaction_id=transaction_id, extractor_uid=1201,
                        contract_verified=True, cgroup_root=root, run=run,
                    )


if __name__ == "__main__":
    unittest.main()

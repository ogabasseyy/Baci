#!/usr/bin/env python3
"""Unit and opt-in disposable-systemd tests for archive extraction."""
from __future__ import annotations

import hashlib
import importlib.util
import io
import os
import pwd
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_archive_extract_child as child
import worker_release_systemd_extractor as supervisor
import worker_release_systemd_contract as contract
_provisioner_path = Path(__file__).with_name("provision-worker-source-extractor.py")
_provisioner_spec = importlib.util.spec_from_file_location("source_extractor_provisioner", _provisioner_path)
provisioner = importlib.util.module_from_spec(_provisioner_spec)
sys.modules[_provisioner_spec.name] = provisioner
_provisioner_spec.loader.exec_module(provisioner)
from worker_release_stage_journal import StageJournal
from worker_release_source_snapshot import pin_source_snapshot

SHA = "a" * 40
FENCE = {"repository": "ogabasseyy/Baci", "workflow": ".github/workflows/production-release.yml",
         "ref": "refs/heads/main", "sha": SHA, "run_id": "234", "run_attempt": 1, "job_id": "567"}
RESOURCE_ROOT = supervisor.RESOURCE_ROOT


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


def archive_bytes() -> bytes:
    stream = io.BytesIO()
    with tarfile.open(fileobj=stream, mode="w:gz") as archive:
        for name, content in (("repo/pnpm-lock.yaml", b"root lock\n"),
                              ("repo/vps-workers/pnpm-lock.yaml", b"worker lock\n")):
            item = tarfile.TarInfo(name)
            item.size = len(content)
            item.mode = 0o440
            archive.addfile(item, io.BytesIO(content))
    return stream.getvalue()


class ExtractorUnitTests(unittest.TestCase):
    def test_systemd_manager_probe_accepts_degraded_but_reachable_manager(self):
        run = Mock(return_value=Mock(returncode=0, stdout="255\n"))
        self.assertTrue(systemd_system_manager_available(run))
        self.assertEqual(run.call_args.args[0],
                         ("systemctl", "--system", "show", "--property=Version", "--value"))

    def test_systemd_manager_probe_rejects_absent_manager(self):
        self.assertFalse(systemd_system_manager_available(
            Mock(return_value=Mock(returncode=1, stdout=""))))

    def test_apply_passes_file_record_to_shared_installer_without_missing_type_import(self):
        item = provisioner.File("fixture", b"content", 0o440, Path("/tmp/fixture"))
        runner = Mock()
        with patch.object(provisioner.os, "geteuid", return_value=0), \
             patch.object(provisioner.grp, "getgrnam", return_value=object()), \
             patch.object(provisioner.pwd, "getpwnam", return_value=object()), \
             patch.object(provisioner, "_identity", return_value=(1234, 1234)), \
             patch.object(provisioner, "_runtime_paths"), \
             patch.object(provisioner, "install_files", return_value=(item,)), \
             patch.object(provisioner, "install_one") as install_one:
            provisioner.apply(runner=runner)
        install_one.assert_called_once_with(item)
        self.assertEqual(runner.call_args_list[0].args[0][0], "systemd-tmpfiles")
        self.assertEqual(runner.call_args_list[1].args[0], ("systemctl", "daemon-reload"))

    def _contract_fixture(self, unit_file, properties=None):
        transaction_id = "d" * 32
        unit = f"{supervisor.UNIT_PREFIX}{transaction_id}.service"
        expected = contract.expected_properties(
            extractor=supervisor.EXTRACTOR, resource_root=supervisor.RESOURCE_ROOT,
            control_root=supervisor.CONTROL_ROOT,
        )
        expected.update(properties or {})
        calls = []

        def run(*args):
            name = args[3] if len(args) > 3 else ""
            calls.append(name)
            if name == "FragmentPath":
                return str(unit_file)
            if name == "ExecStart":
                return ("{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 -I -B "
                        f"/usr/local/lib/baci-worker-broker/worker_release_archive_extract_child.py {transaction_id} ; }}")
            if name == "MainPID":
                return "4321"
            if name == "ControlGroup":
                return f"/system.slice/{unit}"
            return expected[name]

        return transaction_id, unit, run, calls

    def test_effective_unit_contract_pins_resources_and_hardening(self):
        with tempfile.TemporaryDirectory() as temporary:
            unit_file = Path(temporary) / "extract@.service"
            unit_file.write_text("[Service]\n")
            unit_file.chmod(0o644)
            txid, unit, run, calls = self._contract_fixture(unit_file)
            result = contract.validate_unit_contract(
                unit=unit, transaction_id=txid, extractor_uid=os.getuid(),
                extractor_gid=os.getgid(), unit_file=unit_file, extractor=supervisor.EXTRACTOR,
                unit_prefix=supervisor.UNIT_PREFIX, resource_root=supervisor.RESOURCE_ROOT,
                control_root=supervisor.CONTROL_ROOT, run=run,
                pid_identity=lambda pid, uid, gid: self.assertEqual((pid, uid, gid),
                                                                     (4321, os.getuid(), os.getgid())),
                trusted_uid=os.getuid(),
            )
        self.assertEqual(result, (4321, f"/system.slice/{unit}"))
        self.assertIn("MemoryMax", calls)
        self.assertIn("TasksMax", calls)
        self.assertIn("RuntimeMaxUSec", calls)
        self.assertIn("KillMode", calls)
        self.assertIn("DropInPaths", calls)

    def test_effective_unit_contract_rejects_resource_and_hardening_drift(self):
        with tempfile.TemporaryDirectory() as temporary:
            unit_file = Path(temporary) / "extract@.service"
            unit_file.write_text("[Service]\n")
            unit_file.chmod(0o644)
            for name, unsafe in (("MemoryMax", "infinity"), ("TasksMax", "max"),
                                 ("RuntimeMaxUSec", "infinity"), ("KillMode", "process"),
                                 ("SupplementaryGroups", "baci-locks"),
                                 ("ProtectSystem", "no"), ("RestrictAddressFamilies", "AF_UNIX AF_INET"),
                                 ("InaccessiblePaths", "/etc"), ("DropInPaths", "/run/override.conf")):
                with self.subTest(property=name):
                    txid, unit, run, _calls = self._contract_fixture(unit_file, {name: unsafe})
                    with self.assertRaisesRegex(contract.UnitContractRejected, "properties"):
                        contract.validate_unit_contract(
                            unit=unit, transaction_id=txid, extractor_uid=os.getuid(),
                            extractor_gid=os.getgid(), unit_file=unit_file,
                            extractor=supervisor.EXTRACTOR, unit_prefix=supervisor.UNIT_PREFIX,
                            resource_root=supervisor.RESOURCE_ROOT, control_root=supervisor.CONTROL_ROOT,
                            run=run, pid_identity=lambda *_args: None, trusted_uid=os.getuid(),
                        )

    def test_effective_unit_contract_rejects_wrong_cgroup_instance(self):
        with tempfile.TemporaryDirectory() as temporary:
            unit_file = Path(temporary) / "extract@.service"
            unit_file.write_text("[Service]\n")
            unit_file.chmod(0o644)
            txid, unit, run, _calls = self._contract_fixture(unit_file)
            with self.assertRaisesRegex(contract.UnitContractRejected, "cgroup"):
                contract.validate_unit_contract(
                    unit=unit, transaction_id=txid, extractor_uid=os.getuid(),
                    extractor_gid=os.getgid(), unit_file=unit_file, extractor=supervisor.EXTRACTOR,
                    unit_prefix=supervisor.UNIT_PREFIX, resource_root=supervisor.RESOURCE_ROOT,
                    control_root=supervisor.CONTROL_ROOT,
                    run=lambda *args: ("/system.slice/other.service" if args[3] == "ControlGroup" else run(*args)),
                    pid_identity=lambda *_args: None, trusted_uid=os.getuid(),
                )

    def test_child_rejects_invalid_transaction_before_socket_access(self):
        with self.assertRaisesRegex(ValueError, "transaction identity"):
            child.extract("../bad")

    def test_child_rejects_bad_archive_digest_before_extracting(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            resource = root / "resources"
            resource.mkdir()
            txid = "a" * 32
            path = root / f"{txid}.sock"
            with patch.object(child, "CONTROL_ROOT", root), patch.object(child, "RESOURCE_ROOT", resource):
                server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                server.bind(str(path))
                server.listen(1)

                def respond():
                    connection, _ = server.accept()
                    with connection:
                        self.assertEqual(connection.recv(128), f"READY {txid}\n".encode())
                        header = (f'{{"sha":"{SHA}","archive_sha256":"' + "0" * 64
                                  + f'","archive_bytes":1,"destination":".{SHA}.source.{txid}"}}\n')
                        connection.sendall(header.encode())
                        connection.sendall(b"x")

                thread = threading.Thread(target=respond)
                thread.start()
                try:
                    with self.assertRaisesRegex(ValueError, "digest"):
                        child.extract(txid)
                finally:
                    thread.join(timeout=2)
                    server.close()
                self.assertEqual(list(resource.iterdir()), [])

    @unittest.skipUnless(os.geteuid() == 0 and os.environ.get("WORKER_RELEASE_EXTRACT_REQUIRE_SYSTEMD") == "1",
                         "enabled only by the disposable root/systemd CI harness")
    def test_fixed_systemd_unit_extracts_exact_archive_and_freezes_journal_output(self):
        account = pwd.getpwnam(supervisor.EXTRACTOR)
        if not systemd_system_manager_available():
            self.fail("CI requires a reachable systemd system manager")
        self.assertEqual(list(RESOURCE_ROOT.iterdir()), [], "unknown resource trees must block extraction")
        with tempfile.TemporaryDirectory(dir=Path.home()) as temporary:
            journal_root = Path(temporary)
            (journal_root / "releases").mkdir(mode=0o700)
            bundle = archive_bytes()
            digest = hashlib.sha256(bundle).hexdigest()
            with StageJournal(journal_root, owner_uid=0, stage_uid=account.pw_uid,
                              stage_gid=os.getgid(), resource_root=RESOURCE_ROOT,
                              resource_uid=account.pw_uid) as journal:
                journal.begin(FENCE, digest)
                receipt = supervisor.extract_frozen_source(journal, bundle, digest)
                source = receipt["snapshot"]
                self.assertEqual(receipt["source_sha"], SHA)
                self.assertEqual((source / "pnpm-lock.yaml").read_bytes(), b"root lock\n")
                self.assertEqual((source / "vps-workers/pnpm-lock.yaml").read_bytes(), b"worker lock\n")
                self.assertEqual((source / ".baci-source-sha").read_text(), SHA + "\n")
                self.assertEqual(source.stat().st_uid, account.pw_uid)
                self.assertEqual(source.stat().st_gid, os.getgid())
                self.assertEqual(source.stat().st_mode & 0o777, 0o550)
                with pin_source_snapshot(source, trusted_root=RESOURCE_ROOT,
                                         owner_uid=account.pw_uid) as pin:
                    pin.verify_unchanged()
                self.assertEqual(journal.recover(terminal_attempt_proven=lambda _fence: True,
                                                 resources_quiesced=lambda _fence: True), "discarded")
        self.assertEqual(list(RESOURCE_ROOT.iterdir()), [])


if __name__ == "__main__":
    unittest.main()

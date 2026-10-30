#!/usr/bin/env python3
"""Unit regressions for the disconnected authenticated seed-generation contract."""
from __future__ import annotations

import inspect
import os
from pathlib import Path
import socket
import sys
import tempfile
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import dependency_seed_generation as generation
from dependency_seed_generation_unit import (
    BIN, EGRESS_SOCKET, EGRESS_SOURCE_ROOT, EGRESS_TARGET, TOOLS,
    SeedGenerationRejected, systemd_command, trusted_egress_source, validate_active_unit,
)
from dependency_seed_generation_contract import (
    GenerationCapability, _generation_capability_values,
    _issue_generation_capability, validate_generation_attestation,
)
from dependency_seed_generation_worker import _mapped_host_id, proxy_environment
from worker_release_dependency_artifacts import BuilderRejected


class SeedGenerationContractTests(unittest.TestCase):
    def test_capability_cannot_be_constructed_from_a_plain_dict_or_direct_init(self):
        with self.assertRaises(TypeError):
            GenerationCapability(object(), {}, {}, lambda: None)
        for forged in ({}, object.__new__(GenerationCapability)):
            with self.assertRaises(SeedGenerationRejected):
                generation._publish_seed(
                    Path("/missing/source"), Path("/missing/cache"), Path("/missing/store"),
                    Path("/missing/seeds"), "a" * 40, generation_capability=forged)

    def test_capability_defensively_copies_verified_receipt_and_attestation(self):
        receipt = {"result": "passed"}
        attestation = {"sourceSha": "a" * 40}
        capability = _issue_generation_capability(receipt, attestation, lambda: None)
        receipt["result"] = "forged"
        attestation["sourceSha"] = "b" * 40
        stored_receipt, stored_attestation, _guard = _generation_capability_values(capability)
        self.assertEqual(stored_receipt, {"result": "passed"})
        self.assertEqual(stored_attestation, {"sourceSha": "a" * 40})

    def test_public_api_has_no_caller_supplied_success_or_receipt(self):
        parameters = inspect.signature(generation.generate_authenticated_seed).parameters
        self.assertNotIn("verified_receipt", parameters)
        self.assertNotIn("success", parameters)
        self.assertNotIn("runner", parameters)
        self.assertIn("revalidate_identity", parameters)
        self.assertIn("release_lock_proof", parameters)

    def test_fence_is_rechecked_exactly_before_publication_contract(self):
        from worker_release_lifecycle import AuthenticatedRun, LifecycleRejected, release_lock

        identity = AuthenticatedRun(
            repository="ogabasseyy/Baci",
            workflow=".github/workflows/production-release.yml",
            ref="refs/heads/main", sha="a" * 40, run_id="19", run_attempt=2,
            job_id="27", status="in_progress",
        )
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "release.lock"
            with patch.object(generation, "RELEASE_LOCK", lock_path):
                with release_lock(lock_path, expected_owner_uid=os.getuid()) as proof:
                    generation._revalidate_authenticated_fence(identity, lambda: identity, proof)
                    changed = AuthenticatedRun(**{**identity.__dict__, "run_attempt": 3})
                    with self.assertRaises(SeedGenerationRejected):
                        generation._revalidate_authenticated_fence(identity, lambda: changed, proof)
                with self.assertRaises(SeedGenerationRejected):
                    generation._revalidate_authenticated_fence(identity, lambda: identity, proof)
        completed = AuthenticatedRun(
            **{**identity.__dict__, "status": "completed"},
        )
        with tempfile.TemporaryDirectory() as temporary:
            lock_path = Path(temporary) / "release.lock"
            with patch.object(generation, "RELEASE_LOCK", lock_path):
                with release_lock(lock_path, expected_owner_uid=os.getuid()) as proof:
                    with self.assertRaises(SeedGenerationRejected):
                        generation._revalidate_authenticated_fence(identity, lambda: completed, proof)
                    with self.assertRaises(SeedGenerationRejected):
                        generation._revalidate_authenticated_fence(
                            identity, lambda: (_ for _ in ()).throw(OSError("unavailable")), proof)

    def test_generation_workspace_serializes_and_fails_closed_on_crash_scratch(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                with self.assertRaises(SeedGenerationRejected):
                    with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                        pass
            # The fixed persistent collection is permitted on later runs.
            with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                pass
            stale = workspace / "seed-deadbeef"
            stale.mkdir()
            with self.assertRaisesRegex(SeedGenerationRejected, "scratch blocks"):
                with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                    pass

    def test_generation_workspace_rejects_unknown_seed_collection_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            seeds = workspace / "seeds"
            seeds.mkdir(mode=0o700)
            (seeds / "untrusted-entry").write_text("do not accept")
            with self.assertRaisesRegex(SeedGenerationRejected, "unknown or excess"):
                with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                    pass

    def test_generation_workspace_refuses_symlinked_lock(self):
        with tempfile.TemporaryDirectory() as temporary:
            workspace = Path(temporary)
            target = workspace / "target"
            target.touch()
            (workspace / ".seed-generation.lock").symlink_to(target)
            with self.assertRaises(SeedGenerationRejected):
                with generation._locked_workspace(workspace, owner_uid=os.getuid()):
                    pass

    def test_systemd_worker_isolated_to_private_network_and_fixed_broker(self):
        egress_source = EGRESS_SOURCE_ROOT / ("baci-seed-egress-" + "a" * 32 + ".sock")
        command = systemd_command(
            "baci-worker-seed-0123456789ab-" + "a" * 32 + ".service",
            "0123456789ab", 812, 812, source=Path("/root/source"),
            cache=Path("/root/cache"), store=Path("/root/store"),
            pnpm=Path("/root/pnpm.cjs"), node=Path("/root/node"),
            egress_source=egress_source,
        )
        text = "\n".join(command)
        for contract in (
            "--property=PrivateNetwork=yes", "--property=NoNewPrivileges=yes",
            "--property=KillMode=mixed", "--property=ProtectSystem=strict",
            "--property=RemainAfterExit=yes", "--property=PrivateUsers=yes",
            "--property=ProtectControlGroups=yes", "--property=SupplementaryGroups=",
            "--property=RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6",
            "--property=InaccessiblePaths=/root /home /var/lib /var/log /run /srv /mnt /media",
            "--property=TemporaryFileSystem=/etc:ro",
            "--property=MemoryMax=2G", "--property=TasksMax=128", "--property=CPUQuota=200%",
            EGRESS_TARGET, "/run/baci-seed/source", str(egress_source),
            "/run/baci-seed/cache", "/run/baci-seed/store",
            "--host-uid", "--host-gid",
        ):
            self.assertIn(contract, text)
        self.assertIn("--sha\n0123456789ab", text)
        self.assertEqual(command[-8], "--node")
        self.assertEqual(command[-5], "0123456789ab")
        self.assertIn(f"{egress_source}:{EGRESS_TARGET}", text)
        self.assertNotIn(f"{EGRESS_SOCKET}:{EGRESS_TARGET}", text)

    def test_systemd_command_rejects_source_alias_under_masked_run(self):
        with self.assertRaisesRegex(SeedGenerationRejected, "outside fixed policy"):
            systemd_command(
                "baci-worker-seed-0123456789ab-" + "a" * 32 + ".service",
                "0123456789ab", 812, 812, source=Path("/root/source"),
                cache=Path("/root/cache"), store=Path("/root/store"),
                pnpm=Path("/root/pnpm.cjs"), node=Path("/root/node"),
                egress_source=Path("/run/baci-worker-egress/broker.sock"),
            )

    def test_private_user_namespace_maps_only_to_the_dedicated_host_identity(self):
        with tempfile.TemporaryDirectory() as temporary:
            mapping = Path(temporary) / "uid_map"
            mapping.write_text("0 812 1\n", encoding="ascii")
            self.assertEqual(_mapped_host_id(str(mapping), 0), 812)
            with self.assertRaises(BuilderRejected):
                _mapped_host_id(str(mapping), 1)

    def test_effective_network_and_exec_contract_must_match_before_receipt(self):
        uid, gid = os.getuid(), os.getgid()
        egress_source = EGRESS_SOURCE_ROOT / ("baci-seed-egress-" + "a" * 32 + ".sock")
        unit = "baci-worker-seed-aaaaaaaaaaaa-" + "d" * 32 + ".service"
        values = {
            "ActiveState": "active", "SubState": "exited", "Result": "success",
            "ExecMainStatus": "0", "MainPID": "0", "ControlGroup": f"/system.slice/{unit}",
            "Type": "exec", "RemainAfterExit": "yes", "SupplementaryGroups": "",
            "KillMode": "mixed", "NoNewPrivileges": "yes", "PrivateNetwork": "yes",
            "PrivateUsers": "yes", "ProtectSystem": "strict", "ProtectHome": "yes",
            "PrivateTmp": "yes", "PrivateDevices": "yes", "ProtectControlGroups": "yes",
            "ProtectKernelTunables": "yes", "ProtectKernelModules": "yes",
            "ProtectKernelLogs": "yes", "ProtectProc": "invisible", "ProcSubset": "pid",
            "RestrictSUIDSGID": "yes", "RestrictRealtime": "yes", "TasksMax": "128",
            "MemoryMax": str(2 * 1024**3), "CPUQuotaPerSecUSec": "2s", "UMask": "0077",
            "LimitNOFILE": "4096", "ReadWritePaths": "/run/baci-seed/cache /run/baci-seed/store",
            "BindPaths": "/root/cache:/run/baci-seed/cache /root/store:/run/baci-seed/store",
            "BindReadOnlyPaths": "/root/source:/run/baci-seed/source "
                f"{TOOLS}:/run/baci-seed-tools {BIN}:/run/baci-seed-bin "
                "/root/pnpm.cjs:/run/baci-seed-runtime/pnpm.cjs "
                "/root/node:/run/baci-seed-runtime/node /etc/ssl/certs:/etc/ssl/certs "
                f"{egress_source}:{EGRESS_TARGET}",
            "InaccessiblePaths": "/root /home /var/lib /var/log /run /srv /mnt /media",
            "TemporaryFileSystem": "/etc:ro", "User": str(uid), "Group": str(gid),
            "RuntimeMaxUSec": "5min 30s", "LimitFSIZE": str(4 * 1024**3),
            "RestrictAddressFamilies": "AF_UNIX AF_INET AF_INET6",
            "ExecStart": "{ path=/usr/bin/python3 ; argv[]=/usr/bin/python3 "
                "/run/baci-seed-tools/dependency_seed_generation_worker.py --source "
                "/run/baci-seed/source --cache /run/baci-seed/cache --store "
                "/run/baci-seed/store --pnpm /run/baci-seed-runtime/pnpm.cjs --node "
                f"/run/baci-seed-runtime/node --sha {'a' * 12} --host-uid {uid} "
                f"--host-gid {gid} ; ignore_errors=no ; }}",
        }

        def query(_verb, property_arg, _value, _unit):
            return values[property_arg.removeprefix("--property=")]

        arguments = {
            "source": Path("/root/source"), "cache": Path("/root/cache"),
            "store": Path("/root/store"), "pnpm": Path("/root/pnpm.cjs"),
            "node": Path("/root/node"),
            "egress_source": egress_source,
        }
        validate_active_unit(query, unit, uid, gid, **arguments)
        values["PrivateNetwork"] = "no"
        with self.assertRaises(SeedGenerationRejected):
            validate_active_unit(query, unit, uid, gid, **arguments)
    @unittest.skipUnless(os.geteuid() == 0, "socket alias inode verification requires root")
    def test_egress_source_alias_must_be_same_socket_inode(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "broker.sock"
            alias = root / ("baci-seed-egress-" + "a" * 32 + ".sock")
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                listener.bind(str(source))
                source.chmod(0o660)
                os.chown(source, 0, os.getgid())
                os.link(source, alias, follow_symlinks=False)
                with patch("dependency_seed_generation_unit.EGRESS_SOCKET", source), \
                     patch("dependency_seed_generation_unit.EGRESS_SOURCE_ROOT", root), \
                     patch("dependency_seed_generation_unit.trusted_directory_chain"):
                    identity = trusted_egress_source(alias, os.getgid())
                    self.assertEqual(identity, (source.stat().st_dev, source.stat().st_ino))
                    alias.unlink()
                    other = root / "other.sock"
                    other_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    try:
                        other_listener.bind(str(other))
                        other.chmod(0o660)
                        os.chown(other, 0, os.getgid())
                        os.link(other, alias, follow_symlinks=False)
                        with self.assertRaisesRegex(SeedGenerationRejected, "not the approved"):
                            trusted_egress_source(alias, os.getgid())
                    finally:
                        other_listener.close()
            finally:
                listener.close()

    @unittest.skipUnless(os.geteuid() == 0, "bind-mount alias lifecycle requires root")
    def test_alias_lifecycle_removes_only_restored_placeholder(self):
        import dependency_seed_generation_unit as unit_module

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "broker.sock"
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            backup = root / "placeholder.backup"
            try:
                listener.bind(str(source))
                source.chmod(0o660)
                os.chown(source, 0, os.getgid())

                def emulate_mount(executable, *args, **_kwargs):
                    alias = Path(args[-1])
                    if executable == "/usr/bin/mount":
                        alias.rename(backup)
                        os.link(source, alias, follow_symlinks=False)
                    elif executable == "/usr/bin/umount":
                        alias.unlink()
                        backup.rename(alias)
                    else:
                        raise AssertionError("unexpected mount executable")

                with (patch.object(unit_module, "EGRESS_SOCKET", source),
                      patch.object(unit_module, "EGRESS_SOURCE_ROOT", root),
                      patch.object(unit_module, "trusted_directory_chain"),
                      patch.object(unit_module, "_is_mountpoint",
                                   side_effect=[False, True, False]),
                      patch.object(unit_module, "_mount_command", side_effect=emulate_mount)):
                    alias = unit_module.create_egress_source_alias(os.getgid())
                    self.assertEqual(unit_module.trusted_egress_source(
                        alias.path, os.getgid()), alias.source_identity[:2])
                    unit_module.release_egress_source_alias(alias, os.getgid())
                self.assertFalse(alias.path.exists())
                self.assertFalse(backup.exists())
            finally:
                listener.close()

    @unittest.skipUnless(os.geteuid() == 0, "journaled alias recovery requires root")
    def test_recovery_uses_recorded_inode_after_broker_socket_replacement(self):
        import dependency_seed_generation_unit as unit_module

        transaction_id = "b" * 32
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "broker.sock"
            alias = root / f"baci-seed-egress-{transaction_id}.sock"
            backup = root / "placeholder.backup"
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                listener.bind(str(source))
                source.chmod(0o660)
                os.chown(source, 0, os.getgid())
                placeholder = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                placeholder.bind(str(alias))
                placeholder.close()
                alias.chmod(0o600)
                placeholder_info = alias.lstat()
                os.rename(alias, backup)
                os.link(source, alias, follow_symlinks=False)
                source_info = source.lstat()
                source_identity = (source_info.st_dev, source_info.st_ino)
                placeholder_identity = (placeholder_info.st_dev, placeholder_info.st_ino)
                source_backup = root / "old-broker.sock"
                os.rename(source, source_backup)
                replacement_listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                replacement_listener.bind(str(source))
                source.chmod(0o660)
                os.chown(source, 0, os.getgid())
                replacement_identity = (source.lstat().st_dev, source.lstat().st_ino)
                self.assertNotEqual(source_identity, replacement_identity)

                def emulate_unmount(_executable, *args, **_kwargs):
                    self.assertEqual(Path(args[-1]), alias)
                    alias.unlink()
                    os.rename(backup, alias)

                with (patch.object(unit_module, "EGRESS_SOCKET", source),
                      patch.object(unit_module, "EGRESS_SOURCE_ROOT", root),
                      patch.object(unit_module, "trusted_directory_chain"),
                      patch.object(unit_module, "identity",
                                   return_value=(1234, os.getgid())),
                      patch.object(unit_module, "_is_mountpoint",
                                   side_effect=[True, True, False, False, False]),
                      patch.object(unit_module, "_mount_command", side_effect=emulate_unmount)):
                    with self.assertRaisesRegex(SeedGenerationRejected, "journal-derived"):
                        unit_module.recover_egress_source_alias(
                            root / ("baci-seed-egress-" + "c" * 32 + ".sock"),
                            os.getgid(), transaction_id=transaction_id)
                    with self.assertRaisesRegex(SeedGenerationRejected,
                                                "source inode is not recorded"):
                        unit_module.recover_egress_source_alias(
                            alias, os.getgid(), transaction_id=transaction_id)
                    with self.assertRaisesRegex(SeedGenerationRejected,
                                                "source inode is not recorded"):
                        unit_module.recover_egress_source_alias(
                            alias, os.getgid(), transaction_id=transaction_id,
                            expected_source_identity=replacement_identity,
                            expected_placeholder_identity=placeholder_identity)
                    unit_module.recover_egress_source_alias(
                        alias, os.getgid(), transaction_id=transaction_id,
                        expected_source_identity=source_identity,
                        expected_placeholder_identity=placeholder_identity)
                    placeholder = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                    placeholder.bind(str(alias))
                    placeholder.close()
                    alias.chmod(0o600)
                    replacement_placeholder_identity = (alias.lstat().st_dev, alias.lstat().st_ino)
                    with self.assertRaisesRegex(SeedGenerationRejected, "placeholder is unsafe"):
                        unit_module.recover_egress_source_alias(
                            alias, os.getgid(), transaction_id=transaction_id)
                    unit_module.recover_egress_source_alias(
                        alias, os.getgid(), transaction_id=transaction_id,
                        expected_source_identity=source_identity,
                        expected_placeholder_identity=replacement_placeholder_identity)
                self.assertFalse(alias.exists())
                self.assertFalse(backup.exists())
                unit_module.recover_egress_source_alias(
                    alias, os.getgid(), transaction_id=transaction_id, allow_absent=True)
                with self.assertRaisesRegex(SeedGenerationRejected, "is absent"):
                    unit_module.recover_egress_source_alias(
                        alias, os.getgid(), transaction_id=transaction_id)
            finally:
                listener.close()
                if "replacement_listener" in locals():
                    replacement_listener.close()

    @unittest.skipUnless(os.geteuid() == 0 and sys.platform.startswith("linux"),
                         "planned alias recovery requires root on Linux")
    def test_planned_recovery_removes_only_private_unmounted_socket(self):
        import dependency_seed_generation_unit as unit_module

        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "broker.sock"
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                listener.bind(str(source))
                source.chmod(0o660)
                os.chown(source, 0, os.getgid())
                transaction_id = "d" * 32
                alias = root / f"baci-seed-egress-{transaction_id}.sock"

                def create_placeholder(path: Path, mask: int) -> None:
                    previous = os.umask(mask)
                    try:
                        sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
                        try:
                            sock.bind(str(path))
                        finally:
                            sock.close()
                    finally:
                        os.umask(previous)

                # A crash before chmod/journal still leaves a safely formed
                # placeholder because preparation creates it with umask 0177.
                create_placeholder(alias, 0o177)
                self.assertEqual(alias.stat().st_mode & 0o777, 0o600)
                with (patch.object(unit_module, "EGRESS_SOCKET", source),
                      patch.object(unit_module, "EGRESS_SOURCE_ROOT", root),
                      patch.object(unit_module, "trusted_directory_chain"),
                      patch.object(unit_module, "trusted_socket"),
                      patch.object(unit_module, "identity", return_value=(1234, os.getgid())),
                      patch.object(unit_module, "_is_mountpoint", return_value=False)):
                    unit_module.recover_egress_source_alias(
                        alias, os.getgid(), transaction_id=transaction_id)
                    self.assertFalse(alias.exists())

                    bad_id = "e" * 32
                    malformed = root / f"baci-seed-egress-{bad_id}.sock"
                    create_placeholder(malformed, 0o111)
                    with self.assertRaisesRegex(SeedGenerationRejected,
                                                "placeholder is unsafe"):
                        unit_module.recover_egress_source_alias(
                            malformed, os.getgid(), transaction_id=bad_id)
                    self.assertTrue(malformed.exists())
            finally:
                listener.close()
        values["PrivateNetwork"] = "yes"
        values["RestrictAddressFamilies"] = "AF_INET6 AF_UNIX AF_INET"
        validate_active_unit(query, unit, uid, gid, **arguments)
        for address_families in (
                "AF_UNIX AF_INET AF_INET6 AF_RAW", "AF_UNIX AF_INET",
                "AF_UNIX AF_INET AF_INET6 AF_INET"):
            values["RestrictAddressFamilies"] = address_families
            with self.assertRaisesRegex(SeedGenerationRejected, "address-family policy"):
                validate_active_unit(query, unit, uid, gid, **arguments)

    def test_unit_name_is_transaction_fenced(self):
        with self.assertRaises(generation.SeedGenerationRejected):
            systemd_command(
                "baci-worker-seed-0123456789ab-untrusted.service", "0123456789ab",
                812, 812, source=Path("/source"), cache=Path("/cache"),
                store=Path("/store"), pnpm=Path("/pnpm"), node=Path("/node"),
                egress_source=EGRESS_SOURCE_ROOT / ("baci-seed-egress-" + "a" * 32 + ".sock"),
            )

    def test_pnpm_proxy_cannot_be_bypassed_by_inherited_no_proxy(self):
        env = proxy_environment({
            "NO_PROXY": "registry.npmjs.org,localhost", "no_proxy": "*",
            "npm_config_noproxy": "registry.npmjs.org", "SECRET_SHOULD_NOT_BE_ADDED": "x",
        })
        self.assertEqual(env["HTTPS_PROXY"], "http://127.0.0.1:3128")
        self.assertEqual(env["npm_config_https_proxy"], "http://127.0.0.1:3128")
        self.assertEqual(env["NO_PROXY"], "")
        self.assertEqual(env["no_proxy"], "")
        self.assertEqual(env["npm_config_noproxy"], "")
        # preverify builds its own child environment; the proxy wrapper preserves
        # only that bounded set and does not copy arbitrary ambient variables.
        self.assertNotIn("SECRET_SHOULD_NOT_BE_ADDED", proxy_environment(None))

    def test_generation_attestation_binds_identity_archive_source_and_drained_unit(self):
        identity = {
            "repository": "ogabasseyy/Baci", "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main", "sha": "a" * 40, "run_id": "19",
            "run_attempt": 2, "job_id": "27", "status": "in_progress",
        }
        attestation = generation.GenerationAttestation(
            schema=1, fence=identity, archive_sha256="b" * 64,
            source_tree_sha256="c" * 64,
            unit="baci-worker-seed-aaaaaaaaaaaa-" + "d" * 32 + ".service",
            unit_quiescence="systemd-collected-cgroup-and-uid-absence-proved",
            policy_receipt={"verification": "pnpm-online-frozen-install-passed"},
        ).as_dict()
        self.assertEqual(attestation["fence"], identity)
        self.assertEqual(attestation["archiveSha256"], "b" * 64)
        self.assertEqual(attestation["sourceTreeSha256"], "c" * 64)
        self.assertEqual(attestation["unitQuiescence"],
                         "systemd-collected-cgroup-and-uid-absence-proved")

    def test_attestation_rejects_wrong_source_fence_unit_or_policy_receipt(self):
        sha = "a" * 40
        receipt = {"sourceSha": sha, "verification": "pnpm-online-frozen-install-passed"}
        attestation = {
            "schema": 1,
            "fence": {
                "repository": "ogabasseyy/Baci",
                "workflow": ".github/workflows/production-release.yml",
                "ref": "refs/heads/main", "sha": sha, "run_id": "1",
                "run_attempt": 1, "job_id": "2", "status": "in_progress",
            },
            "archiveSha256": "b" * 64, "sourceTreeSha256": "c" * 64,
            "unit": f"baci-worker-seed-{sha[:12]}-{'d' * 32}.service",
            "unitQuiescence": "systemd-collected-cgroup-and-uid-absence-proved",
            "policyReceipt": receipt,
        }
        validate_generation_attestation(attestation, source_sha=sha,
                                        source_tree_sha256="c" * 64,
                                        policy_receipt=receipt)
        for field, value in (("sourceTreeSha256", "e" * 64),
                             ("unit", "baci-worker-seed-" + "f" * 12 + "-" + "d" * 32 + ".service")):
            changed = dict(attestation)
            changed[field] = value
            with self.assertRaises(SeedGenerationRejected):
                validate_generation_attestation(changed, source_sha=sha,
                                                source_tree_sha256="c" * 64,
                                                policy_receipt=receipt)
        with self.assertRaises(SeedGenerationRejected):
            validate_generation_attestation(attestation, source_sha=sha,
                                            source_tree_sha256="c" * 64,
                                            policy_receipt={"sourceSha": sha})


if __name__ == "__main__":
    unittest.main()

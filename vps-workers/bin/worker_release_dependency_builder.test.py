import importlib.util
import json
import os
import stat
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("worker_release_dependency_builder.py")
SPEC = importlib.util.spec_from_file_location("worker_release_dependency_builder", SCRIPT)
assert SPEC and SPEC.loader
builder = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(builder)
ARTIFACT_SPEC = importlib.util.spec_from_file_location(
    "worker_release_dependency_artifacts", SCRIPT.with_name("worker_release_dependency_artifacts.py")
)
assert ARTIFACT_SPEC and ARTIFACT_SPEC.loader
artifacts = importlib.util.module_from_spec(ARTIFACT_SPEC)
ARTIFACT_SPEC.loader.exec_module(artifacts)
FS_SPEC = importlib.util.spec_from_file_location(
    "worker_release_dependency_fs", SCRIPT.with_name("worker_release_dependency_fs.py")
)
assert FS_SPEC and FS_SPEC.loader
fs = importlib.util.module_from_spec(FS_SPEC)
FS_SPEC.loader.exec_module(fs)
SANDBOX_SPEC = importlib.util.spec_from_file_location(
    "worker_release_dependency_sandbox", SCRIPT.with_name("worker_release_dependency_sandbox.py")
)
assert SANDBOX_SPEC and SANDBOX_SPEC.loader
sandbox = importlib.util.module_from_spec(SANDBOX_SPEC)
SANDBOX_SPEC.loader.exec_module(sandbox)

SHA = "a" * 40


def make_source(root: Path) -> Path:
    source = root / "source"
    (source / "vps-workers").mkdir(parents=True)
    (source / ".baci-source-sha").write_text(SHA + "\n", encoding="ascii")
    (source / "pnpm-lock.yaml").write_text("lock\n", encoding="utf-8")
    (source / "vps-workers" / "pnpm-lock.yaml").write_text("workers lock\n", encoding="utf-8")
    return source


class DependencyBuilderTests(unittest.TestCase):
    def test_systemd_sandbox_uses_fixed_commands_and_blocks_worker_state(self):
        command = builder._systemd_command(Path("/input"), Path("/scratch"), SHA, 1234, 1234, "test.service")
        joined = " ".join(command)
        self.assertEqual(command[0], "/usr/bin/systemd-run")
        self.assertIn("--uid=1234", command)
        self.assertIn("--gid=1234", command)
        self.assertIn("ReadOnlyPaths=/input", joined)
        self.assertIn("ReadWritePaths=/scratch", joined)
        self.assertIn("InaccessiblePaths=/srv/baci-workers/runtime /srv/baci-workers/releases /srv/baci-workers/locks", joined)
        self.assertIn("ProtectSystem=strict", joined)
        self.assertIn("ProtectHome=true", joined)
        self.assertIn("NoNewPrivileges=true", joined)
        self.assertIn("PrivateUsers=true", joined)
        self.assertIn("KillMode=control-group", joined)
        self.assertIn("RuntimeMaxSec=300s", joined)
        self.assertIn("MemoryMax=2G", joined)
        self.assertIn("TasksMax=128", joined)
        self.assertIn("PrivateNetwork=true", joined)
        self.assertIn("PNPM_CONFIG_OFFLINE=true", joined)
        self.assertIn(f"ReadOnlyPaths={builder.PNPM_STORE}", joined)
        self.assertIn("PNPM_CONFIG_IGNORE_SCRIPTS=true", joined)
        self.assertNotIn("worker.env", joined)
        self.assertNotIn("GITHUB_TOKEN", joined)
        self.assertNotIn("GH_TOKEN", joined)

    def test_sandbox_installs_standalone_worker_dependencies_from_its_lockfile(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = root / "verified-source"
            source.mkdir()
            scratch = root / "scratch"
            scratch.mkdir()
            (scratch / "home").mkdir()
            calls = []

            def copy_source(_source, destination):
                (destination / "vps-workers").mkdir(parents=True)

            def run(command, *, cwd, **_kwargs):
                calls.append((tuple(command), Path(cwd)))
                if command == (sandbox.PNPM, "--version"):
                    return type("Result", (), {"stdout": sandbox.EXPECTED_PNPM + "\n"})()
                if command[1:3] == ("install", "--prod"):
                    self.assertEqual(Path(cwd), scratch / "source" / "vps-workers")
                    (Path(cwd) / "node_modules").mkdir()
                return type("Result", (), {"stdout": ""})()

            with patch.dict(os.environ, {"HOME": str(scratch / "home")}), \
                 patch.object(sandbox, "copy_source_tree", side_effect=copy_source), \
                 patch.object(sandbox.subprocess, "run", side_effect=run), \
                 patch.object(sandbox, "verify_runtime_candidates", return_value={
                     "web_tsx": "passed", "worker_dotenv": "passed"
                 }), patch.object(sandbox, "write_smoke_evidence"):
                sandbox.run_sandbox_worker(source, scratch, SHA)

            worker_install, worker_cwd = calls[2]
            self.assertEqual(worker_cwd, scratch / "source" / "vps-workers")
            self.assertEqual(worker_install[:3], (sandbox.PNPM, "install", "--prod"))
            for required in ("--frozen-lockfile", "--ignore-scripts", "--offline", "--store-dir"):
                self.assertIn(required, worker_install)
            self.assertTrue((scratch / "payload" / "root" / "node_modules").is_dir())

    def test_manifest_hashes_files_but_marks_symlinks_as_unapproved(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            (payload / "web").mkdir(parents=True)
            (payload / "web" / "package.json").write_text("{}", encoding="utf-8")
            (payload / "web" / "alias").symlink_to("package.json")
            manifest = artifacts.payload_manifest(
                payload, SHA, {"pnpm-lock.yaml": "f" * 64}, {"web_tsx": "passed", "worker_dotenv": "passed"}
            )
            self.assertFalse(manifest["runtime_ready"])
            self.assertFalse(manifest["exact_sha_provenance_verified"])
            self.assertEqual(manifest["source_provenance"], "broker-attestation-required")
            self.assertEqual(manifest["symlink_validation"], "portable-contained")
            entries = {item["path"]: item for item in manifest["entries"]}
            self.assertEqual(entries["web/alias"]["kind"], "symlink")
            self.assertEqual(entries["web/alias"]["target"], "package.json")
            self.assertRegex(entries["web/package.json"]["sha256"], r"^[0-9a-f]{64}$")

    def test_manifest_rejects_missing_runtime_smoke_evidence(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            payload.mkdir()
            with self.assertRaisesRegex(artifacts.BuilderRejected, "smoke evidence"):
                artifacts.payload_manifest(payload, SHA, {}, {})

    def test_manifest_rejects_special_files_and_payload_escape_type(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            payload.mkdir()
            fifo = payload / "named-pipe"
            os.mkfifo(fifo)
            with self.assertRaisesRegex(artifacts.BuilderRejected, "special file"):
                artifacts.validate_payload(payload)

    def test_symlink_targets_must_resolve_inside_candidate_root(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            target = payload / "web" / "node_modules" / "tsx" / "dist"
            target.mkdir(parents=True)
            cli = target / "cli.mjs"
            cli.write_text("export {};", encoding="utf-8")
            binary_dir = payload / "web" / "node_modules" / ".bin"
            binary_dir.mkdir()
            link = binary_dir / "tsx"
            link.symlink_to("../tsx/dist/cli.mjs")
            entries, _ = artifacts.validate_payload(payload)
            self.assertIn({"path": "web/node_modules/.bin/tsx", "kind": "symlink", "target": "../tsx/dist/cli.mjs"}, entries)
            link.unlink()
            link.symlink_to("../../../../../../outside")
            with self.assertRaisesRegex(artifacts.BuilderRejected, "escapes payload"):
                artifacts.validate_payload(payload)

    def test_symlink_rejects_absolute_broken_and_cyclic_targets(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            payload.mkdir()
            link = payload / "link"
            link.symlink_to("/etc/passwd")
            with self.assertRaisesRegex(artifacts.BuilderRejected, "non-portable symlink"):
                artifacts.validate_payload(payload)
            link.unlink()
            link.symlink_to("missing")
            with self.assertRaisesRegex(artifacts.BuilderRejected, "broken, cyclic"):
                artifacts.validate_payload(payload)
            link.unlink()
            (payload / "other").symlink_to("link")
            link.symlink_to("other")
            with self.assertRaisesRegex(artifacts.BuilderRejected, "broken, cyclic"):
                artifacts.validate_payload(payload)

    def test_payload_bounds_fail_closed(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            payload.mkdir()
            (payload / "oversized").write_bytes(b"0123456789")
            with patch.object(artifacts, "MAX_PAYLOAD_BYTES", 5):
                with self.assertRaisesRegex(artifacts.BuilderRejected, "exceeds size limit"):
                    artifacts.validate_payload(payload)
            (payload / "oversized").unlink()
            (payload / "one").touch()
            (payload / "two").touch()
            with patch.object(artifacts, "MAX_ENTRIES", 1):
                with self.assertRaisesRegex(artifacts.BuilderRejected, "too many entries"):
                    artifacts.validate_payload(payload)

    def test_payload_rejects_hardlinks_to_outside_artifact(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            payload = root / "payload"
            payload.mkdir()
            external = root / "external"
            external.write_text("shared", encoding="utf-8")
            os.link(external, payload / "linked")
            with self.assertRaisesRegex(artifacts.BuilderRejected, "hardlinked file"):
                artifacts.validate_payload(payload)

    def test_payload_rejects_set_id_and_world_writable_modes(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            payload.mkdir()
            unsafe = payload / "unsafe"
            unsafe.write_text("no", encoding="utf-8")
            unsafe.chmod(0o4777)
            with self.assertRaisesRegex(artifacts.BuilderRejected, "unsafe write or set-id bits"):
                artifacts.validate_payload(payload)

    def test_snapshot_copies_candidate_into_immutable_root_owned_tree(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            payload = scratch / "payload"
            target = payload / "web" / "tsx" / "cli.mjs"
            target.parent.mkdir(parents=True)
            target.write_text("export const version = 1;", encoding="utf-8")
            binary = payload / "web" / ".bin"
            binary.mkdir()
            (binary / "tsx").symlink_to("../tsx/cli.mjs")
            result = root / "result"
            result.mkdir(mode=0o700)
            snapshot = fs.snapshot_payload(scratch, result, os.getuid())
            copied = snapshot / "web" / "tsx" / "cli.mjs"
            original_hash = artifacts.sha256_file(copied)
            target.write_text("mutated after build", encoding="utf-8")
            self.assertEqual(artifacts.sha256_file(copied), original_hash)
            self.assertEqual(stat.S_IMODE(copied.stat().st_mode), 0o440)
            self.assertEqual(os.readlink(snapshot / "web" / ".bin" / "tsx"), "../tsx/cli.mjs")

    def test_snapshot_rejects_escape_symlink_without_touching_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            payload = scratch / "payload"
            payload.mkdir(mode=0o700)
            sentinel = root / "sentinel"
            sentinel.write_text("unchanged", encoding="utf-8")
            (payload / "escape").symlink_to(sentinel)
            result = root / "result"
            result.mkdir(mode=0o700)
            with self.assertRaisesRegex(fs.BuilderRejected, "non-portable symlink"):
                fs.snapshot_payload(scratch, result, os.getuid())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")

    def test_smoke_symlink_never_reads_or_overwrites_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            sentinel = root / "sentinel"
            sentinel.write_text("unchanged", encoding="utf-8")
            (scratch / fs.SMOKE_NAME).symlink_to(sentinel)
            with self.assertRaisesRegex(fs.BuilderRejected, "safe regular inode"):
                fs.read_smoke_evidence(scratch, os.getuid())
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")

    def test_manifest_creation_refuses_symlink_destination(self):
        with tempfile.TemporaryDirectory() as temporary:
            result = Path(temporary) / "result"
            result.mkdir(mode=0o700)
            sentinel = Path(temporary) / "sentinel"
            sentinel.write_text("unchanged", encoding="utf-8")
            (result / artifacts.MANIFEST_NAME).symlink_to(sentinel)
            with self.assertRaisesRegex(fs.BuilderRejected, "already exists or is unsafe"):
                fs.write_manifest(result, {"safe": True})
            self.assertEqual(sentinel.read_text(encoding="utf-8"), "unchanged")

    def test_directory_usage_counts_links_without_following_them(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / "scratch"
            scratch.mkdir()
            outside = root / "outside"
            outside.write_bytes(b"x" * 10000)
            (scratch / "link").symlink_to(outside)
            entries, size = fs.directory_usage(scratch, max_entries=10, max_bytes=100)
            self.assertEqual(entries, 1)
            self.assertLess(size, 100)

    def test_runtime_verification_requires_tsx_and_dotenv_candidates(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary) / "payload"
            tsx_dir = payload / "web" / "node_modules" / "tsx"
            bin_dir = payload / "web" / "node_modules" / ".bin"
            dotenv = payload / "root" / "node_modules" / "dotenv"
            tsx_dir.mkdir(parents=True)
            bin_dir.mkdir()
            dotenv.mkdir(parents=True)
            cli = tsx_dir / "cli.mjs"
            cli.write_text("#!/usr/bin/env node\n", encoding="utf-8")
            cli.chmod(0o755)
            (bin_dir / "tsx").symlink_to("../tsx/cli.mjs")
            with patch.object(artifacts.subprocess, "run", return_value=type("Result", (), {"stdout": "tsx 4.22.4\n"})()) as run:
                checks = artifacts.verify_runtime_candidates(payload)
            self.assertEqual(checks, {"web_tsx": "passed", "worker_dotenv": "passed"})
            self.assertEqual(run.call_count, 2)
            self.assertEqual(run.call_args_list[0].args[0][-1], "--version")
            self.assertIn("import('dotenv')", run.call_args_list[1].args[0][-1])
            (dotenv).rmdir()
            with self.assertRaisesRegex(artifacts.BuilderRejected, "absent or escapes"):
                artifacts.verify_runtime_candidates(payload)

    def test_source_copy_excludes_dotenv_and_package_manager_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            (source / ".env.production").write_text("opaque", encoding="utf-8")
            (source / ".npmrc").write_text("opaque", encoding="utf-8")
            output = root / "copy"
            artifacts.copy_source_tree(source, output)
            self.assertFalse((output / ".env.production").exists())
            self.assertFalse((output / ".npmrc").exists())
            self.assertTrue((output / "pnpm-lock.yaml").exists())
            artifacts.make_read_only_input(output)
            self.assertEqual(stat.S_IMODE(output.stat().st_mode), 0o555)
            self.assertEqual(stat.S_IMODE((output / "pnpm-lock.yaml").stat().st_mode), 0o444)

    def test_source_copy_enforces_byte_and_entry_bounds(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            with self.assertRaisesRegex(artifacts.BuilderRejected, "exceeds size limit"):
                artifacts.copy_source_tree(source, root / "too-large", max_bytes=1)
            with self.assertRaisesRegex(artifacts.BuilderRejected, "too many entries"):
                artifacts.copy_source_tree(source, root / "too-many", max_entries=1)

    def test_source_requires_broker_sha_marker_and_both_lockfiles(self):
        with tempfile.TemporaryDirectory() as temporary:
            source = make_source(Path(temporary))
            self.assertEqual(builder._safe_source(source, SHA), source.resolve())
            (source / ".baci-source-sha").write_text("b" * 40, encoding="ascii")
            with self.assertRaisesRegex(builder.BuilderRejected, "SHA marker"):
                builder._safe_source(source, SHA)

    def test_builder_identity_rejects_lock_group_membership(self):
        fake_user = type("User", (), {"pw_gid": 77, "pw_uid": 1234})()
        fake_group = type("Group", (), {"gr_gid": 77})()
        lock_group = type("Group", (), {"gr_gid": 88})()
        with patch.object(builder.pwd, "getpwnam", return_value=fake_user), patch.object(
            builder.grp, "getgrnam", side_effect=[fake_group, lock_group]
        ), patch.object(builder.os, "getgrouplist", return_value=[77, 88]):
            with self.assertRaisesRegex(builder.BuilderRejected, "protected lock group"):
                builder._builder_identity()

    def test_build_invokes_only_sanitized_systemd_orchestration(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            build_root = root / "build-root"
            build_root.mkdir(mode=0o710)
            results = build_root / "results"
            results.mkdir(mode=0o700)
            fake_user = type("User", (), {"pw_gid": os.getgid(), "pw_uid": os.getuid()})()
            fake_worker = type("User", (), {"pw_gid": os.getgid(), "pw_uid": os.getuid() + 1})()
            fake_group = type("Group", (), {"gr_gid": os.getgid()})()
            lock_group = type("Group", (), {"gr_gid": os.getgid() + 1})()
            calls = []
            scratch_paths = []

            def runner(command, scratch, unit):
                calls.append((command, scratch, unit))
                scratch_paths.append(scratch)
                payload = scratch / "payload"
                (payload / "web").mkdir(parents=True)
                (payload / "web" / "node_modules.txt").write_text("candidate", encoding="utf-8")
                (payload / "root" / "node_modules").mkdir(parents=True)
                fs.write_smoke_evidence(scratch, {"web_tsx": "passed", "worker_dotenv": "passed"})

            lock_path = root / "test-lock"
            with patch.object(builder, "_validate_offline_store"), patch.object(builder, "_validate_build_roots"), patch.object(
                builder, "BUILD_ROOT", build_root
            ), patch.object(builder, "BUILD_INPUT_ROOT", build_root), patch.object(
                builder, "BUILD_RESULTS_ROOT", results
            ), patch.object(builder, "_is_root", return_value=True), patch.object(
                builder, "_acquire_build_lock", side_effect=lambda: os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            ), patch.object(
                builder.pwd, "getpwnam", side_effect=[fake_user, fake_worker]
            ), patch.object(builder.grp, "getgrnam", side_effect=[fake_group, lock_group]), patch.object(
                builder.os, "getgrouplist", return_value=[os.getgid()]
            ):
                manifest, result_dir = builder.build(str(source), SHA, runner=runner)
            self.assertEqual(len(calls), 1)
            command, scratch, unit = calls[0]
            self.assertEqual(command[0], "/usr/bin/systemd-run")
            worker_index = command.index("--sandbox-worker")
            source_copy = Path(command[worker_index + 1])
            self.assertNotIn(scratch, source_copy.parents)
            self.assertEqual(list(build_root.iterdir()), [results])
            self.assertFalse(scratch_paths[0].exists())
            self.assertFalse(manifest["runtime_ready"])
            self.assertEqual(manifest["source_provenance"], "broker-attestation-required")
            written = json.loads((result_dir / builder.MANIFEST_NAME).read_text(encoding="utf-8"))
            self.assertEqual(written["requested_commit_sha"], SHA)
            self.assertFalse(written["exact_sha_provenance_verified"])
            self.assertEqual(written["lockfiles"]["vps-workers/pnpm-lock.yaml"], artifacts.sha256_file(source / "vps-workers" / "pnpm-lock.yaml"))


if __name__ == "__main__":
    unittest.main()

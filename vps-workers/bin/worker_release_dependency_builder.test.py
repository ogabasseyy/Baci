import importlib.util
import json
import os
import shutil
import stat
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


def _bounded_run_adapter(fake_run):
    def invoke(command, **kwargs):
        try:
            result = fake_run(command, **kwargs, check=True, capture_output=True, text=True)
        except subprocess.CalledProcessError as error:
            result = error
        return subprocess.CompletedProcess(
            command, getattr(result, "returncode", 0),
            getattr(result, "stdout", None) or getattr(result, "output", None) or "",
            getattr(result, "stderr", None) or "",
        )
    return invoke


def _bounded_run_adapter_mock(results):
    remaining = iter(results)
    return lambda *_args, **_kwargs: _bounded_run_adapter(lambda *a, **k: next(remaining))(
        *_args, **_kwargs)


SCRIPT = Path(__file__).with_name("worker_release_dependency_builder.py")
sys.path.insert(0, str(SCRIPT.parents[1] / "tools" / "nonproduction-worker-release"))
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
POLICY_SPEC = importlib.util.spec_from_file_location(
    "worker_release_dependency_policy_cache", SCRIPT.with_name("worker_release_dependency_policy_cache.py")
)
assert POLICY_SPEC and POLICY_SPEC.loader
policy_cache = importlib.util.module_from_spec(POLICY_SPEC)
POLICY_SPEC.loader.exec_module(policy_cache)

SHA = "a" * 40


def make_source(root: Path) -> Path:
    source = root / "source"
    (source / "vps-workers").mkdir(parents=True)
    (source / ".baci-source-sha").write_text(SHA + "\n", encoding="ascii")
    (source / "pnpm-lock.yaml").write_text("lock\n", encoding="utf-8")
    (source / "vps-workers" / "pnpm-lock.yaml").write_text("workers lock\n", encoding="utf-8")
    return source


class DependencyBuilderTests(unittest.TestCase):
    def test_web_deploy_removes_only_verified_workspace_self_link(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            working = root / "source"
            package = working / "apps/web"
            package.mkdir(parents=True)
            (package / "package.json").write_text('{"name":"@baci/web"}\n', encoding="utf-8")
            output = root / "payload/web"
            link = output / "node_modules/.pnpm/node_modules/@baci/web"
            link.parent.mkdir(parents=True)
            link.symlink_to(os.path.relpath(package, link.parent), target_is_directory=True)

            sandbox.remove_workspace_self_link(output, working)
            self.assertFalse(link.exists())
            self.assertTrue(package.is_dir())

    def test_web_deploy_rejects_unexpected_workspace_self_link_target(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            working = root / "source"
            package = working / "apps/web"
            package.mkdir(parents=True)
            (package / "package.json").write_text('{"name":"@baci/web"}\n', encoding="utf-8")
            external = root / "attacker"
            external.mkdir()
            output = root / "payload/web"
            link = output / "node_modules/.pnpm/node_modules/@baci/web"
            link.parent.mkdir(parents=True)
            link.symlink_to(os.path.relpath(external, link.parent), target_is_directory=True)

            with self.assertRaisesRegex(sandbox.BuilderRejected, "unexpected target"):
                sandbox.remove_workspace_self_link(output, working)
            self.assertTrue(link.is_symlink())

    def test_web_deploy_self_link_cleanup_rejects_symlinked_parent(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            working = root / "source"
            (working / "apps/web").mkdir(parents=True)
            (working / "apps/web/package.json").write_text('{"name":"@baci/web"}\n', encoding="utf-8")
            external = root / "outside"
            (external / ".pnpm/node_modules/@baci").mkdir(parents=True)
            (external / ".pnpm/node_modules/@baci/web").symlink_to(working / "apps/web", target_is_directory=True)
            output = root / "payload/web"
            output.mkdir(parents=True)
            (output / "node_modules").symlink_to(external, target_is_directory=True)

            with self.assertRaisesRegex(sandbox.BuilderRejected, "parent is unsafe"):
                sandbox.remove_workspace_self_link(output, working)
            self.assertTrue((external / ".pnpm/node_modules/@baci/web").is_symlink())

    def test_web_deploy_self_link_cleanup_rejects_manifest_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            working = root / "source"
            package = working / "apps/web"
            package.mkdir(parents=True)
            external_manifest = root / "external-package.json"
            external_manifest.write_text('{"name":"@baci/web"}\n', encoding="utf-8")
            (package / "package.json").symlink_to(external_manifest)
            output = root / "payload/web"
            link = output / "node_modules/.pnpm/node_modules/@baci/web"
            link.parent.mkdir(parents=True)
            link.symlink_to(os.path.relpath(package, link.parent), target_is_directory=True)

            with self.assertRaisesRegex(sandbox.BuilderRejected, "package metadata is unavailable"):
                sandbox.remove_workspace_self_link(output, working)
            self.assertTrue(link.is_symlink())

    def test_systemd_sandbox_uses_fixed_commands_and_blocks_worker_state(self):
        command = builder._systemd_command(Path("/input"), Path("/scratch"), SHA, 1234, 1234, "test.service")
        joined = " ".join(command)
        self.assertEqual(command[0], "/usr/bin/systemd-run")
        self.assertIn("--uid=1234", command)
        self.assertIn("--gid=1234", command)
        self.assertIn("ReadOnlyPaths=/input", joined)
        self.assertIn("/pnpm-cache-seed", joined)
        self.assertIn(policy_cache.RECEIPT_NAME, joined)
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
        self.assertIn("PNPM_CONFIG_STORE_DIR=/scratch/pnpm-store", joined)
        self.assertIn("PNPM_CONFIG_CACHE_DIR=/scratch/pnpm-cache", joined)
        self.assertIn("PNPM_CONFIG_TRUST_LOCKFILE=false", joined)
        self.assertIn("PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES=false", joined)
        self.assertIn("PNPM_CONFIG_PACKAGE_IMPORT_METHOD=copy", joined)
        self.assertIn(f"PNPM_CONFIG_REGISTRY={policy_cache.TRUSTED_REGISTRY}", joined)
        self.assertNotIn(str(builder.PNPM_STORE), joined)
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
            (scratch / "pnpm-store").mkdir(mode=0o700)
            (scratch / "pnpm-cache").mkdir(mode=0o700)
            seed = root / "pnpm-cache-seed"
            seed.mkdir(mode=0o700)
            (seed / "metadata.json").write_text("verified seed", encoding="utf-8")
            seed.chmod(0o500)
            receipt_path = root / policy_cache.RECEIPT_NAME
            receipt_path.write_text("synthetic receipt", encoding="utf-8")
            receipt_path.chmod(0o400)
            sandbox_uid = os.geteuid() if os.geteuid() != 0 else 1234
            sandbox_gid = os.getgid() if os.geteuid() != 0 else 1234
            if os.geteuid() == 0:
                os.chown(scratch / "pnpm-store", sandbox_uid, sandbox_gid)
                os.chown(scratch / "pnpm-cache", sandbox_uid, sandbox_gid)
            calls = []
            injection_settings = []
            receipt_validations = []

            def copy_source(_source, destination):
                (destination / "vps-workers").mkdir(parents=True)
                (destination / "pnpm-lock.yaml").write_text("settings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
                (destination / "vps-workers/pnpm-lock.yaml").write_text("settings:\n  injectWorkspacePackages: false\n", encoding="utf-8")

            def run(command, *, cwd, **_kwargs):
                calls.append((tuple(command), Path(cwd)))
                injection_settings.append(_kwargs.get("env", {}).get("PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES"))
                if command == (sandbox.PNPM, "--version"):
                    return type("Result", (), {"stdout": sandbox.EXPECTED_PNPM + "\n"})()
                if "@baci/web..." in command:
                    (scratch / "pnpm-cache" / "metadata.json").write_text("pnpm mutable update", encoding="utf-8")
                if "deploy" in command:
                    return type("Result", (), {"stdout": "Deploying production dependencies", "stderr": ""})()
                if "@baci/web..." in command:
                    return type("Result", (), {
                        "stdout": "✓ Lockfile passes supply-chain policies (1 entry in 1ms)", "stderr": ""
                    })()
                if "install" in command and "--prod" in command:
                    self.assertEqual(Path(cwd), scratch / "source" / "vps-workers")
                    (Path(cwd) / "node_modules").mkdir()
                    return type("Result", (), {
                        "stdout": "", "stderr": "✓ Lockfile passes supply-chain policies (1 entry in 2ms)"
                    })()
                return type("Result", (), {"stdout": ""})()

            with patch.dict(os.environ, {"HOME": str(scratch / "home")}), \
                 patch.object(sandbox, "SEED_OWNER_UID", os.geteuid()), \
                 patch.object(sandbox.os, "geteuid", return_value=sandbox_uid), \
                 patch.object(sandbox.os, "getgid", return_value=sandbox_gid), \
                 patch.object(sandbox, "copy_source_tree", side_effect=copy_source), \
                 patch.object(sandbox, "run_bounded_capture", side_effect=_bounded_run_adapter(run)), \
                 patch.object(sandbox, "validate_receipt", side_effect=lambda *args, **kwargs: receipt_validations.append((args, kwargs))), \
                 patch.object(sandbox, "verify_runtime_candidates", return_value={
                     "web_tsx": "passed", "worker_dotenv": "passed"
                 }), patch.object(sandbox, "write_smoke_evidence"):
                sandbox.run_sandbox_worker(source, scratch, SHA)

            web_install, web_install_cwd = calls[1]
            self.assertEqual(web_install_cwd, scratch / "source")
            self.assertIn("install", web_install)
            self.assertIn("@baci/web...", web_install)
            self.assertIn("--frozen-lockfile", web_install)
            self.assertIn("--ignore-scripts", web_install)
            web_deploy, web_cwd = calls[2]
            self.assertEqual(web_cwd, scratch / "source")
            self.assertIn("deploy", web_deploy)
            self.assertNotIn("--legacy", web_deploy)
            self.assertIn("--frozen-lockfile", web_deploy)
            self.assertIn("--package-import-method=copy", web_deploy)
            self.assertIn("--registry", web_deploy)
            self.assertIn(policy_cache.TRUSTED_REGISTRY, web_deploy)
            self.assertIn("--store-dir", web_deploy)
            self.assertIn(str(scratch / "pnpm-store"), web_deploy)
            self.assertIn("--ignore-pnpmfile", web_deploy)
            worker_install, worker_cwd = calls[3]
            self.assertEqual(worker_cwd, scratch / "source" / "vps-workers")
            self.assertEqual(worker_install[:3], (sandbox.PNPM, "--registry", policy_cache.TRUSTED_REGISTRY))
            self.assertIn("install", worker_install)
            self.assertIn("--package-import-method=copy", worker_install)
            self.assertIn("--prod", worker_install)
            for required in ("--frozen-lockfile", "--ignore-scripts", "--ignore-pnpmfile", "--offline", "--store-dir"):
                self.assertIn(required, worker_install)
            self.assertIn(str(scratch / "pnpm-store"), worker_install)
            self.assertEqual(injection_settings[1:], ["false", "true", "false"])
            self.assertEqual((seed / "metadata.json").read_text(encoding="utf-8"), "verified seed")
            self.assertEqual((scratch / "pnpm-cache" / "metadata.json").read_text(encoding="utf-8"), "pnpm mutable update")
            self.assertEqual(len(receipt_validations), 2)
            for args, kwargs in receipt_validations:
                self.assertEqual(args[1], seed)
                self.assertEqual(args[2], receipt_path)
                self.assertEqual(kwargs["cache_owner_uid"], os.geteuid())
            self.assertFalse((seed / policy_cache.RECEIPT_NAME).exists())
            self.assertTrue((scratch / "payload" / "root" / "node_modules").is_dir())

    def test_private_offline_store_is_an_independent_writable_copy(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "shared-store"
            package = shared / "files" / "ab"
            package.mkdir(parents=True)
            content = package / "cli.mjs"
            external_link = root / "active-release-file"
            external_link.write_text("export {};", encoding="utf-8")
            os.link(external_link, content)
            content.chmod(0o555)
            scratch = root / "scratch"
            scratch.mkdir(mode=0o700)
            with (patch.object(builder, "PNPM_STORE", shared),
                  patch.object(builder, "_validate_offline_store",
                               return_value=((shared.stat().st_dev, shared.stat().st_ino), frozenset())) as validate):
                copy = builder._copy_private_offline_store(scratch, os.getuid(), os.getgid())

            cloned = copy / "files" / "ab" / "cli.mjs"
            self.assertEqual(validate.call_count, 1)
            self.assertEqual(cloned.read_text(encoding="utf-8"), "export {};")
            self.assertNotEqual(cloned.stat().st_ino, content.stat().st_ino)
            self.assertEqual(cloned.stat().st_nlink, 1)
            self.assertEqual(stat.S_IMODE(cloned.stat().st_mode), 0o700)
            self.assertEqual(stat.S_IMODE((copy / "files").stat().st_mode), 0o700)
            cloned.write_text("local mutation", encoding="utf-8")
            self.assertEqual(content.read_text(encoding="utf-8"), "export {};")
            self.assertEqual(external_link.read_text(encoding="utf-8"), "export {};")

    def test_offline_store_copy_obeys_the_scratch_byte_bound(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "shared-store"
            shared.mkdir()
            (shared / "large").write_bytes(b"123456")
            scratch = root / "scratch"
            scratch.mkdir()
            with (patch.object(builder, "PNPM_STORE", shared),
                  patch.object(builder, "_validate_offline_store",
                               return_value=((shared.stat().st_dev, shared.stat().st_ino), frozenset())),
                  patch.object(builder, "MAX_BUILD_SCRATCH_BYTES", 5)):
                with self.assertRaisesRegex(builder.BuilderRejected, "size limit"):
                    builder._copy_private_offline_store(scratch, os.getuid(), os.getgid())

    def test_offline_store_validation_rejects_root_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            target = root / "real-store"
            target.mkdir()
            link = root / "store-link"
            link.symlink_to(target, target_is_directory=True)
            with patch.object(builder, "PNPM_STORE", link):
                with self.assertRaisesRegex(builder.BuilderRejected, "ownership or mode") as raised:
                    builder._validate_offline_store(owner_uid=os.getuid())
            self.assertEqual(raised.exception.safe_subtype, "root-type")

    def test_offline_store_validation_rejects_untrusted_store_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary) / "store"
            store.mkdir()
            (store / "index.json").write_text("{}", encoding="utf-8")
            with patch.object(builder, "PNPM_STORE", store):
                with self.assertRaisesRegex(builder.BuilderRejected, "ownership or mode") as raised:
                    builder._validate_offline_store(owner_uid=os.getuid() + 1)
            self.assertEqual(raised.exception.safe_subtype, "root-owner-mode")

    @unittest.skipUnless(os.geteuid() == 0, "changing store entry ownership requires root")
    def test_offline_store_validation_rejects_untrusted_entry_owner(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary) / "store"
            store.mkdir()
            child = store / "index.json"
            child.write_text("{}", encoding="utf-8")
            os.chown(child, os.getuid() + 1234, os.getgid())
            with patch.object(builder, "PNPM_STORE", store):
                with self.assertRaisesRegex(builder.BuilderRejected, "untrusted entry") as raised:
                    builder._validate_offline_store(owner_uid=os.getuid())
            self.assertEqual(raised.exception.safe_subtype, "entry-owner-mode")

    def test_offline_store_validation_rejects_writable_modes_symlinks_and_specials(self):
        for case in ("root-mode", "child-mode", "symlink", "fifo"):
            with self.subTest(case=case), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                store = root / "store"
                store.mkdir()
                if case == "root-mode":
                    store.chmod(0o777)
                elif case == "child-mode":
                    child = store / "writable.json"
                    child.write_text("{}", encoding="utf-8")
                    child.chmod(0o666)
                elif case == "symlink":
                    (store / "link").symlink_to(root / "outside")
                else:
                    os.mkfifo(store / "pipe")
                expected = {
                    "root-mode": "root-owner-mode", "child-mode": "entry-owner-mode",
                    "symlink": "entry-symlink", "fifo": "entry-special",
                }[case]
                with patch.object(builder, "PNPM_STORE", store):
                    with self.assertRaises(builder.BuilderRejected) as raised:
                        builder._validate_offline_store(owner_uid=os.getuid())
                self.assertEqual(raised.exception.safe_subtype, expected)

    def test_offline_store_validation_reports_entry_and_size_limits(self):
        for limit_name in ("entry", "size"):
            with self.subTest(limit=limit_name), tempfile.TemporaryDirectory() as temporary:
                store = Path(temporary) / "store"
                store.mkdir()
                (store / "one").write_bytes(b"1234")
                (store / "two").write_bytes(b"5678")
                patches = [patch.object(builder, "PNPM_STORE", store)]
                if limit_name == "entry":
                    patches.append(patch.object(builder, "MAX_BUILD_SCRATCH_ENTRIES", 1))
                    expected = "entry-count-limit"
                else:
                    patches.append(patch.object(builder, "MAX_BUILD_SCRATCH_BYTES", 4))
                    expected = "entry-size-limit"
                with patches[0], patches[1]:
                    with self.assertRaises(builder.BuilderRejected) as raised:
                        builder._validate_offline_store(owner_uid=os.getuid())
                self.assertEqual(raised.exception.safe_subtype, expected)

    def test_offline_store_validation_excludes_only_pnpm_project_link_indexes(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "shared-store"
            project_links = shared / "v11" / "projects"
            package_files = shared / "v11" / "files"
            project_links.mkdir(parents=True)
            package_files.mkdir(parents=True)
            (project_links / "abcdef").symlink_to(root / "removed-seed-project", target_is_directory=True)
            (package_files / "package-content").write_text("content", encoding="utf-8")
            with patch.object(builder, "PNPM_STORE", shared):
                identity, excluded = builder._validate_offline_store(owner_uid=os.getuid())
            self.assertEqual(identity, (shared.stat().st_dev, shared.stat().st_ino))
            self.assertEqual(excluded, frozenset({"v11/projects"}))

            scratch = root / "scratch"
            scratch.mkdir()
            with (patch.object(builder, "PNPM_STORE", shared),
                  patch.object(builder, "_validate_offline_store",
                               return_value=((shared.stat().st_dev, shared.stat().st_ino), excluded))):
                private = builder._copy_private_offline_store(scratch, os.getuid(), os.getgid())
            self.assertFalse((private / "v11" / "projects").exists())
            self.assertEqual((private / "v11" / "files" / "package-content").read_text(), "content")

    def test_private_store_copy_rejects_root_replacement_after_validation(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            shared = root / "shared-store"
            shared.mkdir()
            (shared / "validated").write_text("trusted", encoding="utf-8")
            validated_identity = (shared.stat().st_dev, shared.stat().st_ino)
            replacement = root / "replacement"
            replacement.mkdir()
            (replacement / "unvalidated").write_text("must not copy", encoding="utf-8")
            scratch = root / "scratch"
            scratch.mkdir()

            def validate_then_replace():
                shared.rename(root / "validated-store")
                replacement.rename(shared)
                return validated_identity, frozenset()

            with (patch.object(builder, "PNPM_STORE", shared),
                  patch.object(builder, "_validate_offline_store", side_effect=validate_then_replace)):
                with self.assertRaisesRegex(builder.BuilderRejected, "root changed after validation"):
                    builder._copy_private_offline_store(scratch, os.getuid(), os.getgid())

            self.assertFalse((scratch / "pnpm-store").exists())

    def test_offline_store_validation_enforces_entry_and_byte_budgets(self):
        with tempfile.TemporaryDirectory() as temporary:
            store = Path(temporary) / "store"
            store.mkdir()
            (store / "one").write_bytes(b"123")
            (store / "two").write_bytes(b"456")
            with (patch.object(builder, "PNPM_STORE", store),
                  patch.object(builder, "MAX_BUILD_SCRATCH_ENTRIES", 1)):
                with self.assertRaisesRegex(builder.BuilderRejected, "too many entries"):
                    builder._validate_offline_store(owner_uid=os.getuid())
            with (patch.object(builder, "PNPM_STORE", store),
                  patch.object(builder, "MAX_BUILD_SCRATCH_BYTES", 5)):
                with self.assertRaisesRegex(builder.BuilderRejected, "size limit"):
                    builder._validate_offline_store(owner_uid=os.getuid())

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

    def test_policy_receipt_is_bound_to_exact_locks_policy_flags_and_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\ntrustLockfile: true\n", encoding="utf-8")
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            (cache / "metadata.json").write_text("verified registry metadata", encoding="utf-8")
            receipt = policy_cache.make_receipt(source, cache, "11.7.0")
            path = root / "receipt.json"
            path.write_text(json.dumps(receipt), encoding="utf-8")
            path.chmod(0o400)
            self.assertEqual(policy_cache.validate_receipt(source, cache, path), receipt)
            self.assertFalse(receipt["effectiveFlags"]["trustLockfile"])
            receipt["registryRouting"]["default"] = "https://registry.attacker.invalid/"
            path.chmod(0o600)
            path.write_text(json.dumps(receipt), encoding="utf-8")
            path.chmod(0o400)
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "exact lockfiles and policy"):
                policy_cache.validate_receipt(source, cache, path)
            receipt["registryRouting"]["default"] = policy_cache.TRUSTED_REGISTRY
            path.chmod(0o600)
            path.write_text(json.dumps(receipt), encoding="utf-8")
            path.chmod(0o400)
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "expected source SHA"):
                policy_cache.validate_receipt(source, cache, path, expected_sha="b" * 40)
            (source / "pnpm-lock.yaml").write_text("changed lock\n", encoding="utf-8")
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "exact lockfiles and policy"):
                policy_cache.validate_receipt(source, cache, path)
            (source / "pnpm-lock.yaml").write_text("lock\n", encoding="utf-8")
            (source / "pnpm-workspace.yaml").write_text("minimumReleaseAge: 60\n", encoding="utf-8")
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "exact lockfiles and policy"):
                policy_cache.validate_receipt(source, cache, path)

    def test_policy_receipt_rejects_metadata_cache_tampering(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            (cache / "metadata.json").write_text("trusted metadata", encoding="utf-8")
            receipt_path = root / "receipt.json"
            receipt_path.write_text(json.dumps(policy_cache.make_receipt(source, cache, "11.7.0")), encoding="utf-8")
            receipt_path.chmod(0o400)
            (cache / "metadata.json").write_text("changed metadata", encoding="utf-8")
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "metadata cache changed"):
                policy_cache.validate_receipt(source, cache, receipt_path)

    def test_writable_pnpm_cache_mutation_does_not_mutate_or_replace_verified_seed(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            seed = root / "pnpm-cache-seed"
            seed.mkdir(mode=0o700)
            (seed / "metadata.json").write_text("verified metadata", encoding="utf-8")
            receipt = root / "receipt.json"
            receipt.write_text(json.dumps(policy_cache.make_receipt(source, seed, "11.7.0")), encoding="utf-8")
            receipt.chmod(0o400)
            writable = root / "pnpm-cache"
            shutil.copytree(seed, writable)
            (writable / "metadata.json").write_text("pnpm's normal mutable cache update", encoding="utf-8")

            validated = policy_cache.validate_receipt(
                source, seed, receipt, owner_uid=os.geteuid(),
                cache_owner_uid=os.geteuid(), expected_sha=SHA,
            )
            self.assertEqual(validated["metadataCacheSha256"], policy_cache._hash_tree(seed))
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "metadata cache changed"):
                policy_cache.validate_receipt(
                    source, writable, receipt, owner_uid=os.geteuid(),
                    cache_owner_uid=os.geteuid(), expected_sha=SHA,
                )

    @unittest.skipUnless(os.geteuid() == 0, "seed receipt snapshot requires root-owned fixture inputs")
    def test_policy_seed_receipt_is_sibling_and_excluded_from_cache_digest(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            (cache / "metadata.json").write_text("verified metadata", encoding="utf-8")
            store = root / "store"
            store.mkdir(mode=0o700)
            receipt = store / policy_cache.RECEIPT_NAME
            receipt.write_text(json.dumps(policy_cache.make_receipt(source, cache, "11.7.0")), encoding="utf-8")
            receipt.chmod(0o400)
            input_root = root / "input"
            input_root.mkdir(mode=0o700)

            seed = builder._copy_policy_cache_seed(cache, receipt, input_root)

            self.assertFalse((seed / policy_cache.RECEIPT_NAME).exists())
            self.assertTrue((input_root / policy_cache.RECEIPT_NAME).is_file())
            self.assertEqual(policy_cache._hash_tree(seed), policy_cache.make_receipt(
                source, cache, "11.7.0"
            )["metadataCacheSha256"])
            validated = policy_cache.validate_receipt(
                source, seed, input_root / policy_cache.RECEIPT_NAME,
                owner_uid=0, cache_owner_uid=0, expected_sha=SHA,
            )
            self.assertEqual(validated["metadataCacheSha256"], policy_cache._hash_tree(seed))

    def test_policy_preverify_runs_both_lockfiles_with_scripts_and_trust_bypass_disabled(self):
        policy_source = SCRIPT.with_name("worker_release_dependency_policy_cache.py").read_text(encoding="utf-8")
        self.assertEqual(policy_source.count('"PNPM_CONFIG_FROZEN_LOCKFILE": "true"'), 1)
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\ntrustLockfile: true\n", encoding="utf-8")
            web_lock = source / "pnpm-lock.yaml"
            worker_lock = source / "vps-workers/pnpm-lock.yaml"
            web_lock.write_text("lockfileVersion: '9.0'\n\nsettings:\n  excludeLinksFromLockfile: false\n", encoding="utf-8")
            worker_lock.write_text("lockfileVersion: '9.0'\n\nsettings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
            original_locks = (web_lock.read_bytes(), worker_lock.read_bytes())
            (source / ".npmrc").write_text("# registry configuration is pinned by the fixture\n", encoding="utf-8")
            safe_npmrc = source / "apps/mobile-storefront/.npmrc"
            safe_npmrc.parent.mkdir(parents=True, exist_ok=True)
            safe_npmrc.write_text("legacy-peer-deps=true\nengine-strict=false\n", encoding="utf-8")
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            calls = []

            def run(command, **kwargs):
                calls.append((tuple(command), kwargs))
                if command[-1] == "--version":
                    return type("Result", (), {"stdout": "11.7.0\n"})()
                (cache / "registry-metadata.json").write_text("verified", encoding="utf-8")
                marker = "✓ Lockfile passes supply-chain policies (1 entry in 2ms)"
                if "deploy" in command:
                    return type("Result", (), {"stdout": "Deploying production dependencies", "stderr": ""})()
                return (type("Result", (), {"stdout": "", "stderr": marker})()
                        if len(calls) == 2 else type("Result", (), {"stdout": marker, "stderr": ""})())

            with patch("worker_release_pnpm_exec.run_bounded_capture",
                       side_effect=_bounded_run_adapter(run)):
                policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            checks = [call for call in calls if "install" in call[0] or "deploy" in call[0]]
            self.assertEqual(len(checks), 3)
            for command, kwargs in checks:
                self.assertEqual(command[0], "/usr/bin/node")
                self.assertEqual(command[1], "/fixed/pnpm")
                self.assertEqual(kwargs["env"]["PNPM_CONFIG_FROZEN_LOCKFILE"], "true")
                self.assertIn("/usr/bin", kwargs["env"]["PATH"].split(":"))
                if "install" in command:
                    self.assertIn("--frozen-lockfile", command)
                    self.assertIn("--package-import-method=copy", command)
                    if "@baci/web..." in command:
                        self.assertIn("--prod", command)
                    else:
                        self.assertEqual(kwargs["cwd"], source / "vps-workers")
                if "deploy" in command:
                    self.assertIn("--frozen-lockfile", command)
                    self.assertNotIn("--legacy", command)
                    self.assertIn("@baci/web", command)
                    self.assertNotIn("@baci/web...", command)
                self.assertIn("--ignore-scripts", command)
                self.assertIn("--ignore-pnpmfile", command)
                self.assertNotIn("--config.trust-lockfile=true", command)
                self.assertEqual(kwargs["env"]["PNPM_CONFIG_TRUST_LOCKFILE"], "false")
                expected_injection = ("true" if "deploy" in command else "false")
                self.assertEqual(kwargs["env"]["PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES"], expected_injection)
                self.assertEqual(kwargs["env"]["PNPM_CONFIG_PACKAGE_IMPORT_METHOD"], "copy")
                self.assertIn("--registry", command)
                registry_index = command.index("--registry")
                self.assertEqual(command[registry_index + 1], policy_cache.TRUSTED_REGISTRY)
                self.assertEqual(kwargs["env"]["PNPM_CONFIG_REGISTRY"], policy_cache.TRUSTED_REGISTRY)
                self.assertEqual(kwargs["env"]["npm_config_registry"], policy_cache.TRUSTED_REGISTRY)
            receipt = store / policy_cache.RECEIPT_NAME
            self.assertTrue(receipt.is_file())
            validated = policy_cache.validate_receipt(source, cache, receipt)
            self.assertEqual(validated["effectiveFlags"], policy_cache.POLICY_FLAGS)
            self.assertEqual(validated["effectiveFlags"]["injectWorkspacePackages"], "per-lockfile-setting")
            self.assertTrue(validated["effectiveFlags"]["deployInjectWorkspacePackages"])
            self.assertEqual(validated["lockInjectionSettings"], {
                "pnpm-lock.yaml": False,
                "vps-workers/pnpm-lock.yaml": False,
            })
            self.assertEqual((web_lock.read_bytes(), worker_lock.read_bytes()), original_locks)
            self.assertFalse(validated["effectiveFlags"]["trustLockfile"])
            self.assertEqual(validated["registryRouting"], {"default": policy_cache.TRUSTED_REGISTRY, "scoped": "none"})

    def test_policy_preverify_rejects_and_does_not_receipt_a_mutated_lockfile(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            web_lock = source / "pnpm-lock.yaml"
            web_lock.write_text("lockfileVersion: '9.0'\nsettings:\n  injectWorkspacePackages: false\n", encoding="utf-8")
            original = web_lock.read_bytes()
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            calls = 0

            def run(command, **_kwargs):
                nonlocal calls
                calls += 1
                if command[-1] == "--version":
                    return type("Result", (), {"stdout": "11.7.0\n"})()
                (cache / "registry-metadata.json").write_text("verified", encoding="utf-8")
                if "@baci/web..." in command:
                    web_lock.write_bytes(original + b"# mutation\n")
                return type("Result", (), {
                    "stdout": "✓ Lockfile passes supply-chain policies (1 entry in 2ms)",
                    "stderr": "",
                })()

            with patch.object(policy_cache, "run_pnpm_checked", side_effect=run):
                with self.assertRaisesRegex(policy_cache.BuilderRejected, "changed a lockfile or policy"):
                    policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            self.assertNotEqual(web_lock.read_bytes(), original)
            self.assertFalse((store / policy_cache.RECEIPT_NAME).exists())

    def test_preverify_rejects_archive_owned_registry_overrides(self):
        for relative, content in (
            (".npmrc", "@attacker:registry=https://registry.attacker.invalid/\n"),
            (".npmrc", "strict-ssl=false\n"),
            (".npmrc", "//registry.npmjs.org/:_authToken=${TOKEN}\n"),
            ("pnpm-workspace.yaml", "registries:\n  https://registry.attacker.invalid/:\n    scopes: ['@attacker']\n"),
            ("pnpm-workspace.yaml", "nested:\n  'registry': https://registry.attacker.invalid/\n"),
            ("pnpm-workspace.yaml", "packages: [{name: fixture, registries: {https://registry.attacker.invalid/: {scopes: ['@attacker']}}}]\n"),
            ("pnpm-workspace.yaml", "routing: \"regist\\u0072y\"\n"),
        ):
            with self.subTest(relative=relative), tempfile.TemporaryDirectory() as temporary:
                root = Path(temporary)
                source = make_source(root)
                for policy_path in policy_cache.POLICY_FILES:
                    (source / policy_path).parent.mkdir(parents=True, exist_ok=True)
                    (source / policy_path).write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
                (source / relative).write_text(content, encoding="utf-8")
                store = root / "store"
                store.mkdir()
                cache = root / "cache"
                cache.mkdir()
                with patch("worker_release_pnpm_exec.run_bounded_capture") as run:
                    with self.assertRaisesRegex(policy_cache.BuilderRejected, "source"):
                        policy_cache.preverify(source, store, cache, "/fixed/pnpm")
                    run.assert_not_called()

    def test_policy_preverify_refuses_when_pnpm_did_not_report_policy_pass(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir()
            with patch("worker_release_pnpm_exec.run_bounded_capture", side_effect=_bounded_run_adapter_mock([
                type("Result", (), {"stdout": "11.7.0\n"})(),
                type("Result", (), {"stdout": "progress: Lockfile passes supply-chain policies (message text only)"})(),
            ])):
                with self.assertRaises(policy_cache.BuilderRejected) as raised:
                    policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            self.assertEqual(raised.exception.safe_stage, "preverify-web-install")
            self.assertEqual(raised.exception.safe_category, "policy-pass-marker-missing")
            self.assertEqual(raised.exception.exit_code, 0)
            self.assertFalse((store / policy_cache.RECEIPT_NAME).exists())

    def test_online_preverification_requires_empty_metadata_cache(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            (cache / "old-verification-cache").write_text("stale", encoding="utf-8")
            with patch.object(policy_cache, "run_pnpm_checked") as run:
                with self.assertRaisesRegex(policy_cache.BuilderRejected, "fresh empty metadata cache"):
                    policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            run.assert_not_called()

    def test_policy_pass_marker_on_stderr_is_still_checked_without_relaxing_marker(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            result = lambda stdout, stderr="": type("Result", (), {"stdout": stdout, "stderr": stderr})()
            with patch("worker_release_pnpm_exec.run_bounded_capture", side_effect=_bounded_run_adapter_mock([
                result("11.7.0\n"), result("", "✓ Lockfile passes supply-chain policies (1 entry in 1ms)"),
                result("Deploying production dependencies"), result("✓ Lockfile passes supply-chain policies (2 entries in 2ms)"),
            ])):
                policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            self.assertTrue((store / policy_cache.RECEIPT_NAME).is_file())

    def test_policy_preverify_reports_fixed_stage_and_category_without_raw_output(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source = make_source(root)
            for relative in policy_cache.POLICY_FILES:
                path = source / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text("minimumReleaseAge: 1440\ntrustPolicy: no-downgrade\n", encoding="utf-8")
            store = root / "store"
            store.mkdir()
            cache = root / "cache"
            cache.mkdir()
            failure = subprocess.CalledProcessError(
                1, ["synthetic"], output="synthetic credential marker", stderr="ECONNRESET synthetic-private-token"
            )
            with patch("worker_release_pnpm_exec.run_bounded_capture", side_effect=_bounded_run_adapter_mock([
                type("Result", (), {"stdout": "11.7.0\n"})(), failure,
            ])):
                with self.assertRaises(policy_cache.BuilderRejected) as caught:
                    policy_cache.preverify(source, store, cache, "/fixed/pnpm")
            self.assertEqual(caught.exception.safe_stage, "preverify-web-install")
            self.assertEqual(caught.exception.safe_category, "registry-network")
            self.assertEqual(caught.exception.exit_code, 1)
            self.assertNotIn("synthetic-private-token", str(caught.exception))
            self.assertNotIn("synthetic credential marker", str(caught.exception))
            self.assertFalse((store / policy_cache.RECEIPT_NAME).exists())

    def test_trust_downgrade_has_specific_redacted_category(self):
        from worker_release_dependency_diagnostics import pnpm_failure_category

        output = 'ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for "@fixture/pkg@1.2.3" private-token'
        self.assertEqual(pnpm_failure_category(output), "lockfile-trust-downgrade")
        self.assertNotIn("private-token", pnpm_failure_category(output))

    def test_policy_cache_hash_rejects_links_and_writable_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            cache = root / "cache"
            cache.mkdir(mode=0o700)
            target = root / "target"
            target.write_text("metadata", encoding="utf-8")
            (cache / "link").symlink_to(target)
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "unsafe file"):
                policy_cache._hash_tree(cache)
            (cache / "link").unlink()
            entry = cache / "entry.json"
            entry.write_text("metadata", encoding="utf-8")
            entry.chmod(0o666)
            with self.assertRaisesRegex(policy_cache.BuilderRejected, "unsafe file"):
                policy_cache._hash_tree(cache)

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
            store = root / "store"
            store.mkdir()
            (store / "package-index.json").write_text("{}", encoding="utf-8")
            build_root = root / "build-root"
            build_root.mkdir(mode=0o710)
            results = build_root / "results"
            results.mkdir(mode=0o700)
            fake_gid = os.getgid() if os.geteuid() != 0 else 1234
            fake_uid = os.getuid() if os.geteuid() != 0 else 1234
            fake_user = type("User", (), {"pw_gid": fake_gid, "pw_uid": fake_uid})()
            fake_worker = type("User", (), {"pw_gid": fake_gid, "pw_uid": fake_uid + 1})()
            fake_group = type("Group", (), {"gr_gid": fake_gid})()
            lock_group = type("Group", (), {"gr_gid": fake_gid + 1})()
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

            def make_seed(_source, _sha, scratch, input_copy, uid, gid):
                seed = input_copy / "pnpm-cache-seed"
                seed.mkdir(mode=0o500)
                (scratch / "pnpm-store").mkdir(mode=0o700)
                (scratch / "pnpm-cache").mkdir(mode=0o700)
                return seed

            lock_path = root / "test-lock"
            with patch.object(builder, "_validate_offline_store",
                              return_value=((store.stat().st_dev, store.stat().st_ino), frozenset())), patch.object(
                builder, "_validate_build_roots"
            ), patch.object(
                builder, "BUILD_ROOT", build_root
            ), patch.object(builder, "BUILD_INPUT_ROOT", build_root), patch.object(
                builder, "BUILD_RESULTS_ROOT", results
            ), patch.object(builder, "PNPM_STORE", store
            ), patch.object(builder, "PNPM_CACHE", root / "policy-cache"
            ), patch.object(builder, "validate_receipt"
            ), patch.object(builder, "_consume_authenticated_seed", side_effect=make_seed
            ), patch.object(builder, "_is_root", return_value=True), patch.object(
                builder, "_acquire_build_lock", side_effect=lambda: os.open(lock_path, os.O_CREAT | os.O_RDWR, 0o600)
            ), patch.object(
                builder.pwd, "getpwnam", side_effect=[fake_user, fake_worker]
            ), patch.object(builder.grp, "getgrnam", side_effect=[fake_group, lock_group]), patch.object(
                builder.os, "getgrouplist", return_value=[fake_gid]
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

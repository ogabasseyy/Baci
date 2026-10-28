import importlib.util
import io
import json
import os
import stat
import tarfile
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch


SCRIPT = Path(__file__).with_name("migrate-baci-release-runner.py")
SPEC = importlib.util.spec_from_file_location("migrate_baci_release_runner", SCRIPT)
assert SPEC and SPEC.loader
migration = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(migration)


def make_archive(path: Path, members=None):
    entries = members or {
        "config.sh": (b"#!/bin/sh\n", 0o755),
        "run.sh": (b"#!/bin/sh\n", 0o755),
        "runsvc.sh": (b"#!/bin/sh\n", 0o755),
        "bin/Runner.Listener": (b"runner", 0o755),
    }
    with tarfile.open(path, "w:gz") as archive:
        for name, (content, mode) in entries.items():
            info = tarfile.TarInfo(name)
            info.size = len(content)
            info.mode = mode
            archive.addfile(info, io.BytesIO(content))


class FakeResponse:
    def __init__(self, body, status):
        self.body = body
        self.status = status

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        return None

    def read(self, size=-1):
        return self.body[:size]


class MigrateBaciReleaseRunnerTests(unittest.TestCase):
    def test_uses_reviewed_linux_x64_runner_artifact_pin(self):
        version, url, digest = migration.runner_artifact()
        self.assertEqual(version, "2.335.1")
        self.assertIn(f"actions-runner-linux-x64-{version}.tar.gz", url)
        self.assertEqual(len(digest), 64)

    def test_registration_uses_only_the_isolated_custom_label(self):
        valid = ["--labels", "baci-release", "--no-default-labels"]
        migration.validate_registration_is_isolated(valid)
        for bad in (
            ["--labels", "baci-deploy", "--no-default-labels"],
            ["--labels", "baci-release,baci-deploy", "--no-default-labels"],
            ["--labels", "baci-release"],
            ["--labels", "baci-release", "--no-default-labels", "--replace"],
        ):
            with self.subTest(args=bad), self.assertRaisesRegex(RuntimeError, "runner registration|runner migration"):
                migration.validate_registration_is_isolated(bad)

    def test_requires_the_dedicated_os_identity_and_private_home(self):
        migration.validate_release_account(uid=2202, username="baci-release", home=Path("/home/baci-release"), groups=["baci-release"])
        for fields in (
            {"uid": 2202, "username": "bassey", "home": Path("/home/bassey"), "groups": ["bassey"]},
            {"uid": 0, "username": "baci-release", "home": Path("/home/baci-release"), "groups": ["baci-release"]},
            {"uid": 2202, "username": "baci-release", "home": Path("/home/baci-release"), "groups": ["baci-release", "docker"]},
        ):
            with self.subTest(fields=fields), self.assertRaises(RuntimeError):
                migration.validate_release_account(**fields)

    def test_extracts_expected_runner_files_and_rejects_escaping_archive_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            archive = base / "runner.tar.gz"
            target = base / "runner"
            make_archive(archive)
            migration.extract_runner_archive(archive, target)
            self.assertTrue((target / "bin/Runner.Listener").is_file())
            self.assertTrue(os.access(target / "config.sh", os.X_OK))
            self.assertEqual(stat.S_IMODE((target / "config.sh").stat().st_mode), 0o755)

            bad_archive = base / "bad.tar.gz"
            make_archive(bad_archive, {"../escape": (b"bad", 0o600)})
            with self.assertRaisesRegex(RuntimeError, "unsafe path"):
                migration.extract_runner_archive(bad_archive, base / "bad-runner")
            self.assertFalse((base / "escape").exists())

    def test_rejects_escaping_and_parent_symlink_archive_entries(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            archive = base / "runner.tar.gz"
            with tarfile.open(archive, "w:gz") as tar:
                for name, link in (("outside", "../../outside"),):
                    info = tarfile.TarInfo(name)
                    info.type = tarfile.SYMTYPE
                    info.linkname = link
                    tar.addfile(info)
            with tarfile.open(archive, "r:gz") as tar, self.assertRaisesRegex(RuntimeError, "symlink escapes"):
                migration.validate_archive_members(tar)

            with tarfile.open(archive, "w:gz") as tar:
                link = tarfile.TarInfo("bin")
                link.type = tarfile.SYMTYPE
                link.linkname = "real-bin"
                tar.addfile(link)
                real_dir = tarfile.TarInfo("real-bin")
                real_dir.type = tarfile.DIRTYPE
                tar.addfile(real_dir)
                child = tarfile.TarInfo("bin/Runner.Listener")
                child.size = 1
                tar.addfile(child, io.BytesIO(b"x"))
            with tarfile.open(archive, "r:gz") as tar, self.assertRaisesRegex(RuntimeError, "below a symlink"):
                migration.validate_archive_members(tar)

    def test_registration_token_request_is_bounded_and_does_not_return_response_body_on_error(self):
        seen = []

        def opener(request, timeout):
            seen.append((request.full_url, request.method, request.get_header("Authorization"), timeout))
            return FakeResponse(json.dumps({"token": "short-lived"}).encode(), 201)

        token = migration.request_github_runner_token("registration-token", "admin-secret", opener=opener)
        self.assertEqual(token, "short-lived")
        self.assertEqual(seen, [("https://api.github.com/repos/ogabasseyy/Baci/actions/runners/registration-token", "POST", "Bearer admin-secret", 15)])
        with self.assertRaisesRegex(RuntimeError, "token request failed"):
            migration.request_github_runner_token(
                "remove-token", "admin-secret", opener=lambda *_args, **_kwargs: (_ for _ in ()).throw(OSError("sensitive response"))
            )

    def test_runner_registration_verifier_rejects_default_or_shared_labels(self):
        correct = {"runners": [{"name": migration.RUNNER_NAME, "labels": [{"name": "baci-release"}]}]}
        self.assertIsNone(migration.verify_github_runner_registration("admin", opener=lambda *_a, **_k: FakeResponse(json.dumps(correct).encode(), 200)))
        wrong = {"runners": [{"name": migration.RUNNER_NAME, "labels": [{"name": "self-hosted"}, {"name": "baci-release"}]}]}
        with self.assertRaisesRegex(RuntimeError, "labels are not isolated"):
            migration.verify_github_runner_registration("admin", opener=lambda *_a, **_k: FakeResponse(json.dumps(wrong).encode(), 200))

    def test_local_registration_requires_private_release_owned_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            home = Path(temporary)
            runner_root = home / "actions-runner"
            runner_root.mkdir()
            with patch.object(migration, "RUNNER_ROOT", runner_root):
                for name in (".runner", ".credentials"):
                    path = runner_root / name
                    path.write_text("credential fixture", encoding="utf-8")
                    os.chmod(path, 0o600)
                migration._verify_local_registration(os.getuid())
                os.chmod(runner_root / ".credentials", 0o644)
                with self.assertRaisesRegex(RuntimeError, "ownership or mode is unsafe"):
                    migration._verify_local_registration(os.getuid())

    def _prepare_apply_fixture(self, base: Path):
        home = base / "baci-release"
        home.mkdir(mode=0o700)
        os.chmod(home, 0o700)
        old_runner = base / "legacy" / "actions-runner"
        old_runner.mkdir(parents=True)
        (old_runner / "keep.txt").write_text("legacy stays", encoding="utf-8")
        archive = base / "runner.tar.gz"
        make_archive(archive)
        verifier = base / "verify-isolation.sh"
        verifier.write_text("#!/bin/sh\n", encoding="utf-8")
        return home, old_runner, archive, verifier

    def _patch_apply_host(self, home: Path):
        account = SimpleNamespace(pw_uid=os.getuid(), pw_gid=os.getgid(), pw_name="baci-release", pw_dir=str(home), pw_shell="/usr/sbin/nologin")
        return (
            patch.object(migration.os, "geteuid", return_value=0),
            patch.object(migration.pwd, "getpwnam", return_value=account),
            patch.object(migration.os, "getgrouplist", return_value=[os.getgid()]),
            patch.object(migration.grp, "getgrgid", return_value=SimpleNamespace(gr_name="baci-release")),
            patch.object(migration, "RUNNER_HOME", home),
            patch.object(migration, "RUNNER_ROOT", home / "actions-runner"),
        )

    def test_adds_dedicated_runner_without_touching_legacy_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") for arg in command):
                    for name in (".runner", ".credentials"):
                        artifact = home / "actions-runner" / name
                        artifact.write_text("mocked private runner state", encoding="utf-8")
                        os.chmod(artifact, 0o600)
                if "install" in command:
                    (service_dir / "actions.runner.ogabasseyy-Baci.baci-release-01.service").write_text(
                        "[Service]\nUser=baci-release\nWorkingDirectory=" + str(home / "actions-runner") + "\n", encoding="utf-8"
                    )
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    migration.apply_migration(
                        archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                        token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                        registration_verifier=lambda token: self.assertEqual(token, "admin-secret"),
                    )
            finally:
                for item in reversed(patches):
                    item.stop()
            self.assertTrue((home / "actions-runner/.runner").is_file())
            self.assertEqual(stat.S_IMODE((home / "actions-runner/.credentials").stat().st_mode), 0o600)
            config_call = next(command for command in calls if any(str(arg).endswith("config.sh") for arg in command))
            self.assertIn("baci-release", config_call)
            self.assertNotIn("baci-deploy", config_call)
            self.assertTrue((old_runner / "keep.txt").is_file())
            self.assertFalse(any(str(old_runner) in str(arg) for call in calls for arg in call))

    def test_failed_isolation_rolls_back_only_the_new_runner(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") for arg in command):
                    for name in (".runner", ".credentials"):
                        artifact = home / "actions-runner" / name
                        artifact.write_text("mocked private runner state", encoding="utf-8")
                        os.chmod(artifact, 0o600)
                if "install" in command:
                    (service_dir / "actions.runner.ogabasseyy-Baci.baci-release-01.service").write_text(
                        "[Service]\nUser=baci-release\nWorkingDirectory=" + str(home / "actions-runner") + "\n", encoding="utf-8"
                    )
                if command[0] == str(verifier):
                    return SimpleNamespace(returncode=1, stdout="", stderr="")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()
            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())
            rollback_call = next(command for command in calls if "remove" in command)
            self.assertIn("removal", rollback_call)

    def test_partial_service_install_failure_rolls_back_attempted_side_effects(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()
            unit = service_dir / "actions.runner.ogabasseyy-Baci.baci-release-01.service"

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") and "remove" not in command for arg in command):
                    for name in (".runner", ".credentials"):
                        artifact = home / "actions-runner" / name
                        artifact.write_text("mocked private runner state", encoding="utf-8")
                        os.chmod(artifact, 0o600)
                if "install" in command:
                    unit.write_text(
                        "[Service]\nUser=baci-release\nWorkingDirectory=" + str(home / "actions-runner") + "\n", encoding="utf-8"
                    )
                    return SimpleNamespace(returncode=1, stdout="", stderr="partial install")
                if "uninstall" in command:
                    unit.unlink(missing_ok=True)
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()

            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())
            self.assertFalse(unit.exists())
            self.assertTrue(any("stop" in command for command in calls))
            self.assertTrue(any("remove" in command for command in calls))
            self.assertTrue(any("uninstall" in command for command in calls))

    def test_partial_config_failure_attempts_runner_removal(self):
        with tempfile.TemporaryDirectory() as temporary:
            base = Path(temporary)
            home, old_runner, archive, verifier = self._prepare_apply_fixture(base)
            calls = []
            service_dir = base / "systemd"
            service_dir.mkdir()

            def run(command, **kwargs):
                calls.append(command)
                if any(str(arg).endswith("config.sh") for arg in command):
                    if "remove" not in command:
                        for name in (".runner", ".credentials"):
                            artifact = home / "actions-runner" / name
                            artifact.write_text("mocked partial config", encoding="utf-8")
                            os.chmod(artifact, 0o600)
                        return SimpleNamespace(returncode=1, stdout="", stderr="partial config")
                return SimpleNamespace(returncode=0, stdout="", stderr="")

            patches = self._patch_apply_host(home)
            patches += (patch.object(migration.platform, "system", return_value="Linux"), patch.object(migration.platform, "machine", return_value="x86_64"))
            for item in patches:
                item.start()
            try:
                with patch.object(migration, "_safe_chown_tree"), patch.object(migration, "runner_artifact", return_value=("2.335.1", "https://github.com/actions/runner/releases/download/v2.335.1/actions-runner-linux-x64-2.335.1.tar.gz", migration.hashlib.sha256(archive.read_bytes()).hexdigest())), patch.dict(os.environ, {"BACI_RUNNER_ADMIN_TOKEN": "admin-secret"}, clear=False):
                    with self.assertRaisesRegex(RuntimeError, "runner migration command failed"):
                        migration.apply_migration(
                            archive_path=archive, repo_root=base, runner=run, credential_verifier=verifier, service_dir=service_dir,
                            token_provider=lambda kind, token: "registration" if kind == "registration-token" else "removal",
                            registration_verifier=lambda _token: None,
                        )
            finally:
                for item in reversed(patches):
                    item.stop()

            remove_call = next(command for command in calls if any(str(arg).endswith("config.sh") for arg in command) and "remove" in command)
            self.assertIn("removal", remove_call)
            self.assertFalse((home / "actions-runner").exists())
            self.assertTrue((old_runner / "keep.txt").is_file())


if __name__ == "__main__":
    unittest.main()

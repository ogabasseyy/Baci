from migrate_baci_release_runner_test_support import (
    migration, make_archive, FakeResponse, ReleaseRunnerTestFixture, SimpleNamespace, patch, Path, os, json, io, stat, tarfile, tempfile, unittest,
)


class ReleaseRunnerValidationTests(ReleaseRunnerTestFixture):

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


if __name__ == "__main__":
    unittest.main()

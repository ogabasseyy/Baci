import io
import os
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from worker_release_broker import BrokerProtocolError, _freeze_release_tree, _stage_archive, _validate_staged_release, extract_github_tarball
from worker_release_runtime_test_fixtures import create_runtime_tree, runtime_archive_entries


def _archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for entry in entries:
            archive.addfile(*entry)
    return output.getvalue()


def _regular(name, content, mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(content)
    info.mode = mode
    return info, io.BytesIO(content)


def _directory(name):
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    return info, None


class RuntimeCompletenessTests(unittest.TestCase):
    def test_stage_does_not_publish_archive_only_worker_source(self):
        with tempfile.TemporaryDirectory(prefix="baci-runtime-stage-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            sha = "f" * 40
            archive = _archive([
                _directory("repo/vps-workers/"),
                _regular("repo/vps-workers/bin/worker.sh", b"#!/bin/sh\n", 0o755),
                _regular("repo/.github/scripts/gigl-dotenv.sh", b"# trusted dotenv reader\n"),
            ])
            with patch("worker_release_broker._run_as_worker_extractor",
                       side_effect=lambda raw, path, _uid, _gid: extract_github_tarball(io.BytesIO(raw), path)), \
                    patch("worker_release_broker._freeze_release_tree",
                          side_effect=lambda path, gid, owner_uid=0: _freeze_release_tree(path, gid, owner_uid=os.getuid())):
                with self.assertRaisesRegex(BrokerProtocolError, "missing required runtime dependencies"):
                    _stage_archive(archive, str(releases), sha, os.getuid(), os.getgid(), owner_uid=os.getuid())
            self.assertFalse((releases / sha).exists())

    def test_preflight_rejects_source_tree_without_web_and_root_dependencies(self):
        with tempfile.TemporaryDirectory(prefix="baci-runtime-preflight-empty-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            release = releases / ("a" * 40)
            release.mkdir()
            (release / "worker.sh").write_text("source only\n")
            (release / "worker.sh").chmod(0o440)
            release.chmod(0o550)
            with self.assertRaisesRegex(BrokerProtocolError, "missing required runtime dependencies"):
                _validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid())

    def test_preflight_accepts_materialized_frozen_runtime_and_rejects_unusable_tsx(self):
        with tempfile.TemporaryDirectory(prefix="baci-runtime-preflight-complete-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            release = releases / ("b" * 40)
            release.mkdir()
            create_runtime_tree(release)
            release.chmod(0o550)
            self.assertGreater(_validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid()), 0)
            (release / "apps/web/node_modules/.bin/tsx").chmod(0o440)
            with self.assertRaisesRegex(BrokerProtocolError, "web runtime entrypoint is unsafe"):
                _validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid())

    def test_repository_archive_fixture_contains_only_materialized_regular_dependency_paths(self):
        names = [entry[0].name for entry in runtime_archive_entries()]
        self.assertIn("repo/node_modules/runtime/", names)
        self.assertIn("repo/apps/web/node_modules/.bin/tsx", names)
        tsx = next(info for info, _content in runtime_archive_entries()
                   if info.name.endswith("apps/web/node_modules/.bin/tsx"))
        self.assertTrue(tsx.isreg())


if __name__ == "__main__":
    unittest.main()

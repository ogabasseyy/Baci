"""Opt-in end-to-end test of the disconnected authenticated stage composition."""
from __future__ import annotations

import base64
import hashlib
import io
import os
import pwd
import shutil
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_broker
from worker_release_authenticated_staging import (
    StagingOrchestrationRejected, _copy_contents, stage_authenticated_archive,
)
from worker_release_dependency_artifacts import payload_manifest, sha256_file
from worker_release_dependency_fs import write_manifest
from worker_release_lifecycle import AuthenticatedRun
from worker_release_descriptor_cgroup import CgroupProofRejected
from worker_release_dependency_supervisor_cgroup import preflight_cgroup_root
from worker_release_systemd_extractor import EXTRACTOR, RESOURCE_ROOT
from worker_release_systemd_test_support import systemd_system_manager_available

SHA = "a" * 40


def identity() -> AuthenticatedRun:
    return AuthenticatedRun(repository="ogabasseyy/Baci",
                            workflow=".github/workflows/production-release.yml",
                            ref="refs/heads/main", sha=SHA, run_id="234",
                            run_attempt=1, job_id="567", status="in_progress")


def archive_bytes() -> bytes:
    entries = {
        "pnpm-lock.yaml": b"root lock\n",
        "vps-workers/pnpm-lock.yaml": b"worker lock\n",
        "apps/web/package.json": b'{"name":"web"}\n',
        "vps-workers/bin/worker.mjs": b"export {};\n",
        "vps-workers/jobs/cache-worker.mjs": b"export {};\n",
        "vps-workers/lib/runtime.mjs": b"export {};\n",
        "vps-workers/config/runtime.json": b"{}\n",
        "vps-workers/systemd/worker.service": b"[Service]\n",
        ".github/scripts/gigl-dotenv.sh": b"#!/bin/sh\nexit 0\n",
    }
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in entries.items():
            item = tarfile.TarInfo(f"repo/{name}")
            item.size, item.mode = len(data), 0o755 if name.endswith(".sh") else 0o644
            archive.addfile(item, io.BytesIO(data))
    return output.getvalue()


def response(data: bytes) -> dict[str, object]:
    run = identity()
    return {"operation": "stage", "sourceSha": run.sha, "repository": run.repository,
            "workflow": run.workflow, "ref": run.ref, "status": run.status,
            "runId": run.run_id, "runAttempt": run.run_attempt, "jobId": run.job_id,
            "archiveSha256": hashlib.sha256(data).hexdigest(),
            "archiveBase64": base64.b64encode(data).decode("ascii")}


class AuthenticatedStagingTests(unittest.TestCase):
    def test_descriptor_copy_copies_regular_tree_and_rejects_links(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            source, destination = root / "source", root / "destination"
            source.mkdir()
            destination.mkdir()
            (source / "nested").mkdir()
            (source / "nested" / "file").write_text("content")
            source_fd = os.open(source, os.O_RDONLY | os.O_DIRECTORY)
            destination_fd = os.open(destination, os.O_RDONLY | os.O_DIRECTORY)
            try:
                _copy_contents(source_fd, destination_fd)
            finally:
                os.close(source_fd)
                os.close(destination_fd)
            self.assertEqual((destination / "nested/file").read_text(), "content")

            linked, empty = root / "linked", root / "empty"
            linked.mkdir()
            empty.mkdir()
            (linked / "outside").symlink_to(destination / "nested/file")
            linked_fd = os.open(linked, os.O_RDONLY | os.O_DIRECTORY)
            empty_fd = os.open(empty, os.O_RDONLY | os.O_DIRECTORY)
            try:
                with self.assertRaisesRegex(StagingOrchestrationRejected, "link or special"):
                    _copy_contents(linked_fd, empty_fd)
            finally:
                os.close(linked_fd)
                os.close(empty_fd)

    @unittest.skipUnless(os.geteuid() == 0 and
                         os.environ.get("WORKER_RELEASE_STAGE_REQUIRE_SYSTEMD") == "1",
                         "requires the disposable root/systemd integration workflow")
    def test_dispatch_archive_extractor_consumer_and_journal_complete_as_one_stage(self):
        if not systemd_system_manager_available():
            self.fail("CI requires a reachable systemd system manager")
        try:
            preflight_cgroup_root(Path("/sys/fs/cgroup"))
        except (OSError, CgroupProofRejected) as error:
            self.fail(f"CI requires a usable cgroup v2 system.slice: {error}")
        account = pwd.getpwnam(EXTRACTOR)
        if list(RESOURCE_ROOT.iterdir()):
            self.fail("unclaimed extractor resources must block the stage")
        with tempfile.TemporaryDirectory(dir=Path.home()) as temporary:
            base = Path(temporary)
            worker_root = base / "worker"
            # The builder journal is root-owned and only accepts a private
            # 0700 test root (production uses the provisioned 0710 baci-locks
            # root).  mkdir(parents=True) would create this intermediate
            # directory as 0755 under the CI umask.
            worker_root.mkdir(mode=0o700)
            (worker_root / "releases").mkdir(parents=True, mode=0o700)
            lock = worker_root / "release.lock"
            lock.touch(mode=0o600)
            results = base / "results"
            results.mkdir(mode=0o700)
            build_root = base / "build"
            build_root.mkdir(mode=0o710)
            data = archive_bytes()
            digest = hashlib.sha256(data).hexdigest()

            def builder(source_arg: str, expected_sha: str, *, runner):
                source = Path(source_arg)
                self.assertEqual((source / ".baci-source-sha").read_text().strip(), expected_sha)
                input_root = build_root / f"{expected_sha}.input.fixture"
                input_root.mkdir(mode=0o700)
                source_copy = input_root / "source"
                shutil.copytree(source, source_copy)
                for current, directories, files in os.walk(source_copy, topdown=False):
                    for name in files:
                        (Path(current) / name).chmod(0o440)
                    for name in directories:
                        (Path(current) / name).chmod(0o550)
                source_copy.chmod(0o550)
                input_root.chmod(0o555)
                scratch = build_root / f"{expected_sha}.scratch.fixture"
                scratch.mkdir(mode=0o700)
                builder_account = pwd.getpwnam("nobody")
                os.chown(scratch, builder_account.pw_uid, builder_account.pw_gid)
                output = results / "candidate"
                output.mkdir(mode=0o700)
                unit = f"baci-worker-deps-{expected_sha[:12]}-{'c' * 32}.service"
                runner(("synthetic-test-command",), scratch, unit,
                       input_root=input_root, result_dir=output)
                payload = output / "payload"
                cli = payload / "web" / "node_modules" / "tsx" / "cli.mjs"
                cli.parent.mkdir(parents=True)
                cli.write_text("export {};\n")
                cli.chmod(0o550)
                binary = payload / "web" / "node_modules" / ".bin"
                binary.mkdir()
                (binary / "tsx").symlink_to("../tsx/cli.mjs")
                dotenv = payload / "root" / "node_modules" / "dotenv" / "index.js"
                dotenv.parent.mkdir(parents=True)
                dotenv.write_text("export {};\n")
                locks = {"pnpm-lock.yaml": sha256_file(source / "pnpm-lock.yaml"),
                         "vps-workers/pnpm-lock.yaml": sha256_file(
                             source / "vps-workers" / "pnpm-lock.yaml")}
                manifest = payload_manifest(payload, expected_sha, locks,
                                            {"web_tsx": "passed", "worker_dotenv": "passed"})
                write_manifest(output, manifest)
                shutil.rmtree(scratch)
                shutil.rmtree(input_root)
                return manifest, output

            def journaled_runner_factory(run_identity, unit_journal):
                account = pwd.getpwnam("nobody")

                def run(_command, scratch, unit, *, input_root, result_dir):
                    unit_journal.begin(
                        run_identity.fence(), unit, input_root / "source", scratch,
                        account.pw_uid, account.pw_gid, input_root=input_root,
                        result_dir=result_dir,
                    )
                    unit_journal.mark_running(type("Cgroup", (), {"st_dev": 1, "st_ino": 2})())
                    unit_journal.mark_drained(type("Cgroup", (), {"st_dev": 1, "st_ino": 2})())

                return run

            receipt = stage_authenticated_archive(
                response(data), identity(), expected_archive_sha256=digest,
                worker_root=worker_root, lock_path=lock, result_root=results,
                worker_gid=os.getgid(), builder=builder,
                builder_runner_factory=journaled_runner_factory,
                builder_build_root=build_root, builder_results_root=results,
                builder_quiesced=lambda _fence: True,
            )
            release = Path(receipt["release_path"])
            self.assertEqual(receipt["phase"], "committed")
            self.assertFalse((worker_root / "current").exists())
            self.assertTrue((release / "apps/web/node_modules/.bin/tsx").is_file())
            self.assertFalse((release / "apps/web/node_modules/.bin/tsx").is_symlink())
            self.assertTrue((release / "bin/worker.mjs").is_file())
            self.assertTrue((release / "bin/gigl-dotenv.sh").is_file())
            self.assertEqual(list(results.iterdir()), [])
            self.assertFalse((worker_root / "release-stage-journal.json").exists())
            self.assertFalse((worker_root / "release-source-view-journal.json").exists())
        self.assertEqual(list(RESOURCE_ROOT.iterdir()), [])


if __name__ == "__main__":
    unittest.main()

import base64
import hashlib
import io
import os
import sys
import tarfile
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_dependency_consumer as consumer
import worker_release_dependency_install as install
from worker_release_dependency_artifacts import payload_manifest, sha256_file
from worker_release_dependency_fs import write_manifest
from worker_release_lifecycle import AuthenticatedRun


SHA = "a" * 40


def identity(sha=SHA):
    return AuthenticatedRun(
        repository="ogabasseyy/Baci", workflow=".github/workflows/production-release.yml",
        ref="refs/heads/main", sha=sha, run_id="123", run_attempt=1,
        job_id="456", status="in_progress",
    )


def archive_bytes(root_lock=b"root lock\n"):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as archive:
        for name, data in (
            ("repo/pnpm-lock.yaml", root_lock),
            ("repo/vps-workers/pnpm-lock.yaml", b"worker lock\n"),
        ):
            info = tarfile.TarInfo(name)
            info.size = len(data)
            info.mode = 0o644
            archive.addfile(info, io.BytesIO(data))
    return output.getvalue()


def dispatcher_response(archive, run=identity()):
    return {
        "operation": "stage", "sourceSha": run.sha,
        "repository": run.repository, "workflow": run.workflow, "ref": run.ref,
        "status": run.status, "runId": run.run_id, "runAttempt": run.run_attempt,
        "jobId": run.job_id, "archiveSha256": hashlib.sha256(archive).hexdigest(),
        "archiveBase64": base64.b64encode(archive).decode("ascii"),
    }


class DependencyConsumerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.source_tmp = self.root / "source-inputs"
        self.source_tmp.mkdir(mode=0o700)
        self.result_root = self.root / "results"
        self.result_root.mkdir(mode=0o700)
        self.release = self.root / "release"
        (self.release / "apps" / "web").mkdir(parents=True, mode=0o700)

    def tearDown(self):
        self.temp.cleanup()

    def make_builder(self, *, bad_lock_hash=False, bad_worker_lock_hash=False, bad_manifest=False):
        def build(source_arg, expected_sha):
            source = Path(source_arg)
            self.assertEqual((source / ".baci-source-sha").read_text().strip(), expected_sha)
            result = self.result_root / "candidate"
            result.mkdir(mode=0o700)
            payload = result / "payload"
            tsx = payload / "web" / "node_modules" / "tsx"
            tsx.mkdir(parents=True)
            cli = tsx / "cli.mjs"
            cli.write_text("#!/usr/bin/env node\\n", encoding="utf-8")
            cli.chmod(0o550)
            binary = payload / "web" / "node_modules" / ".bin"
            binary.mkdir()
            (binary / "tsx").symlink_to("../tsx/cli.mjs")
            packed = payload / "web" / "node_modules" / ".pnpm" / "sample@1" / "node_modules" / "sample"
            packed.mkdir(parents=True)
            (packed / "index.js").write_text("export const sample = true;\\n", encoding="utf-8")
            (payload / "web" / "node_modules" / "sample").symlink_to(".pnpm/sample@1/node_modules/sample")
            dotenv = payload / "root" / "node_modules" / "dotenv"
            dotenv.mkdir(parents=True)
            (dotenv / "index.js").write_text("export const config = () => ({});\\n", encoding="utf-8")
            locks = {
                "pnpm-lock.yaml": sha256_file(source / "pnpm-lock.yaml"),
                "vps-workers/pnpm-lock.yaml": sha256_file(source / "vps-workers" / "pnpm-lock.yaml"),
            }
            if bad_lock_hash:
                locks["pnpm-lock.yaml"] = "0" * 64
            if bad_worker_lock_hash:
                locks["vps-workers/pnpm-lock.yaml"] = "0" * 64
            manifest = payload_manifest(payload, expected_sha, locks,
                                        {"web_tsx": "passed", "worker_dotenv": "passed"})
            if bad_manifest:
                manifest["runtime_ready"] = True
            write_manifest(result, manifest)
            return manifest, result
        return build

    def run_consumer(self, builder):
        archive = archive_bytes()
        return consumer.build_and_install_dependencies(
            dispatcher_response(archive), identity(),
            expected_bundle_sha256=hashlib.sha256(archive).hexdigest(),
            source_temp_root=self.source_tmp,
            result_root=self.result_root, release_root=self.release,
            builder=builder, owner_uid=os.geteuid(),
        )

    def test_verified_archive_and_candidate_are_installed_with_regular_files_only(self):
        receipt = self.run_consumer(self.make_builder())
        self.assertEqual(receipt["source_sha"], SHA)
        self.assertEqual(receipt["installed_dependency_roots"], ["apps/web/node_modules", "node_modules"])
        link = self.release / "apps" / "web" / "node_modules" / ".bin" / "tsx"
        self.assertTrue(link.is_file())
        self.assertFalse(link.is_symlink())
        self.assertEqual(link.read_text(), "#!/usr/bin/env node\\n")
        self.assertFalse((self.release / "apps" / "web" / "node_modules" / "sample").is_symlink())
        self.assertEqual((self.release / "apps" / "web" / "node_modules" / "sample" / "index.js").read_text(),
                         "export const sample = true;\\n")
        self.assertEqual((self.release / "node_modules" / "dotenv" / "index.js").read_text(),
                         "export const config = () => ({});\\n")
        self.assertEqual(list(self.result_root.iterdir()), [])
        self.assertEqual(list(self.source_tmp.iterdir()), [])

    def test_lock_hash_mismatch_fails_before_install_and_cleans_candidate(self):
        with self.assertRaisesRegex(consumer.BuilderRejected, "lockfile hashes"):
            self.run_consumer(self.make_builder(bad_lock_hash=True))
        self.assertFalse((self.release / "node_modules").exists())
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertEqual(list(self.result_root.iterdir()), [])

    def test_standalone_worker_lockfile_is_verified_independently(self):
        with self.assertRaisesRegex(consumer.BuilderRejected, "lockfile hashes"):
            self.run_consumer(self.make_builder(bad_worker_lock_hash=True))
        self.assertFalse((self.release / "node_modules").exists())
        self.assertEqual(list(self.result_root.iterdir()), [])

    def test_unapproved_builder_readiness_claim_fails_closed(self):
        with self.assertRaisesRegex(consumer.BuilderRejected, "manifest does not match broker policy"):
            self.run_consumer(self.make_builder(bad_manifest=True))
        self.assertFalse((self.release / "node_modules").exists())

    def test_archive_provenance_marker_collision_is_rejected(self):
        collision = io.BytesIO()
        with tarfile.open(fileobj=collision, mode="w:gz") as archive:
            for name, data in (("repo/.baci-source-sha", b"spoof"),
                               ("repo/pnpm-lock.yaml", b"lock"),
                               ("repo/vps-workers/pnpm-lock.yaml", b"worker lock")):
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        with self.assertRaisesRegex(consumer.BuilderRejected, "reserved provenance marker"):
            consumer.build_and_install_dependencies(
                dispatcher_response(collision.getvalue()), identity(),
                expected_bundle_sha256=hashlib.sha256(collision.getvalue()).hexdigest(),
                source_temp_root=self.source_tmp,
                result_root=self.result_root, release_root=self.release,
                builder=self.make_builder(), owner_uid=os.geteuid(),
            )
        self.assertEqual(list(self.source_tmp.iterdir()), [])

    def test_forged_archive_cannot_reuse_authenticated_sha_and_bundle_digest(self):
        trusted_archive = archive_bytes()
        forged_archive = archive_bytes(b"fake lock\n")
        response = dispatcher_response(forged_archive)
        response["archiveSha256"] = hashlib.sha256(trusted_archive).hexdigest()
        with self.assertRaisesRegex(consumer.BuilderRejected, "source archive digest"):
            consumer.build_and_install_dependencies(
                response, identity(), expected_bundle_sha256=hashlib.sha256(trusted_archive).hexdigest(),
                source_temp_root=self.source_tmp, result_root=self.result_root,
                release_root=self.release, builder=self.make_builder(), owner_uid=os.geteuid(),
            )
        self.assertEqual(list(self.source_tmp.iterdir()), [])
        self.assertEqual(list(self.result_root.iterdir()), [])

    def test_existing_release_dependency_target_is_never_overwritten(self):
        target = self.release / "node_modules"
        target.mkdir()
        sentinel = target / "sentinel"
        sentinel.write_text("preserve")
        with self.assertRaisesRegex(consumer.BuilderRejected, "already contains"):
            self.run_consumer(self.make_builder())
        self.assertEqual(sentinel.read_text(), "preserve")

    def test_failure_after_readonly_targets_are_created_removes_both_targets(self):
        original = install._materialize_directory
        second_target_source = Path("/unused")

        def fail_after_second_target(source, destination, payload_root, budget, ancestors):
            if source == second_target_source:
                original(source, destination, payload_root, budget, ancestors)
                raise consumer.BuilderRejected("injected install failure after materialization")
            return original(source, destination, payload_root, budget, ancestors)

        def builder(source_arg, expected_sha):
            result = self.make_builder()(source_arg, expected_sha)
            nonlocal second_target_source
            second_target_source = result[1] / "payload" / "root" / "node_modules"
            return result

        with patch.object(install, "_materialize_directory", side_effect=fail_after_second_target):
            with self.assertRaisesRegex(consumer.BuilderRejected, "injected install failure"):
                self.run_consumer(builder)
        self.assertFalse((self.release / "apps" / "web" / "node_modules").exists())
        self.assertFalse((self.release / "node_modules").exists())
        self.assertEqual(list(self.result_root.iterdir()), [])
        self.assertEqual(list(self.source_tmp.iterdir()), [])

    def test_failed_partial_cleanup_marks_incoming_release_discard_required(self):
        original = install._materialize_directory
        second_target_source = Path("/unused")

        def fail_after_second_target(source, destination, payload_root, budget, ancestors):
            if source == second_target_source:
                original(source, destination, payload_root, budget, ancestors)
                raise consumer.BuilderRejected("injected install failure")
            return original(source, destination, payload_root, budget, ancestors)

        def builder(source_arg, expected_sha):
            result = self.make_builder()(source_arg, expected_sha)
            nonlocal second_target_source
            second_target_source = result[1] / "payload" / "root" / "node_modules"
            return result

        with patch.object(install, "_materialize_directory", side_effect=fail_after_second_target), \
             patch.object(install, "_remove_partial_tree", side_effect=OSError("injected cleanup failure")):
            with self.assertRaisesRegex(consumer.BuilderRejected, "discard the incoming release"):
                self.run_consumer(builder)


if __name__ == "__main__":
    unittest.main()

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
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_candidate_pin
import worker_release_runtime_acl
import worker_release_runtime_verifier
import worker_release_authenticated_staging as staging_module
from worker_release_authenticated_staging import (
    StagingOrchestrationRejected, _copy_contents, stage_authenticated_archive,
)
from worker_release_dependency_artifacts import payload_manifest, sha256_file
from worker_release_dependency_fs import write_manifest
from worker_release_lifecycle import AuthenticatedRun
from worker_release_descriptor_cgroup import CgroupProofRejected
from worker_release_dependency_supervisor_cgroup import preflight_cgroup_root
from worker_release_systemd_extractor import EXTRACTOR, RESOURCE_ROOT, UNIT_PREFIX, extract_frozen_source
from worker_release_systemd_test_support import (
    systemd_system_manager_available, systemd_unit_failure_summary,
)
from worker_release_runtime_verifier_test_support import emit_namespace_failure_diagnostic

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
    def test_runtime_verifier_receipt_is_required_before_publish(self):
        run = identity()
        candidate = Path("/srv/baci-workers/releases/." + SHA + ".incoming." + "b" * 32)
        digest = "c" * 64
        opaque_receipt = object()
        with (patch.object(staging_module, "verify_materialized_candidate",
                           return_value=opaque_receipt) as verify,
              patch.object(staging_module, "validate_runtime_receipt", return_value=False) as validate):
            with self.assertRaisesRegex(StagingOrchestrationRejected, "receipt does not match"):
                staging_module._verify_runtime_before_publish(candidate, run, digest, 81)
        verify.assert_called_once_with(candidate, run, archive_sha256=digest,
                                       owner_uid=0, owner_gid=81)
        validate.assert_called_once_with(opaque_receipt, candidate, run, digest,
                                         owner_uid=0, owner_gid=81)

    def test_unproven_runtime_unit_preserves_candidate_for_recovery(self):
        run = identity()
        candidate = Path("/srv/baci-workers/releases/." + SHA + ".incoming." + "c" * 32)
        with patch.object(staging_module, "verify_materialized_candidate",
                          side_effect=staging_module.RuntimeVerificationQuiescenceUnproven("unproven")):
            with self.assertRaises(staging_module.RuntimeVerificationQuiescenceUnproven):
                staging_module._verify_runtime_before_publish(candidate, run, "d" * 64, 81)

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
                cli.write_text("#!/usr/bin/node\nconsole.log('tsx v4.20.6');\n")
                cli.chmod(0o550)
                binary = payload / "web" / "node_modules" / ".bin"
                binary.mkdir()
                (binary / "tsx").symlink_to("../tsx/cli.mjs")
                dotenv = payload / "root" / "node_modules" / "dotenv" / "index.js"
                dotenv.parent.mkdir(parents=True)
                (dotenv.parent / "package.json").write_text(
                    '{"name":"dotenv","type":"module","exports":"./index.js"}\n')
                dotenv.write_text("export function config() { return {}; }\n")
                supabase = payload / "root" / "node_modules" / "@supabase" / "supabase-js"
                supabase.mkdir(parents=True)
                (supabase / "package.json").write_text(
                    '{"name":"@supabase/supabase-js","type":"module","exports":"./index.js"}\n')
                (supabase / "index.js").write_text(
                    "export function createClient() { return { from() {} }; }\n")
                expo = payload / "root" / "node_modules" / "expo-server-sdk"
                expo.mkdir(parents=True)
                (expo / "package.json").write_text(
                    '{"name":"expo-server-sdk","type":"module","exports":"./index.js"}\n')
                (expo / "index.js").write_text(
                    "export class Expo { sendPushNotificationsAsync() {} }\n")
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

            def diagnostic_extractor(journal, archive, archive_sha256):
                txid = journal._require_journal()["transaction_id"]
                unit = f"{UNIT_PREFIX}{txid}.service"
                try:
                    extracted = extract_frozen_source(journal, archive, archive_sha256)
                    extracted_source = Path(extracted["snapshot"]).stat()
                    extracted_source_identity.append((extracted_source.st_uid, extracted_source.st_gid))
                    return extracted
                except Exception as error:
                    raise AssertionError(
                        f"extractor failed ({type(error).__name__}); systemd state: "
                        f"{systemd_unit_failure_summary(unit)}"
                    ) from error

            fixture_releases = worker_root / "releases"
            extracted_source_identity = []

            def grant_fixture_candidate_acl(candidate, **kwargs):
                # Keep the production ACL validator intact while binding its
                # explicit releases-root parameter to this test's private tree.
                return worker_release_runtime_acl.grant_candidate_acl(
                    candidate, releases_root=fixture_releases, **kwargs)

            generation_observations = []

            def fake_seed_generation(journal, _response, _identity, **kwargs):
                kwargs["source_pin"].verify_unchanged()
                kwargs["release_lock_proof"].require_active(lock)
                resource = journal.create_builder_result()
                generation_observations.append((
                    kwargs["source_path"].exists(), resource.exists(),
                    kwargs["source_path"].stat().st_uid,
                    kwargs["source_pin"].owner_uid,
                    kwargs["source_pin"].read_uids,
                ))
                journal.remove_builder_result()
                return False

            with (patch.object(worker_release_candidate_pin, "RELEASES_ROOT", fixture_releases),
                  patch.object(worker_release_runtime_verifier, "grant_candidate_acl",
                               side_effect=grant_fixture_candidate_acl),
                  patch.object(staging_module, "generate_for_stage_journal",
                               side_effect=fake_seed_generation) as generate_seed):
                unit_names = []
                real_unit_name = worker_release_runtime_verifier._unit_name

                def record_unit_name(*args):
                    unit = real_unit_name(*args)
                    unit_names.append(unit)
                    return unit

                with patch.object(worker_release_runtime_verifier, "_unit_name",
                                  side_effect=record_unit_name):
                    try:
                        receipt = stage_authenticated_archive(
                            response(data), identity(), expected_archive_sha256=digest,
                            worker_root=worker_root, lock_path=lock, result_root=results,
                            worker_gid=account.pw_gid, builder=builder,
                            revalidate_authenticated_fence=identity,
                            extractor=diagnostic_extractor,
                            builder_runner_factory=journaled_runner_factory,
                            builder_build_root=build_root, builder_results_root=results,
                            builder_quiesced=lambda _fence: True,
                        )
                    except StagingOrchestrationRejected as error:
                        if "runtime verification failed" in str(error):
                            for unit in unit_names:
                                emit_namespace_failure_diagnostic(unit)
                        raise
            release = Path(receipt["release_path"])
            self.assertEqual(generate_seed.call_count, 1)
            self.assertEqual(generation_observations,
                             [(True, True, 0, 0, staging_module.fixed_reader_uids())])
            self.assertEqual(extracted_source_identity, [(account.pw_uid, account.pw_gid)])
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

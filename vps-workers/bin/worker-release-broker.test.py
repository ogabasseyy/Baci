import io
import json
import os
import re
import socket
import subprocess
import stat
import sys
import tarfile
import tempfile
import threading
from types import SimpleNamespace
import unittest
from unittest.mock import patch
from pathlib import Path

from worker_release_broker import BrokerProtocolError, BROKER_CLIENT_TIMEOUT_SECONDS, BROKER_OPERATION_BUDGET_SECONDS, DISPATCHER_TIMEOUT_SECONDS, extract_github_tarball, serve_connection, _stage_archive, _freeze_release_tree, _validate_staged_release, _load_release_state, _record_promotion_failure, _record_promotion_success, _promotion_restore_confirmed, _run_gigl_capability_smoke, _validate_gigl_release_sha
from worker_release_lifecycle import LifecycleRejected, ReleaseHealthProbeError, ReleaseHealthRejected
from worker_release_staging import _drop_extractor_privileges
from worker_release_gigl import _acquire_gigl_tracking_lock


def make_archive(entries):
    output = io.BytesIO()
    with tarfile.open(fileobj=output, mode="w:gz") as tar:
        for entry in entries:
            tar.addfile(*entry)
    output.seek(0)
    return output


def regular(name, payload=b"ok", mode=0o644):
    info = tarfile.TarInfo(name)
    info.size = len(payload)
    info.mode = mode
    return info, io.BytesIO(payload)


def directory(name):
    info = tarfile.TarInfo(name)
    info.type = tarfile.DIRTYPE
    return info, None


class BrokerSocketTests(unittest.TestCase):
    def test_real_python_entrypoint_bootstraps_single_broker_facade(self):
        broker_script = Path(__file__).with_name("worker_release_broker.py")
        result = subprocess.run(
            [sys.executable, str(broker_script), "--help"],
            capture_output=True, text=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn("Root-owned Baci worker release broker", result.stdout)
        self.assertNotIn("Traceback", result.stderr)

    def test_dispatcher_timeout_covers_total_github_authentication_budget_with_margin(self):
        broker_source = Path(__file__).parents[1] / "lib" / "worker-release-broker.mjs"
        source = broker_source.read_text(encoding="utf-8")
        match = re.search(r"authorizationDeadlineMs:\s*([\d_]+)", source)
        self.assertIsNotNone(match)
        deadline_ms = int(match.group(1).replace("_", ""))
        self.assertGreaterEqual(DISPATCHER_TIMEOUT_SECONDS * 1000, deadline_ms + 30_000)
        dispatcher_match = re.search(r"dispatcherTimeoutMs:\s*([\d_]+)", source)
        quiescence_match = re.search(r"quiescenceReadyTimeoutMs:\s*([\d_]+)", source)
        cleanup_match = re.search(r"quiescenceCleanupTimeoutMs:\s*([\d_]+)", source)
        operation_match = re.search(r"brokerOperationBudgetMs:\s*([\d_]+)", source)
        client_match = re.search(r"brokerClientTimeoutMs:\s*([\d_]+)", source)
        self.assertTrue(all((dispatcher_match, quiescence_match, cleanup_match, operation_match, client_match)))
        parse_ms = lambda match: int(match.group(1).replace("_", ""))
        self.assertEqual(DISPATCHER_TIMEOUT_SECONDS * 1000, parse_ms(dispatcher_match))
        self.assertGreaterEqual(BROKER_OPERATION_BUDGET_SECONDS * 1000,
                                parse_ms(dispatcher_match) + parse_ms(quiescence_match) + parse_ms(cleanup_match))
        self.assertEqual(BROKER_CLIENT_TIMEOUT_SECONDS * 1000, parse_ms(client_match))
        self.assertGreater(BROKER_CLIENT_TIMEOUT_SECONDS, BROKER_OPERATION_BUDGET_SECONDS)
        dispatcher_source = Path(__file__).with_name("worker_release_broker_dispatch.py").read_text(encoding="utf-8")
        socket_source = Path(__file__).with_name("worker_release_broker.py").read_text(encoding="utf-8")
        self.assertIn("timeout=broker.DISPATCHER_TIMEOUT_SECONDS", dispatcher_source)
        self.assertIn("connection.settimeout(BROKER_CLIENT_TIMEOUT_SECONDS)", socket_source)

    def exchange(self, expected_uid, payload, dispatch):
        server, client = socket.socketpair()
        worker = threading.Thread(target=serve_connection, kwargs={
            "connection": server,
            "expected_release_uid": expected_uid,
            "dispatch": dispatch,
        })
        worker.start()
        client.sendall(payload)
        response = b""
        while not response.endswith(b"\n"):
            chunk = client.recv(4096)
            if not chunk:
                break
            response += chunk
        client.close()
        worker.join(timeout=2)
        server.close()
        self.assertFalse(worker.is_alive())
        return json.loads(response)

    def test_uses_kernel_peer_uid_and_dispatches_one_json_object(self):
        seen = []
        uid = os.getuid()
        result = self.exchange(uid, b'{"operation":"stage"}\n', lambda peer, request: seen.append((peer, request)) or {"ok": True})
        self.assertEqual(result, {"ok": True})
        self.assertEqual(seen, [(uid, {"operation": "stage"})])

    def test_refuses_wrong_uid_without_calling_dispatch(self):
        called = []
        result = self.exchange(os.getuid() + 1, b'{"operation":"stage"}\n', lambda *_: called.append(True) or {"ok": True})
        self.assertEqual(result, {"ok": False, "error": "unauthorized"})
        self.assertEqual(called, [])

    def test_rejects_oversized_multiline_and_non_object_requests(self):
        for payload in (b"x" * 25_000 + b"\n", b'{"op":1}\n{}\n', b'[]\n'):
            result = self.exchange(os.getuid(), payload, lambda *_: {"ok": True})
            self.assertEqual(result, {"ok": False, "error": "rejected"})


class GiglCapabilityBrokerTests(unittest.TestCase):
    def test_extractor_retains_only_provisioned_lock_group(self):
        calls = []
        with patch("worker_release_staging.broker.os.setgroups", side_effect=lambda value: calls.append(("groups", value))), \
                patch("worker_release_staging.broker.os.setgid", side_effect=lambda value: calls.append(("gid", value))), \
                patch("worker_release_staging.broker.os.setuid", side_effect=lambda value: calls.append(("uid", value))):
            _drop_extractor_privileges(2002, 2003, 2004)
        self.assertEqual(calls, [("groups", [2004]), ("gid", 2003), ("uid", 2002)])

    def test_gigl_operation_requires_installed_sha_to_equal_authenticated_sha(self):
        sha = "a" * 40
        self.assertEqual(_validate_gigl_release_sha(sha, sha), sha)
        with self.assertRaisesRegex(BrokerProtocolError, "authenticated SHA"):
            _validate_gigl_release_sha("b" * 40, sha)
        with self.assertRaisesRegex(BrokerProtocolError, "authenticated SHA"):
            _validate_gigl_release_sha("invalid", sha)

    def test_runs_only_the_fixed_helper_as_worker_and_accepts_safe_receipt(self):
        sha = "a" * 40
        fingerprint = "c" * 64
        output = json.dumps({
            "smokePassed": True, "scope": "enabled",
            "installedSha": sha, "credentialFingerprint": fingerprint,
        }).encode()
        with patch("worker_release_broker.grp.getgrnam", return_value=type("Group", (), {"gr_gid": 2345})()), \
                patch("worker_release_broker._assert_root_owned_executable") as assert_executable, \
                patch("worker_release_broker.subprocess.run", return_value=subprocess.CompletedProcess([], 0, output, b"")) as run:
            result = _run_gigl_capability_smoke("/srv/baci-workers", 2002, 2003, sha)
        assert_executable.assert_called_once_with("/srv/baci-workers/current/bin/gigl-capability-smoke-latch.sh")
        args, kwargs = run.call_args
        self.assertEqual(args[0], ["/srv/baci-workers/current/bin/gigl-capability-smoke-latch.sh"])
        self.assertEqual(kwargs["user"], 2002)
        self.assertEqual(kwargs["group"], 2003)
        self.assertEqual(kwargs["extra_groups"], (2345,))
        self.assertEqual(kwargs["env"], {
            "PATH": "/usr/bin:/bin", "HOME": "/srv/baci-workers",
            "BACI_WORKER_ROOT": "/srv/baci-workers", "BACI_EXPECTED_APP_SHA": sha,
        })
        self.assertEqual(result["scope"], "enabled")
        self.assertEqual(result["installedSha"], sha)
        self.assertEqual(result["credentialFingerprint"], fingerprint)

    def test_rejects_failure_or_non_allowlisted_receipt_data(self):
        sha = "b" * 40
        valid = {"smokePassed": True, "scope": "disabled", "installedSha": sha, "credentialFingerprint": "d" * 64}
        for returncode, receipt in (
            (1, valid),
            (0, {**valid, "credential": "must-not-pass"}),
            (0, {**valid, "scope": "unexpected"}),
            (0, {**valid, "credentialFingerprint": "not-a-fingerprint"}),
        ):
            with self.subTest(returncode=returncode, receipt=receipt):
                with patch("worker_release_broker._assert_root_owned_executable"), patch(
                    "worker_release_broker.subprocess.run",
                    return_value=subprocess.CompletedProcess([], returncode, json.dumps(receipt).encode(), b"provider secret"),
                ):
                    with self.assertRaises(BrokerProtocolError):
                        _run_gigl_capability_smoke("/srv/baci-workers", 2002, 2003, sha)

    def test_gigl_lock_accepts_only_provisioned_root_shared_inode(self):
        with tempfile.TemporaryDirectory(prefix="baci-gigl-lock-") as temp:
            lock_dir = Path(temp) / "locks"
            lock_dir.mkdir()
            lock_path = lock_dir / "gigl-tracking.lock"
            lock_path.touch(mode=0o660)
            metadata = SimpleNamespace(
                st_mode=stat.S_IFREG | 0o660, st_uid=0, st_gid=2345, st_nlink=1,
            )
            with patch("worker_release_gigl.broker.grp.getgrnam", return_value=SimpleNamespace(gr_gid=2345)), \
                    patch("worker_release_gigl.broker.os.fstat", return_value=metadata), \
                    patch("worker_release_gigl.broker.fcntl.flock"):
                fd = _acquire_gigl_tracking_lock(temp)
                os.close(fd)

            for invalid in (
                SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=0, st_gid=2346, st_nlink=1),
                SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=2002, st_gid=2345, st_nlink=1),
                SimpleNamespace(st_mode=stat.S_IFREG | 0o640, st_uid=0, st_gid=2345, st_nlink=1),
                SimpleNamespace(st_mode=stat.S_IFREG | 0o660, st_uid=0, st_gid=2345, st_nlink=2),
            ):
                with self.subTest(metadata=invalid), \
                        patch("worker_release_gigl.broker.grp.getgrnam", return_value=SimpleNamespace(gr_gid=2345)), \
                        patch("worker_release_gigl.broker.os.fstat", return_value=invalid):
                    with self.assertRaisesRegex(BrokerProtocolError, "lock is invalid"):
                        _acquire_gigl_tracking_lock(temp)

    def test_broker_persists_only_atomic_0600_latch_metadata(self):
        from worker_release_broker import _write_gigl_capability_latch

        with tempfile.TemporaryDirectory(prefix="baci-gigl-latch-write-") as temp:
            fingerprint = "e" * 64
            _write_gigl_capability_latch(temp, "enabled", "f" * 40, fingerprint)
            latch = Path(temp) / ".gigl-capability-smoke-ok"
            self.assertEqual(latch.read_text(encoding="ascii"), f"enabled:{'f' * 40}:{fingerprint}\n")
            self.assertEqual(stat.S_IMODE(latch.stat().st_mode), 0o600)
            self.assertEqual(latch.stat().st_uid, os.getuid())
            self.assertEqual(
                [path.name for path in Path(temp).iterdir() if path.name.startswith(".gigl-capability-smoke-ok.")],
                [],
            )

    def test_broker_refuses_invalid_latch_destination_and_identity(self):
        from worker_release_broker import _write_gigl_capability_latch

        with tempfile.TemporaryDirectory(prefix="baci-gigl-latch-invalid-") as temp:
            latch = Path(temp) / ".gigl-capability-smoke-ok"
            latch.mkdir()
            with self.assertRaises(BrokerProtocolError):
                _write_gigl_capability_latch(temp, "enabled", "a" * 40, "b" * 64)
            with self.assertRaises(BrokerProtocolError):
                _write_gigl_capability_latch(temp, "invalid", "a" * 40, "b" * 64)


class SafeArchiveTests(unittest.TestCase):
    def extract(self, entries, *, limit=1024):
        temp = tempfile.TemporaryDirectory(prefix="baci-broker-extract-")
        self.addCleanup(temp.cleanup)
        destination = Path(temp.name) / "release"
        destination.mkdir(mode=0o700)
        count = extract_github_tarball(make_archive(entries), str(destination), max_expanded_bytes=limit)
        return destination, count

    def test_extracts_files_and_directories_beneath_the_single_github_root(self):
        destination, count = self.extract([
            directory("repo-deadbeef/"),
            directory("repo-deadbeef/jobs/"),
            regular("repo-deadbeef/jobs/worker.mjs", b"worker", 0o755),
        ])
        self.assertEqual(count, 2)
        target = destination / "jobs" / "worker.mjs"
        self.assertEqual(target.read_bytes(), b"worker")
        self.assertEqual(target.stat().st_mode & 0o777, 0o750)

    def test_rejects_traversal_absolute_paths_links_and_special_files(self):
        symlink = tarfile.TarInfo("repo/link")
        symlink.type = tarfile.SYMTYPE
        symlink.linkname = "../../outside"
        hardlink = tarfile.TarInfo("repo/hardlink")
        hardlink.type = tarfile.LNKTYPE
        hardlink.linkname = "repo/file"
        fifo = tarfile.TarInfo("repo/fifo")
        fifo.type = tarfile.FIFOTYPE
        malicious = [
            [regular("repo/../outside", b"bad")],
            [regular("/absolute", b"bad")],
            [(symlink, None)],
            [(hardlink, None)],
            [(fifo, None)],
        ]
        for entries in malicious:
            with self.subTest(entries=entries):
                temp = tempfile.TemporaryDirectory(prefix="baci-broker-reject-")
                self.addCleanup(temp.cleanup)
                destination = Path(temp.name) / "release"
                destination.mkdir(mode=0o700)
                with self.assertRaises(BrokerProtocolError):
                    extract_github_tarball(make_archive(entries), str(destination))
                self.assertFalse((Path(temp.name) / "outside").exists())

    def test_rejects_duplicate_entries_multiple_roots_and_expansion_overflow(self):
        invalid = [
            [regular("repo/file"), regular("repo/file")],
            [regular("repo-a/file"), regular("repo-b/file")],
        ]
        for entries in invalid:
            with self.subTest(entries=entries):
                temp = tempfile.TemporaryDirectory(prefix="baci-broker-duplicate-")
                self.addCleanup(temp.cleanup)
                destination = Path(temp.name) / "release"
                destination.mkdir(mode=0o700)
                with self.assertRaises(BrokerProtocolError):
                    extract_github_tarball(make_archive(entries), str(destination))
        temp = tempfile.TemporaryDirectory(prefix="baci-broker-size-")
        self.addCleanup(temp.cleanup)
        destination = Path(temp.name) / "release"
        destination.mkdir(mode=0o700)
        with self.assertRaisesRegex(BrokerProtocolError, "size limit"):
            extract_github_tarball(make_archive([regular("repo/file", b"12345")]), str(destination), max_expanded_bytes=4)


class AtomicStageTests(unittest.TestCase):
    def test_publishes_complete_tree_under_sha_and_removes_incoming_name(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-stage-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            sha = "a" * 40
            archive = make_archive([directory("repo/"), regular("repo/worker.mjs", b"ready")]).getvalue()
            with patch("worker_release_broker._run_as_worker_extractor", side_effect=lambda raw, path, _uid, _gid: extract_github_tarball(io.BytesIO(raw), path)), patch("worker_release_broker._freeze_release_tree", side_effect=lambda path, gid: _freeze_release_tree(path, gid, owner_uid=os.getuid())):
                count = _stage_archive(archive, str(releases), sha, os.getuid(), os.getgid())
            self.assertEqual(count, 1)
            self.assertEqual((releases / sha / "worker.mjs").read_bytes(), b"ready")
            self.assertEqual((releases / sha / "worker.mjs").stat().st_mode & 0o777, 0o440)
            self.assertFalse((releases / f".{sha}.incoming").exists())

    def test_github_archive_materializes_and_executes_worker_runtime_paths(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-layout-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            sha = "e" * 40
            wrapper = Path(__file__).with_name("process-domain-events.sh").read_bytes()
            stub_runner = b'#!/bin/sh\nprintf "%s|%s" "$1" "$2" > "$BACI_TEST_MARKER"\n'
            entries = [
                regular("repo/vps-workers/bin/process-domain-events.sh", wrapper, mode=0o755),
                regular("repo/vps-workers/bin/run-web-script.sh", stub_runner, mode=0o755),
                regular("repo/vps-workers/jobs/run-cache-invalidation-cron.mjs", b"export {};\n"),
                regular("repo/vps-workers/lib/gigl-tracking-scoped-env.sh", b"# scoped env\n"),
                regular("repo/vps-workers/config/worker.json", b"{}\n"),
                regular("repo/vps-workers/systemd/baci-event-delivery-worker.service", b"[Service]\n"),
            ]
            archive = make_archive(entries).getvalue()
            with patch("worker_release_broker._run_as_worker_extractor", side_effect=lambda raw, path, _uid, _gid: extract_github_tarball(io.BytesIO(raw), path)), \
                    patch("worker_release_broker._freeze_release_tree", side_effect=lambda path, gid: _freeze_release_tree(path, gid, owner_uid=os.getuid())):
                _stage_archive(archive, str(releases), sha, os.getuid(), os.getgid())
            release = releases / sha
            current = Path(temp) / "current"
            current.symlink_to(Path("releases") / sha)
            for path in (
                "bin/process-domain-events.sh", "bin/run-web-script.sh",
                "jobs/run-cache-invalidation-cron.mjs", "lib/gigl-tracking-scoped-env.sh",
                "config/worker.json", "systemd/baci-event-delivery-worker.service",
            ):
                self.assertTrue((current / path).is_file(), path)
            marker = Path(temp) / "wrapper-executed"
            subprocess.run(
                [str(current / "bin/process-domain-events.sh")], check=True,
                env={**os.environ, "BACI_TEST_MARKER": str(marker)},
            )
            self.assertEqual(marker.read_text(), "process-domain-events|src/scripts/process-domain-events.ts")
            self.assertEqual((release / "bin/process-domain-events.sh").stat().st_mode & 0o777, 0o550)

    def test_failed_extraction_cleans_partial_stage_and_allows_retry(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-stage-fail-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            sha = "b" * 40
            bad_archive = make_archive([regular("repo/../escape", b"bad")]).getvalue()
            with patch("worker_release_broker._run_as_worker_extractor", side_effect=lambda raw, path, _uid, _gid: extract_github_tarball(io.BytesIO(raw), path)), patch("worker_release_broker._freeze_release_tree", side_effect=lambda path, gid: _freeze_release_tree(path, gid, owner_uid=os.getuid())):
                with self.assertRaises(BrokerProtocolError):
                    _stage_archive(bad_archive, str(releases), sha, os.getuid(), os.getgid())
            self.assertFalse((releases / f".{sha}.incoming").exists())
            self.assertFalse((releases / sha).exists())
            good_archive = make_archive([regular("repo/worker.mjs", b"retry")]).getvalue()
            with patch("worker_release_broker._run_as_worker_extractor", side_effect=lambda raw, path, _uid, _gid: extract_github_tarball(io.BytesIO(raw), path)), patch("worker_release_broker._freeze_release_tree", side_effect=lambda path, gid: _freeze_release_tree(path, gid, owner_uid=os.getuid())):
                _stage_archive(good_archive, str(releases), sha, os.getuid(), os.getgid())
            self.assertEqual((releases / sha / "worker.mjs").read_bytes(), b"retry")

    def test_refuses_existing_final_release(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-stage-existing-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            sha = "c" * 40
            (releases / sha).mkdir()
            with self.assertRaisesRegex(BrokerProtocolError, "already exists"):
                _stage_archive(b"unused", str(releases), sha, os.getuid(), os.getgid())


class ReadOnlyPreflightTests(unittest.TestCase):
    def test_accepts_only_complete_immutable_root_owned_tree(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-preflight-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            release = releases / ("d" * 40)
            release.mkdir(mode=0o750)
            (release / "worker.mjs").write_text("ready")
            (release / "worker.mjs").chmod(0o440)
            release.chmod(0o550)
            self.assertEqual(_validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid()), 1)
            (release / "worker.mjs").chmod(0o640)
            with self.assertRaisesRegex(BrokerProtocolError, "file ownership or mode"):
                _validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid())

    def test_rejects_symlinked_release_content(self):
        with tempfile.TemporaryDirectory(prefix="baci-broker-preflight-link-") as temp:
            releases = Path(temp) / "releases"
            releases.mkdir()
            release = releases / ("e" * 40)
            release.mkdir(mode=0o750)
            (release / "worker.mjs").symlink_to("/etc/passwd")
            release.chmod(0o550)
            try:
                with self.assertRaisesRegex(BrokerProtocolError, "file ownership or mode"):
                    _validate_staged_release(str(releases), release.name, os.getgid(), owner_uid=os.getuid())
            finally:
                release.chmod(0o750)


class PromotionFailureStateTests(unittest.TestCase):
    def test_successful_pointer_promotion_is_not_marked_healthy_before_probe(self):
        writes = []
        fence = {"run_id": "123", "sha": "a" * 40}
        with patch("worker_release_broker._write_release_state", side_effect=lambda path, state: writes.append(state)):
            _record_promotion_success("/unused", "a" * 40, "b" * 40, fence)
        self.assertEqual(writes[-1]["status"], "promoted")
        self.assertNotEqual(writes[-1]["status"], "healthy")

    def test_only_typed_confirmed_restore_errors_can_clear_the_recovery_barrier(self):
        self.assertTrue(_promotion_restore_confirmed(ReleaseHealthRejected("probe returned unhealthy")))
        self.assertTrue(_promotion_restore_confirmed(ReleaseHealthProbeError("probe raised")))
        self.assertFalse(_promotion_restore_confirmed(LifecycleRejected("restore failed")))
        self.assertFalse(_promotion_restore_confirmed(OSError("pointer restore failed")))

    def test_only_confirmed_restore_is_recorded_as_rolled_back(self):
        writes = []
        fence = {"run_id": "123", "sha": "a" * 40}
        with patch("worker_release_broker._write_release_state", side_effect=lambda path, state: writes.append(state)):
            status = _record_promotion_failure("/unused", "a" * 40, "b" * 40, fence, restored=True)
            self.assertEqual(status, "rolled_back")
            self.assertEqual(writes[-1]["status"], "rolled_back")

            status = _record_promotion_failure("/unused", "c" * 40, "b" * 40, fence, restored=False)
            self.assertEqual(status, "recovery_required")
            self.assertEqual(writes[-1]["status"], "recovery_required")


if __name__ == "__main__":
    unittest.main()

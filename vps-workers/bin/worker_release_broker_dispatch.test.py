"""Dispatch-to-authenticated-stage handoff contract tests."""
from __future__ import annotations

import base64
import hashlib
import json
import os
import socket
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).parent))

import worker_release_broker as broker
import worker_release_broker_dispatch as dispatch
import worker_release_authenticated_staging as staging
import worker_release_dependency_builder as builder


class AuthenticatedStageDispatchTests(unittest.TestCase):
    def setUp(self):
        self.sha = "a" * 40
        data = b"authenticated archive bytes"
        self.digest = hashlib.sha256(data).hexdigest()
        self.verified = {
            "operation": "stage", "sourceSha": self.sha,
            "repository": "ogabasseyy/Baci",
            "workflow": ".github/workflows/production-release.yml",
            "ref": "refs/heads/main", "status": "in_progress",
            "runId": "123", "runAttempt": 2, "jobId": "456",
            "archiveSha256": self.digest,
            "archiveBase64": base64.b64encode(data).decode("ascii"),
        }

    def test_authenticated_envelope_is_forwarded_unchanged_to_pipeline(self):
        result = {"phase": "committed", "source_sha": self.sha,
                  "archive_sha256": self.digest, "entry_count": 17}
        with (patch.object(staging, "stage_authenticated_archive", return_value=result) as stage,
              patch.object(builder, "BUILD_ROOT", Path("/run/fixed-builder")),
              patch.object(builder, "BUILD_RESULTS_ROOT", Path("/run/fixed-builder/results")),
              patch.object(builder, "build") as build):
            receipt = dispatch._stage_authenticated_release(self.verified, self.sha, 81)
        self.assertEqual(receipt, result)
        stage.assert_called_once()
        args, kwargs = stage.call_args
        self.assertEqual(args[0], self.verified)
        identity = args[1]
        self.assertEqual(identity.repository, self.verified["repository"])
        self.assertEqual(identity.workflow, self.verified["workflow"])
        self.assertEqual(identity.ref, self.verified["ref"])
        self.assertEqual(identity.sha, self.sha)
        self.assertEqual(identity.run_id, "123")
        self.assertEqual(identity.run_attempt, 2)
        self.assertEqual(identity.job_id, "456")
        self.assertEqual(identity.status, "in_progress")
        self.assertEqual(kwargs["expected_archive_sha256"], self.digest)
        self.assertEqual(kwargs["worker_gid"], 81)
        self.assertEqual(kwargs["result_root"], Path("/run/fixed-builder/results"))
        self.assertIs(kwargs["builder"], build)
        self.assertEqual(kwargs["builder_build_root"], Path("/run/fixed-builder"))
        self.assertEqual(kwargs["builder_results_root"], Path("/run/fixed-builder/results"))

    def test_bad_verified_identity_is_rejected_before_pipeline(self):
        self.verified["jobId"] = "0"
        with patch.object(staging, "stage_authenticated_archive") as stage:
            with self.assertRaises(broker.BrokerProtocolError):
                dispatch._stage_authenticated_release(self.verified, self.sha, 81)
        stage.assert_not_called()

    def test_uncommitted_or_mismatched_stage_receipt_is_rejected(self):
        result = {"phase": "published", "source_sha": self.sha,
                  "archive_sha256": self.digest, "entry_count": 17}
        with (patch.object(staging, "stage_authenticated_archive", return_value=result),
              patch.object(builder, "BUILD_ROOT", Path("/run/fixed-builder")),
              patch.object(builder, "BUILD_RESULTS_ROOT", Path("/run/fixed-builder/results")),
              patch.object(builder, "build")):
            with self.assertRaises(broker.BrokerProtocolError):
                dispatch._stage_authenticated_release(self.verified, self.sha, 81)

    def test_fixed_dispatch_passes_only_verified_archive_envelope_to_pipeline(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            releases = root / "releases"
            releases.mkdir()
            verified = {**self.verified, "sourceSha": self.sha}
            stage_result = {"phase": "committed", "source_sha": self.sha,
                            "archive_sha256": self.digest, "entry_count": 17}
            quiescence = SimpleNamespace(recovery_latch=lambda: None,
                                         is_active_for=lambda _fence: False)
            root_metadata = SimpleNamespace(st_mode=0o40755, st_uid=0, st_gid=0)
            with (patch.object(broker.os, "geteuid", return_value=0),
                  patch.object(broker, "WORKER_ROOT", str(root)),
                  patch.object(broker.os.path, "realpath", return_value=str(root)),
                  patch.object(broker, "_assert_root_owned_executable"),
                  patch.object(broker.os, "stat", return_value=root_metadata),
                  patch("worker_release_quiesce_lease.WorkerQuiesceLeaseManager",
                        return_value=quiescence),
                  patch.object(broker.subprocess, "run", return_value=SimpleNamespace(
                      returncode=0, stdout=(json.dumps(verified) + "\n").encode("utf-8"))),
                  patch.object(dispatch, "_stage_authenticated_release",
                               return_value=stage_result) as stage):
                fixed = dispatch.make_fixed_release_dispatch(
                    release_uid=1001, worker_uid=1002, worker_gid=81)
                receipt = fixed(1001, {"operation": "stage", "sourceSha": self.sha,
                                       "bundleSha256": self.digest})
            self.assertEqual(receipt, {"ok": True, "operation": "stage",
                                       "sourceSha": self.sha, "entryCount": 17})
            stage.assert_called_once_with(verified, self.sha, 81)

    def test_stage_recovery_dispatch_uses_only_verified_terminal_target(self):
        target = {"sha": "b" * 40, "run_id": "99", "run_attempt": 3, "job_id": "88"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "releases").mkdir()
            verified = {**self.verified, "operation": "stage-recovery",
                        "sourceSha": self.sha, "recoveryOf": target}
            quiescence = SimpleNamespace(recovery_latch=lambda: None,
                                         is_active_for=lambda _fence: False)
            root_metadata = SimpleNamespace(st_mode=0o40755, st_uid=0, st_gid=0)
            with (patch.object(broker.os, "geteuid", return_value=0),
                  patch.object(broker, "WORKER_ROOT", str(root)),
                  patch.object(broker.os.path, "realpath", return_value=str(root)),
                  patch.object(broker, "_assert_root_owned_executable"),
                  patch.object(broker.os, "stat", return_value=root_metadata),
                  patch("worker_release_quiesce_lease.WorkerQuiesceLeaseManager",
                        return_value=quiescence),
                  patch.object(broker.subprocess, "run", return_value=SimpleNamespace(
                      returncode=0, stdout=(json.dumps(verified) + "\n").encode("utf-8"))),
                  patch("worker_release_authenticated_staging_recovery.recover_interrupted_stage",
                        return_value="recovered") as recover):
                fixed = dispatch.make_fixed_release_dispatch(
                    release_uid=1001, worker_uid=1002, worker_gid=81)
                receipt = fixed(1001, {"operation": "stage-recovery", "sourceSha": self.sha,
                                       "recoveryOf": target})
            self.assertEqual(receipt["operation"], "stage-recovery")
            self.assertEqual(receipt["recoveredFence"], target)
            self.assertIs(receipt["recovered"], True)
            self.assertEqual(recover.call_args.kwargs["expected_target"], target)
            self.assertEqual(recover.call_args.kwargs["worker_gid"], 81)

    def test_recovery_status_includes_stage_fence_from_journal_reader(self):
        target = {"sha": "b" * 40, "run_id": "99", "run_attempt": 3, "job_id": "88"}
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / "releases").mkdir()
            verified = {**self.verified, "operation": "recovery-status", "sourceSha": self.sha}
            quiescence = SimpleNamespace(recovery_latch=lambda: None,
                                         is_active_for=lambda _fence: False)
            root_metadata = SimpleNamespace(st_mode=0o40755, st_uid=0, st_gid=0)
            with (patch.object(broker.os, "geteuid", return_value=0),
                  patch.object(broker, "WORKER_ROOT", str(root)),
                  patch.object(broker.os.path, "realpath", return_value=str(root)),
                  patch.object(broker, "_assert_root_owned_executable"),
                  patch.object(broker.os, "stat", return_value=root_metadata),
                  patch("worker_release_quiesce_lease.WorkerQuiesceLeaseManager",
                        return_value=quiescence),
                  patch.object(broker.subprocess, "run", return_value=SimpleNamespace(
                      returncode=0, stdout=(json.dumps(verified) + "\n").encode("utf-8"))),
                  patch("worker_release_recovery_dispatch.status", return_value={
                      "ok": True, "operation": "recovery-status", "sourceSha": self.sha,
                      "pending": False,
                  }),
                  patch("worker_release_authenticated_staging_recovery.stage_recovery_status",
                        return_value={"pending": True, "target": target})):
                fixed = dispatch.make_fixed_release_dispatch(
                    release_uid=1001, worker_uid=1002, worker_gid=81)
                receipt = fixed(1001, {"operation": "recovery-status", "sourceSha": self.sha})
            self.assertEqual(receipt["stageRecovery"], {"pending": True, "target": target})


class BrokerDrainTests(unittest.TestCase):
    def test_shutdown_finishes_admitted_mutation_and_drops_queued_request(self):
        with tempfile.TemporaryDirectory() as temporary:
            listener = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            listener.bind(str(Path(temporary) / "broker.sock"))
            listener.listen(4)
            stop_event = threading.Event()
            dispatch_started = threading.Event()
            finish_dispatch = threading.Event()
            dispatched = []
            server_errors = []

            def dispatch(peer_uid, request):
                dispatched.append(request["sequence"])
                if request["sequence"] == 1:
                    dispatch_started.set()
                    if not finish_dispatch.wait(3):
                        raise TimeoutError("test dispatch did not receive release signal")
                return {"ok": True, "sequence": request["sequence"]}

            def serve():
                try:
                    broker.serve_forever(
                        listener, expected_release_uid=os.getuid(), dispatch=dispatch,
                        stop_event=stop_event, accept_poll_seconds=0.05,
                    )
                except BaseException as error:
                    server_errors.append(error)

            server = threading.Thread(target=serve)
            server.start()
            first = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            second = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
            try:
                first.connect(listener.getsockname())
                first.sendall(b'{"sequence":1}\n')
                self.assertTrue(dispatch_started.wait(2),
                                f"first mutation was not admitted; server errors={server_errors!r}")
                second.connect(listener.getsockname())
                second.sendall(b'{"sequence":2}\n')
                stop_event.set()
                finish_dispatch.set()
                first.settimeout(2)
                response = b""
                while not response.endswith(b"\n"):
                    chunk = first.recv(4096)
                    if not chunk:
                        break
                    response += chunk
                server.join(2)
                self.assertFalse(server.is_alive(), "broker did not exit after draining")
                listener.close()
                self.assertEqual(json.loads(response), {"ok": True, "sequence": 1})
                self.assertEqual(dispatched, [1], "queued request ran after drain began")
                self.assertEqual(server_errors, [])
                second.settimeout(2)
                self.assertEqual(second.recv(4096), b"")
            finally:
                stop_event.set()
                finish_dispatch.set()
                first.close()
                second.close()
                listener.close()
                server.join(2)


if __name__ == "__main__":
    unittest.main()

#!/usr/bin/env python3
"""Tests for the fixed authenticated stage-fence revalidation subprocess."""
from __future__ import annotations

import json
import subprocess
import unittest
from unittest.mock import Mock

from worker_release_broker_stage_fence import StageFenceRejected, revalidate_active_stage_fence
from worker_release_lifecycle import AuthenticatedRun


IDENTITY = AuthenticatedRun.from_broker({
    "repository": "ogabasseyy/Baci",
    "workflow": ".github/workflows/production-release.yml",
    "ref": "refs/heads/main",
    "sha": "a" * 40,
    "run_id": "123456", "run_attempt": 2, "job_id": "654321",
    "status": "in_progress",
}, expected_sha="a" * 40)


class BrokerStageFenceTests(unittest.TestCase):
    def test_uses_fixed_internal_dispatcher_and_keeps_token_out_of_argv_and_env(self):
        expected = {**IDENTITY.fence(), "status": "in_progress", "active": True}
        runner = Mock(return_value=subprocess.CompletedProcess(
            args=[], returncode=0,
            stdout=(json.dumps(expected, separators=(",", ":")) + "\n").encode(),
        ))
        result = revalidate_active_stage_fence(
            IDENTITY, "sensitive-github-token", node="/usr/bin/node",
            dispatcher="/usr/local/lib/broker/dispatcher.mjs", peer_uid=1001,
            release_uid=1001, worker_uid=1002, runner=runner,
        )
        self.assertIs(result, IDENTITY)
        args, kwargs = runner.call_args
        self.assertNotIn("sensitive-github-token", args[0])
        self.assertNotIn("sensitive-github-token", kwargs["env"].values())
        request = json.loads(kwargs["input"])
        self.assertEqual(request["githubToken"], "sensitive-github-token")
        self.assertEqual(request["fence"], {key: value for key, value in expected.items()
                                             if key != "active"})
        self.assertEqual(kwargs["env"]["BACI_BROKER_INTERNAL_FENCE_CHECK"], "1")
        self.assertIs(kwargs["stderr"], subprocess.DEVNULL)

    def test_rejects_mismatched_identity_response(self):
        wrong = {**IDENTITY.fence(), "status": "in_progress", "active": True,
                 "sha": "b" * 40}
        result = subprocess.CompletedProcess(
            args=[], returncode=0, stdout=(json.dumps(wrong) + "\n").encode())
        with self.assertRaisesRegex(StageFenceRejected, "does not match"):
            revalidate_active_stage_fence(
                IDENTITY, "token", node="/usr/bin/node", dispatcher="/fixed/dispatch.mjs",
                peer_uid=1001, release_uid=1001, worker_uid=1002, runner=Mock(return_value=result),
            )

    def test_rejects_process_error_and_invalid_context_without_invoking_runner(self):
        runner = Mock(side_effect=OSError("synthetic"))
        with self.assertRaisesRegex(StageFenceRejected, "revalidation failed"):
            revalidate_active_stage_fence(
                IDENTITY, "token", node="/usr/bin/node", dispatcher="/fixed/dispatch.mjs",
                peer_uid=1001, release_uid=1001, worker_uid=1002, runner=runner,
            )
        with self.assertRaises(StageFenceRejected):
            revalidate_active_stage_fence(
                IDENTITY, "token", node="/usr/bin/node", dispatcher="/fixed/dispatch.mjs",
                peer_uid=1001, release_uid=1003, worker_uid=1002, runner=runner,
            )
        self.assertEqual(runner.call_count, 1)


if __name__ == "__main__":
    unittest.main()

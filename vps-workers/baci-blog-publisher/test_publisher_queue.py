import io
import json
from pathlib import Path
import tempfile
import unittest
import urllib.error
from unittest.mock import patch

import publisher

USER = "11111111-1111-1111-1111-111111111111"
FIRST = "22222222-2222-2222-2222-222222222222"
SECOND = "44444444-4444-4444-4444-444444444444"
POST = "33333333-3333-3333-3333-333333333333"
CONFIG = {"user_id": USER, "api_key": "sb_publishable_test", "email": "test", "password": "test"}


class PublisherQueueTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.state = Path(directory.name) / "state.json"
        self.responses = [
            {"access_token": "test"}, {"id": USER},
            [{"release_id": FIRST, "title": "First"}, {"release_id": SECOND, "title": "Second"}],
        ]

    @patch("publisher.verify_public_page", return_value="https://usebaci.com/blog/second")
    @patch("publisher.api_request")
    def test_publish_failure_does_not_block_later_release(self, api, verify):
        api.side_effect = self.responses + [
            urllib.error.HTTPError("https://example.test", 409, "private provider detail", {}, None),
            {"post_id": POST, "slug": "second", "replayed": False},
        ]
        results = publisher.run(CONFIG, self.state)
        self.assertEqual(results[0], {"release_id": FIRST, "status": "failed", "http_status": 409})
        self.assertEqual(results[1]["release_id"], SECOND)
        self.assertEqual(api.call_count, 5)
        verify.assert_called_once_with("second", "Second")
        self.assertTrue(json.loads(self.state.read_text())[SECOND]["verified"])

    @patch("publisher.verify_public_page", side_effect=[ValueError("private error detail"), "https://usebaci.com/blog/second"])
    @patch("publisher.api_request")
    def test_verification_failure_preserves_receipt_and_continues(self, api, verify):
        api.side_effect = self.responses + [
            {"post_id": POST, "slug": "first", "replayed": False},
            {"post_id": POST, "slug": "second", "replayed": False},
        ]
        results = publisher.run(CONFIG, self.state)
        self.assertEqual(results[0], {"release_id": FIRST, "status": "failed", "post_id": POST, "error_type": "ValueError"})
        self.assertEqual(results[1]["release_id"], SECOND)
        state = json.loads(self.state.read_text())
        self.assertFalse(state[FIRST]["verified"])
        self.assertEqual(state[FIRST]["post_id"], POST)
        self.assertTrue(state[SECOND]["verified"])

    @patch("publisher.read_config", return_value=CONFIG)
    @patch("publisher.run", return_value=[{"release_id": FIRST, "status": "failed", "http_status": 409}])
    def test_cli_failure_is_nonzero_and_identifies_release(self, run, read):
        with patch("sys.argv", ["publisher.py"]), patch("sys.stdout", new_callable=io.StringIO) as output:
            self.assertEqual(publisher.main(), 1)
        result = json.loads(output.getvalue())
        self.assertEqual(result["status"], "failed")
        self.assertEqual(result["releases"][0]["release_id"], FIRST)

    @patch("publisher.read_config", return_value=CONFIG)
    @patch("publisher.run")
    def test_cli_success_and_dry_run_remain_successful(self, run, read):
        for args, status in [([], "completed"), (["--dry-run"], "dry_run")]:
            with self.subTest(status=status):
                run.return_value = [{"release_id": SECOND, "title": "Second"}]
                with patch("sys.argv", ["publisher.py", *args]), patch("sys.stdout", new_callable=io.StringIO) as output:
                    self.assertEqual(publisher.main(), 0)
                self.assertEqual(json.loads(output.getvalue())["status"], status)
                self.assertEqual(run.call_args.kwargs["dry_run"], bool(args))

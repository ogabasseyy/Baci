import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import publisher

RELEASE = "22222222-2222-2222-2222-222222222222"
USER = "11111111-1111-1111-1111-111111111111"
POST = "33333333-3333-3333-3333-333333333333"
CONFIG = {"user_id": USER, "api_key": "sb_publishable_test", "email": "test", "password": "test"}


class PublisherTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.state = Path(self.directory.name) / "state.json"

    def responses(self):
        return [
            {"access_token": "test"}, {"id": USER},
            [{"release_id": RELEASE, "title": "Approved"}],
            {"post_id": POST, "slug": "approved", "replayed": False},
        ]

    @patch("publisher.verify_public_page", return_value="https://usebaci.com/blog/approved")
    @patch("publisher.api_request")
    def test_publishes_only_release_id_and_verifies(self, api, verify):
        api.side_effect = self.responses()
        self.assertEqual(publisher.run(CONFIG, self.state)[0]["post_id"], POST)
        self.assertEqual(api.call_args.args[3], {"p_release_id": RELEASE})
        self.assertTrue(json.loads(self.state.read_text())[RELEASE]["verified"])
        verify.assert_called_once_with("approved", "Approved")

    @patch("publisher.api_request")
    def test_dry_run_never_publishes(self, api):
        api.side_effect = self.responses()[:3]
        self.assertEqual(len(publisher.run(CONFIG, self.state, dry_run=True)), 1)
        self.assertEqual(api.call_count, 3)
        self.assertFalse(self.state.exists())

    @patch("publisher.api_request")
    def test_identity_mismatch_fails_before_listing(self, api):
        api.side_effect = [{"access_token": "test"}, {"id": POST}]
        with self.assertRaisesRegex(ValueError, "identity mismatch"):
            publisher.run(CONFIG, self.state)
        self.assertEqual(api.call_count, 2)

    @patch("publisher.verify_public_page", side_effect=ValueError("Not live"))
    @patch("publisher.api_request")
    def test_public_verification_failure_remains_retryable(self, api, verify):
        api.side_effect = self.responses()
        with self.assertRaises(ValueError):
            publisher.run(CONFIG, self.state)
        self.assertFalse(json.loads(self.state.read_text())[RELEASE]["verified"])

    @patch("publisher.api_request")
    def test_verified_release_is_skipped(self, api):
        publisher.save_state(self.state, {RELEASE: {"verified": True}})
        api.side_effect = self.responses()[:3]
        self.assertEqual(publisher.run(CONFIG, self.state), [])
        self.assertEqual(api.call_count, 3)

    def test_world_readable_credentials_rejected(self):
        config = Path(self.directory.name) / "config.json"
        config.write_text(json.dumps(CONFIG))
        config.chmod(0o644)
        with self.assertRaisesRegex(ValueError, "private regular file"):
            publisher.read_config(config)

    def test_public_key_config_accepted(self):
        config = Path(self.directory.name) / "config.json"
        config.write_text(json.dumps(CONFIG))
        config.chmod(0o600)
        self.assertEqual(publisher.read_config(config)["user_id"], USER)

    def test_service_key_rejected(self):
        import base64
        claims = base64.urlsafe_b64encode(b'{"role":"service_role"}').decode()
        config = Path(self.directory.name) / "config.json"
        config.write_text(json.dumps({**CONFIG, "api_key": f"header.{claims}.signature"}))
        config.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "public API key"):
            publisher.read_config(config)

    def test_secret_key_without_jwt_segments_rejected(self):
        config = Path(self.directory.name) / "config.json"
        config.write_text(json.dumps({**CONFIG, "api_key": "sb_secret_test"}))
        config.chmod(0o600)
        with self.assertRaisesRegex(ValueError, "public API key"):
            publisher.read_config(config)


if __name__ == "__main__":
    unittest.main()

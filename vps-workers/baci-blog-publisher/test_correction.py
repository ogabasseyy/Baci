import importlib
import unittest
from unittest.mock import patch


class CorrectionTests(unittest.TestCase):
    def setUp(self):
        try:
            self.module = importlib.import_module("correction")
        except ModuleNotFoundError:
            self.fail("Correction updater is not implemented")
        self.config = {"api_key": "public", "user_id": "11111111-1111-1111-1111-111111111111",
                       "email": "writer@example.test", "password": "test-only"}
        self.revision = "66666666-6666-6666-6666-666666666666"
        self.post = "df7c8d06-bfa2-4171-948e-548cb2f463a6"

    def test_rpc_receives_revision_only_under_verified_identity(self):
        result = {"revision_id": self.revision, "post_id": self.post, "replayed": False,
                  "slug": "baci-vs-bumpa-which-fits-your-nigerian-business-1791740380"}
        with patch.object(self.module, "api_request", side_effect=[
            {"access_token": "test-token"}, {"id": self.config["user_id"]}, result,
        ]) as request:
            self.assertEqual(self.module.apply_correction(self.config, self.revision, self.post), result)
        self.assertEqual(request.call_args_list[-1].args,
                         ("/rest/v1/rpc/apply_approved_baci_blog_correction", "public", "test-token",
                          {"p_revision_id": self.revision}))

    def test_wrong_auth_identity_cannot_call_correction_rpc(self):
        with patch.object(self.module, "api_request", side_effect=[
            {"access_token": "test-token"}, {"id": "different-user"},
        ]) as request:
            with self.assertRaisesRegex(ValueError, "identity"):
                self.module.apply_correction(self.config, self.revision, self.post)
        self.assertEqual(request.call_count, 2)

    def test_third_post_is_rejected_before_authentication(self):
        with patch.object(self.module, "api_request") as request:
            with self.assertRaisesRegex(ValueError, "scope"):
                self.module.apply_correction(self.config, self.revision, "33333333-3333-3333-3333-333333333333")
        request.assert_not_called()

    def test_mismatched_rpc_receipt_is_not_reported_as_complete(self):
        with patch.object(self.module, "api_request", side_effect=[
            {"access_token": "test-token"}, {"id": self.config["user_id"]},
            {"revision_id": self.revision, "post_id": "8642fd90-400b-4264-a954-f588da5ccd59"},
        ]):
            with self.assertRaisesRegex(ValueError, "receipt"):
                self.module.apply_correction(self.config, self.revision, self.post)

    def test_replayed_revision_is_accepted_without_submitting_content(self):
        result = {"revision_id": self.revision, "post_id": self.post, "replayed": True,
                  "slug": "baci-vs-bumpa-which-fits-your-nigerian-business-1791740380"}
        with patch.object(self.module, "api_request", side_effect=[
            {"access_token": "test-token"}, {"id": self.config["user_id"]}, result,
        ]):
            self.assertTrue(self.module.apply_correction(self.config, self.revision, self.post)["replayed"])


if __name__ == "__main__":
    unittest.main()

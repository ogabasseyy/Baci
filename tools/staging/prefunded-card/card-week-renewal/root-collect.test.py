import base64
import contextlib
import io
import json
from pathlib import Path
import sys
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import importlib.util
SPEC = importlib.util.spec_from_file_location("root_collect_tested", HERE / "root-collect.py")
root_collect = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(root_collect)
sys.path.pop(0)


class RuntimeProjectionTests(unittest.TestCase):
    def test_metadata_extracts_expiry_and_flags_without_returning_tokens(self):
        payload = base64.urlsafe_b64encode(json.dumps({"iss": "staging-issuer",
            "aud": "staging-receipts", "exp": 1790000000}).encode()).decode().rstrip("=")
        token = "e30." + payload + ".signature-never-return-this"
        files = {"/config/checkout.json": json.dumps({
            "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED": True,
            "savedCardsEnabled": False, "autoDebitEnabled": False,
            "expiresAt": "2026-09-29T15:59:10Z", "receiptToken": token}).encode(),
            "/code/launch-public.cjs": b'const expiresAt="2026-09-29T15:59:10Z";'}
        files["/etc/systemd/system/baci-prefunded-public.service"] = (
            b"[Service]\nExecCondition=/usr/bin/test 1790697550\n")
        units = [{"name": "baci-prefunded-public.service", "activeState": "inactive"}]

        result = root_collect.runtime_metadata(files, units)

        self.assertTrue(result["configuredFirstCardEnabled"])
        self.assertFalse(result["savedCardsEnabled"])
        self.assertFalse(result["autoDebitEnabled"])
        self.assertEqual(result["unverifiedTokenExpiryEpochs"], [1790000000])
        self.assertEqual(result["publicServiceActive"], False)
        self.assertNotIn(token, json.dumps(result))
        self.assertIn("2026-09-29T15:59:10Z", result["sourceExpiry"])
        self.assertIn("2026-09-29T15:59:10Z", result["compiledExpiry"])
        self.assertEqual(result["publicServiceConditionEpochs"], [1790697550])

    def test_mixed_baseline_extracts_only_exact_renewed_public_condition(self):
        for epoch, expected in ((1791302350, [1791302350]), (1791302351, []),
                                (11791302350, [])):
            files = {"/etc/systemd/system/baci-prefunded-public.service":
                f"[Service]\nExecCondition=/usr/bin/test {epoch}\n".encode(),
                "/config/background.json": b'{"expiresAt":"2026-09-29T15:59:10Z"}',
                "/etc/systemd/system/baci-prefunded-background.service":
                b"ExecCondition=/usr/bin/test 1790697550\n"}
            with self.subTest(epoch=epoch):
                result = root_collect.runtime_metadata(files, [])
                self.assertEqual(result["publicServiceConditionEpochs"], expected)
                self.assertIn("2026-09-29T15:59:10Z", result["sourceExpiry"])

    def test_refusal_does_not_delete_preexisting_output_paths(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "baseline.json"
            artifacts = root / "artifacts"
            output.write_text("keep")
            artifacts.mkdir()
            sentinel = artifacts / "keep"
            sentinel.write_text("keep")
            previous_argv = sys.argv
            previous_geteuid = root_collect.os.geteuid
            sys.argv = ["root-collect.py", "--output", str(output),
                "--artifacts", str(artifacts)]
            root_collect.os.geteuid = lambda: 0
            try:
                with contextlib.redirect_stdout(io.StringIO()):
                    self.assertEqual(root_collect.main(), 1)
            finally:
                sys.argv = previous_argv
                root_collect.os.geteuid = previous_geteuid
            self.assertEqual(output.read_text(), "keep")
            self.assertEqual(sentinel.read_text(), "keep")


if __name__ == "__main__":
    unittest.main()

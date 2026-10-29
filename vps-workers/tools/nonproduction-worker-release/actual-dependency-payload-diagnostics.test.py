import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "vps-workers" / "bin"))
sys.path.insert(0, str(Path(__file__).parent))

from worker_release_actual_dependency_guard import failure_diagnostic


class PayloadDiagnosticsTests(unittest.TestCase):
    def test_fixed_payload_rejections_have_closed_subtypes(self):
        cases = {
            "dependency payload contains a special file": "special-file",
            "dependency payload file has unsafe write or set-id bits": "entry-mode-invalid",
            "dependency payload contains a shared hardlinked file": "shared-file-inode",
            "dependency payload exceeds size limit": "size-bound",
            "dependency payload has too many entries": "entry-bound",
            "dependency symlink escapes payload root": "symlink-escape",
        }
        for message, subtype in cases.items():
            with self.subTest(subtype=subtype):
                self.assertEqual(
                    failure_diagnostic("payload-validation", RuntimeError(message)),
                    "experiment failure stage=payload-validation category=payload-invalid "
                    f"payload_check={subtype}",
                )

    def test_unrecognized_payload_error_does_not_echo_details(self):
        secret = "private path=/home/runner/token-value"
        result = failure_diagnostic("payload-validation", RuntimeError(secret))
        self.assertEqual(result, "experiment failure stage=payload-validation category=runtime-error")
        self.assertNotIn(secret, result)


if __name__ == "__main__":
    unittest.main()

import sys
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "vps-workers" / "bin"))
sys.path.insert(0, str(Path(__file__).parent))

from worker_release_actual_dependency_guard import failure_diagnostic
from worker_release_actual_dependency_hardlinks import HardlinkBoundaryError


class PayloadDiagnosticsTests(unittest.TestCase):
    def test_fixed_payload_rejections_have_closed_subtypes(self):
        cases = {
            "dependency payload contains a special file": "special-file",
            "dependency payload file has unsafe write or set-id bits": "entry-mode-invalid",
            "dependency payload contains a shared hardlinked file": "shared-file-inode",
            "candidate contains hardlinks outside its payload": "external-hardlink",
            "dependency payload exceeds size limit": "size-bound",
            "dependency payload has too many entries": "entry-bound",
            "dependency symlink escapes payload root": "symlink-escape",
        }
        for message, subtype in cases.items():
            with self.subTest(subtype=subtype):
                self.assertEqual(
                    failure_diagnostic(
                        "payload-hardlink-normalization" if subtype == "external-hardlink"
                        else "payload-validation", RuntimeError(message)),
                    f"experiment failure stage={'payload-hardlink-normalization' if subtype == 'external-hardlink' else 'payload-validation'} category=payload-invalid "
                    f"payload_check={subtype}",
                )

    def test_unrecognized_payload_error_does_not_echo_details(self):
        secret = "private path=/home/runner/token-value"
        result = failure_diagnostic("payload-validation", RuntimeError(secret))
        self.assertEqual(result, "experiment failure stage=payload-validation category=runtime-error")
        self.assertNotIn(secret, result)

    def test_external_hardlink_diagnostic_uses_only_fixed_root_categories(self):
        error = HardlinkBoundaryError(("web", "worker"), 3)
        result = failure_diagnostic("payload-hardlink-normalization", error)
        self.assertEqual(result,
                         "experiment failure stage=payload-hardlink-normalization "
                         "category=payload-invalid payload_check=external-hardlink "
                         "hardlink_roots=web+worker external_hardlink_groups=3")
        self.assertNotIn("/", result)


if __name__ == "__main__":
    unittest.main()

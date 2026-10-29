import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(ROOT / "vps-workers" / "bin"))
sys.path.insert(0, str(Path(__file__).parent))

from worker_release_actual_dependency_guard import failure_diagnostic
from worker_release_actual_dependency_hardlinks import HardlinkBoundaryError
from worker_release_actual_dependency_limits import inspect_materialization_budget


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

    def test_materialization_preflight_distinguishes_byte_and_entry_bounds(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary)
            web = payload / "web" / "node_modules" / "pkg"
            workers = payload / "root" / "node_modules"
            web.mkdir(parents=True)
            workers.mkdir(parents=True)
            (web / "index.js").write_bytes(b"12345")
            (workers / "index.js").write_bytes(b"x")

            self.assertEqual(inspect_materialization_budget(payload, byte_limit=5),
                             ("bytes-bound", 5, 6))

    def test_materialization_budget_counts_directory_symlink_copies_safely(self):
        with tempfile.TemporaryDirectory() as temporary:
            payload = Path(temporary)
            web = payload / "web" / "node_modules"
            workers = payload / "root" / "node_modules"
            (web / "pkg").mkdir(parents=True)
            workers.mkdir(parents=True)
            (web / "pkg" / "index.js").write_bytes(b"x")
            (web / "alias").symlink_to(web / "pkg", target_is_directory=True)

            state, entries, size = inspect_materialization_budget(
                payload, byte_limit=100,
            )
            self.assertEqual((state, size), ("within-bounds", 2))
            self.assertEqual(entries, 6)

    def test_materialization_failure_diagnostic_contains_only_bounded_measurements(self):
        error = RuntimeError("materialized dependency candidate exceeds configured bounds")
        error.safe_materialization_check = "bytes-bound"
        error.safe_materialization_entries = 3
        error.safe_materialization_bytes = 10_000
        error.safe_materialization_entry_limit = 200_000
        error.safe_materialization_byte_limit = 9_999
        result = failure_diagnostic("payload-materialization", error)
        self.assertEqual(
            result,
            "experiment failure stage=payload-materialization category=configured-bound "
            "materialization_check=bytes-bound materialized_entries=3 materialized_bytes=10000 "
            "materialized_entry_limit=200000 materialized_byte_limit=9999",
        )
        self.assertNotIn("/", result)

    def test_materialization_diagnostic_rejects_unrecognized_enum_or_unbounded_counts(self):
        error = RuntimeError("materialized dependency candidate exceeds configured bounds")
        error.safe_materialization_check = "path=/secret"
        error.safe_materialization_entries = 999_999_999
        error.safe_materialization_bytes = 10
        error.safe_materialization_entry_limit = 200_000
        error.safe_materialization_byte_limit = 10
        result = failure_diagnostic("payload-materialization", error)
        self.assertEqual(result, "experiment failure stage=payload-materialization category=configured-bound")
        self.assertNotIn("/secret", result)


if __name__ == "__main__":
    unittest.main()

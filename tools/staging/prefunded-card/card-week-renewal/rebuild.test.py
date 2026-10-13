import contextlib
import io
import json
from pathlib import Path
import tempfile
import sys
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rebuild
sys.path.pop(0)


class SealedSourceTests(unittest.TestCase):
    def test_candidate_function_predecessors_match_sealed_expected_hashes(self):
        source_files = rebuild._source_files(HERE.parents[3])
        definitions = rebuild._sealed_function_bodies(HERE.parents[3], source_files)
        self.assertEqual(set(definitions), set(rebuild.SEALED["functions"]))
        for signature, pinned in rebuild.SEALED["functions"].items():
            self.assertEqual(definitions[signature][1], pinned["oldBodyMd5"])
            self.assertEqual(definitions[signature][2], pinned["newBodyMd5"])

    def test_reserve_closure_uses_sealed_sql_without_retirement_loader(self):
        source_files = rebuild._source_files(HERE.parents[3])
        definitions = rebuild._sealed_function_bodies(HERE.parents[3], source_files)
        signature = "prefunded_card.checkout_reserve(jsonb,jsonb)"
        self.assertNotIn("checkout_retirement_patches.py", source_files)
        self.assertEqual(len(source_files), 4)
        self.assertEqual(definitions[signature][1],
            rebuild.SEALED["functions"][signature]["oldBodyMd5"])

    def test_builder_refuses_missing_live_oid_and_expiry_constraint_pins(self):
        with self.assertRaisesRegex(rebuild.Refused, "app_database_pin_mismatch"):
            rebuild.render_database_sql({}, HERE.parents[3])

    def test_refusal_preserves_preexisting_preparing_path(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            output = root / "candidate"
            staging = root / "candidate.preparing"
            staging.mkdir()
            sentinel = staging / "do-not-delete"
            sentinel.write_text("retained")
            self.assertEqual(rebuild.main(["--baseline", str(root / "missing"),
                "--artifacts", str(root / "artifacts"), "--repo-root", str(root),
                "--output", str(output)]), 1)
            self.assertEqual(sentinel.read_text(), "retained")

    def test_reports_collector_refusal_without_generic_downgrade(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            baseline = root / "baseline.json"
            baseline.write_text(json.dumps({"readOnly": False, "changesMade": False}))
            output = io.StringIO()
            with contextlib.redirect_stdout(output):
                status = rebuild.main(["--baseline", str(baseline), "--artifacts",
                    str(root / "artifacts"), "--repo-root", str(root),
                    "--output", str(root / "candidate")])
            self.assertEqual(status, 1)
            self.assertEqual(json.loads(output.getvalue())["reason"], "inventory_not_read_only")


if __name__ == "__main__":
    unittest.main()

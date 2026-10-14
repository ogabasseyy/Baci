"""Register status classification tests (stdlib only)."""
import datetime as dt
import importlib.util
import json
import tempfile
import unittest
from pathlib import Path

_status_spec = importlib.util.spec_from_file_location(
    "register_status", Path(__file__).parent / "register_status.py"
)
_status = importlib.util.module_from_spec(_status_spec)
_status_spec.loader.exec_module(_status)


class RegisterStatusTests(unittest.TestCase):
    def test_register_status_classifies_fresh_stale_broken(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        row = {"id": "x", "title": "X", "claim": "c", "limitations": "l", "status": "code_evidenced", "source_refs": ["cited.txt"]}

        def register(**overrides):
            value = {
                "schema_version": 1,
                "reviewed_at": now,
                "source_revision": "a" * 40,
                "evidence_digest": "e" * 64,
                "claims_digest": "c" * 64,
                "review_scope": "scope",
                "capabilities": [dict(row)],
            }
            value.update(overrides)
            return value

        with tempfile.TemporaryDirectory() as root:
            path = Path(root) / "capabilities.json"
            path.write_text(json.dumps(register()))
            self.assertEqual(_status.classify(path), "fresh")
            old = (dt.datetime.now(dt.timezone.utc) - dt.timedelta(days=20)).isoformat()
            path.write_text(json.dumps(register(reviewed_at=old)))
            self.assertEqual(_status.classify(path), "stale")
            future = (dt.datetime.now(dt.timezone.utc) + dt.timedelta(days=1)).isoformat()
            path.write_text(json.dumps(register(reviewed_at=future)))
            self.assertEqual(_status.classify(path), "broken")
            # Structurally invalid but current-dated: broken, not fresh.
            path.write_text(json.dumps({"reviewed_at": now}))
            self.assertEqual(_status.classify(path), "broken")
            path.write_text(json.dumps(register(schema_version=2)))
            self.assertEqual(_status.classify(path), "broken")
            path.write_text("{invalid json")
            self.assertEqual(_status.classify(path), "broken")
            self.assertEqual(_status.classify(Path(root) / "missing.json"), "broken")
            # Current-dated rows the runtime rejects are broken, not fresh.
            prod = dict(row, status="production_verified")
            path.write_text(json.dumps(register(capabilities=[prod])))
            self.assertEqual(_status.classify(path), "broken")
            path.write_text(json.dumps(register(capabilities=[dict(row), dict(row)])))
            self.assertEqual(_status.classify(path), "broken")
            dup_refs = dict(row, source_refs=["cited.txt", "cited.txt"])
            path.write_text(json.dumps(register(capabilities=[dup_refs])))
            self.assertEqual(_status.classify(path), "broken")
            # Evidence without revision or timestamp: broken, not fresh.
            thin = {"workflow": "w", "entitlement": "e", "observation": "o"}
            path.write_text(json.dumps(register(capabilities=[dict(row, status="production_verified", production_evidence=thin)])))
            self.assertEqual(_status.classify(path), "broken")
            full = dict(thin, deployed_revision="b" * 40, verified_at=now)
            path.write_text(json.dumps(register(capabilities=[dict(row, status="production_verified", production_evidence=full)])))
            self.assertEqual(_status.classify(path), "fresh")
            oversized = dict(full, workflow="w" * 1001)
            path.write_text(json.dumps(register(capabilities=[dict(row, status="production_verified", production_evidence=oversized)])))
            self.assertEqual(_status.classify(path), "broken")
            # Oversized current-dated fields the runtime rejects: broken.
            path.write_text(json.dumps(register(capabilities=[dict(row, claim="x" * 1001)])))
            self.assertEqual(_status.classify(path), "broken")
            many_refs = ["r%d" % i for i in range(21)]
            path.write_text(json.dumps(register(capabilities=[dict(row, source_refs=many_refs)])))
            self.assertEqual(_status.classify(path), "broken")
            # Duplicate JSON keys silently keep the last value: broken.
            text = json.dumps(register())
            duplicated = text.replace('"schema_version": 1,', '"schema_version": 1, "schema_version": 1,', 1)
            self.assertNotEqual(duplicated, text)
            path.write_text(duplicated)
            self.assertEqual(_status.classify(path), "broken")
            # Optional review_scope mirrors the runtime type/length rule.
            path.write_text(json.dumps(register(review_scope="s" * 1001)))
            self.assertEqual(_status.classify(path), "broken")
            path.write_text(json.dumps(register(review_scope={"smuggled": "content"})))
            self.assertEqual(_status.classify(path), "broken")
            # Aggregate bounds mirror the runtime: past 200k on disk or 50k
            # serialized, a current-dated register is broken, never fresh.
            path.write_text(json.dumps(register()) + " " * 200_001)
            self.assertEqual(_status.classify(path), "broken")
            big_row = dict(row, claim="x" * 1000, limitations="l" * 1000,
                           source_refs=["r%d" % i for i in range(20)])
            path.write_text(json.dumps(register(capabilities=[dict(big_row, id="r%d" % i) for i in range(50)])))
            self.assertGreater(len(path.read_text()), 50_000)
            self.assertEqual(_status.classify(path), "broken")
            # The 50k bound measures the rendered payload, not the file:
            # long source refs stay on disk only, so full JSON past 50k
            # with a small projection is fresh, like the runtime.
            ref_row = dict(row, claim="c", limitations="l",
                           source_refs=["s" * 150 + "%d" % i for i in range(20)])
            path.write_text(json.dumps(register(capabilities=[dict(ref_row, id="s%d" % i) for i in range(50)])))
            self.assertGreater(len(path.read_text()), 50_000)
            self.assertEqual(_status.classify(path), "fresh")


if __name__ == "__main__":
    unittest.main()

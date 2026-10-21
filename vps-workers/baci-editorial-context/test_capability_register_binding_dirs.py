"""Directory-citation binding tests (stdlib only, no writer checkout needed).

Split from test_capability_register_binding.py to hold the 300-line
limit: directory citations expand to deterministic descendant sets in
both the digest and the provenance check.
"""
import importlib.util
import subprocess
import tempfile
import unittest
from pathlib import Path

_digests_spec = importlib.util.spec_from_file_location(
    "register_digests", Path(__file__).parent / "register_digests.py"
)
_digests = importlib.util.module_from_spec(_digests_spec)
_digests_spec.loader.exec_module(_digests)
evidence_digest_for = _digests.evidence_digest_for

_binding_spec = importlib.util.spec_from_file_location(
    "binding_checks", Path(__file__).parent / "test_capability_register_binding.py"
)


def _git(repo, *args):
    subprocess.run(
        ["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
        check=True, capture_output=True, text=True,
    )


def _binding_failures(repo, data):
    loader = importlib.util.module_from_spec(_binding_spec)
    _binding_spec.loader.exec_module(loader)
    return loader.binding_failures(repo, data)


class DirectoryBindingTests(unittest.TestCase):
    def test_evidence_digest_expands_directory_citations(self):
        # The digest must hash descendants, not crash on read_bytes, and
        # move with descendant content.
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "app" / "sub").mkdir(parents=True)
            (repo / "app" / "b.ts").write_text("b1")
            (repo / "app" / "sub" / "a.ts").write_text("a1")
            data = {"capabilities": [{"status": "code_evidenced", "source_refs": ["app"]}],
                    "reviewed_at": "2026-01-01T00:00:00Z", "source_revision": "a" * 40}
            first = evidence_digest_for(repo, data)
            self.assertEqual(evidence_digest_for(repo, data), first)
            (repo / "app" / "sub" / "a.ts").write_text("a2")
            self.assertNotEqual(evidence_digest_for(repo, data), first)

    def test_directory_citation_binds_end_to_end(self):
        # A register citing a directory passes the full binding (digest +
        # provenance) when descendants match the bound revision, and fails
        # when a descendant drifts — without ever reading the directory.
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            _git(repo, "init", "-q", ".")
            (repo / "app").mkdir()
            (repo / "app" / "foo.ts").write_text("v1\n")
            _git(repo, "add", ".")
            _git(repo, "commit", "-q", "-m", "one")
            head = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "HEAD"],
                capture_output=True, text=True,
            ).stdout.strip()
            data = {"capabilities": [{"status": "code_evidenced", "source_refs": ["app"]}],
                    "reviewed_at": "2026-01-01T00:00:00Z", "source_revision": head}
            data["evidence_digest"] = evidence_digest_for(repo, data)
            data["claims_digest"] = _digests.claims_digest_for(data)
            self.assertEqual(_binding_failures(repo, data), [])
            (repo / "app" / "foo.ts").write_text("v2\n")
            failures = _binding_failures(repo, data)
            self.assertTrue(failures, "drifted descendant must fail the binding")


if __name__ == "__main__":
    unittest.main()

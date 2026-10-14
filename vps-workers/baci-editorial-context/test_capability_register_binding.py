"""Register/evidence binding tests (stdlib only, no writer checkout needed)."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

_spec = importlib.util.spec_from_file_location(
    "platform_capabilities", Path(__file__).parent / "platform_capabilities.py"
)
_mod = importlib.util.module_from_spec(_spec)
_spec.loader.exec_module(_mod)
capability_context = _mod.capability_context

_gate_spec = importlib.util.spec_from_file_location(
    "capability_gate", Path(__file__).parent / "capability_gate.py"
)
gate = importlib.util.module_from_spec(_gate_spec)
_gate_spec.loader.exec_module(gate)

_digests_spec = importlib.util.spec_from_file_location(
    "register_digests", Path(__file__).parent / "register_digests.py"
)
_digests = importlib.util.module_from_spec(_digests_spec)
_digests_spec.loader.exec_module(_digests)
evidence_digest_for = _digests.evidence_digest_for
claims_digest_for = _digests.claims_digest_for

_status_spec = importlib.util.spec_from_file_location(
    "register_status", Path(__file__).parent / "register_status.py"
)
_status = importlib.util.module_from_spec(_status_spec)
_status_spec.loader.exec_module(_status)


def binding_failures(repo, data):
    """Return binding failure strings for a register dict (empty = bound)."""
    failures = []
    refs = sorted({ref for row in data["capabilities"] for ref in row["source_refs"]})
    repo_root = str(Path(repo).resolve())
    for ref in refs:
        resolved = (Path(repo) / ref).resolve()
        if not str(resolved).startswith(repo_root + os.sep):
            failures.append(f"cited source escapes repo: {ref}")
        elif not resolved.exists():
            failures.append(f"cited source missing: {ref}")
        else:
            tracked = subprocess.run(
                ["git", "-C", str(repo), "ls-files", "--error-unmatch", "--", ref],
                capture_output=True, text=True,
            )
            if tracked.returncode != 0:
                failures.append(f"cited source is not tracked: {ref}")
    if not failures:
        expected = data.get("evidence_digest")
        if not isinstance(expected, str) or evidence_digest_for(repo, data) != expected:
            failures.append("cited evidence or claim text changed since review; re-review the claims and update evidence_digest")
        if data.get("claims_digest") != claims_digest_for(data):
            failures.append("claims_digest does not match register content; regenerate with register_digests.py")
        failures.extend(_provenance_failures(repo, data))
    return failures


def _provenance_failures(repo, data):
    """When source_revision resolves here, cited content must match it."""
    revision = data.get("source_revision")
    if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{40}", revision):
        return []
    probe = subprocess.run(
        ["git", "-C", str(repo), "cat-file", "-e", f"{revision}^{{commit}}"],
        capture_output=True, text=True,
    )
    if probe.returncode != 0:
        return []  # Rewritten history (e.g. squash merge): digest still binds.
    failures = []
    refs = sorted({ref for row in data["capabilities"] if row.get("status") != "unverified" for ref in row["source_refs"]})
    for ref in refs:
        at_rev = subprocess.run(
            ["git", "-C", str(repo), "show", f"{revision}:{ref}"],
            capture_output=True,
        )
        if at_rev.returncode != 0:
            failures.append(f"cited source absent at source_revision {revision[:10]}: {ref}")
        elif hashlib.sha256(at_rev.stdout).hexdigest() != hashlib.sha256((Path(repo) / ref).read_bytes()).hexdigest():
            failures.append(f"cited content differs from source_revision {revision[:10]}: {ref}")
    return failures


class CapabilityBindingTests(unittest.TestCase):
    def test_register_binding_matches_shipped_tree(self):
        repo = Path(__file__).resolve().parents[2]
        register_path = repo / "docs/product/baci-capabilities.json"
        if not (repo / ".git").exists():
            self.skipTest("repo checkout unavailable")
        self.assertTrue(register_path.exists(), "committed capability register is missing; restore it or re-review")
        data = json.loads(register_path.read_text())
        reviewed = dt.datetime.fromisoformat(data["reviewed_at"].replace("Z", "+00:00"))
        age = dt.datetime.now(dt.timezone.utc) - reviewed
        self.assertGreaterEqual(age, dt.timedelta(0), "register reviewed_at is future-dated; runtime would reject it")
        stale = age > dt.timedelta(days=14)
        if not stale:
            # Freshness and runtime acceptance are only asserted inside the
            # evidence window; structural binding below is always enforced.
            with patch.dict(os.environ, {"BACI_CAPABILITY_REGISTER_PATH": str(register_path), "BACI_CAPABILITY_REGISTER_DIGEST": data["claims_digest"]}):
                rendered = capability_context()
            self.assertIn("<capability-register-json untrusted-evidence-data>", rendered)
            self.assertNotIn("Register unavailable", rendered)
        if stale and os.environ.get("BACI_REGISTER_REQUIRE_FRESH"):
            self.fail("register outside its 14-day evidence window; owner re-review required")
        self.assertEqual(binding_failures(repo, data), [])

    def test_register_digests_cli_reproduces_shipped_digests(self):
        repo = Path(__file__).resolve().parents[2]
        register_path = repo / "docs/product/baci-capabilities.json"
        if not register_path.exists():
            self.skipTest("shipped register unavailable")
        out = subprocess.run(
            [sys.executable, str(Path(__file__).parent / "register_digests.py"), "--register", str(register_path)],
            capture_output=True, text=True,
        )
        self.assertEqual(out.returncode, 0, out.stderr)
        data = json.loads(register_path.read_text())
        self.assertIn(f"evidence_digest: {data['evidence_digest']}", out.stdout)
        self.assertIn(f"claims_digest: {data['claims_digest']}", out.stdout)

    def test_register_digests_write_handles_compact_json(self):
        with tempfile.TemporaryDirectory() as root:
            register = Path(root) / "capabilities.json"
            data = {
                "schema_version": 1,
                "reviewed_at": "2026-01-01T00:00:00Z",
                "source_revision": "a" * 40,
                "evidence_digest": "0" * 64,
                "claims_digest": "0" * 64,
                "capabilities": [{"id": "x", "title": "X", "claim": "c", "limitations": "l", "status": "code_evidenced", "source_refs": ["cited.txt"]}],
            }
            (Path(root) / "cited.txt").write_text("v1")
            register.write_text(json.dumps(data, separators=(",", ":")))
            out = subprocess.run(
                [sys.executable, str(Path(__file__).parent / "register_digests.py"), "--register", str(register), "--repo", str(root), "--write"],
                capture_output=True, text=True,
            )
            self.assertEqual(out.returncode, 0, out.stderr)
            updated = json.loads(register.read_text())
            self.assertNotEqual(updated["evidence_digest"], "0" * 64)
            self.assertEqual(updated["evidence_digest"], evidence_digest_for(Path(root), updated))
            self.assertEqual(updated["claims_digest"], claims_digest_for(updated))

    def test_binding_failures_are_detected_in_fixture_repo(self):
        def git(repo, *args):
            subprocess.run(
                ["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
                check=True, capture_output=True, text=True,
            )

        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            git(repo, "init", "-q", ".")
            (repo / "cited.txt").write_text("v1")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "one")
            refs = ["cited.txt"]
            first = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            data = {"capabilities": [{"source_refs": refs}], "reviewed_at": "2026-01-01T00:00:00Z", "source_revision": first}
            data["evidence_digest"] = evidence_digest_for(repo, data)
            data["claims_digest"] = claims_digest_for(data)
            self.assertEqual(binding_failures(repo, data), [])
            (repo / "cited.txt").write_text("v2")
            self.assertTrue(binding_failures(repo, data), "changed cited content must fail the digest binding")
            data["evidence_digest"] = evidence_digest_for(repo, data)
            data["claims_digest"] = claims_digest_for(data)
            provenance = binding_failures(repo, data)
            self.assertTrue(any("source_revision" in f for f in provenance), f"provenance alone must reject after redigest: {provenance}")
            self.assertTrue(binding_failures(repo, {"capabilities": [{"source_refs": ["missing.txt"]}], "evidence_digest": "x"}), "missing cited source must fail")
            self.assertTrue(binding_failures(repo, {"capabilities": [{"source_refs": ["../escape.txt"]}], "evidence_digest": "x"}), "escaping cited source must fail")

    def test_ci_invokes_capability_gate_unconditionally(self):
        # The gate cannot notice its own caller changing: if ci.yml drops or
        # conditions the invocation, cited-source changes bypass re-review.
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/ci.yml"
        action = repo / ".github/actions/capability-gate/action.yml"
        if not workflow.exists() or not action.exists():
            self.skipTest("CI workflow or gate action unavailable")
        lines = workflow.read_text().splitlines()
        starts = [i for i, line in enumerate(lines) if line.strip() == "- name: Test capability register binding"]
        self.assertEqual(len(starts), 1, "ci.yml must invoke the capability gate exactly once")
        step = []
        for line in lines[starts[0] + 1:]:
            if re.match(r"^      - ", line):
                break
            step.append(line)
        self.assertIn("uses: ./.github/actions/capability-gate", "\n".join(step))
        self.assertFalse(
            any(re.match(r"^\s+if:", line) for line in step),
            "gate invocation must stay unconditional",
        )

    def test_freshness_probe_falls_back_to_broken(self):
        # If register_status.py itself errors, the probe must still emit a
        # routable status instead of an empty one that files no issue.
        repo = Path(__file__).resolve().parents[2]
        workflow = repo / ".github/workflows/capability-register-freshness.yml"
        if not workflow.exists():
            self.skipTest("freshness workflow unavailable")
        text = workflow.read_text()
        probe = [line for line in text.splitlines() if "register_status.py" in line]
        self.assertEqual(len(probe), 1, "probe must invoke register_status.py exactly once")
        self.assertIn("|| echo broken", probe[0])

    def test_changed_cited_source_must_match_bound_revision(self):
        def git(repo, *args):
            subprocess.run(
                ["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args],
                check=True, capture_output=True, text=True,
            )

        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            git(repo, "init", "-q", ".")
            (repo / "cited.txt").write_text("v1\n")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "one")
            (repo / "other.txt").write_text("x\n")
            git(repo, "add", ".")
            git(repo, "commit", "-q", "-m", "two")
            intermediate = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            (repo / "cited.txt").write_text("v2\n")
            register = {"source_revision": intermediate, "capabilities": [{"status": "unverified", "source_refs": ["cited.txt"]}]}
            # Intermediate descendant predating the worktree edit: unbound.
            self.assertEqual(
                gate._changed_refs_unbound(register, {"cited.txt"}, cwd=repo),
                ["cited change not bound at source_revision: cited.txt"],
            )
            self.assertEqual(gate._changed_refs_unbound(register, {"other.txt"}, cwd=repo), [])
            git(repo, "commit", "-q", "-am", "three")
            current = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            register["source_revision"] = current
            self.assertEqual(gate._changed_refs_unbound(register, {"cited.txt"}, cwd=repo), [])



if __name__ == "__main__":
    unittest.main()

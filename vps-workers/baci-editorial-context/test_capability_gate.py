"""Gate and register-binding tests (stdlib only, no writer checkout needed)."""
import datetime as dt
import hashlib
import importlib.util
import json
import os
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
    import re

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


class CapabilityGateTests(unittest.TestCase):
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

    def test_gate_decision_fails_closed(self):
        register = {"capabilities": [{"source_refs": ["apps/web/src/lib/feeds.ts"]}]}
        self.assertTrue(gate.should_run("base", register, None), "unknown change set must run the suite")
        self.assertFalse(gate.should_run("base", register, {"docs/other.md"}))
        self.assertFalse(gate.should_run("base", {}, {"docs/other.md"}), "structurally invalid register must not crash the gate")
        self.assertTrue(gate.should_run("base", {}, {"docs/product/baci-capabilities.json"}))
        self.assertTrue(gate.should_run("base", register, {"apps/web/src/lib/feeds.ts"}))
        self.assertTrue(gate.should_run("base", register, {"vps-workers/baci-editorial-context/README.md"}))
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            subprocess.run(["git", "-C", str(repo), "init", "-q", "."], check=True, capture_output=True)
            self.assertIsNone(gate.changed_paths("f" * 40, cwd=repo), "unresolvable base must yield unknown, not empty")
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            (repo / "cited.ts").write_text("export {};\n")
            git("add", ".")
            git("commit", "-q", "-m", "one")
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("mv", "cited.ts", "renamed.ts")
            git("commit", "-q", "-m", "rename")
            changed = gate.changed_paths(base, cwd=repo)
            self.assertIn("cited.ts", changed, "rename source path must stay visible to the gate")
            self.assertIn("renamed.ts", changed)
            citing = {"capabilities": [{"source_refs": ["cited.ts"]}]}
            self.assertTrue(gate.should_run(base, citing, changed), "renaming a cited source must run the suite")
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/agent-access-map.md").write_text("See `apps/web/src/lib/agentic/` for tools.")
            previous = os.getcwd()
            os.chdir(repo)
            try:
                citing = {"capabilities": [{"source_refs": ["cited.ts"]}]}
                self.assertTrue(
                    gate.should_run("base", citing, {"apps/web/src/lib/agentic/new-route.ts"}),
                    "a new file under a map-cited directory must run the suite",
                )
                self.assertFalse(gate.should_run("base", citing, {"apps/web/src/lib/other.ts"}))
            finally:
                os.chdir(previous)

    def test_freshness_scoping(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        fresh = {"reviewed_at": now, "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/web/src/lib/feeds.ts"]},
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        stale = {**fresh, "reviewed_at": "2020-01-01T00:00:00Z"}
        bound_change = {"apps/web/src/lib/feeds.ts"}
        self.assertFalse(gate.freshness_required(fresh, bound_change))
        self.assertTrue(gate.freshness_required(stale, bound_change), "re-digesting must not bypass a stale register")
        self.assertTrue(gate.freshness_required(fresh, {"docs/product/baci-capabilities.json"}))
        self.assertTrue(gate.freshness_required(fresh, {"apps/web/src/app/(platform)/pricing/page.tsx"}))
        self.assertTrue(gate.freshness_required(fresh, None))
        self.assertTrue(gate.freshness_required(None, bound_change))

    def test_map_link_targets_parse_balanced_parentheses(self):
        text = "See [Public features](../../apps/web/src/app/(platform)/features/page.tsx) and [map](other.md)."
        targets = gate.map_link_targets(text)
        self.assertIn("apps/web/src/app/(platform)/features/page.tsx", targets)
        self.assertNotIn("apps/web/src/app/(platform", targets)
        self.assertIn("docs/product/other.md", targets)
        self.assertEqual(gate.map_link_targets("See [x](https://example.com/a_(b)) and [y](#frag)."), set())

    def test_requires_register_update(self):
        now = dt.datetime.now(dt.timezone.utc)
        fresh = {"reviewed_at": now.isoformat(), "capabilities": [
            {"status": "code_evidenced", "source_refs": ["apps/web/src/lib/feeds.ts"]},
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        stale = {**fresh, "reviewed_at": "2020-01-01T00:00:00Z"}
        base = {**fresh, "reviewed_at": (now - dt.timedelta(days=1)).isoformat()}
        rereviewed = {**fresh, "reviewed_at": (now + dt.timedelta(hours=1)).isoformat()}
        unverified_change = {"apps/web/src/app/(platform)/pricing/page.tsx"}
        touched = unverified_change | {gate.REGISTER_PATH}
        # Fresh register + unverified source changed + register untouched: re-review required.
        self.assertTrue(gate.requires_register_update(fresh, unverified_change))
        # Whitespace-only register touch (reviewed_at not advanced): still required.
        same_date = {**fresh, "reviewed_at": base["reviewed_at"]}
        self.assertTrue(gate.requires_register_update(same_date, touched, base))
        # Genuine re-review (reviewed_at advanced past base): accepted.
        self.assertFalse(gate.requires_register_update(rereviewed, touched, base))
        # Base register unloadable: the path touch is the only signal, accepted.
        self.assertFalse(gate.requires_register_update(fresh, touched, None))
        self.assertFalse(gate.requires_register_update(fresh, touched))
        # Unrelated change: no re-review.
        self.assertFalse(gate.requires_register_update(fresh, {"apps/web/src/lib/other.ts"}, base))
        # Stale register: the freshness hard gate (not this rule) owns the failure.
        self.assertFalse(gate.requires_register_update(stale, unverified_change, base))
        # Unknown inputs: fail closed elsewhere, nothing to enforce here.
        self.assertFalse(gate.requires_register_update(fresh, None, base))
        self.assertFalse(gate.requires_register_update(None, unverified_change, base))

    def test_main_rejects_unverified_change_without_register_update(self):
        now = dt.datetime.now(dt.timezone.utc).isoformat()
        register = {"reviewed_at": now, "capabilities": [
            {"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps(register))
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.object(gate, "changed_paths", return_value={"apps/web/src/app/(platform)/pricing/page.tsx"}):
                    with patch.object(gate, "_base_register", return_value=None):
                        with patch.object(gate.subprocess, "run", side_effect=AssertionError("suite must not run")):
                            with patch.dict(os.environ, {"BASE_SHA": "b" * 40, "BACI_REGISTER_REQUIRE_FRESH": "1"}):
                                self.assertEqual(gate.main(), 1)
            finally:
                os.chdir(previous)

    def test_main_rejects_whitespace_only_register_touch(self):
        reviewed = dt.datetime.now(dt.timezone.utc).isoformat()
        capabilities = [{"status": "unverified", "source_refs": ["apps/web/src/app/(platform)/pricing/page.tsx"]}]
        base_register = {"reviewed_at": reviewed, "capabilities": capabilities}
        head_register = {"reviewed_at": reviewed, "capabilities": capabilities}
        changed = {"apps/web/src/app/(platform)/pricing/page.tsx", gate.REGISTER_PATH}
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/baci-capabilities.json").write_text(json.dumps(head_register))
            previous = os.getcwd()
            os.chdir(repo)
            try:
                with patch.object(gate, "changed_paths", return_value=changed):
                    with patch.object(gate, "_base_register", return_value=base_register):
                        with patch.object(gate.subprocess, "run", side_effect=AssertionError("suite must not run")):
                            with patch.dict(os.environ, {"BASE_SHA": "b" * 40}):
                                self.assertEqual(gate.main(), 1)
            finally:
                os.chdir(previous)

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


if __name__ == "__main__":
    unittest.main()

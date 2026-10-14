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


def _manifest_tool_names(manifest_text):
    """Tool names from the authoritative CONNECTOR_TOOL_NAMES tuple."""
    match = re.search(r"CONNECTOR_TOOL_NAMES\s*=\s*\[(.*?)\]\s*as const", manifest_text, re.S)
    if not match:
        return None
    return set(re.findall(r"'([^']+)'", match.group(1)))


def _map_tool_names(row):
    """Dotted backtick citations on a map row, excluding the version token."""
    names = set()
    for token in re.findall(r"`([^`]+)`", row):
        token = token.strip()
        if "/" in token or "." not in token:
            continue
        if re.fullmatch(r"r\d+\.\d+", token):
            continue  # Manifest version, asserted separately.
        if re.fullmatch(r"[A-Za-z0-9_.-]+", token):
            names.add(token)
    return names


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

    def test_agent_access_map_paths_resolve(self):
        repo = Path(__file__).resolve().parents[2]
        map_path = repo / "docs/product/agent-access-map.md"
        if not map_path.exists():
            # Deleting the committed map must fail the suite, not skip it.
            # Skip only when there is no repository checkout to check against
            # (e.g. a bare writer checkout without git history).
            probe = subprocess.run(
                ["git", "-C", str(repo), "rev-parse", "--is-inside-work-tree"],
                capture_output=True, text=True,
            )
            if probe.returncode == 0 and probe.stdout.strip() == "true":
                self.fail("committed agent-access map is missing inside the checkout; restore it or re-review")
            self.skipTest("agent access map unavailable")
        text = map_path.read_text()
        cited = gate.map_cited_paths(text) | gate.map_link_targets(text)
        missing = [p for p in sorted(cited) if not (repo / p.rstrip("/")).exists()]
        self.assertEqual(missing, [], f"agent-access-map cites non-resolvable paths: {missing}")
        tracked = subprocess.run(["git", "-C", str(repo), "ls-files"], capture_output=True, text=True).stdout.split()
        basenames = {Path(p).name for p in tracked}
        missing_names = [n for n in sorted(gate.map_cited_filenames(text)) if n not in basenames]
        self.assertEqual(missing_names, [], f"agent-access-map cites unresolvable filenames: {missing_names}")
        missing_links = [p for p in sorted(gate.map_link_targets(text)) if p not in tracked]
        self.assertEqual(missing_links, [], f"agent-access-map links untracked paths: {missing_links}")

    def test_agent_access_map_manifest_claims_match_manifest(self):
        # The map advertises an exact manifest version and tool list; a cited
        # implementation change (version bump, tool rename, tool addition)
        # must break this test and force the map to be re-reviewed.
        repo = Path(__file__).resolve().parents[2]
        map_path = repo / "docs/product/agent-access-map.md"
        manifest_path = repo / "apps/web/src/lib/connector/manifest.ts"
        if not map_path.exists() or not manifest_path.exists():
            self.skipTest("agent access map or connector manifest unavailable")
        text = map_path.read_text()
        row = next(line for line in text.splitlines() if "manifest.ts" in line)
        versions = set(re.findall(r"`(r\d+\.\d+)`", row))
        self.assertEqual(len(versions), 1, f"map gateway row must name exactly one manifest version: {row[:120]}")
        (version,) = versions
        tools = _map_tool_names(row)
        self.assertGreaterEqual(len(tools), 4, f"map gateway row must name its tools: {row[:120]}")
        manifest = manifest_path.read_text()
        self.assertIn(f"CONNECTOR_MANIFEST_VERSION = '{version}'", manifest)
        manifest_tools = _manifest_tool_names(manifest)
        self.assertIsNotNone(manifest_tools, "connector manifest must export a CONNECTOR_TOOL_NAMES tuple")
        self.assertEqual(
            tools, manifest_tools,
            f"map advertises {sorted(tools)} but the manifest exposes {sorted(manifest_tools)}; "
            "a new tool silently breaks the map's exact-count claim",
        )

    def test_manifest_tool_extraction_parses_unrestricted_names(self):
        # The tuple grammar is unrestricted strings: names with underscores
        # or extra dots (orders.list_v2, catalog.v2) must survive extraction
        # on both sides, so a fifth tool breaks set equality instead of
        # vanishing from both sets.
        manifest = (
            "export const CONNECTOR_TOOL_NAMES = [\n"
            "  'orders.list',\n"
            "  'orders.list_v2',\n"
            "  'catalog.v2',\n"
            "] as const;\n"
        )
        self.assertEqual(
            _manifest_tool_names(manifest), {"orders.list", "orders.list_v2", "catalog.v2"}
        )
        row = "tools (version `r0.4`): `orders.list`, `orders.list_v2`, `catalog.v2`."
        self.assertEqual(
            _map_tool_names(row), {"orders.list", "orders.list_v2", "catalog.v2"}
        )
        stale_row = "tools (version `r0.4`): `orders.list`."
        self.assertNotEqual(_map_tool_names(stale_row), _manifest_tool_names(manifest))


if __name__ == "__main__":
    unittest.main()

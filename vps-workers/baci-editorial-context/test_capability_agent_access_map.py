"""Agent-access-map binding tests (stdlib only, no writer checkout needed)."""
import calendar
import datetime as dt
import importlib.util
import json
import os
import re
import subprocess
import tempfile
import unittest
from pathlib import Path

_gate_spec = importlib.util.spec_from_file_location(
    "capability_gate", Path(__file__).parent / "capability_gate.py"
)
gate = importlib.util.module_from_spec(_gate_spec)
_gate_spec.loader.exec_module(gate)


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


class AgentAccessMapTests(unittest.TestCase):
    def test_bare_cited_filenames_resolve_to_tracked_paths(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/agent-access-map.md").write_text("See `useFollowUpQueue.ts` for queue state and `spaced.ts` for spacing.")
            (repo / "apps/x").mkdir(parents=True)
            (repo / "apps/x/useFollowUpQueue.ts").write_text("export {};\n")
            (repo / "apps/aardvark").mkdir(parents=True)
            (repo / "apps/aardvark/useFollowUpQueue.ts").write_text("export {};\n")
            (repo / "apps/with space").mkdir(parents=True)
            (repo / "apps/with space/spaced.ts").write_text("export {};\n")
            git("add", ".")
            git("commit", "-q", "-m", "one")
            previous = os.getcwd()
            os.chdir(repo)
            try:
                citing = {"capabilities": []}
                resolved, unresolved = gate._resolve_cited_filenames({"useFollowUpQueue.ts", "spaced.ts", "ghost.ts"})
                self.assertEqual(resolved, {"apps/x/useFollowUpQueue.ts", "apps/aardvark/useFollowUpQueue.ts", "apps/with space/spaced.ts"})
                self.assertEqual(unresolved, {"ghost.ts"})
                relevant = gate.relevant_paths(citing)
                self.assertIn("apps/x/useFollowUpQueue.ts", relevant)
                self.assertIn("apps/aardvark/useFollowUpQueue.ts", relevant)
                self.assertIn("apps/with space/spaced.ts", relevant)
                self.assertNotIn("useFollowUpQueue.ts", relevant)
                self.assertTrue(gate.should_run("base", citing, {"apps/x/useFollowUpQueue.ts"}))
                self.assertTrue(gate.should_run("base", citing, {"apps/aardvark/useFollowUpQueue.ts"}))
                self.assertTrue(gate.should_run("base", citing, {"apps/with space/spaced.ts"}))
                # Same basename, different untracked path: no longer a "cited source".
                self.assertFalse(gate.should_run("base", citing, {"apps/other/useFollowUpQueue.ts"}))
            finally:
                os.chdir(previous)

    def test_base_union_keeps_deleted_citation_relevant(self):
        with tempfile.TemporaryDirectory() as root:
            repo = Path(root)

            def git(*args):
                subprocess.run(["git", "-C", str(repo), "-c", "user.email=t@example.com", "-c", "user.name=t", *args], check=True, capture_output=True)

            git("init", "-q", ".")
            (repo / "docs/product").mkdir(parents=True)
            (repo / "docs/product/agent-access-map.md").write_text("See `same.ts` for shared state.")
            (repo / "apps/a").mkdir(parents=True)
            (repo / "apps/b").mkdir(parents=True)
            (repo / "apps/a/same.ts").write_text("export {};\n")
            (repo / "apps/b/same.ts").write_text("export {};\n")
            git("add", ".")
            git("commit", "-q", "-m", "one")
            base = subprocess.run(["git", "-C", str(repo), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
            git("rm", "-q", "apps/b/same.ts")
            git("commit", "-q", "-m", "drop duplicate")
            # From outside the checkout: the map must still resolve via cwd.
            citing = {"capabilities": []}
            changed = gate.changed_paths(base, cwd=repo)
            self.assertIn("apps/b/same.ts", changed)
            self.assertFalse(gate.should_run(base, citing, changed),
                             "map lookup from the process cwd must not see the fixture map")
            self.assertTrue(gate.should_run(base, citing, changed, cwd=str(repo)),
                            "base-tree union must keep the deleted citation relevant")
            self.assertFalse(gate.should_run(None, citing, changed, cwd=str(repo)),
                             "head-only resolution must not see the deleted path")

    def test_action_only_change_runs_suite(self):
        register = {"capabilities": []}
        self.assertTrue(gate.should_run("base", register, {gate.ACTION_PATH}))

    def test_workflow_only_change_runs_suite(self):
        register = {"capabilities": []}
        self.assertTrue(gate.should_run("base", register, {gate.FRESHNESS_WORKFLOW}))

    def test_noncanonical_citation_spelling_triggers_gate(self):
        register = {"capabilities": [
            {"status": "code_evidenced", "source_refs": ["./apps/web/src/lib/feeds.ts"]},
            {"status": "unverified", "source_refs": ["./apps/web/src/app/(platform)/pricing/page.tsx"]},
        ]}
        self.assertTrue(gate.should_run("base", register, {"apps/web/src/lib/feeds.ts"}))
        self.assertTrue(
            gate._touches_unverified_refs(register, {"apps/web/src/app/(platform)/pricing/page.tsx"})
        )
        self.assertFalse(gate.should_run("base", register, {"apps/web/src/lib/other.ts"}))

    def test_agent_access_map_review_date_matches_register(self):
        # The map's human provenance note must agree with the enforced
        # register, or agents read a different review date than the lane uses.
        repo = Path(__file__).resolve().parents[2]
        map_path = repo / "docs/product/agent-access-map.md"
        register_path = repo / "docs/product/baci-capabilities.json"
        if not map_path.exists() or not register_path.exists():
            self.skipTest("agent access map or register unavailable")
        match = re.search(r"Reviewed (\d{1,2}) (\w+) (\d{4})", map_path.read_text())
        self.assertIsNotNone(match, "agent-access-map must state its review date")
        day, month_name, year = match.groups()
        month = {name: number for number, name in enumerate(calendar.month_name) if name}[month_name]
        data = json.loads(register_path.read_text())
        reviewed = dt.datetime.fromisoformat(data["reviewed_at"].replace("Z", "+00:00"))
        self.assertEqual((reviewed.day, reviewed.month, reviewed.year), (int(day), month, int(year)))
        self.assertIn(data["source_revision"], map_path.read_text())

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

import unittest
import os
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from worker_release_dependency_diagnostics import (
    MAX_FRESH_VERIFICATION_ELAPSED_MS,
    MAX_RECENT_VERIFICATION_AGE_MS,
    PnpmStepRejected,
    has_fresh_policy_pass,
    has_policy_pass_marker,
    policy_pass_evidence,
    policy_evidence_summary,
    read_diagnostic,
    write_diagnostic,
    run_pnpm_checked,
)


class PolicyPassEvidenceTests(unittest.TestCase):
    def test_fresh_evidence_boundaries_and_output_streams(self):
        at_limit = "✓ Lockfile passes supply-chain policies (3 entries in 240s)\n"
        over_limit = "✓ Lockfile passes supply-chain policies (3 entries in 240.001s)\n"
        self.assertEqual(policy_pass_evidence(at_limit, ""), ("fresh", MAX_FRESH_VERIFICATION_ELAPSED_MS))
        self.assertTrue(has_fresh_policy_pass("", at_limit))
        self.assertFalse(has_fresh_policy_pass(over_limit, ""))

    def test_cached_evidence_boundaries(self):
        at_limit = f"✓ Lockfile passes supply-chain policies (verified {MAX_RECENT_VERIFICATION_AGE_MS}ms ago)\n"
        over_limit = f"✓ Lockfile passes supply-chain policies (verified {MAX_RECENT_VERIFICATION_AGE_MS + 1}ms ago)\n"
        self.assertEqual(policy_pass_evidence("", at_limit), ("cached", MAX_RECENT_VERIFICATION_AGE_MS))
        self.assertTrue(has_policy_pass_marker("", at_limit))
        self.assertFalse(has_policy_pass_marker(over_limit, ""))

    def test_ansi_is_removed_before_exact_line_parse(self):
        line = "\x1b[32m✓ Lockfile passes supply-chain policies (1 entry in 5ms)\x1b[0m\n"
        self.assertEqual(policy_pass_evidence(line, ""), ("fresh", 5))

    def test_malformed_or_embedded_markers_are_not_evidence(self):
        for line in (
            "progress: ✓ Lockfile passes supply-chain policies (1 entry in 5ms)",
            "✓ Lockfile passes supply-chain policies (0 entries in 5ms)",
            "✓ Lockfile passes supply-chain policies (verified 5 ago)",
            "✓ Lockfile passes supply-chain policies (1 entry in -5ms)",
            "Lockfile passes supply-chain policies (1 entry in 5ms)",
        ):
            with self.subTest(line=line):
                self.assertIsNone(policy_pass_evidence(line, ""))

    def test_multiple_recognized_markers_fail_closed(self):
        stale = "✓ Lockfile passes supply-chain policies (verified 600001ms ago)\n"
        fresh = "✓ Lockfile passes supply-chain policies (1 entry in 5ms)\n"
        self.assertIsNone(policy_pass_evidence(stale + fresh, ""))
        self.assertIsNone(policy_pass_evidence(fresh, stale))
        self.assertIsNone(policy_pass_evidence(fresh, fresh))

    def test_safe_policy_evidence_summary_classifications(self):
        fresh = "✓ Lockfile passes supply-chain policies (1 entry in 5ms)\n"
        stale = "✓ Lockfile passes supply-chain policies (verified 601s ago)\n"
        malformed = "progress: Lockfile passes supply-chain policies"
        self.assertEqual(policy_evidence_summary("", ""), {
            "classification": "absent", "phrase_lines": 0, "recognized_lines": 0,
        })
        self.assertEqual(policy_evidence_summary(fresh, ""), {
            "classification": "fresh", "phrase_lines": 1, "recognized_lines": 1,
        })
        self.assertEqual(policy_evidence_summary(stale, ""), {
            "classification": "stale", "phrase_lines": 1, "recognized_lines": 1,
        })
        self.assertEqual(policy_evidence_summary(malformed, ""), {
            "classification": "malformed", "phrase_lines": 1, "recognized_lines": 0,
        })
        self.assertEqual(policy_evidence_summary(fresh, fresh)["classification"], "ambiguous")

    def test_policy_evidence_metadata_round_trips_only_as_closed_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "diagnostic.json"
            evidence = {"classification": "absent", "phrase_lines": 0, "recognized_lines": 0}
            write_diagnostic(path, "preverify-web-install", "policy-pass-marker-missing", 0, evidence)
            self.assertEqual(read_diagnostic(path, owner_uid=os.geteuid()), {
                "stage": "preverify-web-install",
                "category": "policy-pass-marker-missing",
                "exit_code": 0,
                "evidence": evidence,
            })
            path.unlink()
            with self.assertRaises(ValueError):
                write_diagnostic(path, "preverify-web-install", "policy-pass-marker-missing", 0,
                                 {"classification": "secret=bad", "phrase_lines": 0, "recognized_lines": 0})
            self.assertIsNone(read_diagnostic(path, owner_uid=os.geteuid()))

    def test_checked_pnpm_failure_suppresses_raw_subprocess_cause(self):
        raw = subprocess.CalledProcessError(
            7, ("pnpm", "install"), output="private-token", stderr="ERR_PNPM_TRUST_DOWNGRADE private-token"
        )
        with patch("worker_release_dependency_diagnostics.subprocess.run", side_effect=raw):
            with self.assertRaises(PnpmStepRejected) as caught:
                run_pnpm_checked(("pnpm", "install"), cwd=".", timeout=1, stage="preverify web-install")
        self.assertEqual(caught.exception.safe_category, "lockfile-trust-downgrade")
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)


if __name__ == "__main__":
    unittest.main()

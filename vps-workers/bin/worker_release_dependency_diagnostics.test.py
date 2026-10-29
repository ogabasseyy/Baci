import unittest

from worker_release_dependency_diagnostics import (
    MAX_FRESH_VERIFICATION_ELAPSED_MS,
    MAX_RECENT_VERIFICATION_AGE_MS,
    has_fresh_policy_pass,
    has_policy_pass_marker,
    policy_pass_evidence,
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


if __name__ == "__main__":
    unittest.main()

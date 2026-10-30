import unittest
import os
import errno
import subprocess
import tempfile
from pathlib import Path
from unittest.mock import patch

from worker_release_dependency_diagnostics import (
    MAX_FRESH_VERIFICATION_ELAPSED_MS,
    MAX_RECENT_VERIFICATION_AGE_MS,
    PnpmStepRejected,
    format_policy_line_shapes,
    has_fresh_policy_pass,
    has_policy_pass_marker,
    policy_pass_evidence,
    policy_evidence_summary,
    read_diagnostic,
    write_diagnostic,
)
from worker_release_pnpm_exec import run_pnpm_checked
from worker_release_dependency_evidence_shape import safe_errno_category


class PolicyPassEvidenceTests(unittest.TestCase):
    def test_os_errors_map_to_closed_categories(self):
        self.assertEqual(safe_errno_category(errno.ENOSPC), "filesystem-no-space")
        self.assertEqual(safe_errno_category(errno.EACCES), "filesystem-permission")
        self.assertEqual(safe_errno_category(errno.ENOENT), "filesystem-missing")
        self.assertEqual(safe_errno_category(-1), "filesystem-error")

    def test_fresh_evidence_boundaries_and_output_streams(self):
        at_limit = "✓ Lockfile passes supply-chain policies (3 entries in 240s)\n"
        over_limit = "✓ Lockfile passes supply-chain policies (3 entries in 240.001s)\n"
        over_limit_fraction = "✓ Lockfile passes supply-chain policies (3 entries in 240.0001s)\n"
        self.assertEqual(policy_pass_evidence(at_limit, ""), ("fresh", MAX_FRESH_VERIFICATION_ELAPSED_MS))
        self.assertTrue(has_fresh_policy_pass("", at_limit))
        self.assertFalse(has_fresh_policy_pass(over_limit, ""))
        self.assertEqual(policy_pass_evidence(over_limit_fraction, ""), ("fresh", 240_001))
        self.assertFalse(has_fresh_policy_pass(over_limit_fraction, ""))

    def test_pinned_pretty_ms_minute_and_decimal_formats_keep_freshness_limits(self):
        at_limit = "✓ Lockfile passes supply-chain policies (3 entries in 4m)\n"
        decimal = "✓ Lockfile passes supply-chain policies (3 entries in 3m 59.9s)\n"
        over_limit = "✓ Lockfile passes supply-chain policies (3 entries in 4m 1s)\n"
        self.assertEqual(policy_pass_evidence(at_limit, ""), ("fresh", MAX_FRESH_VERIFICATION_ELAPSED_MS))
        self.assertEqual(policy_pass_evidence(decimal, ""), ("fresh", 239_900))
        self.assertTrue(has_fresh_policy_pass("", at_limit))
        self.assertFalse(has_fresh_policy_pass(over_limit, ""))

    def test_compact_cached_pretty_ms_units_are_bounded_by_freshness_age(self):
        within = "✓ Lockfile passes supply-chain policies (verified 10m ago)\n"
        stale = "✓ Lockfile passes supply-chain policies (verified 11m ago)\n"
        self.assertEqual(policy_pass_evidence(within, ""), ("cached", MAX_RECENT_VERIFICATION_AGE_MS))
        self.assertTrue(has_policy_pass_marker(within, ""))
        self.assertFalse(has_policy_pass_marker(stale, ""))

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
        malformed = "progress: ✓ Lockfile passes supply-chain policies (message text only)\n"
        self.assertIsNone(policy_pass_evidence(stale + fresh, ""))
        self.assertIsNone(policy_pass_evidence(fresh, stale))
        self.assertIsNone(policy_pass_evidence(fresh, fresh))
        self.assertIsNone(policy_pass_evidence(fresh + malformed, ""))
        self.assertIsNone(policy_pass_evidence(malformed + fresh, ""))
        self.assertIsNone(policy_pass_evidence(fresh, malformed))

    def test_safe_policy_evidence_summary_classifications(self):
        fresh = "✓ Lockfile passes supply-chain policies (1 entry in 5ms)\n"
        stale = "✓ Lockfile passes supply-chain policies (verified 601s ago)\n"
        malformed = "progress: Lockfile passes supply-chain policies"
        self.assertEqual(policy_evidence_summary("", ""), {
            "classification": "absent", "phrase_lines": 0, "recognized_lines": 0, "line_shapes": [],
        })
        self.assertEqual(policy_evidence_summary(fresh, ""), {
            "classification": "fresh", "phrase_lines": 1, "recognized_lines": 1,
            "line_shapes": [{"prefix_category": "checkmark", "prefix_length_bucket": "2",
                             "suffix_category": "fresh-positive", "suffix_length_bucket": "9+",
                             "time_has_minutes": False, "time_has_decimal": False}],
        })
        self.assertEqual(policy_evidence_summary(stale, ""), {
            "classification": "stale", "phrase_lines": 1, "recognized_lines": 1,
            "line_shapes": [{"prefix_category": "checkmark", "prefix_length_bucket": "2",
                             "suffix_category": "cached", "suffix_length_bucket": "9+",
                             "time_has_minutes": False, "time_has_decimal": False}],
        })
        self.assertEqual(policy_evidence_summary(malformed, ""), {
            "classification": "malformed", "phrase_lines": 1, "recognized_lines": 0,
            "line_shapes": [{"prefix_category": "other", "prefix_length_bucket": "9+",
                             "suffix_category": "empty", "suffix_length_bucket": "0",
                             "time_has_minutes": False, "time_has_decimal": False}],
        })
        zero = "✓ Lockfile passes supply-chain policies (0 entries in 5ms)\n"
        zero_shape = policy_evidence_summary(zero, "")["line_shapes"][0]
        self.assertEqual(zero_shape["suffix_category"], "fresh-zero-count")
        self.assertFalse(zero_shape["time_has_minutes"])
        self.assertFalse(zero_shape["time_has_decimal"])
        minute_decimal = "✓ Lockfile passes supply-chain policies (2 entries in 1m 0.3s)"
        minute_shape = policy_evidence_summary(minute_decimal, "")["line_shapes"][0]
        self.assertEqual(minute_shape["suffix_category"], "fresh-positive")
        self.assertTrue(minute_shape["time_has_minutes"])
        self.assertTrue(minute_shape["time_has_decimal"])
        self.assertEqual(policy_evidence_summary(fresh, fresh)["classification"], "ambiguous")

    def test_line_shape_redacts_all_text_outside_fixed_marker(self):
        secret = "private-token /home/runner/secret"
        summary = policy_evidence_summary(f"{secret} ✓ {secret}Lockfile passes supply-chain policies ({secret}ms)\n", "")
        shape_text = format_policy_line_shapes(summary)
        self.assertNotIn(secret, shape_text)
        self.assertEqual(shape_text,
                         " line_shape=other:9+/parenthesized:9+:minutes=0:decimal=0")

    def test_policy_evidence_metadata_round_trips_only_as_closed_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "diagnostic.json"
            evidence = {"classification": "absent", "phrase_lines": 0, "recognized_lines": 0, "line_shapes": []}
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
                                 {"classification": "secret=bad", "phrase_lines": 0, "recognized_lines": 0,
                                  "line_shapes": []})
            self.assertIsNone(read_diagnostic(path, owner_uid=os.geteuid()))

    def test_errno_sidecar_round_trips_bounded_number_and_fixed_substage(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "diagnostic.json"
            write_diagnostic(path, "policy-preverify", "filesystem-error", None,
                             os_error={"errno": 28, "substage": "preverify-filesystem"})
            self.assertEqual(read_diagnostic(path, owner_uid=os.geteuid()), {
                "stage": "policy-preverify", "category": "filesystem-error", "exit_code": None,
                "os_error": {"errno": 28, "substage": "preverify-filesystem"},
            })
            path.unlink()
            write_diagnostic(path, "policy-preverify", "filesystem-error", None,
                             os_error={"errno": None, "substage": "pnpm-launch"})
            self.assertEqual(read_diagnostic(path, owner_uid=os.geteuid())["os_error"], {
                "errno": None, "substage": "pnpm-launch",
            })
            path.unlink()
            with self.assertRaises(ValueError):
                write_diagnostic(path, "policy-preverify", "filesystem-error", None,
                                 os_error={"errno": 256, "substage": "raw path /secret"})

    def test_checked_pnpm_failure_suppresses_raw_subprocess_cause(self):
        raw = subprocess.CalledProcessError(
            7, ("pnpm", "install"), output="private-token", stderr="ERR_PNPM_TRUST_DOWNGRADE private-token"
        )
        completed = subprocess.CompletedProcess(raw.cmd, 7, raw.stdout, raw.stderr)
        with patch("worker_release_pnpm_exec.run_bounded_capture", return_value=completed):
            with self.assertRaises(PnpmStepRejected) as caught:
                run_pnpm_checked(("pnpm", "install"), cwd=".", timeout=1, stage="preverify web-install")
        self.assertEqual(caught.exception.safe_category, "lockfile-trust-downgrade")
        self.assertIsNone(caught.exception.__cause__)
        self.assertTrue(caught.exception.__suppress_context__)

    def test_output_limit_maps_to_fixed_diagnostic_without_captured_text(self):
        from worker_release_bounded_process import OutputLimitExceeded

        with patch("worker_release_pnpm_exec.run_bounded_capture",
                   side_effect=OutputLimitExceeded(b"private-token", b"private-token")):
            with self.assertRaises(PnpmStepRejected) as caught:
                run_pnpm_checked(("pnpm", "install"), cwd=".", timeout=1,
                                  stage="preverify web-install")
        self.assertEqual((caught.exception.safe_category, caught.exception.exit_code),
                         ("pnpm-output-limit", 125))
        self.assertNotIn("private-token", str(caught.exception))

    def test_pnpm_launch_oserror_gets_fixed_substage_only(self):
        from worker_release_bounded_process import ProcessLaunchError

        raw = ProcessLaunchError(2)
        with patch("worker_release_pnpm_exec.run_bounded_capture", side_effect=raw):
            with self.assertRaises(OSError) as caught:
                run_pnpm_checked(("pnpm", "install"), cwd=".", timeout=1,
                                  stage="preverify web-install")
        self.assertEqual(caught.exception.safe_substage, "pnpm-launch")
        self.assertNotIn("/private/path", str(caught.exception.safe_substage))

    def test_other_pnpm_oserror_keeps_filesystem_fallback_substage(self):
        raw = OSError(5, "private filesystem detail", "/private/path")
        with patch("worker_release_pnpm_exec.run_bounded_capture", side_effect=raw):
            with self.assertRaises(OSError) as caught:
                run_pnpm_checked(("pnpm", "install"), cwd=".", timeout=1,
                                  stage="preverify web-install")
        self.assertFalse(hasattr(caught.exception, "safe_substage"))


if __name__ == "__main__":
    unittest.main()

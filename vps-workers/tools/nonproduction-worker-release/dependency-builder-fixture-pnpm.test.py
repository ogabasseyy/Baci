from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
MODULE_PATH = Path(__file__).with_name("dependency-builder-fixture-pnpm.py")
SPEC = importlib.util.spec_from_file_location("dependency_builder_fixture_pnpm", MODULE_PATH)
assert SPEC and SPEC.loader
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)


class FixturePnpmDiagnosticTests(unittest.TestCase):
    def test_trust_failure_without_hint_is_reported_as_unreported(self):
        output = (
            'ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for "secret-package@9.9.9" '
            'token=must-not-leak'
        )
        summary = fixture.summarize_failure(output)
        self.assertEqual(summary, {
            "schema": 1,
            "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
            "trust_evidence_transition": "unreported",
        })
        self.assertNotIn("secret-package", repr(summary))
        self.assertNotIn("must-not-leak", repr(summary))

    def test_trust_transition_variants_are_exact_and_allowlisted(self):
        cases = {
            "Earlier versions had trusted publisher, but this version has provenance attestation.":
                "trusted-publisher-to-provenance",
            "Earlier versions had trusted publisher, but this version has no trust evidence.":
                "trusted-publisher-to-none",
            "Earlier versions had provenance attestation, but this version has no trust evidence.":
                "provenance-to-none",
        }
        for hint, expected in cases.items():
            with self.subTest(expected=expected):
                result = fixture.summarize_failure(f"ERR_PNPM_TRUST_DOWNGRADE\nhint: {hint}")
                self.assertEqual(result["trust_evidence_transition"], expected)
        unknown = fixture.summarize_failure(
            "ERR_PNPM_TRUST_DOWNGRADE Earlier versions had custom signing, now unknown"
        )
        self.assertEqual(unknown["trust_evidence_transition"], "unrecognized")

    def test_unknown_failure_does_not_preserve_package_or_error_text(self):
        summary = fixture.summarize_failure("ERR_PNPM_META_FETCH_FAIL private-package@7 token=secret")
        self.assertEqual(summary["error_code"], "OTHER_PNPM_ERROR")
        self.assertEqual(summary["trust_evidence_transition"], "not-applicable")
        self.assertNotIn("private-package", repr(summary))

    def test_success_output_keeps_only_version_and_policy_marker(self):
        output = fixture.safe_success_output(
            "11.7.0\nProgress: resolved 100, token=secret\n",
            "✓ Lockfile passes supply-chain policies (12 entries in 2.1s)\nwarning: ignored"
        )
        self.assertEqual(output.splitlines(), [
            "11.7.0", "✓ Lockfile passes supply-chain policies (12 entries in 2.1s)",
        ])
        self.assertNotIn("secret", output)

    def test_marker_suffix_is_strictly_parsed_and_secret_suffix_is_rejected(self):
        valid = fixture.safe_success_output(
            "", "✓ Lockfile passes supply-chain policies (12 entries in 2.1s)"
        )
        self.assertEqual(valid, "✓ Lockfile passes supply-chain policies (12 entries in 2.1s)")
        tainted = fixture.safe_success_output(
            "", "✓ Lockfile passes supply-chain policies (12 entries in 2.1s) token=must-not-leak"
        )
        self.assertEqual(tainted, "")
        self.assertNotIn("must-not-leak", tainted)

    def test_cached_marker_preserves_cached_kind_and_age(self):
        output = fixture.safe_success_output(
            "", "✓ Lockfile passes supply-chain policies (verified 2s ago)"
        )
        self.assertEqual(output, "✓ Lockfile passes supply-chain policies (verified 2s ago)")
        self.assertNotIn("entries in", output)

    def test_multiple_or_malformed_markers_fail_closed(self):
        multiple = fixture.safe_success_output(
            "✓ Lockfile passes supply-chain policies (12 entries in 2s)\n"
            "✓ Lockfile passes supply-chain policies (verified 1s ago)", ""
        )
        malformed = fixture.safe_success_output(
            "", "✓ Lockfile passes supply-chain policies (verified 1s ago) injected"
        )
        self.assertEqual(multiple, "")
        self.assertEqual(malformed, "")

    def test_diagnostic_reader_rejects_symlink_and_extra_fields(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            accepted = root / "accepted"
            fixture._write_diagnostic(accepted, {
                "schema": 1,
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "trust_evidence_transition": "trusted-publisher-to-none",
            })
            self.assertEqual(fixture.read_diagnostic(accepted, owner_uid=accepted.stat().st_uid), {
                "schema": 1,
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "trust_evidence_transition": "trusted-publisher-to-none",
            })
            self.assertIsNone(fixture.read_diagnostic(accepted, owner_uid=accepted.stat().st_uid + 1))
            target = root / "target"
            target.write_text('{"schema":1,"error_code":"OTHER_PNPM_ERROR",'
                              '"trust_evidence_transition":"not-applicable","raw":"secret"}')
            target.chmod(0o600)
            self.assertIsNone(fixture.read_diagnostic(target, owner_uid=target.stat().st_uid))
            link = root / "link"
            link.symlink_to(target)
            self.assertIsNone(fixture.read_diagnostic(link, owner_uid=target.stat().st_uid))

    def test_observer_store_path_and_harness_reader_share_exact_scratch_location(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / f"{sha}.fixture"
            scratch.mkdir(mode=0o700)
            (scratch / "pnpm-store").mkdir(mode=0o700)
            candidate = fixture._diagnostic_path(["install", "--store-dir",
                                                  str(scratch / "pnpm-store")])
            self.assertEqual(candidate, scratch / fixture.FIXTURE_ERROR_NAME)
            fixture._write_diagnostic(candidate, {
                "schema": 1,
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "trust_evidence_transition": "trusted-publisher-to-none",
            })
            self.assertEqual(fixture.read_scratch_diagnostic(
                scratch, build_root=root, expected_sha=sha, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid(),
            )["error_code"], "ERR_PNPM_TRUST_DOWNGRADE")

    def test_scratch_reader_rejects_wrong_sha_mode_and_location(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / f"{sha}.fixture"
            scratch.mkdir(mode=0o700)
            self.assertIsNone(fixture.read_scratch_diagnostic(
                scratch, build_root=root, expected_sha="b" * 40, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid(),
            ))
            scratch.chmod(0o750)
            self.assertIsNone(fixture.read_scratch_diagnostic(
                scratch, build_root=root, expected_sha=sha, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid(),
            ))
            self.assertIsNone(fixture.read_scratch_diagnostic(
                scratch, build_root=root / "wrong", expected_sha=sha, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid(),
            ))

    def test_harness_reads_diagnostic_from_builder_scratch_not_outer_command_args(self):
        harness = MODULE_PATH.with_name("dependency-builder-systemd-test.sh").read_text(encoding="utf-8")
        self.assertIn("read_scratch_diagnostic(", harness)
        self.assertIn("scratch, build_root=dependency_builder.BUILD_ROOT", harness)
        self.assertNotIn('store_argument = next((index for index, value in enumerate(command)', harness)
        self.assertIn("stdout=subprocess.DEVNULL", harness)
        self.assertIn("stderr=subprocess.DEVNULL", harness)
        self.assertNotIn('diagnostic = (result.stderr + "\\n" + result.stdout)', harness)
        self.assertNotIn("print(diagnostic, file=sys.stderr)", harness)


if __name__ == "__main__":
    unittest.main()

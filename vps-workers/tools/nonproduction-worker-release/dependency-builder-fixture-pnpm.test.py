from __future__ import annotations

import importlib.util
import hashlib
import json
import os
import shutil
import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "bin"))
MODULE_PATH = Path(__file__).with_name("dependency-builder-fixture-pnpm.py")


def systemd_fixture_source() -> str:
    paths = [MODULE_PATH.with_name("dependency-builder-systemd-test.sh")]
    paths.extend(sorted(MODULE_PATH.parent.glob("dependency-builder-systemd-test-*.sh")))
    return "\n".join(path.read_text(encoding="utf-8") for path in paths)


SPEC = importlib.util.spec_from_file_location("dependency_builder_fixture_pnpm", MODULE_PATH)
assert SPEC and SPEC.loader
fixture = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(fixture)


class FixturePnpmDiagnosticTests(unittest.TestCase):
    def test_ndjson_reporter_is_limited_to_synthetic_deploy_invocation(self):
        deploy = fixture._pnpm_command("/trusted/pnpm.cjs", ("--filter", "@baci/web", "deploy"))
        install = fixture._pnpm_command("/trusted/pnpm.cjs", ("install", "--offline"))
        self.assertEqual(deploy, ("/usr/bin/node", "/trusted/pnpm.cjs", "--reporter=ndjson",
                                  "--filter", "@baci/web", "deploy"))
        self.assertEqual(install, ("/usr/bin/node", "/trusted/pnpm.cjs", "install", "--offline"))

    def test_nested_json_reporter_error_decodes_only_safe_package_and_transition(self):
        secret = "token=fixture-private-marker"
        nested_message = (
            'High-risk trust downgrade for "@esbuild/linux-x64@0.28.1" '
            '(possible package takeover)'
        )
        nested_hint = (
            "Earlier versions had trusted publisher, but this version has no trust evidence."
        )
        output = json.dumps({
            "level": "error",
            "err": json.dumps({
                "code": "ERR_PNPM_TRUST_DOWNGRADE",
                "message": nested_message,
                "hint": nested_hint,
                "diagnostic": secret,
            }),
        })
        summary = fixture.summarize_failure(output, pnpm_args=("--filter", "@baci/web", "deploy"),
                                            env={"PNPM_CONFIG_OFFLINE": "true",
                                                 "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"})
        self.assertEqual(summary["error_code"], "ERR_PNPM_TRUST_DOWNGRADE")
        self.assertEqual(summary["fixture_package"], "esbuild-platform-binary")
        self.assertEqual(summary["trust_evidence_transition"], "trusted-publisher-to-none")
        self.assertEqual(summary["trust_headline_state"], "recognized")
        self.assertEqual(summary["trust_hint_state"], "recognized")
        self.assertEqual(summary["package_coordinate_sha256"],
                         hashlib.sha256(b"@esbuild/linux-x64@0.28.1").hexdigest())
        self.assertNotIn(secret, repr(summary))
        self.assertNotIn("@esbuild/linux-x64", repr(summary))

    def test_ndjson_trust_error_is_reduced_to_coordinate_hash_and_transition(self):
        output = (
            '{"level":"error","name":"pnpm","code":"ERR_PNPM_TRUST_DOWNGRADE",'
            '"hint":"Trust checks are based solely on publish date. Earlier versions had '
            'provenance attestation, but this version has no trust evidence.",'
            '"err":{"message":"High-risk trust downgrade for \\"private-dep@3.4.5\\" '
            '(possible package takeover)"}}'
        )
        summary = fixture.summarize_failure(output, pnpm_args=("--filter", "@baci/web", "deploy"),
                                            env={"PNPM_CONFIG_OFFLINE": "true",
                                                 "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"})
        self.assertEqual(summary["error_code"], "ERR_PNPM_TRUST_DOWNGRADE")
        self.assertEqual(summary["trust_evidence_transition"], "provenance-to-none")
        self.assertEqual(summary["trust_headline_state"], "recognized")
        self.assertEqual(summary["package_coordinate_sha256"],
                         hashlib.sha256(b"private-dep@3.4.5").hexdigest())
        self.assertEqual(summary["fixture_package"], "unknown")
        self.assertNotIn("private-dep", repr(summary))

    def test_observer_imports_sibling_modules_when_loaded_from_staged_directory(self):
        module_names = ("dependency_builder_fixture_pnpm_classification",
                        "dependency_builder_fixture_pnpm_diagnostics")
        saved_paths = list(sys.path)
        saved_modules = {name: sys.modules.pop(name, None) for name in module_names}
        try:
            with tempfile.TemporaryDirectory() as temporary:
                staged = Path(temporary)
                for source in (MODULE_PATH,
                               MODULE_PATH.with_name("dependency_builder_fixture_pnpm_classification.py"),
                               MODULE_PATH.with_name("dependency_builder_fixture_pnpm_diagnostics.py")):
                    shutil.copyfile(source, staged / source.name)
                sys.path[:] = [str(Path(__file__).resolve().parents[2] / "bin")]
                spec = importlib.util.spec_from_file_location(
                    "staged_dependency_builder_fixture_pnpm", staged / MODULE_PATH.name,
                )
                self.assertIsNotNone(spec)
                self.assertIsNotNone(spec.loader)
                staged_observer = importlib.util.module_from_spec(spec)
                spec.loader.exec_module(staged_observer)
                self.assertEqual(staged_observer.summarize_failure("ERR_PNPM_TRUST_DOWNGRADE")["error_code"],
                                 "ERR_PNPM_TRUST_DOWNGRADE")
                self.assertIn(str(staged), sys.path[0])
        finally:
            sys.path[:] = saved_paths
            for name in module_names:
                sys.modules.pop(name, None)
                if saved_modules[name] is not None:
                    sys.modules[name] = saved_modules[name]

    def test_trust_failure_without_hint_is_reported_as_unreported(self):
        output = (
            'ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for "tsx@4.22.4" '
            '(possible package takeover) '
            'token=must-not-leak'
        )
        summary = fixture.summarize_failure(output)
        self.assertEqual(summary, {
            "schema": 1,
            "fixture_stage": "unknown",
            "fixture_network": "unknown",
            "fixture_injection": "unknown",
            "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
            "fixture_package": "tsx",
            "package_coordinate_sha256": hashlib.sha256(b"tsx@4.22.4").hexdigest(),
            "trust_evidence_transition": "unreported",
            "trust_headline_state": "recognized",
            "trust_hint_state": "absent",
        })
        self.assertNotIn("must-not-leak", repr(summary))

    def test_trust_headline_only_classifies_fixed_fixture_allowlist(self):
        for package, expected in (("dotenv@16.6.1", "dotenv"),
                                  ("esbuild@0.28.1", "esbuild"),
                                  ("@esbuild/linux-x64@0.28.1", "esbuild-platform-binary"),
                                  ("fsevents@2.3.3", "fsevents"),
                                  ("attacker@1.2.3", "unknown"),
                                  ("tsx@4.22.5", "unknown"),
                                  ("@esbuild/linux-x64@0.28.2", "unknown")):
            with self.subTest(package=package):
                result = fixture.summarize_failure(
                    f'ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for "{package}" '
                    "(possible package takeover)"
                )
                self.assertEqual(result["fixture_package"], expected)
                self.assertEqual(len(result["package_coordinate_sha256"]), 64)
                self.assertEqual(result["trust_evidence_transition"], "unreported")
                self.assertEqual(result["trust_headline_state"], "recognized")

    def test_fixture_stage_uses_only_fixed_command_shapes(self):
        cases = (
            (("--version",), Path("/tmp/source"), "version-check"),
            (("--filter", "@baci/web...", "install", "--offline"),
             Path("/tmp/source"), "web-install"),
            (("--filter", "@baci/web", "deploy", "--offline"),
             Path("/tmp/source"), "web-deploy"),
            (("install", "--offline"), Path("/tmp/source/vps-workers"), "worker-install"),
            (("install", "--offline"), Path("/tmp/untrusted/path"), "unknown"),
        )
        for args, cwd, expected in cases:
            with self.subTest(expected=expected):
                result = fixture.summarize_failure(
                    "ERR_PNPM_TRUST_DOWNGRADE token=must-not-leak",
                    pnpm_args=args, cwd=cwd,
                )
                self.assertEqual(result["fixture_stage"], expected)
                self.assertNotIn("untrusted", repr(result))
                self.assertNotIn("must-not-leak", repr(result))

    def test_unparsed_trust_failure_records_worker_install_stage(self):
        # Reproduces CI's code-only trust error and identifies only which
        # fixed pnpm phase failed, without copying pnpm output or its paths.
        summary = fixture.summarize_failure(
            "ERR_PNPM_TRUST_DOWNGRADE",
            pnpm_args=("install", "--prod", "--frozen-lockfile", "--offline"),
            cwd=Path("/run/build/source/vps-workers"),
        )
        self.assertEqual(summary["fixture_stage"], "worker-install")
        self.assertEqual(summary["trust_headline_state"], "absent")
        self.assertEqual(summary["package_coordinate_sha256"], "unreported")

    def test_unparsed_trust_failure_records_offline_injected_web_deploy(self):
        summary = fixture.summarize_failure(
            "ERR_PNPM_TRUST_DOWNGRADE",
            pnpm_args=("--filter", "@baci/web", "deploy", "--offline"),
            cwd=Path("/run/build/source"),
            env={"PNPM_CONFIG_OFFLINE": "true",
                 "PNPM_CONFIG_INJECT_WORKSPACE_PACKAGES": "true"},
        )
        self.assertEqual(summary["fixture_stage"], "web-deploy")
        self.assertEqual(summary["fixture_network"], "offline")
        self.assertEqual(summary["fixture_injection"], "enabled")
        self.assertNotIn("/run/build", repr(summary))

    def test_json_escaped_pnpm_headline_produces_coordinate_hash_only(self):
        summary = fixture.summarize_failure(
            r'{"error":{"code":"ERR_PNPM_TRUST_DOWNGRADE",'
            r'"message":"High-risk trust downgrade for \"private-dep@3.4.5\" '
            r'(possible package takeover)"}}'
        )
        self.assertEqual(summary["fixture_package"], "unknown")
        self.assertEqual(summary["package_coordinate_sha256"],
                         hashlib.sha256(b"private-dep@3.4.5").hexdigest())
        self.assertEqual(summary["trust_headline_state"], "recognized")
        self.assertNotIn("private-dep", repr(summary))

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
                self.assertEqual(result["trust_hint_state"], "recognized")
        unknown = fixture.summarize_failure(
            "ERR_PNPM_TRUST_DOWNGRADE Earlier versions had custom signing, now unknown"
        )
        self.assertEqual(unknown["trust_evidence_transition"], "unrecognized")
        self.assertEqual(unknown["trust_hint_state"], "intro-unparsed")

    def test_writer_diagnostics_round_trip_all_fixture_package_enum_values(self):
        examples = (
            ("tsx@4.22.4", "tsx"), ("dotenv@16.6.1", "dotenv"),
            ("esbuild@0.28.1", "esbuild"), ("fsevents@2.3.3", "fsevents"),
            ("@esbuild/linux-x64@0.28.1", "esbuild-platform-binary"),
            ("other@1.2.3", "unknown"),
        )
        with tempfile.TemporaryDirectory() as temporary:
            for index, (coordinate, expected_package) in enumerate(examples):
                with self.subTest(expected_package=expected_package):
                    output = (
                        "ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for "
                        f'"{coordinate}" (possible package takeover) Earlier versions had '
                        "trusted publisher, but this version has no trust evidence."
                    )
                    result = fixture.summarize_failure(output)
                    self.assertEqual(result["fixture_package"], expected_package)
                    path = Path(temporary) / f"diagnostic-{index}"
                    fixture._write_diagnostic(path, result)
                    self.assertEqual(fixture.read_diagnostic(path, owner_uid=os.geteuid()), result)

    def test_reader_rejects_inconsistent_hint_and_transition(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / "diagnostic"
            invalid = {
                "schema": 1,
                "fixture_stage": "worker-install",
                "fixture_network": "offline",
                "fixture_injection": "disabled",
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "fixture_package": "unknown",
                "package_coordinate_sha256": "0" * 64,
                "trust_evidence_transition": "trusted-publisher-to-none",
                "trust_headline_state": "recognized",
                "trust_hint_state": "intro-unparsed",
            }
            fixture._write_diagnostic(path, invalid)
            self.assertIsNone(fixture.read_diagnostic(path, owner_uid=os.geteuid()))

    def test_safe_states_distinguish_missing_and_unparsed_headline_without_text(self):
        missing = fixture.summarize_failure("ERR_PNPM_TRUST_DOWNGRADE unrelated safe text")
        malformed = fixture.summarize_failure(
            'ERR_PNPM_TRUST_DOWNGRADE High-risk trust downgrade for “secret@9.8”'
        )
        self.assertEqual(missing["trust_headline_state"], "absent")
        self.assertEqual(missing["trust_hint_state"], "absent")
        self.assertEqual(malformed["trust_headline_state"], "present-unparsed")
        self.assertEqual(malformed["trust_hint_state"], "absent")
        self.assertNotIn("secret", repr(malformed))

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
                "fixture_stage": "web-install",
                "fixture_network": "offline",
                "fixture_injection": "disabled",
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "fixture_package": "unknown",
                "package_coordinate_sha256": "0" * 64,
                "trust_evidence_transition": "trusted-publisher-to-none",
                "trust_headline_state": "recognized",
                "trust_hint_state": "recognized",
            })
            self.assertEqual(fixture.read_diagnostic(accepted, owner_uid=accepted.stat().st_uid), {
                "schema": 1,
                "fixture_stage": "web-install",
                "fixture_network": "offline",
                "fixture_injection": "disabled",
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "fixture_package": "unknown",
                "package_coordinate_sha256": "0" * 64,
                "trust_evidence_transition": "trusted-publisher-to-none",
                "trust_headline_state": "recognized",
                "trust_hint_state": "recognized",
            })
            self.assertIsNone(fixture.read_diagnostic(accepted, owner_uid=accepted.stat().st_uid + 1))
            target = root / "target"
            target.write_text('{"schema":1,"error_code":"OTHER_PNPM_ERROR",'
                              '"fixture_package":"not-applicable",'
                              '"package_coordinate_sha256":"not-applicable",'
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
                "fixture_stage": "worker-install",
                "fixture_network": "offline",
                "fixture_injection": "disabled",
                "error_code": "ERR_PNPM_TRUST_DOWNGRADE",
                "fixture_package": "unknown",
                "package_coordinate_sha256": "0" * 64,
                "trust_evidence_transition": "trusted-publisher-to-none",
                "trust_headline_state": "recognized",
                "trust_hint_state": "recognized",
            })
            # A later observer failure must not replace the first bounded
            # event; uniqueness is part of the scratch diagnostic protocol.
            fixture._write_diagnostic(candidate, {
                **fixture.summarize_failure("ERR_PNPM_META_FETCH_FAIL"),
            })
            diagnostic, state = fixture.read_scratch_diagnostic_status(
                scratch, build_root=root, expected_sha=sha, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid(),
            )
            self.assertEqual(state, "sidecar-accepted")
            self.assertEqual(diagnostic["error_code"], "ERR_PNPM_TRUST_DOWNGRADE")

    def test_observer_uses_fixed_pnpm_store_environment_when_cli_omits_store_dir(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / f"{sha}.fixture"
            scratch.mkdir(mode=0o700)
            store = scratch / "pnpm-store"
            store.mkdir(mode=0o700)
            path, state = fixture._diagnostic_path_state(
                ("--filter", "@baci/web", "deploy"),
                env={"PNPM_CONFIG_STORE_DIR": str(store)})
            self.assertEqual(state, "path-accepted")
            self.assertEqual(path, scratch / fixture.FIXTURE_ERROR_NAME)
            self.assertEqual(fixture._diagnostic_path(
                ("--filter", "@baci/web", "deploy"),
                env={"PNPM_CONFIG_STORE_DIR": str(store)}),
                scratch / fixture.FIXTURE_ERROR_NAME)
            _path, state = fixture._diagnostic_path_state(
                ("--store-dir", str(root / "other")),
                env={"PNPM_CONFIG_STORE_DIR": str(store)})
            self.assertEqual(state, "store-config-conflict")
            self.assertIsNone(fixture._diagnostic_path(
                ("--store-dir", str(root / "other")),
                env={"PNPM_CONFIG_STORE_DIR": str(store)}))

    def test_fixture_status_sidecar_records_only_closed_path_and_write_states(self):
        sha = "a" * 40
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scratch = root / f"{sha}.fixture"
            scratch.mkdir(mode=0o700)
            store = scratch / "pnpm-store"
            store.mkdir(mode=0o700)
            status_path = scratch / fixture.FIXTURE_STATUS_NAME
            self.assertTrue(fixture.write_scratch_diagnostic_status(
                status_path, store=store, state="path-store-owner-mismatch"))
            self.assertEqual(fixture.read_scratch_fixture_status(
                scratch, build_root=root, expected_sha=sha, owner_uid=os.geteuid(),
                build_root_uid=os.geteuid()), "path-store-owner-mismatch")
            self.assertFalse(fixture.write_scratch_diagnostic_status(
                status_path, store=store, state="arbitrary-output"))
            self.assertFalse(fixture.write_scratch_diagnostic_status(
                scratch / "elsewhere", store=store, state="path-accepted"))

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
        harness = systemd_fixture_source()
        self.assertIn("read_scratch_diagnostic_status(", harness)
        self.assertIn("fixture_sidecar_read={fixture_sidecar_read}", harness)
        self.assertIn('fixture_detail["fixture_stage"]', harness)
        self.assertIn('fixture_detail["fixture_network"]', harness)
        self.assertIn('fixture_detail["fixture_injection"]', harness)
        self.assertIn("fixture_stage={fixture_stage}", harness)
        self.assertIn("fixture_network={fixture_network}", harness)
        self.assertIn("fixture_injection={fixture_injection}", harness)
        self.assertIn("scratch, build_root=dependency_builder.BUILD_ROOT", harness)
        self.assertNotIn('store_argument = next((index for index, value in enumerate(command)', harness)
        self.assertIn("stdout=subprocess.PIPE", harness)
        self.assertIn("stderr=subprocess.PIPE", harness)
        self.assertIn("BoundedOutputDrain", harness)
        self.assertIn("summarize_child_output(", harness)
        self.assertIn("child_error={child_error}", harness)
        self.assertNotIn('diagnostic = (result.stderr + "\\n" + result.stdout)', harness)
        self.assertNotIn("print(diagnostic, file=sys.stderr)", harness)

    def test_split_systemd_fixture_modules_stay_under_review_limit(self):
        paths = [MODULE_PATH.with_name("dependency-builder-systemd-test.sh")]
        paths.extend(MODULE_PATH.parent.glob("dependency-builder-systemd-test-*.sh"))
        paths.extend((MODULE_PATH, MODULE_PATH.with_name("dependency_builder_fixture_pnpm_classification.py"),
                      MODULE_PATH.with_name("dependency_builder_fixture_pnpm_diagnostics.py")))
        oversized = [path.name for path in paths if len(path.read_text(encoding="utf-8").splitlines()) > 300]
        self.assertEqual(oversized, [])


if __name__ == "__main__":
    unittest.main()

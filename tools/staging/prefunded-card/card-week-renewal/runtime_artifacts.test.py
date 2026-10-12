from pathlib import Path
import sys
import hashlib
import tempfile
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import rebuild
import runtime_artifacts
sys.path.pop(0)


class ExpiryCandidateTests(unittest.TestCase):
    def test_preserves_already_renewed_checkout_after_readonly_installation(self):
        source = b'{"expiresAt":"2026-10-06T15:59:10Z","enabled":false}'
        self.assertEqual(runtime_artifacts._expiry_hits(source,
            '/opt/baci-prefunded-public/config/checkout.json', 0), source)

    def test_preserves_current_public_deadline_condition(self):
        source = b"[Service]\nExecCondition=/usr/bin/test 1791302350\n"
        self.assertEqual(runtime_artifacts._public_service_condition(source), source)

    def test_refuses_current_deadline_hidden_outside_expiry_field(self):
        source = b'{"expiresAt":"2026-10-06T15:59:10Z","note":"2026-10-06T15:59:10Z"}'
        with self.assertRaisesRegex(rebuild.Refused, "unclassified_expiry_literal"):
            runtime_artifacts._expiry_hits(source, '/opt/baci-prefunded-public/config/checkout.json', 0)

    def test_does_not_accept_current_financial_config_as_an_unpinned_noop(self):
        source = b'{"expiresAt":"2026-10-06T15:59:10Z"}'
        with self.assertRaisesRegex(rebuild.Refused, 'expiry_occurrence_map_mismatch'):
            runtime_artifacts._expiry_hits(source, '/opt/baci-prefunded-workers/config/background.json', 0)

    def test_updates_only_expected_expiry_literal(self):
        source = b'{"expiresAt":"2026-09-29T15:59:10Z","enabled":false}'
        result = runtime_artifacts._expiry_hits(source, "config.json", 1)
        self.assertEqual(result, b'{"expiresAt":"2026-10-06T15:59:10Z","enabled":false}')

    def test_updates_deadline_only_for_the_exact_receipt_artifact(self):
        receipt = b'{"deadline":"2026-09-29T15:59:10Z","enabled":false}'
        result = runtime_artifacts._expiry_hits(receipt, runtime_artifacts.RECEIPT_PATH, 1)
        self.assertEqual(result, b'{"deadline":"2026-10-06T15:59:10Z","enabled":false}')
        with self.assertRaisesRegex(rebuild.Refused, "expiry_occurrence_map_mismatch"):
            runtime_artifacts._expiry_hits(receipt, "/other/config.json", 1)

    def test_rebuilds_only_the_frozen_public_exec_condition_epoch(self):
        source = b"[Service]\nExecCondition=/usr/bin/test 1790697550\nExecStart=/bin/true\n"
        result = runtime_artifacts._public_service_condition(source)
        self.assertEqual(result, source.replace(b"ExecCondition=/usr/bin/test 1790697550",
            b"ExecCondition=/usr/bin/test 1791302350"))
        with self.assertRaisesRegex(rebuild.Refused, "public_service_condition_predecessor_drift"):
            runtime_artifacts._public_service_condition(source.replace(b"1790697550", b"1790000000"))

    def test_refuses_wrong_occurrence_count(self):
        with self.assertRaisesRegex(rebuild.Refused, "expiry_occurrence_map_mismatch"):
            runtime_artifacts._expiry_hits(b'{"expiresAt":"2026-09-29T15:59:10Z"}', "config.json", 2)

    def test_refuses_unclassified_legacy_deadline(self):
        source = b'{"expiresAt":"2026-09-29T15:59:10Z","note":"2026-09-29T15:59:10Z"}'
        with self.assertRaisesRegex(rebuild.Refused, "unclassified_expiry_literal"):
            runtime_artifacts._expiry_hits(source, "config.json", 2)

    def test_lease_words_do_not_exempt_unclassified_old_deadline(self):
        for source in (b'{"expiresAt":"2026-09-29T15:59:10Z","releaseChannel":"2026-09-29T15:59:10Z"}',
                       b'{"expiresAt":"2026-09-29T15:59:10Z","leaseId":"2026-09-29T15:59:10Z"}',
                       b'{"expiresAt":"2026-09-29T15:59:10Z","note":"lease expires 2026-09-29T15:59:10Z"}'):
            with self.subTest(source=source), self.assertRaisesRegex(
                    rebuild.Refused, "unclassified_expiry_literal"):
                runtime_artifacts._expiry_hits(source, "config.json", 2)

    def test_refuses_unrecognized_timer_or_epoch_literal(self):
        source = b'{"expiresAt":"2026-09-29T15:59:10Z","note":"1790697550"}'
        with self.assertRaisesRegex(rebuild.Refused, "unclassified_expiry_literal"):
            runtime_artifacts._expiry_hits(source, "config.json", 2)

    def test_prepares_config_only_and_marks_compiled_code_for_source_rebuild(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source_root = root / "input"
            rows = []
            for source, relative in runtime_artifacts.ARTIFACTS.items():
                data = (b'{"deadline":"2026-09-29T15:59:10Z"}' if source == runtime_artifacts.RECEIPT_PATH
                        else b'{"expiresAt":"2026-09-29T15:59:10Z"}' if source.endswith(".json")
                        else b'const expiresAt="2026-09-29T15:59:10Z";')
                path = source_root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.chmod(0o600)
                rows.append({"path": source, "sha256": hashlib.sha256(data).hexdigest(),
                    "oldDeadlineMentions": 1})
            unit_rows = []
            unit_names = set(runtime_artifacts.DEADLINE_TIMERS) | {runtime_artifacts.PUBLIC_SERVICE}
            for name in unit_names:
                data = (b"[Service]\nExecCondition=/usr/bin/test 1790697550\n"
                    if name == runtime_artifacts.PUBLIC_SERVICE else
                    b"[Timer]\nOnCalendar=2026-09-29 15:59:10 UTC\n")
                path = source_root / "units" / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(data)
                path.chmod(0o600)
                unit_rows.append({"name": name, "sha256": hashlib.sha256(data).hexdigest(),
                    "fragmentPath": "/etc/systemd/system/" + name,
                    "dropIns": [], "needDaemonReload": False})
            candidate = root / "candidate"

            manifest = runtime_artifacts.prepare_artifacts(
                {"files": rows, "units": unit_rows}, source_root, candidate)

            self.assertEqual(len(manifest["artifacts"]), 5)
            self.assertEqual(len(manifest["sourceRebuildRequired"]), 3)
            self.assertFalse((candidate / "public/launch-public.cjs").exists())
            self.assertFalse((candidate / "workers/background.cjs").exists())
            self.assertEqual(len(manifest["unitArtifacts"]), 4)
            self.assertIn(b"ExecCondition=/usr/bin/test 1791302350",
                (candidate / "units" / runtime_artifacts.PUBLIC_SERVICE).read_bytes())
            self.assertEqual((candidate / "public/checkout.json").read_bytes(),
                b'{"expiresAt":"2026-10-06T15:59:10Z"}')
            self.assertEqual((candidate / "units/baci-prefunded-deadline.timer").read_bytes(),
                b"[Timer]\nOnCalendar=2026-10-06 15:59:10 UTC\n")
            self.assertEqual((candidate / "first-card-endpoint.env").read_text(),
                "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\nPREFUNDED_CARD_PUBLIC_ENABLED=false\n"
                "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false\n")
            self.assertIn(b"2026-09-29", (source_root / "public/checkout.json").read_bytes())

    def test_refuses_timer_with_dropin_or_pending_reload(self):
        for update in ({"dropIns": ["/etc/systemd/system/override.conf"]},
                       {"needDaemonReload": True}):
            with self.subTest(update=update), tempfile.TemporaryDirectory() as directory:
                root = Path(directory)
                source_root = root / "input"
                rows = []
                for source, relative in runtime_artifacts.ARTIFACTS.items():
                    data = b'{"deadline":"2026-09-29T15:59:10Z"}' if source == runtime_artifacts.RECEIPT_PATH else b'{"expiresAt":"2026-09-29T15:59:10Z"}'
                    path = source_root / relative
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    path.chmod(0o600)
                    rows.append({"path": source, "sha256": hashlib.sha256(data).hexdigest(),
                        "oldDeadlineMentions": 1})
                names = set(runtime_artifacts.DEADLINE_TIMERS) | {runtime_artifacts.PUBLIC_SERVICE}
                unit_rows = []
                for name in names:
                    data = (b"[Service]\nExecCondition=/bin/test 1790697550\n"
                        if name == runtime_artifacts.PUBLIC_SERVICE
                        else b"[Timer]\nOnCalendar=2026-09-29 15:59:10 UTC\n")
                    path = source_root / "units" / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_bytes(data)
                    path.chmod(0o600)
                    row = {"name": name, "sha256": hashlib.sha256(data).hexdigest(),
                        "fragmentPath": "/etc/systemd/system/" + name,
                        "dropIns": [], "needDaemonReload": False}
                    if name == "baci-prefunded-deadline.timer":
                        row.update(update)
                    unit_rows.append(row)
                with self.assertRaisesRegex(rebuild.Refused, "deadline_timer_pin_missing"):
                    runtime_artifacts.prepare_artifacts({"files": rows, "units": unit_rows},
                        source_root, root / "candidate")


if __name__ == "__main__":
    unittest.main()

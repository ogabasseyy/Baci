import gzip
import hashlib
import importlib.util
import io
import json
from datetime import datetime, timezone
from pathlib import Path
import sys
import tarfile
import tempfile
import unittest
from unittest.mock import patch as mock_patch


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import activation_bundle as bundle
sys.path.pop(0)
INSTALLED_PINS = (bundle.APP_SHA256, bundle.APP_MANIFEST_SHA256, bundle.LAUNCHER_SHA256)
INSTALLED_SOURCE_PIN = bundle.SOURCE_MANIFEST_SHA256


def sha(data):
    return hashlib.sha256(data).hexdigest()


class ActivationBundleTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.candidate = self.root / "renewal"
        self.worker = self.root / "worker"
        self.candidate.mkdir()
        (self.candidate / "artifacts/public").mkdir(parents=True)
        (self.candidate / "artifacts/activation").mkdir()
        (self.candidate / "artifacts/units").mkdir()
        self.worker.mkdir()
        self.output = self.root / "bundle"
        self.archive, self.archive_manifest = self.make_archive()
        self.source_manifest = self.root / "source.json"
        self.launcher = self.root / "launch-public.cjs"
        self.worker_manifest = self.worker / "artifact.manifest.json"
        self.rehearsal = self.root / "rehearsal.json"
        self.build_inputs()

    def tearDown(self):
        self.temp.cleanup()

    def make_archive(self):
        files = {"launch-public.cjs": b"module.exports = true;",
                 "apps/web/server.js": b"module.exports = true;"}
        manifest = {"version": 1, "count": len(files),
            "bytes": sum(map(len, files.values())), "files": [
                {"path": name, "sha256": sha(data), "size": len(data)}
                for name, data in sorted(files.items())]}
        raw = io.BytesIO()
        with tarfile.open(fileobj=raw, mode="w:gz") as archive:
            for name, data in files.items():
                info = tarfile.TarInfo(name)
                info.size = len(data)
                archive.addfile(info, io.BytesIO(data))
        content = raw.getvalue()
        manifest.update(tarballSha256=sha(content), tarballSize=len(content))
        manifest_bytes = json.dumps(manifest).encode()
        archive_path, manifest_path = self.root / "app.tar.gz", self.root / "app.manifest.json"
        archive_path.write_bytes(content)
        manifest_path.write_bytes(manifest_bytes)
        self.patch("APP_SHA256", sha(content))
        self.patch("APP_MANIFEST_SHA256", sha(manifest_bytes))
        return archive_path, manifest_path

    def patch(self, name, value, module=bundle):
        patcher = mock_patch.object(module, name, value)
        patcher.start()
        self.addCleanup(patcher.stop)

    def build_inputs(self):
        launcher = b"module.exports = true;"
        self.launcher.write_bytes(launcher)
        self.patch("LAUNCHER_SHA256", sha(launcher))
        source = json.dumps({"version": 2, "sources": {str(i): "a" * 64 for i in range(56)},
            "rewrites": {}}).encode()
        self.source_manifest.write_bytes(source)
        self.patch("SOURCE_MANIFEST_SHA256", sha(source))
        outputs = {name: (name + " payload").encode() for name in bundle.WORKER_OUTPUTS}
        self.patch("WORKER_OUTPUTS", {name: sha(content) for name, content in outputs.items()})
        for name, content in outputs.items():
            (self.worker / name).write_bytes(content)
        worker_meta = {"status": "compiled-artifact-only", "deadline": bundle.DEADLINE,
            "financialBounds": {"companySandboxBudgetKobo": 10000,
                "originalPrincipalKobo": 10000, "principalMutation": False},
            "changesApplied": False, "providerWrites": False, "runtimeActivated": False,
            "externalExternals": ["pg-native"]}
        worker_bytes = json.dumps(worker_meta).encode()
        self.worker_manifest.write_bytes(worker_bytes)
        self.patch("WORKER_MANIFEST_SHA256", sha(worker_bytes))
        scope = {"deployment": "staging", "integrationId": "d91d9e87-8e0d-44de-9b84-1e1d709633d2",
            "merchantId": "10000000-0000-4000-8000-000000000001",
            "treasuryBindingId": "ffffcb16-2e95-5cff-a591-e9cc81cf5f57",
            "businessId": "01M2381RG34HQJMHQKE7DWDACR", "systemIdentifier": "7685292944002592802",
            "expiresAt": "2026-09-29T15:59:10Z"}
        certificate = "-----BEGIN CERTIFICATE-----\nQUJD\n-----END CERTIFICATE-----\n"
        def database(profile, role):
            return {"environment": "staging", "profile": profile, "transport": "tls",
                "host": bundle.checkout_projection.HOST, "expectedHost": bundle.checkout_projection.HOST,
                "port": 5432, "login": role, "expectedLogin": role, "database": "postgres",
                "expectedDatabase": "postgres", "expectedSystemId": "7685292944002592802",
                "expectedProjectId": bundle.checkout_projection.PROJECT,
                "actualProjectId": bundle.checkout_projection.PROJECT,
                "certificateAuthority": certificate, "password": "x" * 64, "storageApproved": True}
        old_public = {"deployment": "staging", "expiresAt": scope["expiresAt"],
            "publicOrigin": bundle.checkout_projection.PUBLIC_ORIGIN,
            "authOrigin": "https://staging-auth.ogabassey.com", "maximumAmountKobo": 10000,
            "context": {"environment": "staging", "transport": "tls", "integrationId": scope["integrationId"],
                "expectedBusinessId": scope["businessId"], "merchantId": scope["merchantId"],
                "allowlistedMerchantIds": [scope["merchantId"]],
                "allowlistedCustomerIds": ["10000000-0000-4000-8000-000000000002"],
                "expectedProjectId": "baci-isolated-savings", "actualProjectId": "baci-isolated-savings"},
            "checkout": {"scope": scope,
                "customerDatabase": database("checkout_customer", "prefunded_treasury_operator"),
                "verifierDatabase": database("checkout_authorizer", "prefunded_authorizer"),
                "provider": {**scope, "paystackSecret": "sk_test_" + "a" * 40,
                    "callbackUrl": bundle.checkout_projection.PUBLIC_ORIGIN + "/savings/card-return"}}}
        activation = json.dumps({"publicCheckout": old_public}, sort_keys=True).encode()
        self.patch('ACTIVATION_SHA256', sha(activation), bundle.checkout_projection)
        old_checkout = bundle.checkout_projection.parsed(
            bundle.checkout_projection.project_checkout(activation, bundle.checkout_projection.DEADLINE_EPOCH - 1))
        new_checkout = bundle._renew_dates(old_checkout)
        config_rows = []
        for source_path, relative, content in (
                ("/etc/baci/prefunded-card/activation.prepared.json", "activation.prepared.json",
                    activation.replace(b"2026-09-29T15:59:10Z", b"2026-10-06T15:59:10Z")),
                ("/opt/baci-prefunded-public/config/checkout.json", "public/checkout.json",
                    json.dumps(new_checkout, sort_keys=True, separators=(",", ":")).encode()),
                ("/opt/baci-prefunded-public/receipt.json", "public/receipt.json",
                    json.dumps({'deadline': bundle.DEADLINE, 'archiveSha256': bundle.APP_SHA256,
                        'manifestSha256': bundle.APP_MANIFEST_SHA256, 'mutationsEnabled': False}).encode())):
            (self.candidate / "artifacts" / relative).write_bytes(content)
            config_rows.append({"sourcePath": source_path, "candidatePath": relative,
                "sourceSha256": sha(activation) if source_path.endswith("activation.prepared.json") else sha(content),
                "candidateSha256": sha(content)})
        unit_rows = []
        for name, content in (("baci-prefunded-public.service", b"service"),
                              ("baci-prefunded-public-deadline.timer", b"timer")):
            relative = "units/" + name
            (self.candidate / "artifacts" / relative).write_bytes(content)
            unit_rows.append({"name": name, "candidatePath": relative,
                "candidateSha256": sha(content)})
        sql = b"BEGIN;\nCOMMIT;\n"
        (self.candidate / "database-renewal.sql").write_bytes(sql)
        (self.candidate / "artifacts/first-card-endpoint.env").write_text(
            "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\nPREFUNDED_CARD_PUBLIC_ENABLED=false\n"
            "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false\n")
        meta = {"status": "expiry_rebuild_prepared", "deadline": bundle.DEADLINE,
            "baselineObservedAt": datetime.now(timezone.utc).isoformat(),
            "databaseSqlSha256": sha(sql), "changesApplied": False,
            "servicesRestarted": False, "newPaymentStarted": False,
            "artifacts": {"artifacts": config_rows, "unitArtifacts": unit_rows}}
        meta["artifacts"]["activationFlags"] = {
            "PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED": "true",
            "PREFUNDED_CARD_PUBLIC_ENABLED": "false",
            "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED": "false",
            "onlyFirstCardEndpointEnabled": True,
            "savedCardsConfigChanged": False, "autoDebitConfigChanged": False}
        (self.candidate / "candidate.json").write_text(json.dumps(meta))
        proof = {"status": "rollback_rehearsal_passed", "databaseSqlSha256": sha(sql),
            "exitCode": 0, "rollbackConfirmed": True, "protectedStateUnchanged": True,
            "committed": False, "newPaymentStarted": False}
        self.rehearsal.write_text(json.dumps(proof))

    def test_real_assembly_roundtrip_keeps_card_not_ready_and_replay_off(self):
        result = bundle.assemble(self.candidate, self.archive, self.archive_manifest,
            self.source_manifest, self.launcher, self.worker, self.rehearsal, self.output)
        self.assertEqual(result["status"], "prepared-inactive")
        self.assertFalse(result["cardReady"])
        self.assertFalse(result["publicStarted"])
        self.assertFalse(result["financialReplayEnabled"])
        self.assertEqual((self.output / "app/apps/web/server.js").read_bytes(), b"module.exports = true;")
        self.assertEqual((self.output / "workers/snapshot.cjs").read_bytes(),
            (self.worker / "snapshot.cjs").read_bytes())
        self.assertEqual((self.output / "configs/first-card-endpoint.env").read_bytes(),
            b"PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\nPREFUNDED_CARD_PUBLIC_ENABLED=false\n"
            b"PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=false\n")

    def test_current_readonly_pins_match_installed_contract(self):
        self.assertEqual(INSTALLED_PINS, (
            '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2',
            '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8',
            'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03'))

    def test_fixture_cleanup_restores_bundle_and_checkout_globals(self):
        previous_bundle = bundle.APP_SHA256
        previous_checkout = bundle.checkout_projection.ACTIVATION_SHA256
        nested = ActivationBundleTests()
        try:
            nested.setUp()
            nested.patch('APP_SHA256', 'f' * 64)
            nested.patch('ACTIVATION_SHA256', 'e' * 64, bundle.checkout_projection)
        finally:
            nested.tearDown()
            nested.doCleanups()
        self.assertEqual(bundle.APP_SHA256, previous_bundle)
        self.assertEqual(bundle.checkout_projection.ACTIVATION_SHA256, previous_checkout)

    def test_refuses_candidate_without_explicit_mutations_disabled_flag(self):
        endpoint = self.candidate / "artifacts/first-card-endpoint.env"
        endpoint.write_text("PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\n"
            "PREFUNDED_CARD_PUBLIC_ENABLED=false\n")
        with self.assertRaisesRegex(bundle.Refused, "activation_flag_scope_refused"):
            bundle.assemble(self.candidate, self.archive, self.archive_manifest,
                self.source_manifest, self.launcher, self.worker, self.rehearsal, self.output)
        self.assertFalse(self.output.exists())

    def test_readonly_source_pin_accepts_current_manifest_and_refuses_old_isolated_pin(self):
        expected = '4b066d0e957b4f029c1be1e5c71c1496e269600d1763414645882d832c5c07d7'
        self.assertEqual(INSTALLED_SOURCE_PIN, expected)
        actual = Path('/private/tmp/baci-first-card-build-20261002.FUTQPHUB/source-readonly-r2/source-manifest.json')
        if actual.exists():
            self.assertEqual(sha(bundle._read(actual, expected, 1_000_000)), expected)
            with self.assertRaisesRegex(bundle.Refused, 'activation_input_pin_mismatch'):
                bundle._read(actual,
                    'a45ad2a1ecaccd2944839ecabef7f85d65ac42f0eb559fd41f615fd4e4ba0575', 1_000_000)

    def test_refuses_candidate_when_mutations_are_enabled(self):
        endpoint = self.candidate / "artifacts/first-card-endpoint.env"
        endpoint.write_text("PREFUNDED_CARD_CHECKOUT_PUBLIC_ENABLED=true\n"
            "PREFUNDED_CARD_PUBLIC_ENABLED=false\n"
            "PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED=true\n")
        with self.assertRaisesRegex(bundle.Refused, "activation_flag_scope_refused"):
            bundle.assemble(self.candidate, self.archive, self.archive_manifest,
                self.source_manifest, self.launcher, self.worker, self.rehearsal, self.output)
        self.assertFalse(self.output.exists())

    def test_refuses_sql_rehearsal_for_different_candidate_without_output(self):
        proof = json.loads(self.rehearsal.read_text())
        proof["databaseSqlSha256"] = "0" * 64
        self.rehearsal.write_text(json.dumps(proof))
        with self.assertRaisesRegex(bundle.Refused, "sql_rehearsal_evidence_refused"):
            bundle.assemble(self.candidate, self.archive, self.archive_manifest,
                self.source_manifest, self.launcher, self.worker, self.rehearsal, self.output)
        self.assertFalse(self.output.exists())


if __name__ == "__main__":
    unittest.main()

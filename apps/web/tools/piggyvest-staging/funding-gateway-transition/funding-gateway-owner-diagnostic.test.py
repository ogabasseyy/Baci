import importlib.util
import json
import os
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


BASE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location(
    'funding_gateway_diagnostic', BASE / 'funding-gateway-owner-diagnostic.py'
)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)


class FundingGatewayDiagnosticTests(unittest.TestCase):
    def test_allows_only_known_redacted_journal_stages(self):
        self.assertEqual(
            diagnostic._journal_stage(
                'secret=do-not-output\nManaged gateway withdrawn; operator review and fresh startup evidence required.\n'
            ),
            'withdrawn',
        )
        self.assertEqual(diagnostic._journal_stage('provider token=secret'), 'unclassified')

    def test_collects_hash_metadata_without_journal_content(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            receipt = root / 'receipt.json'
            renewal = root / 'renewal-receipt.json'
            unit = root / 'baci-savings-gateway.service'
            binding = root / 'binding.json'
            gateway = root / 'managed-gateway.mjs'
            archive = root / 'renewals' / '1790092750'
            archive.mkdir(parents=True)
            binding_hash = diagnostic.hashlib.sha256(b'archived-binding').hexdigest()
            evidence_hash = diagnostic.hashlib.sha256(b'archived-evidence').hexdigest()
            for path, content, mode in (
                (receipt, b'receipt', 0o600),
                (unit, b'unit', 0o644),
                (gateway, b'gateway', 0o440),
            ):
                path.write_bytes(content)
                path.chmod(mode)
            renewal.write_text(json.dumps({
                'version': 1,
                'activatedAt': 1790092750,
                'expiresAt': 1790697550,
                'predecessorReceiptSha256': diagnostic.hashlib.sha256(b'receipt').hexdigest(),
                'archivedEvidence': {'bindingSha256': binding_hash, 'startupEvidenceSha256': evidence_hash},
            }))
            renewal.chmod(0o600)
            binding.write_text(json.dumps({
                'version': 1,
                'identity': {},
                'reviewedAt': '2026-09-22T15:59:10.000Z',
                'leaseNotBefore': '2026-09-22T15:59:10.000Z',
                'leaseExpiresAt': '2026-09-29T15:59:10.000Z',
            }))
            binding.chmod(0o440)
            (archive / 'binding.json').write_bytes(b'archived-binding')
            (archive / 'startup-evidence.json').write_bytes(b'archived-evidence')
            for path in archive.iterdir():
                path.chmod(0o440)

            def run(arguments):
                if arguments[0].endswith('journalctl'):
                    return 'private=secret\nManaged gateway withdrawn; operator review and fresh startup evidence required.\n'
                return 'ExecMainStatus=1\nResult=exit-code\nActiveState=failed\nMainPID=0\nId=ignored\n'

            with (
                patch.object(diagnostic, 'RECEIPTS', (receipt, renewal)),
                patch.object(diagnostic, 'UNIT', unit),
                patch.object(diagnostic, 'BINDING', binding),
                patch.object(diagnostic, 'MANAGED_GATEWAY', gateway),
                patch.object(diagnostic, '_safe_ancestors'),
            ):
                result = diagnostic.collect_diagnostic(run, os.getuid())
            serialized = json.dumps(result)
            self.assertEqual(result['journal'], {'redactedStage': 'withdrawn'})
            self.assertEqual(result['service']['activeState'], 'failed')
            self.assertNotIn('secret', serialized)
            self.assertEqual(result['receipt']['mode'], '0600')
            self.assertEqual(result['renewal']['archiveId'], '1790092750')
            self.assertEqual(result['binding']['leaseExpiresAtEpoch'], 1790697550)
            self.assertEqual(result['managedGateway']['mode'], '0440')
            self.assertEqual(result['unit']['mode'], '0644')

    def test_refuses_missing_or_invalid_keyed_systemd_metadata(self):
        with self.assertRaisesRegex(diagnostic.Refused, 'incomplete'):
            diagnostic._systemd_metadata(lambda _: 'ActiveState=failed\nMainPID=0\n')
        with self.assertRaisesRegex(diagnostic.Refused, 'invalid'):
            diagnostic._systemd_metadata(
                lambda _: 'ActiveState=failed\nMainPID=pid\nResult=exit-code\nExecMainStatus=1\n'
            )

    def test_refuses_symlinked_or_writable_receipt_metadata(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            source = root / 'source'
            source.write_bytes(b'receipt')
            source.chmod(0o600)
            linked = root / 'receipt.json'
            linked.symlink_to(source)
            with patch.object(diagnostic, '_safe_ancestors'):
                with self.assertRaisesRegex(diagnostic.Refused, 'unavailable'):
                    diagnostic._hash_metadata(linked, (0o600,), os.getuid())
            source.chmod(0o640)
            with patch.object(diagnostic, '_safe_ancestors'):
                with self.assertRaisesRegex(diagnostic.Refused, 'unsafe'):
                    diagnostic._hash_metadata(source, (0o600,), os.getuid())

    def test_requires_root_before_collecting_metadata(self):
        with (
            patch.object(diagnostic.os, 'geteuid', return_value=501),
            patch.object(diagnostic.sys, 'stderr'),
        ):
            self.assertEqual(diagnostic.main(['--check']), 1)


if __name__ == '__main__':
    unittest.main()

import subprocess
import unittest
from pathlib import Path


ROOT = Path(__file__).resolve().parent


class OwnerRenewalBundleTests(unittest.TestCase):
    def test_seal_covers_exact_runtime_identity_and_gateway_unit(self):
        result = subprocess.run(
            ['shasum', '-a', '256', '-c', 'SHA256SUMS'],
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
        )
        self.assertEqual(result.returncode, 0, result.stderr)

    def test_regression_owner_wrapper_has_no_nginx_or_deploy_operation(self):
        wrapper = (ROOT / 'renew-seven-day-owner-root.sh').read_text()
        self.assertNotIn('nginx', wrapper.lower())
        self.assertNotIn('vercel', wrapper.lower())
        self.assertIn('managed-hosted-draft-renewal-runner.mjs', wrapper)
        self.assertIn('renewal-receipt.json', wrapper)
        self.assertIn("$config/binding.json", wrapper)
        self.assertIn('end - start != 604800', wrapper)
        self.assertIn('managed-install-manifest.json', wrapper)
        self.assertIn('failed-fresh', wrapper)
        self.assertIn('baci-savings-drafts-smoke.service', wrapper)

    def test_regression_owner_wrapper_requires_predecessor_hashes_before_mutation(self):
        wrapper = (ROOT / 'renew-seven-day-owner-root.sh').read_text()
        for value in (
            'c8b95a4eb3c8d6306f138e157a32bdf884b76474979cdbc25e0e9bcc988941c5',
            '4458d76a23f530586126c1da5b0e05615deb4b0643e0fdcc0c58f9f42908a00b',
            'ea802ae4be62a79f4230c5d78fe60e3964d17173354dbebbd6d64e0acd2aafa9',
            '13e74f1efe9f193f9fa33b074812416bfb60e6b34b4e1c4a403baff25795a90f',
        ):
            self.assertIn(value, wrapper)

    def test_regression_root_preflight_and_rollback_guards_are_present(self):
        wrapper = (ROOT / 'renew-seven-day-owner-root.sh').read_text()
        self.assertIn('MainPID --value', wrapper)
        self.assertIn('test ! -e "$code/$name" && test ! -L "$code/$name"', wrapper)
        self.assertIn("trap 'exit 1' HUP INT TERM", wrapper)
        self.assertIn('restart baci-savings-drafts-deadline.timer', wrapper)
        self.assertIn('http://127.0.0.1:4792/api/storefront/customer/savings/drafts', wrapper)
        self.assertIn('log rollback-stop failed', wrapper)
        self.assertIn('if ! quiet /usr/bin/systemctl stop', wrapper)

    def test_regression_remote_wrapper_pins_transferred_manifest(self):
        wrapper = (ROOT / 'renew-seven-day-owner.sh').read_text()
        self.assertIn('manifest_hash=', wrapper)
        self.assertIn('sha256sum -c SHA256SUMS', wrapper)
        self.assertIn('$manifest_hash', wrapper)


if __name__ == '__main__':
    unittest.main()

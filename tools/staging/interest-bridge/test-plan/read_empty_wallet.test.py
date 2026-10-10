import copy
import hashlib
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from plan_constants import OLD_FAAS, OLD_WALLET, SCOPE
from read_empty_wallet import read_empty_wallet, read_sealed


class EmptyWalletTests(unittest.TestCase):
    def setUp(self):
        self.records = {}
        for wallet_id, faas in ((OLD_WALLET, OLD_FAAS), (SCOPE['publicWalletId'], SCOPE['faasWalletId'])):
            self.records[wallet_id] = {'id': wallet_id, 'faas_wallet_identifier': faas,
                'api_customer_id': SCOPE['apiCustomerId'], 'business_id': SCOPE['businessId'],
                'currency': 'NGN', 'status': 'active', 'interest_enabled': wallet_id != OLD_WALLET,
                'balance': 10000 if wallet_id == OLD_WALLET else 0, 'withdrawal_count': 0}
        self.paths = []

    def request(self, wallet_id):
        self.paths.append(wallet_id)
        return self.records[wallet_id], 'a' * 64

    def test_reads_exact_old_wallet_and_enabled_empty_wallet_without_transactions_or_writes(self):
        result = read_empty_wallet(self.request)
        self.assertEqual(self.paths, [OLD_WALLET, SCOPE['publicWalletId']])
        self.assertTrue(result['interestEnabled'])
        self.assertEqual(result['balanceKobo'], 0)

    def test_rejects_api_alias_faas_or_business_mismatch_on_either_wallet(self):
        for wallet_id in self.records:
            for field in ('api_customer_id', 'faas_wallet_identifier', 'business_id', 'id'):
                saved = copy.deepcopy(self.records)
                self.records[wallet_id][field] = 'different-opaque-id'
                with self.subTest(wallet=wallet_id, field=field), self.assertRaises(ValueError):
                    read_empty_wallet(self.request)
                self.records = saved

    def test_rejects_nonempty_enabled_wallet_bool_balance_and_disabled_interest(self):
        for field, value in (('balance', 1), ('balance', False), ('interest_enabled', False),
                             ('status', 'closed'), ('withdrawal_count', 5), ('withdrawal_count', False)):
            saved = copy.deepcopy(self.records)
            self.records[SCOPE['publicWalletId']][field] = value
            with self.subTest(field=field), self.assertRaises(ValueError):
                read_empty_wallet(self.request)
            self.records = saved

    def test_sealed_inputs_require_root_single_link_0600_and_exact_digest(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / 'proof'
            path.write_bytes(b'synthetic-proof')
            path.chmod(0o600)
            checksum = hashlib.sha256(path.read_bytes()).hexdigest()
            original_stat = os.fstat

            def root_stat(descriptor):
                values = list(original_stat(descriptor))
                values[4] = 0
                return os.stat_result(values)

            with patch('read_empty_wallet.os.fstat', side_effect=root_stat):
                self.assertEqual(read_sealed(path, checksum), b'synthetic-proof')
                with self.assertRaises(ValueError):
                    read_sealed(path, '0' * 64)
                path.chmod(0o644)
                with self.assertRaises(ValueError):
                    read_sealed(path, checksum)


if __name__ == '__main__':
    unittest.main()

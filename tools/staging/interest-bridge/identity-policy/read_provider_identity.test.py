from datetime import datetime, timezone
import json
from types import SimpleNamespace
from urllib.request import HTTPRedirectHandler
import unittest
from unittest.mock import patch

from read_provider_identity import OLD_WALLET, TRANSACTION, TRUE_WALLET, read_provider_identity


class Helper:
    @staticmethod
    def page_rows(page):
        return page['edges'], page['pageInfo'].get('endCursor') if page['pageInfo']['hasNextPage'] else None


class ReadbackTests(unittest.TestCase):
    def setUp(self):
        self.row = {'id': TRANSACTION, 'wallet_id': OLD_WALLET, 'amount': 10000,
                    'status': 'successful', 'type': 'credit', 'category': 'bank-inflow'}
        self.page = {'edges': [self.row], 'pageInfo': {'hasNextPage': False}}
        self.paths = []

    def request(self, path):
        self.paths.append(path)
        if path.startswith('/api/v1/wallet/'):
            return {'id': path.rsplit('/', 1)[-1]}, 'a' * 64
        return self.page, 'b' * 64

    def read(self):
        with patch('read_provider_identity.datetime') as clock:
            clock.now.return_value = datetime(2026, 10, 2, 11, tzinfo=timezone.utc)
            return read_provider_identity(self.request, Helper)

    def test_uses_verified_wallet_and_documented_bounded_transaction_list_routes(self):
        wallets, proof = self.read()
        self.assertEqual(set(wallets), {OLD_WALLET, TRUE_WALLET})
        self.assertEqual(self.paths[-1], '/api/v1/transaction?wallet_id=' + OLD_WALLET + '&limit=100&collapse_batch=0')
        self.assertEqual(proof['transactionId'], TRANSACTION)
        self.assertEqual(proof['responseSha256'], 'b' * 64)
        self.assertEqual(proof['status'], 'exact_provider_transaction_identity_amount_match')
        self.assertFalse(any('/transaction/' in path for path in self.paths))

    def test_refuses_duplicate_or_absent_transaction_ids(self):
        for rows in ([], [self.row, dict(self.row)]):
            self.page['edges'] = rows
            with self.assertRaises(ValueError):
                self.read()

    def test_refuses_wrong_wallet_failed_amount_debit_and_outflow(self):
        for field, value in (('wallet_id', 'different'), ('status', 'pending'), ('amount', 10001),
                             ('type', 'debit'), ('category', 'bank-outflow')):
            self.page['edges'] = [{**self.row, field: value}]
            with self.assertRaises(ValueError):
                self.read()

    def test_refuses_repeated_cursor_and_truncated_list(self):
        self.page['edges'] = []
        self.page['pageInfo'] = {'hasNextPage': True, 'endCursor': 'same-cursor'}
        with self.assertRaisesRegex(ValueError, 'transaction-list-cursor'):
            self.read()

    def test_live_transport_uses_pinned_helper_credentials_and_required_user_agent(self):
        requests = []
        page = self.page

        class Response:
            status = 200

            def __init__(self, data):
                self.data = data

            def __enter__(self):
                return self

            def __exit__(self, *arguments):
                return False

            def read(self, bound):
                return json.dumps({'status': True, 'data': self.data}).encode()

        class Opener:
            def open(self, request, timeout):
                requests.append(request)
                return Response(page if '/transaction?' in request.full_url else {'id': 'wallet'})

        helper = SimpleNamespace(read_configuration=lambda: {'apiSecret': 'synthetic-private-secret'},
                                 NoRedirect=HTTPRedirectHandler, page_rows=Helper.page_rows)
        with patch('read_provider_identity.os.geteuid', return_value=0), \
                patch('read_provider_identity._load_helper', return_value=helper), \
                patch('read_provider_identity.build_opener', return_value=Opener()), \
                patch('read_provider_identity.datetime') as clock:
            clock.now.return_value = datetime(2026, 10, 2, 11, tzinfo=timezone.utc)
            _, proof = read_provider_identity()
        for request in requests:
            self.assertEqual(request.get_method(), 'GET')
            self.assertEqual(request.get_header('User-agent'), 'Baci-Staging-ReadOnly/1.0')
            self.assertEqual(request.get_header('Authorization'), 'Bearer synthetic-private-secret')
        self.assertNotIn('synthetic-private-secret', json.dumps(proof))


if __name__ == '__main__':
    unittest.main()

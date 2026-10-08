import importlib.util
import pathlib
import unittest
from unittest.mock import Mock


def load_module():
    spec = importlib.util.spec_from_file_location('provision', pathlib.Path(__file__).with_name('provision.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


class ProvisionTests(unittest.TestCase):
    def setUp(self):
        self.module = load_module()
        self.goal = '430314fd-cd8b-4579-98d4-e9f345713dd6'
        self.scope = {
            'apiCustomerId': '01M2T3PAHG3P5A32REX8MH3HD7',
            'businessId': '01M2381RG34HQJMHQKE7DWDACR',
            'name': f'baci:{self.module.INTEGRATION}:{self.goal}',
        }
        self.wallet = {
            'id': '01M2T3QAGMXV69P34CMQH8P59H',
            'api_customer_id': self.scope['apiCustomerId'],
            'business_id': self.scope['businessId'],
            'name': self.scope['name'],
            'currency': 'NGN', 'status': 'active',
        }

    def test_rejects_other_customer_wallet_despite_matching_name(self):
        with self.assertRaises(RuntimeError):
            self.module.verify_wallet({**self.wallet, 'api_customer_id': 'other'}, self.scope)

    def test_goal_wallet_name_fits_provider_fifty_character_limit(self):
        name = self.module.wallet_name(self.module.INTEGRATION, self.goal)
        self.assertLessEqual(len(name), 50)
        self.assertRegex(name, r'^baci[a-f0-9]{40}$')
        self.assertEqual(name, self.module.wallet_name(self.module.INTEGRATION, self.goal))
        self.assertNotEqual(name, self.module.wallet_name(self.module.INTEGRATION, 'different-goal'))
        self.assertNotEqual(name, self.module.wallet_name('different-integration', self.goal))

    def test_requires_business_name_currency_and_active_status(self):
        for field, value in [('business_id', 'other'), ('name', 'other'), ('currency', 'USD'), ('status', 'pending')]:
            with self.subTest(field=field), self.assertRaises(RuntimeError):
                self.module.verify_wallet({**self.wallet, field: value}, self.scope)

    def test_accepts_only_exact_provider_identity(self):
        self.assertEqual(self.module.verify_wallet(self.wallet, self.scope), self.wallet['id'])

    def test_rejects_wrong_wallet_id_from_source_provider_read(self):
        with self.assertRaises(RuntimeError):
            self.module.verify_source_wallet(self.wallet, 'different-wallet')

    def test_resolves_api_customer_from_the_exact_signed_receipt_wallet(self):
        self.assertEqual(self.module.verify_source_wallet(self.wallet, self.wallet['id']), self.scope['apiCustomerId'])

    def test_lost_post_response_never_dispatches_again(self):
        api = Mock(return_value={'data': {'paginatedPayload': {'edges': [], 'pageInfo': {'hasNextPage': False}}}})
        with self.assertRaisesRegex(RuntimeError, 'unresolved'):
            self.module.ensure_wallet(api, self.scope, {'phase': 'dispatched'}, Mock())
        self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))

    def test_recovers_exact_wallet_without_another_post(self):
        api = Mock(return_value={'data': {'paginatedPayload': {'edges': [self.wallet], 'pageInfo': {'hasNextPage': False}}}})
        self.assertEqual(self.module.ensure_wallet(api, self.scope, {'phase': 'dispatched'}, Mock()), self.wallet['id'])
        self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))

    def test_duplicate_named_wallets_refuse(self):
        api = Mock(return_value={'data': {'paginatedPayload': {'edges': [self.wallet, self.wallet], 'pageInfo': {'hasNextPage': False}}}})
        with self.assertRaisesRegex(RuntimeError, 'ambiguous'):
            self.module.ensure_wallet(api, self.scope, {'phase': 'prepared'}, Mock())
        self.assertTrue(all(call.args[0] == 'GET' for call in api.call_args_list))

    def test_persists_dispatch_before_provider_post(self):
        events = []
        def request(method, path, body=None):
            events.append(method)
            if method == 'GET':
                return {'data': {'paginatedPayload': {'edges': [], 'pageInfo': {'hasNextPage': False}}}}
            self.assertEqual(events[-2], 'dispatched')
            self.assertFalse(body['enable_interest_accrual'])
            return {'status': True, 'data': {'id': self.wallet['id']}}
        result = self.module.ensure_wallet(request, self.scope, {'phase': 'prepared'}, lambda value: events.append(value['phase']))
        self.assertEqual(result, self.wallet['id'])

    def test_opted_in_savings_wallet_requests_interest_without_changing_default(self):
        requests = []

        def request(method, path, body=None):
            requests.append((method, path, body))
            if method == 'GET':
                return {'data': {'paginatedPayload': {'edges': [], 'pageInfo': {'hasNextPage': False}}}}
            return {'status': True, 'data': {'id': self.wallet['id']}}

        journal = []
        result = self.module.ensure_wallet(
            request, {**self.scope, 'enableInterestAccrual': True},
            {'phase': 'prepared'}, journal.append,
        )
        self.assertEqual(result, self.wallet['id'])
        self.assertEqual(requests[-1], ('POST', '/api/v1/wallet/sub-account', {
            'customer_id': self.scope['apiCustomerId'],
            'subaccount_name': self.scope['name'],
            'reserve_virtual_account': True,
            'enable_interest_accrual': True,
        }))
        self.assertTrue(journal[0]['enableInterestAccrual'])

    def test_existing_wallet_without_verified_interest_is_not_recreated(self):
        for flag in (False, None):
            with self.subTest(flag=flag):
                wallet = {**self.wallet, 'interest_enabled': flag}
                requests = []

                def request(method, path, body=None):
                    requests.append(method)
                    return {'data': {'paginatedPayload': {'edges': [wallet], 'pageInfo': {'hasNextPage': False}}}}

                saved = []
                with self.assertRaisesRegex(RuntimeError, 'Existing wallet interest accrual is not verified'):
                    self.module.ensure_wallet(
                        request, {**self.scope, 'enableInterestAccrual': True},
                        {'phase': 'prepared'}, saved.append,
                    )
                self.assertEqual(requests, ['GET'])
                self.assertEqual(saved, [])

    def test_reuses_explicitly_interest_enabled_wallet_without_post(self):
        wallet = {**self.wallet, 'interest_enabled': True}
        api = Mock(return_value={'data': {'paginatedPayload': {'edges': [wallet], 'pageInfo': {'hasNextPage': False}}}})
        self.assertEqual(self.module.ensure_wallet(
            api, {**self.scope, 'enableInterestAccrual': True},
            {'phase': 'dispatched', 'enableInterestAccrual': True}, Mock(),
        ), self.wallet['id'])
        self.assertEqual([call.args[0] for call in api.call_args_list], ['GET'])

    def test_creation_request_flag_is_not_proof_of_existing_wallet_interest_enabled(self):
        for flag in (False, None):
            with self.subTest(flag=flag):
                wallet = {**self.wallet, 'enable_interest_accrual': True}
                if flag is not None:
                    wallet['interest_enabled'] = flag
                with self.assertRaisesRegex(RuntimeError, 'Existing wallet interest accrual is not verified'):
                    self.module.verify_wallet(wallet, {**self.scope, 'enableInterestAccrual': True})

    def test_interest_enabled_must_be_a_boolean_not_a_truthy_value(self):
        for flag in ('true', 1, ['true']):
            with self.subTest(flag=flag), self.assertRaisesRegex(RuntimeError, 'Existing wallet interest accrual is not verified'):
                self.module.verify_wallet(
                    {**self.wallet, 'interest_enabled': flag, 'enable_interest_accrual': True},
                    {**self.scope, 'enableInterestAccrual': True},
                )

    def test_rejects_non_boolean_interest_choice_before_provider_access(self):
        api = Mock()
        with self.assertRaisesRegex(RuntimeError, 'Invalid interest accrual choice'):
            self.module.ensure_wallet(
                api, {**self.scope, 'enableInterestAccrual': 'true'},
                {'phase': 'prepared'}, Mock(),
            )
        api.assert_not_called()

    def test_rejects_interest_choice_drift_after_prior_dispatch(self):
        api = Mock()
        with self.assertRaisesRegex(RuntimeError, 'Interest accrual choice changed'):
            self.module.ensure_wallet(
                api, {**self.scope, 'enableInterestAccrual': True},
                {'phase': 'dispatched', 'enableInterestAccrual': False}, Mock(),
            )
        api.assert_not_called()


if __name__ == '__main__':
    unittest.main()

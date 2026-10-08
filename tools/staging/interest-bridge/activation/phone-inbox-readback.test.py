import importlib.util
import io
import json
from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch


specification = importlib.util.spec_from_file_location('inbox', Path(__file__).with_name('phone-inbox-readback.py'))
inbox = importlib.util.module_from_spec(specification)
specification.loader.exec_module(inbox)


class InboxReadbackTests(unittest.TestCase):
    def test_only_counts_are_reported_without_message_or_token(self):
        report = inbox.summarize(dict(notifications=[dict(body='private', ticket='private', readAt=None)],
                                     secret='private'))
        self.assertEqual(report, dict(notificationCount=1, unreadCount=1, financialChangesMade=False,
                                     deviceReceiptVerified=False))

    def test_refuses_missing_invalid_or_oversized_inbox(self):
        for response in ({}, dict(notifications=[{}]),
                         dict(notifications=[dict(readAt=True)]), dict(notifications=[{}] * 101)):
            with self.subTest(response=response), self.assertRaises(ValueError):
                inbox.summarize(response)

    def test_shared_authentication_refuses_before_any_inbox_request(self):
        helper = SimpleNamespace(authenticate=Mock(side_effect=ValueError('profile-refused')),
                                 request_json=Mock())
        with self.assertRaisesRegex(ValueError, 'profile-refused'):
            inbox.run(helper)
        helper.authenticate.assert_called_once_with()
        helper.request_json.assert_not_called()

    def test_shared_authenticated_headers_are_used_for_both_scoped_reads(self):
        headers = {'Authorization': 'Bearer PRIVATE-TOKEN', 'apikey': 'PRIVATE-KEY'}
        helper = SimpleNamespace(AUTH='https://staging-auth.ogabassey.com',
            API='https://staging.ogabassey.com', MERCHANT='10000000-0000-4000-8000-000000000001',
            authenticate=Mock(return_value=headers), request_json=Mock(side_effect=[
                (200, [{'id': '10000000-0000-4000-8000-000000000001', 'slug': 'savings-synthetic'}]),
                (200, {'notifications': [{'readAt': None}]})]))
        output = io.StringIO()
        with patch('sys.stdout', output):
            inbox.run(helper)
        helper.authenticate.assert_called_once_with()
        self.assertEqual(helper.request_json.call_count, 2)
        for call in helper.request_json.call_args_list:
            self.assertIs(call.args[1], headers)
            self.assertEqual(len(call.args), 2)
        report = json.loads(output.getvalue())
        self.assertEqual(report['http'], 200)
        self.assertFalse(report['financialChangesMade'])
        self.assertNotIn('PRIVATE', output.getvalue())

    def test_non_200_count_bearing_inbox_does_not_report_authenticated_read(self):
        actor = 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
        def request(url, headers, body=None):
            if '/auth/v1/token?' in url:
                return 200, {'user': {'id': actor}, 'access_token': 'PRIVATE-TOKEN'}
            if '/rest/v1/merchants?' in url:
                return 200, [{'id': '10000000-0000-4000-8000-000000000001', 'slug': 'savings-synthetic'}]
            return 401, {'notifications': [{'readAt': None}]}
        def private_read(path):
            if path.endswith('.json'):
                return b'{"publicKey":"PRIVATE-KEY"}'
            return b'STAGING_PHONE_EMAIL=baci-staging@example.com\nSTAGING_PHONE_PASSWORD=PRIVATE-PASSWORD\n'
        helper = SimpleNamespace(AUTH='https://staging-auth.ogabassey.com',
            API='https://staging.ogabassey.com', ACTOR=actor,
            MERCHANT='10000000-0000-4000-8000-000000000001', private_read=private_read,
            authenticate=Mock(return_value={}), request_json=Mock(side_effect=request))
        output = io.StringIO()
        with patch('sys.stdout', output), self.assertRaisesRegex(ValueError, 'inbox-status'):
            inbox.run(helper)
        self.assertEqual(output.getvalue(), '')

    def test_bad_merchant_response_stops_before_reading_inbox(self):
        for status, merchants in ((201, []), (True, []), (200, {}),
                (200, [{'id': 'wrong', 'slug': 'savings-synthetic'}]),
                (200, [{'id': '10000000-0000-4000-8000-000000000001', 'slug': True}])):
            with self.subTest(status=status, merchants=merchants):
                helper = SimpleNamespace(AUTH='https://staging-auth.ogabassey.com',
                    MERCHANT='10000000-0000-4000-8000-000000000001',
                    authenticate=Mock(return_value={}), request_json=Mock(return_value=(status, merchants)))
                with self.assertRaisesRegex(ValueError, 'merchant-identity'):
                    inbox.run(helper)
                helper.request_json.assert_called_once()


if __name__ == '__main__':
    unittest.main()

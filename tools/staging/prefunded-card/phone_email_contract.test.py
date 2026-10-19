import copy
import json
import unittest
from unittest.mock import patch

import phone_email_contract as contract
from treasury_owner_contract import Refused


class EmailContractTests(unittest.TestCase):
    def test_replaces_only_email_and_preserves_password_and_other_fixture_lines(self):
        original = b"STAGING_PHONE_EMAIL='old@example.invalid'\r\nSTAGING_PHONE_PASSWORD='secret $ with spaces'\r\nANOTHER=unchanged\r\n"
        with patch.object(contract, 'OLD_EMAIL_SHA', contract.digest(b'old@example.invalid')):
            values, changed = contract.fixture(original)
        self.assertEqual(values['STAGING_PHONE_PASSWORD'], 'secret $ with spaces')
        self.assertEqual(changed, original.replace(b"'old@example.invalid'", contract.EMAIL.encode()))
        self.assertEqual(contract.fixture(changed)[1], changed)

    def test_refuses_an_unapproved_email_instead_of_renaming_another_account(self):
        with self.assertRaises(Refused):
            contract.fixture(b'STAGING_PHONE_EMAIL=other@example.com\nSTAGING_PHONE_PASSWORD=secret\n')

    def test_refuses_duplicate_email_or_missing_password(self):
        valid = ('STAGING_PHONE_EMAIL=' + contract.EMAIL + '\nSTAGING_PHONE_PASSWORD=secret\n').encode()
        for content in (valid + valid, valid.split(b'STAGING_PHONE_PASSWORD=')[0]):
            with self.subTest(content=content), self.assertRaises(Refused):
                contract.fixture(content)

    def report(self):
        return dict(scope=True, collision=False, authId=contract.ACTOR, identityCount=1, identityMatches=True,
                    principalKobo=10000, authEmailSha=contract.OLD_EMAIL_SHA,
                    customerEmailSha=contract.OLD_EMAIL_SHA, protected={'goal': 'unchanged', 'password': 'hash'})

    def test_partial_admin_success_is_resumable_without_touching_payment(self):
        report = self.report()
        report['authEmailSha'] = contract.digest(contract.EMAIL.encode())
        contract.validate(report, report['protected'])
        with self.assertRaises(Refused):
            contract.validate(report, report['protected'], final=True)
        report['customerEmailSha'] = report['authEmailSha']
        contract.validate(report, report['protected'], final=True)

    def test_scope_collisions_balance_password_and_payment_drift_refused(self):
        original = self.report()
        for field, value in [('scope', False), ('collision', True), ('authId', 'wrong'),
                             ('identityCount', 2), ('identityMatches', False), ('principalKobo', 0),
                             ('authEmailSha', 'other'), ('protected', {'password': 'changed'})]:
            report = copy.deepcopy(original)
            report[field] = value
            with self.subTest(field=field), self.assertRaises(Refused):
                contract.validate(report, original['protected'])

    def test_customer_write_cannot_update_auth_password_goal_or_intent(self):
        sql = contract.customer_update_sql()
        self.assertEqual(sql.count('UPDATE '), 1)
        self.assertIn('UPDATE public.customers SET email=', sql)
        for guard in (contract.ACTOR, contract.CUSTOMER, contract.MERCHANT, contract.SYSTEM,
                      contract.OLD_EMAIL_SHA, 'affected<>1', 'clock_timestamp()>='):
            self.assertIn(guard, sql)
        self.assertNotIn('DELETE ', sql)
        self.assertNotIn('TRUNCATE ', sql)

    def test_profile_rejects_production_or_changed_key(self):
        value = dict(mode='hosted-staging', apiOrigin='https://staging.ogabassey.com',
                     supabaseOrigin=contract.ORIGIN, expectedAuthIssuer=contract.ORIGIN + '/auth/v1',
                     merchantId=contract.MERCHANT, publicKey='public-fixture')
        with patch.object(contract, 'PUBLIC_KEY_SHA', contract.digest(b'public-fixture')):
            self.assertEqual(contract.profile(json.dumps(value)), 'public-fixture')
            for field, changed in [('apiOrigin', 'https://ogabassey.com'), ('publicKey', 'other')]:
                altered = dict(value, **{field: changed})
                with self.assertRaises(Refused):
                    contract.profile(json.dumps(altered))


if __name__ == '__main__':
    unittest.main()

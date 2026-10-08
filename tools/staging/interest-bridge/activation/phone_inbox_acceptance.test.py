import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, HERE / filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


ACCEPTANCE = load('phone_inbox_acceptance', 'phone_inbox_acceptance.py')
LEGACY = load('legacy_inbox_summary', 'phone-inbox-readback.py')
GOAL = '9f01153c-1589-4dde-b9aa-8f644a846832'
OLD = '430314fd-cd8b-4579-98d4-e9f345713dd6'
EVENT = '20000000-0000-4000-8000-000000000031'
EXPECTED = dict(id=EVENT, goalId=GOAL, type='first_contribution',
                title='Your first step is done!', body='Private expected notification body',
                createdAt='2026-10-03T10:38:43.123456Z')


def response():
    return dict(notifications=[dict(EXPECTED, readAt=None)], deliveryEnabled=False,
        preferences=dict(encouragementEnabled=True, interestAlertsEnabled=True,
            weeklySummaryEnabled=True, quietHoursStart='22:00', quietHoursEnd='07:00',
            timeZone='Africa/Lagos'))


class PhoneInboxAcceptanceTests(unittest.TestCase):
    def refuse(self, status=200, inbox=None, expected=None):
        with self.assertRaisesRegex(ValueError, '^phone_inbox_acceptance_refused$'):
            ACCEPTANCE.verify_phone_inbox_acceptance(status,
                response() if inbox is None else inbox, EXPECTED if expected is None else expected)

    def test_regression_counts_only_accepts_wrong_goal_but_exact_verifier_refuses(self):
        inbox = response()
        inbox['notifications'][0].update(id='20000000-0000-4000-8000-000000000032', goalId=OLD)
        self.assertEqual(LEGACY.summarize(inbox)['notificationCount'], 1)
        self.assertEqual(LEGACY.summarize(inbox)['unreadCount'], 1)
        self.refuse(inbox=inbox)

    def test_matching_event_returns_only_redacted_primitives_without_auth_or_device_claims(self):
        inbox = response()
        original = copy.deepcopy(inbox)
        expected = copy.deepcopy(EXPECTED)
        result = ACCEPTANCE.verify_phone_inbox_acceptance(200, inbox, expected)
        self.assertEqual(result, dict(inboxEventMatched=True, eventId=EVENT, goalId=GOAL,
            contentSha256=hashlib.sha256(json.dumps(
                {key: EXPECTED[key] for key in ('type', 'title', 'body')}, sort_keys=True,
                separators=(',', ':'), ensure_ascii=False).encode()).hexdigest(),
            authenticatedOwnershipVerified=False, deviceReceiptVerified=False,
            financialChangesMade=False))
        self.assertTrue(all(type(value) in (str, bool) for value in result.values()))
        self.assertNotIn(EXPECTED['title'], json.dumps(result))
        self.assertNotIn(EXPECTED['body'], json.dumps(result))
        self.assertEqual(inbox, original)
        self.assertEqual(expected, EXPECTED)

    def test_target_matching_is_independent_of_position_and_push_capability(self):
        inbox = response()
        other = dict(EXPECTED, id='20000000-0000-4000-8000-000000000032', goalId=OLD,
                     type='interest_credited', readAt=None)
        inbox['notifications'].insert(0, other)
        inbox['deliveryEnabled'] = True
        self.assertTrue(ACCEPTANCE.verify_phone_inbox_acceptance(200, inbox, EXPECTED)['inboxEventMatched'])

    def test_duplicate_ids_anywhere_refuse_even_if_expected_event_is_unique(self):
        other = dict(EXPECTED, id='20000000-0000-4000-8000-000000000032', readAt=None)
        for rows in ([dict(EXPECTED, readAt=None)] * 2,
                     [other, dict(EXPECTED, readAt=None), copy.deepcopy(other)]):
            self.refuse(inbox=dict(response(), notifications=rows))

    def test_wrong_target_fields_and_independently_expected_scope_refuse(self):
        for field, value in (('id', '20000000-0000-4000-8000-000000000032'),
            ('goalId', OLD), ('type', 'milestone'), ('title', 'Wrong title'),
            ('body', 'Wrong body'), ('createdAt', '2026-10-03T10:38:44.123456Z')):
            with self.subTest(field=field):
                inbox = response()
                inbox['notifications'][0][field] = value
                self.refuse(inbox=inbox)
        for field, value in (('goalId', OLD), ('type', 'milestone')):
            self.refuse(expected=dict(EXPECTED, **{field: value}))
        self.refuse(inbox=dict(response(), notifications=[dict(EXPECTED, readAt=None,
            createdAt='2026-10-03T10:38:43.123457Z')]))

    def test_utc_equivalent_timestamp_spellings_match_without_precision_loss(self):
        inbox = response()
        inbox['notifications'][0]['createdAt'] = '2026-10-03T10:38:43.123456+00:00'
        inbox['notifications'][0]['readAt'] = '2026-10-03T10:38:43.123457Z'
        self.assertTrue(ACCEPTANCE.verify_phone_inbox_acceptance(200, inbox, EXPECTED)['inboxEventMatched'])

    def test_invalid_utc_timestamps_and_read_markers_refuse(self):
        invalid = [True, 1, '', '2026-10-03', '2026-02-30T10:38:43Z',
            '2026-10-03T10:38:43', '2026-10-03T11:38:43+01:00',
            '2026-10-03T10:38:43.1234567Z', '2026-10-03T10:38:60Z']
        for field in ('createdAt', 'readAt'):
            for value in invalid:
                with self.subTest(field=field, value=value):
                    inbox = response()
                    inbox['notifications'][0][field] = value
                    self.refuse(inbox=inbox)
        inbox = response()
        inbox['notifications'][0]['readAt'] = '2026-10-03T10:38:43.123455Z'
        self.refuse(inbox=inbox)

    def test_bad_status_and_malformed_or_oversized_lists_refuse(self):
        for status in (True, 200.0, '200', None, -1, 0, 201, 204, 401, 500):
            with self.subTest(status=status):
                self.refuse(status=status)
        for rows in ([], {}, 'private', [None], [dict(EXPECTED, readAt=None)] * 101):
            self.refuse(inbox=dict(response(), notifications=rows))

    def test_every_row_is_checked_for_bounds_shape_and_uuid_not_only_expected_row(self):
        other = dict(EXPECTED, id='20000000-0000-4000-8000-000000000032', readAt=None)
        changes = [('title', 'x' * 201), ('body', 'x' * 1001), ('title', ''),
            ('body', ' '), ('title', True), ('type', 'unknown'), ('goalId', None),
            ('id', 'not-uuid'), ('id', '20000000-0000-0000-0000-000000000032'),
            ('goalId', GOAL.upper()), ('body', '\ud800'), ('token', 'PRIVATE-TOKEN')]
        for field, value in changes:
            with self.subTest(field=field):
                self.refuse(inbox=dict(response(), notifications=[dict(EXPECTED, readAt=None),
                    dict(other, **{field: value})]))

    def test_malformed_response_preferences_and_expected_record_refuse_without_secrets(self):
        for inbox in ({}, dict(response(), secret='PRIVATE-TOKEN'),
                      dict(response(), deliveryEnabled=1), dict(response(), preferences={})):
            self.refuse(inbox=inbox)
        for field, value in (('quietHoursStart', '25:00'), ('timeZone', 'x' * 101),
                             ('timeZone', 'Imaginary/Nowhere'),
                             ('encouragementEnabled', 1)):
            inbox = response()
            inbox['preferences'][field] = value
            self.refuse(inbox=inbox)
        for expected in ({}, dict(EXPECTED, token='PRIVATE-TOKEN'), dict(EXPECTED, body='x' * 1001),
                         dict(EXPECTED, createdAt='not-time')):
            self.refuse(expected=expected)

    def test_hundred_unique_rows_are_bounded_and_complete_list_is_validated(self):
        inbox = response()
        inbox['notifications'] += [dict(EXPECTED, readAt=None,
            id='20000000-0000-4000-8000-' + format(value, '012x'), goalId=OLD)
            for value in range(100, 199)]
        self.assertTrue(ACCEPTANCE.verify_phone_inbox_acceptance(200, inbox, EXPECTED)['inboxEventMatched'])
        inbox['notifications'][-1]['readAt'] = 'not-UTC'
        self.refuse(inbox=inbox)


if __name__ == '__main__':
    unittest.main()

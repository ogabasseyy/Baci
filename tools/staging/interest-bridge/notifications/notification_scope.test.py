import copy
import importlib.util
import hashlib
import json
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
SPEC = importlib.util.spec_from_file_location('notification_scope', HERE/'notification_scope.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if SPEC.origin and Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


def fixture():
    goals = ['430314fd-cd8b-4579-98d4-e9f345713dd6', '9f01153c-1589-4dde-b9aa-8f644a846832']
    scope = dict(merchant='10000000-0000-4000-8000-000000000001',
        customer='10000000-0000-4000-8000-000000000002',
        actor='baeb4f5a-54c7-4d46-8b07-9e69ab2907b3')
    events = [dict(scope, id='ad00ea01-65f0-4594-b4f9-71cb609c6aaa', goal=goals[1],
        eventKey='first-contribution', type='first_contribution', immutableSha256='a'*64,
        contentSha256='b'*64, rowSha256='c'*64, expandedAt=None,
        createdAt='2026-10-03T17:00:00+00:00')]
    return dict(capturedAt='2026-10-03T20:00:00+00:00',
        goals=[dict(scope, id=goal, rowSha256='d'*64) for goal in goals], events=events,
        tokens=[], deliveries=[], tables={'savings_notifications.events': dict(oid=1, count=1, sha256='e'*64),
            'savings_notifications.deliveries': dict(oid=2, count=0, sha256='f'*64)})


class ScopeTests(unittest.TestCase):
    def test_postgres_five_digit_fractional_utc_timestamp_is_valid(self):
        value = SUBJECT.stamp('2026-09-27T08:13:55.20498+00:00')
        self.assertEqual(value.microsecond, 204980)
        with self.assertRaises(ValueError):
            SUBJECT.stamp('2026-09-27T08:13:55.20498+01:00')

    @unittest.skipUnless(Path('/private/tmp/baci-notification-scope-20261003.json').is_file(),
        'Authenticated private actual scope capture not available')
    def test_authenticated_actual_nine_event_capture_validates_without_rebaseline(self):
        raw = Path('/private/tmp/baci-notification-scope-20261003.json').read_bytes()
        self.assertEqual(hashlib.sha256(raw).hexdigest(),
            '5dfda373c8461831031380c9f2defeff49f3e28a37ca049fd006f578e40e3d09')
        value = json.loads(raw)
        SUBJECT.validate(value['scope'])
        SUBJECT.validate_database(value['database'])
        self.assertEqual(SUBJECT.verify_transition(value['scope'], value['scope'], [])['newEvents'], 0)
        for event in ('914e9941-c9c1-44a1-9879-1de3e54ac365', 'b5c93597-2989-45d9-bed4-85ec220e4240'):
            after = copy.deepcopy(value['scope'])
            row = next(row for row in after['events'] if row['id'] == event)
            row['immutableSha256'] = '0'*64
            with self.subTest(actualReminder=event), self.assertRaises(ValueError):
                SUBJECT.verify_transition(value['scope'], after, [])

    def test_preserves_existing_content_and_allows_only_expansion(self):
        before = fixture()
        after = copy.deepcopy(before)
        after['capturedAt'] = '2026-10-03T20:00:01+00:00'
        after['events'][0].update(expandedAt=after['capturedAt'], rowSha256='1'*64)
        SUBJECT.verify_transition(before, after, [])

    def test_hidden_body_mutation_and_event_removal_refuse(self):
        for change in ('body', 'remove', 'duplicate', 'foreign'):
            before, after = fixture(), fixture()
            if change == 'body':
                after['events'][0]['immutableSha256'] = '2'*64
            elif change == 'remove':
                after['events'] = []
            elif change == 'duplicate':
                after['events'].append(copy.deepcopy(after['events'][0]))
            else:
                after['goals'][0]['actor'] = 'foreign'
            with self.subTest(change=change), self.assertRaises(ValueError):
                SUBJECT.verify_transition(before, after, [])

    def test_new_event_requires_exact_reviewed_content_not_only_scope(self):
        before, after = fixture(), fixture()
        row = copy.deepcopy(after['events'][0])
        row.update(id='914e9941-c9c1-44a1-9879-1de3e54ac365', eventKey='missed:2026-10-02',
            type='missed_contribution', createdAt=after['capturedAt'])
        after['events'].append(row)
        after['tables']['savings_notifications.events']['count'] = 2
        expected = [{key: row[key] for key in ('goal', 'eventKey', 'type', 'contentSha256')}]
        SUBJECT.verify_transition(before, after, expected)
        row['contentSha256'] = '3'*64
        with self.assertRaises(ValueError):
            SUBJECT.verify_transition(before, after, expected)

    def test_tokens_or_existing_delivery_mutation_without_authority_refuse(self):
        before, after = fixture(), fixture()
        after['tokens'] = [dict(merchant=before['goals'][0]['merchant'], actor='foreign',
            tokenSha256='a'*64, rowSha256='b'*64)]
        with self.assertRaises(ValueError):
            SUBJECT.verify_transition(before, after, [])

    def test_financial_auth_catalog_and_non_target_reminder_changes_refuse(self):
        before = fixture()
        snapshot = dict(capturedAt=before['capturedAt'], readOnly=True, permanentMetadataSha256='a'*64,
            auth='unchanged', tableRows=dict(before['tables'], **{'public.customer_savings_goals': {'sha256': 'b'*64}}),
            allowedTargetWitnesses={})
        for key in ('auth', 'permanentMetadataSha256', 'principal'):
            changed = copy.deepcopy(snapshot)
            changed[key] = 'mutated'
            with self.subTest(key=key), self.assertRaises(ValueError):
                SUBJECT.verify_protected(snapshot, changed, before, before)
        after = copy.deepcopy(before)
        after['events'][0]['goal'] = before['goals'][0]['id']
        with self.assertRaises(ValueError):
            SUBJECT.verify_transition(before, after, [])


if __name__ == '__main__':
    unittest.main()

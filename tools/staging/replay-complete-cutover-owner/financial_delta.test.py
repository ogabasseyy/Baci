import copy
import unittest

from financial_delta import ALLOWED, BASELINE, INSERTIONS, MUTABLE, SCOPE, prove_allowed_deltas


def snapshot():
    tables, witnesses = {}, {}
    for index, name in enumerate(sorted(ALLOWED)):
        count = 0 if name in INSERTIONS else 1
        tables[name] = dict(oid=index + 100, count=count + 1, sha256='a' * 64)
        witnesses[name] = dict(excludedTargetCount=1, excludedTargetHash='b' * 64,
            targetCount=count, targetHash='c' * 64, redactedColumns=['synthetic_secret'],
            targetRows=[{'id': 'synthetic-id'}] if count else [],
            targetRowColumnHashes=[dict(id='d' * 64, amount_kobo='e' * 64,
                current_amount='e' * 64, reserved_kobo='e' * 64)] if count else [])
    tables['public.synthetic_unrelated'] = dict(oid=500, count=5, sha256='f' * 64)
    return dict(version=1, financialSnapshotVersion=1, sourceClosureSha256=BASELINE,
        baselineSnapshotSha256=BASELINE, scope=SCOPE, unsupportedRelations=[],
        identity=dict(systemIdentifier='7685292944002592802', database='postgres', sessionUser='postgres',
            currentUser='postgres', superuser=True, localSocket=True, sessionReplicationRole='origin'),
        permanentMetadataSha256='0' * 64, functions={'synthetic-function': 'unchanged'},
        tableRows=tables, allowedTargetWitnesses=witnesses)


class DeltaTests(unittest.TestCase):
    def test_allows_only_reviewed_target_column_change(self):
        before = snapshot()
        after = copy.deepcopy(before)
        name = 'public.customer_savings_goals'
        after['tableRows'][name]['sha256'] = '1' * 64
        after['allowedTargetWitnesses'][name]['targetRowColumnHashes'][0]['current_amount'] = '2' * 64
        self.assertEqual(prove_allowed_deltas(before, after)['changedTargetRelations'], [name])

    def test_same_table_change_to_original_plan_refuses(self):
        before = snapshot()
        after = copy.deepcopy(before)
        after['allowedTargetWitnesses']['public.customer_savings_goals']['excludedTargetHash'] = '1' * 64
        with self.assertRaisesRegex(ValueError, 'financial_protected_delta_refused'):
            prove_allowed_deltas(before, after)

    def test_unrelated_relation_and_metadata_drift_refuse(self):
        before = snapshot()
        for key in ('relation', 'metadata'):
            after = copy.deepcopy(before)
            if key == 'relation':
                after['tableRows']['public.synthetic_unrelated']['sha256'] = '1' * 64
            else:
                after['permanentMetadataSha256'] = '1' * 64
            with self.assertRaisesRegex(ValueError, 'financial_protected_delta_refused'):
                prove_allowed_deltas(before, after)

    def test_payment_amount_and_checkout_intent_changes_refuse(self):
        before = snapshot()
        for name in ('prefunded_card.operations', 'prefunded_card.checkout_intents'):
            after = copy.deepcopy(before)
            after['allowedTargetWitnesses'][name]['targetRowColumnHashes'][0]['amount_kobo'] = '1' * 64
            with self.assertRaisesRegex(ValueError, 'financial_protected_delta_refused'):
                prove_allowed_deltas(before, after)

    def test_new_target_rows_cannot_hide_mutation_of_existing_history(self):
        before = snapshot()
        name = 'savings_notifications.events'
        for value in (before,):
            value['tableRows'][name]['count'] = 2
            value['allowedTargetWitnesses'][name].update(targetCount=1, targetRows=[{'id': 'original'}],
                targetRowColumnHashes=[{'id': '1' * 64}])
        after = copy.deepcopy(before)
        after['tableRows'][name]['count'] = 3
        after['allowedTargetWitnesses'][name].update(targetCount=2,
            targetRows=[{'id': 'changed'}, {'id': 'new'}],
            targetRowColumnHashes=[{'id': '2' * 64}, {'id': '3' * 64}])
        with self.assertRaisesRegex(ValueError, 'financial_protected_delta_refused'):
            prove_allowed_deltas(before, after)


if __name__ == '__main__':
    unittest.main()

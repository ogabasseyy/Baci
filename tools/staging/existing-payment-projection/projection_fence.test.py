import copy
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest


HERE = Path(__file__).resolve().parent
CONTRACTS = HERE.parent / 'replay-complete-cutover-owner'
sys.path.insert(0, str(CONTRACTS))


def load(name, filename):
    specification = importlib.util.spec_from_file_location(name, filename)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


FIXTURE = load('projection_snapshot_fixture', CONTRACTS / 'completion_snapshot.test.py')
MODULE = load('projection_fence', HERE / 'projection_fence.py') if (
    HERE / 'projection_fence.py').exists() else None
INSERTIONS = ('prefunded_card.projections', 'prefunded_card.provider_aliases',
    'piggyvest_savings_ledger.operations', 'piggyvest_savings_ledger.postings',
    'public.customer_savings_contributions', 'savings_notifications.events')


def column(snapshot, relation, field, value):
    witness = snapshot['allowedTargetWitnesses'][relation]
    witness['targetRows'][0][field] = value
    witness['targetRowColumnHashes'][0][field] = hashlib.sha256(
        json.dumps(value, separators=(',', ':')).encode()).hexdigest()


def states():
    report = FIXTURE.REPORTS.completed_fixture()
    report.update(proofKind='financial_precommit', financialCommitted=False)
    report['appIdentity']['readOnly'] = False
    report['nativeEvidence'].update(proofKind='native_transfer_precommit', financialCommitted=False)
    report['nativeEvidence']['appIdentity']['readOnly'] = False
    after = FIXTURE.consistent_snapshot(FIXTURE.REPORTS.completed_fixture())
    after['readOnly'] = False
    column(after, 'prefunded_card.dispatch_queue', 'attempts', 4)
    before = copy.deepcopy(after)
    before['readOnly'] = True
    column(before, 'prefunded_card.operations', 'projection_status', 'unapplied')
    column(before, 'public.customer_savings_goals', 'current_amount', 0)
    column(before, 'prefunded_card.dispatch_queue', 'attempts', 3)
    column(before, 'prefunded_card.dispatch_queue', 'finished_at', None)
    for relation in INSERTIONS:
        witness = before['allowedTargetWitnesses'][relation]
        witness.update(targetCount=0, targetRows=[], targetRowColumnHashes=[])
        before['tableRows'][relation]['count'] = witness['excludedTargetCount']
    for relation in (*INSERTIONS, 'prefunded_card.operations',
        'prefunded_card.dispatch_queue', 'public.customer_savings_goals'):
        before['tableRows'][relation]['sha256'] = 'b' * 64
    return before, after, report


def reminder_states():
    before, after, report = states()
    FIXTURE.append_reminder(before)
    FIXTURE.append_reminder(after)
    return before, after, report


def install_actual_reminder(before, *projected):
    relation = 'savings_notifications.events'
    witness = json.loads((HERE.parent / 'ledger-balance-repair' /
        'notification-witness.fixture.json').read_text())
    digest = hashlib.sha256(json.dumps(witness, sort_keys=True,
        separators=(',', ':'), ensure_ascii=False).encode()).hexdigest()
    if digest != '0e4a17aa3edad66c67f1aea18c564297a8abbc25e8fc1f748acb5d8272b4a1c2':
        raise ValueError('captured reminder witness changed')
    for snapshot in (before, *projected):
        current = snapshot['allowedTargetWitnesses'][relation]
        combined = copy.deepcopy(witness)
        if snapshot is not before:
            combined['targetRows'].extend(copy.deepcopy(current['targetRows']))
            combined['targetRowColumnHashes'].extend(copy.deepcopy(current['targetRowColumnHashes']))
            combined.update(targetCount=2, targetHash='a' * 64)
        snapshot['allowedTargetWitnesses'][relation] = combined
        snapshot['tableRows'][relation] = dict(oid=44963, count=7 + combined['targetCount'],
            sha256='d966b9b823312f5e11c706e8ca145afccff3d332bbd1ca023a199d923a91ce55'
                if snapshot is before else 'a' * 64)


class ProjectionFenceTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(MODULE, 'existing-payment precommit fence is missing')
        self.before, self.after, self.report = states()

    def refused(self):
        with self.assertRaisesRegex(ValueError, '^existing_projection_fence_refused$'):
            MODULE.verify_projection_fence(self.before, self.after, self.report)

    def test_exact_credit_is_precommit_only_and_does_not_modify_evidence(self):
        originals = copy.deepcopy((self.before, self.after, self.report))
        result = MODULE.verify_projection_fence(self.before, self.after, self.report)
        self.assertTrue(result['precommitVerified'])
        self.assertFalse(result['financialCommitted'])
        self.assertEqual(result['queueAttemptsIncrement'], 1)
        self.assertEqual(result['principalKobo'], 10000)
        self.assertEqual(originals, (self.before, self.after, self.report))

    def test_mutable_treasury_fields_are_not_allowed_in_projection_only_continuation(self):
        for field in ('consumed_kobo', 'reserved_kobo'):
            with self.subTest(field=field):
                self.setUp()
                column(self.after, 'prefunded_card.treasury_bindings', field, 1)
                self.after['tableRows']['prefunded_card.treasury_bindings']['sha256'] = 'd' * 64
                self.refused()

    def test_reverification_token_or_transfer_status_change_is_not_an_application_credit(self):
        for field, value in (('transfer_status', 'pending'), ('verification_fence', 2),
            ('verification_token', '10000000-0000-4000-8000-000000000001')):
            with self.subTest(field=field):
                self.setUp()
                column(self.before, 'prefunded_card.operations', field, 1 if field.endswith('fence') else None)
                column(self.after, 'prefunded_card.operations', field, value)
                self.refused()

    def test_queue_attempts_must_increment_once_not_zero_or_twice(self):
        for value in (3, 5, True):
            with self.subTest(value=value):
                column(self.after, 'prefunded_card.dispatch_queue', 'attempts', value)
                self.refused()

    def test_previous_credit_or_notification_cannot_be_counted_as_new(self):
        for relation in INSERTIONS:
            with self.subTest(relation=relation):
                self.setUp()
                self.before['allowedTargetWitnesses'][relation] = copy.deepcopy(
                    self.after['allowedTargetWitnesses'][relation])
                self.before['tableRows'][relation] = copy.deepcopy(self.after['tableRows'][relation])
                self.refused()

    def test_original_plan_or_unrelated_metadata_change_refuses_before_commit(self):
        for selected in ('old-plan', 'metadata', 'unrelated'):
            with self.subTest(selected=selected):
                self.setUp()
                if selected == 'old-plan':
                    self.after['allowedTargetWitnesses']['public.customer_savings_goals']['excludedTargetHash'] = 'd' * 64
                elif selected == 'metadata':
                    self.after['permanentMetadataSha256'] = 'd' * 64
                else:
                    self.after['tableRows']['public.synthetic_unrelated']['sha256'] = 'd' * 64
                self.refused()

    def test_actual_transaction_flags_and_completion_binding_are_mandatory(self):
        for selected in ('before', 'after', 'proof'):
            with self.subTest(selected=selected):
                self.setUp()
                if selected == 'before':
                    self.before['readOnly'] = False
                elif selected == 'after':
                    self.after['readOnly'] = True
                else:
                    self.report['financialCommitted'] = True
                self.refused()

    def test_exact_known_reminder_survives_only_one_new_contribution(self):
        before, after, report = reminder_states()
        original = copy.deepcopy((before, after, report))
        self.assertTrue(MODULE.verify_projection_fence(before, after, report)['precommitVerified'])
        self.assertEqual((before, after, report), original)

    def test_reminder_mutation_removal_or_unrelated_insert_refuses(self):
        for selected in ('remove', 'type', 'read', 'hidden', 'extra', 'before-type'):
            with self.subTest(selected=selected):
                before, after, report = reminder_states()
                witness = after['allowedTargetWitnesses']['savings_notifications.events']
                if selected == 'remove':
                    witness['targetRows'].pop()
                    witness['targetRowColumnHashes'].pop()
                    witness['targetCount'] -= 1
                    after['tableRows']['savings_notifications.events']['count'] -= 1
                elif selected in ('type', 'read'):
                    witness['targetRows'][1]['type' if selected == 'type' else 'read_at'] = 'changed'
                elif selected == 'hidden':
                    witness['targetRowColumnHashes'][1]['body'] = 'e' * 64
                elif selected == 'extra':
                    FIXTURE.append_reminder(after)
                else:
                    before['allowedTargetWitnesses']['savings_notifications.events']['targetRows'][0]['type'] = 'unknown'
                with self.assertRaisesRegex(ValueError, '^existing_projection_fence_refused$'):
                    MODULE.verify_projection_fence(before, after, report)

    def test_actual_non_target_reminder_witness_drift_refuses_precommit(self):
        install_actual_reminder(self.before, self.after)
        self.assertTrue(MODULE.verify_projection_fence(
            self.before, self.after, self.report)['precommitVerified'])
        relation = 'savings_notifications.events'
        for field, value in (('excludedTargetHash', 'e' * 64), ('excludedTargetCount', 8)):
            with self.subTest(field=field):
                altered = copy.deepcopy(self.after)
                altered['allowedTargetWitnesses'][relation][field] = value
                original = copy.deepcopy((self.before, altered, self.report))
                with self.assertRaisesRegex(ValueError, '^existing_projection_fence_refused$'):
                    MODULE.verify_projection_fence(self.before, altered, self.report)
                self.assertEqual((self.before, altered, self.report), original)


if __name__ == '__main__':
    unittest.main()

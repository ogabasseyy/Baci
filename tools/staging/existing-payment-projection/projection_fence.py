"""Projection-only precommit evidence; never a durable completion claim."""

import completion_snapshot
import financial_delta


INSERTIONS = frozenset(('prefunded_card.projections', 'prefunded_card.provider_aliases',
    'piggyvest_savings_ledger.operations', 'piggyvest_savings_ledger.postings',
    'public.customer_savings_contributions', 'savings_notifications.events'))
CHANGES = {
    'prefunded_card.operations': frozenset(('projection_status', 'updated_at')),
    'prefunded_card.dispatch_queue': frozenset(('claim_token', 'lease_expires_at',
        'available_at', 'finished_at', 'attempts')),
    'public.customer_savings_goals': frozenset(('current_amount', 'status', 'completed_at', 'updated_at')),
}


def _require(condition):
    if not condition:
        raise ValueError('existing_projection_fence_refused')


def _single(snapshot, relation):
    witness = snapshot['allowedTargetWitnesses'][relation]
    _require(witness['targetCount'] == 1 and len(witness['targetRows']) == 1)
    return witness['targetRows'][0]


def verify_projection_fence(before, after, report):
    try:
        _require(before.get('readOnly') is True and after.get('readOnly') is False)
        delta = financial_delta.prove_allowed_deltas(before, after)
        notifications = 'savings_notifications.events'
        previous_notifications = before['allowedTargetWitnesses'][notifications]
        current_notifications = after['allowedTargetWitnesses'][notifications]
        preserved = completion_snapshot._preserved_notifications(
            previous_notifications['targetRows'], report['nativeEvidence']['scope'])
        _require(previous_notifications['targetCount'] == len(preserved)
            and current_notifications['targetCount'] == len(preserved) + 1)
        for row in preserved:
            positions = [position for position, actual in enumerate(current_notifications['targetRows'])
                if actual.get('id') == row['id']]
            _require(len(positions) == 1 and current_notifications['targetRows'][positions[0]] == row
                and current_notifications['targetRowColumnHashes'][positions[0]]
                    == previous_notifications['targetRowColumnHashes'][0])
        completion = completion_snapshot.verify_precommit_snapshot(report, after, preserved_notifications=preserved)
        _require(set(delta['changedTargetRelations']) == INSERTIONS | set(CHANGES))
        treasury = 'prefunded_card.treasury_bindings'
        _require(before['tableRows'][treasury] == after['tableRows'][treasury]
            and before['allowedTargetWitnesses'][treasury] == after['allowedTargetWitnesses'][treasury])
        for relation, mutable in CHANGES.items():
            original = before['allowedTargetWitnesses'][relation]['targetRowColumnHashes'][0]
            current = after['allowedTargetWitnesses'][relation]['targetRowColumnHashes'][0]
            _require(set(original) == set(current) and all(original[field] == current[field]
                for field in original if field not in mutable))
        for relation in INSERTIONS:
            if relation == notifications:
                continue
            previous = before['allowedTargetWitnesses'][relation]
            current = after['allowedTargetWitnesses'][relation]
            _require(previous['targetCount'] == 0 and current['targetCount'] == (
                2 if relation == 'piggyvest_savings_ledger.postings' else 1))
        operation = _single(before, 'prefunded_card.operations')
        _require(operation['projection_status'] == 'unapplied')
        goal = _single(before, 'public.customer_savings_goals')
        _require(type(goal['current_amount']) in (int, float) and goal['current_amount'] == 0)
        original_queue = _single(before, 'prefunded_card.dispatch_queue')
        current_queue = _single(after, 'prefunded_card.dispatch_queue')
        _require(original_queue['finished_at'] is None and type(original_queue['attempts']) is int
            and original_queue['attempts'] >= 0 and type(current_queue['attempts']) is int
            and current_queue['attempts'] == original_queue['attempts'] + 1)
        return dict(precommitVerified=True, financialCommitted=False, principalKobo=10000,
            queueAttemptsIncrement=1, treasuryUnchanged=True, originalPlanUnchanged=True,
            protectedDelta=delta, completion=completion)
    except Exception:
        raise ValueError('existing_projection_fence_refused') from None

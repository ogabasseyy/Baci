import copy
import re

from cutover_runtime import require


SCOPE = dict(operationId='ff561046-58e7-428d-9163-f6e60b0dab65',
    newGoalId='9f01153c-1589-4dde-b9aa-8f644a846832', oldGoalId='430314fd-cd8b-4579-98d4-e9f345713dd6',
    treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    idempotencyKey='pvb-card:ff561046-58e7-428d-9163-f6e60b0dab65')
BASELINE = '680b3b7d0c5d49eb24f2f898356cbc6c5bd90916c511a90fda8faa5ea2fc8d79'
MUTABLE = {
    'prefunded_card.operations': {'transfer_status', 'transfer_provider_transaction_id', 'projection_status',
        'verification_fence', 'verification_token', 'verification_lease_expires_at', 'updated_at'},
    'prefunded_card.dispatch_queue': {'claim_token', 'lease_expires_at', 'available_at', 'finished_at', 'attempts'},
    'prefunded_card.treasury_bindings': {'reserved_kobo', 'consumed_kobo'},
    'public.customer_savings_goals': {'current_amount', 'status', 'completed_at', 'updated_at'},
}
INSERTIONS = {'prefunded_card.projections', 'prefunded_card.provider_aliases',
    'piggyvest_savings_ledger.operations', 'piggyvest_savings_ledger.postings',
    'public.customer_savings_contributions', 'savings_notifications.events'}
UNCHANGED = {'prefunded_card.checkout_intents', 'savings_notifications.deliveries'}
ALLOWED = set(MUTABLE) | INSERTIONS | UNCHANGED


def _pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def _snapshot(snapshot):
    require(type(snapshot) is dict and snapshot['version'] == 1 and snapshot['financialSnapshotVersion'] == 1
            and snapshot['sourceClosureSha256'] == BASELINE and snapshot['baselineSnapshotSha256'] == BASELINE
            and snapshot['scope'] == SCOPE and snapshot['unsupportedRelations'] == [], 'financial_snapshot_refused')
    identity = snapshot['identity']
    require(identity['systemIdentifier'] == '7685292944002592802' and identity['database'] == 'postgres'
            and identity['sessionUser'] == identity['currentUser'] == 'postgres'
            and identity['superuser'] is True and identity['localSocket'] is True
            and identity['sessionReplicationRole'] == 'origin', 'financial_snapshot_identity_refused')
    require(_pin(snapshot['permanentMetadataSha256'])
            and set(snapshot['allowedTargetWitnesses']) == ALLOWED
            and ALLOWED <= set(snapshot['tableRows']), 'financial_snapshot_scope_refused')
    for name, table in snapshot['tableRows'].items():
        require(type(table['count']) is int and table['count'] >= 0 and _pin(table['sha256'])
                and type(table['oid']) is int and table['oid'] > 0, 'financial_table_witness_refused')
        if name not in ALLOWED:
            continue
        witness = snapshot['allowedTargetWitnesses'][name]
        require(type(witness['excludedTargetCount']) is int and witness['excludedTargetCount'] >= 0
                and type(witness['targetCount']) is int and witness['targetCount'] >= 0
                and witness['excludedTargetCount'] + witness['targetCount'] == table['count']
                and _pin(witness['excludedTargetHash']) and _pin(witness['targetHash'])
                and type(witness['targetRows']) is list and type(witness['targetRowColumnHashes']) is list
                and len(witness['targetRows']) == len(witness['targetRowColumnHashes']) == witness['targetCount']
                and all(type(row) is dict and all(_pin(pin) for pin in row.values())
                        for row in witness['targetRowColumnHashes']), 'financial_target_witness_refused')


def prove_allowed_deltas(before, after):
    try:
        before, after = copy.deepcopy(before), copy.deepcopy(after)
        _snapshot(before)
        _snapshot(after)
        for key in ('identity', 'functions', 'permanentMetadataSha256', 'scope'):
            require(before[key] == after[key], 'financial_metadata_changed')
        require(set(before['tableRows']) == set(after['tableRows']), 'financial_relation_set_changed')
        changed = []
        for name, original in before['tableRows'].items():
            current = after['tableRows'][name]
            require(original['oid'] == current['oid'], 'financial_relation_identity_changed')
            if name not in ALLOWED:
                require(original == current, 'unrelated_financial_relation_changed')
                continue
            original_target = before['allowedTargetWitnesses'][name]
            current_target = after['allowedTargetWitnesses'][name]
            for key in ('excludedTargetCount', 'excludedTargetHash', 'redactedColumns'):
                require(original_target[key] == current_target[key], 'non_target_financial_rows_changed')
            if name in UNCHANGED:
                require(original == current and original_target == current_target, 'protected_checkout_or_delivery_changed')
            elif name in MUTABLE:
                require(original_target['targetCount'] == current_target['targetCount'] == 1,
                        'singleton_financial_target_changed')
                previous_columns = original_target['targetRowColumnHashes'][0]
                next_columns = current_target['targetRowColumnHashes'][0]
                require(set(previous_columns) == set(next_columns)
                        and all(previous_columns[column] == next_columns[column]
                                for column in previous_columns if column not in MUTABLE[name]),
                        'protected_target_column_changed')
            else:
                old_rows = original_target['targetRowColumnHashes']
                new_rows = current_target['targetRowColumnHashes']
                require(current_target['targetCount'] >= original_target['targetCount']
                        and all(new_rows.count(row) >= old_rows.count(row) for row in old_rows),
                        'existing_target_history_changed')
            if original != current:
                changed.append(name)
        return dict(status='financial-protected-rows-preserved',
                    relationCount=len(before['tableRows']), changedTargetRelations=sorted(changed),
                    permanentMetadataUnchanged=True, nonTargetRowsUnchanged=True)
    except Exception:
        raise ValueError('financial_protected_delta_refused') from None

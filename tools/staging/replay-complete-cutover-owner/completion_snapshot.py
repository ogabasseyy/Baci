import copy
from datetime import datetime, timezone
from decimal import Decimal
import hashlib
import json

import financial_completion
import financial_delta


NULL_SHA256 = hashlib.sha256(b'null').hexdigest()
TIMESTAMPS = frozenset(('created_at', 'completed_at', 'finished_at', 'transfer_attempted_at'))


def _require(condition):
    if not condition:
        raise ValueError('completion_snapshot_refused')


def _instant(value):
    _require(type(value) is str)
    instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
    _require(instant.tzinfo is not None and instant.utcoffset().total_seconds() == 0)
    return instant.astimezone(timezone.utc)


def _kobo(value):
    _require(type(value) in (int, float) and Decimal(str(value)).is_finite())
    amount = Decimal(str(value))*100
    _require(amount == amount.to_integral_value())
    return int(amount)


def _matches(row, expected):
    _require(type(row) is dict and set(expected) <= set(row))
    for field, value in expected.items():
        actual = row[field]
        if field in ('amount', 'current_amount', 'target_amount'):
            _require(_kobo(actual) == value)
        elif field in TIMESTAMPS and value is not None:
            _require(_instant(actual) == _instant(value))
        else:
            _require(type(actual) is type(value) and actual == value)


def _rows(snapshot, relation, expected):
    witness = snapshot['allowedTargetWitnesses'][relation]
    _require(witness['targetCount'] == len(expected) and len(witness['targetRows']) == len(expected))
    remaining = list(witness['targetRows'])
    for row in expected:
        candidates = []
        for position, actual in enumerate(remaining):
            try:
                _matches(actual, row)
                candidates.append(position)
            except ValueError:
                continue
        _require(len(candidates) == 1)
        remaining.pop(candidates[0])
    _require(not remaining)


def _column(snapshot, relation, field, expected_hash):
    witness = snapshot['allowedTargetWitnesses'][relation]
    _require(witness['targetCount'] == 1
        and witness['targetRowColumnHashes'][0].get(field) == expected_hash)


def _object_hash(value):
    _require(type(value) is dict and all(type(key) is str and key.isascii()
        and (item is None or type(item) is int or type(item) is str and item.isascii())
        for key, item in value.items()))
    ordered = dict(sorted(value.items(), key=lambda item: (len(item[0].encode()), item[0].encode())))
    return hashlib.sha256(json.dumps(ordered, ensure_ascii=False, separators=(', ', ': '),
        allow_nan=False).encode()).hexdigest()


def _preserved_notifications(rows, scope):
    _require(type(rows) in (list, tuple) and len(rows) <= 1)
    preserved = copy.deepcopy(list(rows))
    for row in preserved:
        _require(type(row) is dict and set(row) == {'id', 'merchant_id', 'customer_id', 'goal_id',
            'event_key', 'type', 'due_period_start', 'created_at', 'read_at', 'voided_at', 'push_expanded_at'})
        _matches(row, dict(id='914e9941-c9c1-44a1-9879-1de3e54ac365',
            goal_id=financial_completion.GOAL, merchant_id=financial_completion.MERCHANT,
            customer_id=financial_completion.CUSTOMER, event_key='missed:2026-10-02',
            type='missed_contribution', created_at='2026-10-03T16:40:14.266867+00:00',
            read_at=None, voided_at=None))
        _require(row['goal_id'] == scope['goalId'] and row['merchant_id'] == scope['merchantId']
            and row['customer_id'] == scope['customerId'])
        for field in ('due_period_start', 'push_expanded_at'):
            if row[field] is not None:
                _instant(row[field])
    return preserved


def _verify_snapshot(report, snapshot, precommit=False, preserved_notifications=()):
    try:
        report, snapshot = copy.deepcopy(report), copy.deepcopy(snapshot)
        (financial_completion.validate_precommit if precommit else financial_completion.validate_completed)(report)
        financial_delta._snapshot(snapshot)
        _require(snapshot.get('readOnly') is (not precommit))
        operation, scope = report['operation'], report['nativeEvidence']['scope']
        preserved = _preserved_notifications(preserved_notifications, scope)
        _require(0 <= (_instant(snapshot['capturedAt'])-_instant(report['observedAt'])).total_seconds() <= 60)
        common = dict(integration_id=scope['integrationId'], merchant_id=scope['merchantId'],
            customer_id=scope['customerId'], goal_id=scope['goalId'])
        _rows(snapshot, 'prefunded_card.operations', [dict(common, id=operation['operationId'],
            treasury_binding_id=scope['treasuryBindingId'], amount_kobo=operation['amountKobo'],
            currency=operation['currency'], destination_wallet_id=operation['destinationWalletId'],
            destination_customer_id=operation['destinationCustomerId'],
            collection_status=operation['collectionStatus'], transfer_status=operation['transferStatus'],
            projection_status=operation['projectionStatus'],
            collection_provider_transaction_id=operation['collectionProviderTransactionId'],
            transfer_provider_transaction_id=operation['transferProviderTransactionId'],
            checkout_retired=False, verification_lease_expires_at=None,
            transfer_attempted_at=operation['transferAttemptedAt'])])
        _rows(snapshot, 'prefunded_card.checkout_intents', [dict(operation_id=operation['operationId'],
            phase=operation['intentPhase'], initialization_lease_expires_at=None)])
        _rows(snapshot, 'prefunded_card.dispatch_queue', [dict(operation_id=operation['operationId'],
            lease_expires_at=None, finished_at=report['queue'][0]['finishedAt'])])
        for relation, field in (('prefunded_card.operations', 'verification_token'),
            ('prefunded_card.checkout_intents', 'initialization_token'),
            ('prefunded_card.dispatch_queue', 'claim_token')):
            _column(snapshot, relation, field, NULL_SHA256)
        treasury = report['treasury']
        _rows(snapshot, 'prefunded_card.treasury_bindings', [dict(id=scope['treasuryBindingId'],
            integration_id=scope['integrationId'], expected_business_id=scope['businessId'],
            source_wallet_id=scope['sourceWalletId'], reserved_kobo=treasury['reservedKobo'],
            consumed_kobo=treasury['consumedKobo'])])
        goal = next(row for row in report['goals'] if row['goalId'] == scope['goalId'])
        _rows(snapshot, 'public.customer_savings_goals', [dict(id=scope['goalId'],
            merchant_id=scope['merchantId'], customer_id=scope['customerId'],
            current_amount=goal['displayedPrincipalKobo'], target_amount=goal['targetKobo'],
            status=goal['status'], completed_at=goal['completedAt'])])
        projection = report['projections'][0]
        _rows(snapshot, 'prefunded_card.projections', [dict(operation_id=scope['operationId'],
            ledger_operation_id=projection['ledgerOperationId'], contribution_id=projection['contributionId'],
            amount_kobo=projection['amountKobo'], created_at=projection['createdAt'])])
        _rows(snapshot, 'piggyvest_savings_ledger.operations', [dict(common,
            id=scope['operationId'], evidence_id=report['ledgerOperations'][0]['evidenceId'], reference_id=None)])
        ledger = report['ledgerOperations'][0]
        _column(snapshot, 'piggyvest_savings_ledger.operations', 'command', _object_hash(dict(
            operationId=scope['operationId'], kind=ledger['kind'], principalKobo=ledger['principalKobo'],
            interestKobo=ledger['interestKobo'], evidenceId=ledger['evidenceId'], referenceId=None)))
        _rows(snapshot, 'piggyvest_savings_ledger.postings', [dict(operation_id=row['operationId'],
            account=row['account'], amount_kobo=row['amountKobo']) for row in report['postings']])
        contribution = report['contributions'][0]
        _rows(snapshot, 'public.customer_savings_contributions', [dict(id=contribution['contributionId'],
            goal_id=scope['goalId'], merchant_id=scope['merchantId'], customer_id=scope['customerId'],
            amount=contribution['amountKobo'], source_type=contribution['sourceType'],
            status=contribution['status'], idempotency_key=contribution['idempotencyKey'])])
        _column(snapshot, 'public.customer_savings_contributions', 'metadata', _object_hash(dict(
            funding_model='prefunded_piggyvest', operation_id=contribution['metadataOperationId'],
            provider_transaction_id=contribution['metadataProviderTransactionId'],
            transfer_reference=contribution['transferReference'])))
        _rows(snapshot, 'prefunded_card.provider_aliases', [dict(integration_id=row['integrationId'],
            provider_transaction_id=row['providerTransactionId'], operation_id=row['operationId'])
            for row in report['aliases']])
        _rows(snapshot, 'savings_notifications.events', preserved + [dict(id=row['notificationId'],
            goal_id=row['goalId'], merchant_id=row['merchantId'], customer_id=row['customerId'],
            event_key=row['eventKey'], type=row['type'], voided_at=row['voidedAt']) for row in report['notifications']])
        for row in preserved:
            _require(sum(actual == row for actual in snapshot['allowedTargetWitnesses'][
                'savings_notifications.events']['targetRows']) == 1)
        result = dict(operationId=scope['operationId'],
            snapshotCapturedAt=snapshot['capturedAt'], evidenceSha256=hashlib.sha256(json.dumps(
                dict(report=report, snapshot=snapshot), sort_keys=True, separators=(',', ':'),
                allow_nan=False).encode()).hexdigest())
        if precommit:
            result.update(snapshotPrecommitBound=True, financialCommitted=False, proofKind='financial_precommit')
        else:
            result['snapshotCompletionBound'] = True
        return result
    except Exception:
        raise ValueError('precommit_snapshot_refused' if precommit else 'completion_snapshot_refused') from None


def verify_completion_snapshot(report, snapshot, preserved_notifications=()):
    return _verify_snapshot(report, snapshot, preserved_notifications=preserved_notifications)


def verify_precommit_snapshot(report: dict, snapshot: dict, preserved_notifications=()) -> dict:
    return _verify_snapshot(report, snapshot, precommit=True, preserved_notifications=preserved_notifications)

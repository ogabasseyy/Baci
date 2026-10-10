#!/usr/bin/env python3
"""Payload parsing and request building for staging verification (pure helpers)."""

from datetime import UTC, datetime, timedelta


WALLET_STATUSES = frozenset({'none', 'provisioning', 'ready', 'restricted'})


def goal_ids(payload):
    """Extract goal UUIDs from a goals-list response across shapes."""
    if isinstance(payload, dict):
        for key in ('goals', 'data', 'items'):
            if isinstance(payload.get(key), list):
                return [
                    row.get('id')
                    for row in payload[key]
                    if isinstance(row, dict) and row.get('id')
                ]
        if payload.get('id'):
            return [payload['id']]
    if isinstance(payload, list):
        return [
            row.get('id') for row in payload
            if isinstance(row, dict) and row.get('id')
        ]
    return []


def created_goal_id(payload):
    ids = goal_ids(payload)
    if ids:
        return ids[0]
    if isinstance(payload, dict):
        for key in ('goalId', 'goal_id'):
            if payload.get(key):
                return payload[key]
    return None


def wallet_shape_ok(payload):
    return (
        isinstance(payload, dict)
        and payload.get('status') in WALLET_STATUSES
        and isinstance(payload.get('balanceKobo'), (int, float))
        and isinstance(payload.get('paidInterestKobo'), (int, float))
    )


def error_code(payload):
    if isinstance(payload, dict):
        return ' '.join(
            str(payload.get(key) or '')
            for key in ('code', 'error', 'message')
        ).strip()
    return ''


def goal_body(merchant_id, product_id, stamp, initial=0, key=None,
              variant_id=None, target=50000, goal_key=None):
    today = datetime.now(tz=UTC).date()
    body = {
        'merchantId': merchant_id,
        'productId': product_id,
        'title': f'staging-verify-{stamp}',
        'targetAmount': target,
        'contributionAmount': 5000,
        'contributionFrequency': 'weekly',
        'sourceMode': 'manual',
        'startDate': today.isoformat(),
        'maturityDate': (today + timedelta(days=90)).isoformat(),
        'preferredDebitTime': '09:00',
        'termsAccepted': True,
        'nonWithdrawableAccepted': True,
        'initialContributionAmount': initial,
        'metadata': {'stagingVerify': True},
    }
    if key:
        body['initialContributionIdempotencyKey'] = key
    if goal_key:
        body['goalIdempotencyKey'] = goal_key
    if variant_id:
        body['variantId'] = variant_id
    return body

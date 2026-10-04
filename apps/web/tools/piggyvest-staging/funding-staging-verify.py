#!/usr/bin/env python3
"""Authenticated end-to-end verification of staging savings funding.

Exercises the real Metro-adjacent flow against a staging origin with a
synthetic-customer bearer token: goal creation, persistence, initial-
contribution idempotency, goal-key idempotency (identical retry returns
the same goal, changed payload is rejected), and funding-account retrieval.
Also discovers the goal's product through the gateway's own products
route, which doubles as an authenticated gateway check.

The token is read from a file and never printed. Output is redacted to
step names, HTTP statuses, counts, and synthetic goal UUIDs only.

Exit 0 when every step passes or skips with a reason; exit 1 on any fail.
"""

import argparse
import json
import sys
import urllib.error
import urllib.parse
import urllib.request
from datetime import UTC, datetime, timedelta

SYNTHETIC_MERCHANT_ID = '10000000-0000-4000-8000-000000000001'
WALLET_STATUSES = frozenset({'none', 'provisioning', 'ready', 'restricted'})


class Failed(RuntimeError):
    pass


def _request(origin, method, path, token, body=None, timeout=15):
    url = origin.rstrip('/') + path
    data = None
    headers = {
        'Authorization': 'Bearer ' + token,
        'Accept': 'application/json',
        # The staging edge challenges default scripting UAs; identify honestly.
        'User-Agent': 'baci-staging-verify/1.0',
    }
    if body is not None:
        data = json.dumps(body).encode('utf-8')
        headers['Content-Type'] = 'application/json'
    request = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(request, timeout=timeout) as response:
            raw = response.read()
    except urllib.error.HTTPError as error:
        return error.code, _json_or_text(error.read())
    try:
        return 200, json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return 200, {'_text': raw[:200].decode('utf-8', 'replace')}


def _json_or_text(raw):
    try:
        return json.loads(raw.decode('utf-8'))
    except (ValueError, UnicodeDecodeError):
        return {'_text': raw[:200].decode('utf-8', 'replace')}


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


def run(api_origin, rest_origin, token, merchant_id, product_id, timeout):
    steps = []

    def record(name, status, detail=''):
        steps.append({'step': name, 'status': status, 'detail': detail})
        return status == 'pass'

    query = urllib.parse.urlencode({'merchantId': merchant_id})

    # 1. Discover a product through the gateway's own products route,
    # then a variant: variant-bearing products require variantId at creation.
    if not product_id:
        code, products = _request(
            rest_origin, 'GET',
            f'/rest/v1/products?merchant_id=eq.{merchant_id}&select=id&limit=5',
            token, timeout=timeout,
        )
        ids = goal_ids(products)
        if code != 200 or not ids:
            record('discover-product', 'fail', f'http={code}')
            return steps
        product_id = ids[0]
    record('discover-product', 'pass', f'products_seen>={1 if product_id else 0}')
    code, variants = _request(
        rest_origin, 'POST', '/rest/v1/rpc/get_storefront_product_variants',
        token, {'p_product_ids': [product_id]}, timeout=timeout,
    )
    variant_ids = goal_ids(variants)
    if code != 200 or not variant_ids:
        record('discover-variant', 'fail', f'http={code}')
        return steps
    variant_id = variant_ids[0]
    price = 0
    if isinstance(variants, list) and isinstance(variants[0], dict):
        try:
            price = float(variants[0].get('price_override') or 0)
        except (TypeError, ValueError):
            price = 0
    target = int(price) if price > 0 else 50000
    record('discover-variant', 'pass', f'variants_seen>={len(variant_ids)}')

    # 2. Baseline goal list.
    code, before = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    if code != 200:
        record('list-goals-baseline', 'fail', f'http={code}')
        return steps
    baseline = set(goal_ids(before))
    record('list-goals-baseline', 'pass', f'count={len(baseline)}')

    # 3. Create a manual goal with no initial contribution.
    stamp = datetime.now(tz=UTC).strftime('%Y%m%dT%H%M%S')
    code, created = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token,
        goal_body(merchant_id, product_id, stamp, variant_id=variant_id,
                  target=target),
        timeout=timeout,
    )
    goal_a = created_goal_id(created)
    if code not in (200, 201) or not goal_a:
        record('create-goal', 'fail', f'http={code} code={error_code(created)}')
        return steps
    record('create-goal', 'pass', f'goal={goal_a}')

    # 4. Persistence: the new goal lists back exactly once.
    code, after = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    ids = goal_ids(after)
    if code != 200 or ids.count(goal_a) != 1 or len(set(ids)) != len(baseline) + 1:
        record('goal-persisted', 'fail', f'http={code} count={len(ids)}')
        return steps
    record('goal-persisted', 'pass', f'count={len(ids)}')

    # 5. Idempotency: funded initial contribution, then replay the key.
    key = f'staging-verify-{stamp}'
    funded = goal_body(
        merchant_id, product_id, stamp + '-idem', 100, key,
        variant_id=variant_id, target=target,
    )
    code, first = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token, funded, timeout=timeout,
    )
    created_new = 1
    if code == 409 and 'insufficient' in str(error_code(first)).lower():
        record('idempotency', 'skip', 'synthetic wallet unfunded')
    elif code not in (200, 201):
        record('idempotency', 'fail', f'setup http={code} code={error_code(first)}')
        return steps
    else:
        goal_b = created_goal_id(first)
        replay = dict(funded)
        replay['title'] = f'staging-verify-{stamp}-replay'
        code, second = _request(
            api_origin, 'POST', '/api/storefront/customer/savings/goals',
            token, replay, timeout=timeout,
        )
        if code != 409 or 'duplicate' not in str(error_code(second)).lower():
            record('idempotency', 'fail', f'replay http={code} code={error_code(second)}')
            return steps
        code, final = _request(
            api_origin, 'GET',
            f'/api/storefront/customer/savings/goals?{query}',
            token, timeout=timeout,
        )
        finals = goal_ids(final)
        if code != 200 or len(set(finals)) != len(baseline) + 2 or goal_b not in finals:
            record('idempotency', 'fail', 'replay added a goal row')
            return steps
        record('idempotency', 'pass', 'duplicate rejected, no extra row')
        created_new = 2

    # 5b. Goal-key idempotency: identical retry returns the recorded goal,
    # changed payload under the key is rejected, no extra rows.
    goal_key = f'staging-verify-goal-{stamp}'
    keyed = goal_body(
        merchant_id, product_id, stamp + '-goalkey', variant_id=variant_id,
        target=target, goal_key=goal_key,
    )
    code, keyed_first = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token, keyed, timeout=timeout,
    )
    goal_c = created_goal_id(keyed_first)
    if code not in (200, 201) or not goal_c:
        record('goal-idempotency', 'fail',
               f'setup http={code} code={error_code(keyed_first)}')
        return steps
    retry = dict(keyed)
    retry['metadata'] = {'stagingVerify': True, 'attempt': 2}
    code, keyed_retry = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token, retry, timeout=timeout,
    )
    if code not in (200, 201) or created_goal_id(keyed_retry) != goal_c:
        record('goal-idempotency', 'fail',
               f'retry http={code} same={created_goal_id(keyed_retry) == goal_c}')
        return steps
    changed = dict(keyed)
    changed['title'] = f'staging-verify-{stamp}-goalkey-changed'
    changed['targetAmount'] = target + 5000
    code, keyed_changed = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token, changed, timeout=timeout,
    )
    if code != 409 or 'mismatched' not in str(error_code(keyed_changed)).lower():
        record('goal-idempotency', 'fail',
               f'changed http={code} code={error_code(keyed_changed)}')
        return steps
    code, keyed_final = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    keyed_finals = goal_ids(keyed_final)
    if (code != 200 or len(set(keyed_finals)) != len(baseline) + created_new + 1
            or goal_c not in keyed_finals):
        record('goal-idempotency', 'fail', 'retry added a goal row')
        return steps
    record('goal-idempotency', 'pass', f'same goal={goal_c}, mismatch rejected')

    # 6. Funding-account retrieval.
    code, wallet = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/wallet/piggyvest-plan?{query}',
        token, timeout=timeout,
    )
    if code != 200 or not wallet_shape_ok(wallet):
        record('funding-account', 'fail', f'http={code}')
        return steps
    record('funding-account', 'pass', f"status={wallet['status']}")

    return steps


def main(arguments):
    parser = argparse.ArgumentParser()
    parser.add_argument('--api-origin', required=True)
    parser.add_argument('--rest-origin', required=True)
    parser.add_argument('--token-file', required=True)
    parser.add_argument('--merchant-id', default=SYNTHETIC_MERCHANT_ID)
    parser.add_argument('--product-id', default=None)
    parser.add_argument('--timeout', type=int, default=15)
    parsed = parser.parse_args(arguments)
    try:
        with open(parsed.token_file, encoding='utf-8') as handle:
            token = handle.read().strip()
    except OSError:
        print(json.dumps({'status': 'fail', 'detail': 'token file unreadable'}))
        return 1
    if not token:
        print(json.dumps({'status': 'fail', 'detail': 'token file empty'}))
        return 1
    try:
        steps = run(
            parsed.api_origin, parsed.rest_origin, token,
            parsed.merchant_id, parsed.product_id, parsed.timeout,
        )
    except OSError as error:
        print(json.dumps({'status': 'fail', 'detail': f'network: {type(error).__name__}'}))
        return 1
    failed = [step for step in steps if step['status'] == 'fail']
    print(json.dumps({
        'status': 'fail' if failed else 'pass',
        'steps': steps,
    }))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))

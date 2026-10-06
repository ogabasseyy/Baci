#!/usr/bin/env python3
"""Individual verification scenarios for staging savings funding.

Each scenario runs one numbered check against the staging origins,
recording step outcomes through the caller-provided record callable.
Returns whether the run may continue plus the values later steps need.
"""

import importlib.util
import sys
from pathlib import Path

def _load_sibling(name):
    """Load a focused staging-verify module once per process.

    Dash-named siblings cannot use plain imports; every module resolves them
    through this importlib loader with sys.modules singletons.
    """
    key = f'funding_staging_{name}'
    cached = sys.modules.get(key)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(
        key, Path(__file__).parent / f'funding-staging-{name}.py'
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Staging verify {name} module is unavailable.')
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


_transport = _load_sibling('transport')
_payloads = _load_sibling('payloads')
_request = _transport._request
goal_ids = _payloads.goal_ids
created_goal_id = _payloads.created_goal_id
wallet_shape_ok = _payloads.wallet_shape_ok
error_code = _payloads.error_code
goal_body = _payloads.goal_body


def discover_product(record, rest_origin, token, merchant_id, product_id, timeout):
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
            return False, product_id
        product_id = ids[0]
    record('discover-product', 'pass', f'products_seen>={1 if product_id else 0}')
    return True, product_id


def discover_variant(record, rest_origin, token, product_id, timeout):
    code, variants = _request(
        rest_origin, 'POST', '/rest/v1/rpc/get_storefront_product_variants',
        token, {'p_product_ids': [product_id]}, timeout=timeout,
    )
    variant_ids = goal_ids(variants)
    if code != 200 or not variant_ids:
        record('discover-variant', 'fail', f'http={code}')
        return False, None, 0
    variant_id = variant_ids[0]
    price = 0
    if isinstance(variants, list) and isinstance(variants[0], dict):
        try:
            price = float(variants[0].get('price_override') or 0)
        except (TypeError, ValueError):
            price = 0
    target = int(price) if price > 0 else 50000
    record('discover-variant', 'pass', f'variants_seen>={len(variant_ids)}')
    return True, variant_id, target


def list_baseline(record, api_origin, query, token, timeout):
    # 2. Baseline goal list.
    code, before = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    if code != 200:
        record('list-goals-baseline', 'fail', f'http={code}')
        return False, set()
    baseline = set(goal_ids(before))
    record('list-goals-baseline', 'pass', f'count={len(baseline)}')
    return True, baseline


def create_goal(record, api_origin, token, merchant_id, product_id, stamp, variant_id, target, timeout):
    # 3. Create a manual goal with no initial contribution.
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
        return False, None
    record('create-goal', 'pass', f'goal={goal_a}')
    return True, goal_a


def check_persisted(record, api_origin, query, token, timeout, baseline, goal):
    # 4. Persistence: the new goal lists back exactly once.
    code, after = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    ids = goal_ids(after)
    if code != 200 or ids.count(goal_a) != 1 or len(set(ids)) != len(baseline) + 1:
        record('goal-persisted', 'fail', f'http={code} count={len(ids)}')
        return False
    record('goal-persisted', 'pass', f'count={len(ids)}')
    return True


def check_contribution_idempotency(record, api_origin, query, token, merchant_id, product_id, stamp, variant_id, target, timeout, baseline):
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
        return False, created_new
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
            return False, created_new
        code, final = _request(
            api_origin, 'GET',
            f'/api/storefront/customer/savings/goals?{query}',
            token, timeout=timeout,
        )
        finals = goal_ids(final)
        if code != 200 or len(set(finals)) != len(baseline) + 2 or goal_b not in finals:
            record('idempotency', 'fail', 'replay added a goal row')
            return False, created_new
        record('idempotency', 'pass', 'duplicate rejected, no extra row')
        created_new = 2
    return True, created_new


def check_goal_key_idempotency(record, api_origin, query, token, merchant_id, product_id, stamp, variant_id, target, timeout, baseline, created_new):
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
        return False
    retry = dict(keyed)
    retry['metadata'] = {'stagingVerify': True, 'attempt': 2}
    code, keyed_retry = _request(
        api_origin, 'POST', '/api/storefront/customer/savings/goals',
        token, retry, timeout=timeout,
    )
    if code not in (200, 201) or created_goal_id(keyed_retry) != goal_c:
        record('goal-idempotency', 'fail',
               f'retry http={code} same={created_goal_id(keyed_retry) == goal_c}')
        return False
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
        return False
    code, keyed_final = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/savings/goals?{query}',
        token, timeout=timeout,
    )
    keyed_finals = goal_ids(keyed_final)
    if (code != 200 or len(set(keyed_finals)) != len(baseline) + created_new + 1
            or goal_c not in keyed_finals):
        record('goal-idempotency', 'fail', 'retry added a goal row')
        return False
    record('goal-idempotency', 'pass', f'same goal={goal_c}, mismatch rejected')
    return True


def check_funding_account(record, api_origin, query, token, timeout):
    # 6. Funding-account retrieval.
    code, wallet = _request(
        api_origin, 'GET',
        f'/api/storefront/customer/wallet/piggyvest-plan?{query}',
        token, timeout=timeout,
    )
    if code != 200 or not wallet_shape_ok(wallet):
        record('funding-account', 'fail', f'http={code}')
        return False
    record('funding-account', 'pass', f"status={wallet['status']}")
    return True



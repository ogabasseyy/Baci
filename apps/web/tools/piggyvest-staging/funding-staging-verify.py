#!/usr/bin/env python3
"""Authenticated end-to-end verification of staging savings funding.

Exercises the real Metro-adjacent flow against a staging origin with a
synthetic-customer Bearer [REDACTED] See funding-staging-scenarios.py for the
individual goal/idempotency/funding checks run here in order.

The token is read from a file and never printed. Output is redacted to
step names, HTTP statuses, counts, and synthetic goal UUIDs only.

Exit 0 when every step passes or skips with a reason; exit 1 on any fail.
"""

import argparse
import importlib.util
import json
import sys
import urllib.parse
from datetime import UTC, datetime
from pathlib import Path


SYNTHETIC_MERCHANT_ID = '10000000-0000-4000-8000-000000000001'

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


scenarios = _load_sibling('scenarios')


def run(api_origin, rest_origin, token, merchant_id, product_id, timeout):
    steps = []

    def record(name, status, detail=''):
        steps.append({'step': name, 'status': status, 'detail': detail})
        return status == 'pass'

    query = urllib.parse.urlencode({'merchantId': merchant_id})
    stamp = datetime.now(tz=UTC).strftime('%Y%m%dT%H%M%S')
    ok, product_id = scenarios.discover_product(
        record, rest_origin, token, merchant_id, product_id, timeout
    )
    if not ok:
        return steps
    ok, variant_id, target = scenarios.discover_variant(
        record, rest_origin, token, product_id, timeout
    )
    if not ok:
        return steps
    ok, baseline = scenarios.list_baseline(
        record, api_origin, query, token, timeout
    )
    if not ok:
        return steps
    ok, goal_a = scenarios.create_goal(
        record, api_origin, token, merchant_id, product_id, stamp,
        variant_id, target, timeout,
    )
    if not ok:
        return steps
    if not scenarios.check_persisted(
        record, api_origin, query, token, timeout, baseline, goal_a
    ):
        return steps
    ok, created_new = scenarios.check_contribution_idempotency(
        record, api_origin, query, token, merchant_id, product_id, stamp,
        variant_id, target, timeout, baseline,
    )
    if not ok:
        return steps
    if not scenarios.check_goal_key_idempotency(
        record, api_origin, query, token, merchant_id, product_id, stamp,
        variant_id, target, timeout, baseline, created_new,
    ):
        return steps
    if not scenarios.check_funding_account(
        record, api_origin, query, token, timeout
    ):
        return steps
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

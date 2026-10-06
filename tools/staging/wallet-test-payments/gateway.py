import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import sys
import time


HERE = Path(__file__).resolve().parent
ROUTE = '/rest/v1/rpc/allocate_customer_savings_contribution'
EXPIRY = '2026-09-29T15:59:10.442Z'
RECEIPT = 'wallet-test-payments-route-receipt.json'
BASE_HASH = '87da0711bb81c572e943ab9f5dcdac87f189a4048d11620dde3da345d47ccacc'
RECEIPT_HELPER_HASH = 'b1ebff02395a729801d01b77204b596a0d982d13cc8700b5af12cdbfd9d553c0'


def load_base():
    helper = HERE / 'gateway_receipt.py'
    if helper.is_symlink() or hashlib.sha256(helper.read_bytes()).hexdigest() != RECEIPT_HELPER_HASH:
        raise RuntimeError('Reviewed receipt dependency changed')
    source = HERE / 'engagement_gateway.py'
    if source.is_symlink() or hashlib.sha256(source.read_bytes()).hexdigest() != BASE_HASH:
        raise RuntimeError('Reviewed gateway dependency changed')
    spec = importlib.util.spec_from_file_location('engagement_gateway', source)
    base = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(base)
    return base


def extend(current, expected):
    actual = tuple((row['path'], tuple(row['methods'])) for row in current['identity']['restRoutes'])
    if len(expected) != 22 or actual != expected or current['leaseExpiresAt'] != EXPIRY or any(path == ROUTE for path, _ in expected):
        raise RuntimeError('Gateway predecessor or fixed lease changed')
    target = json.loads(json.dumps(current))
    target['identity']['restRoutes'].append({'path': ROUTE, 'methods': ['POST']})
    return target


def validate_resume(binding, raw, receipt, routes, activator, now):
    if not isinstance(binding, dict) or set(binding) != {'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'} or binding['version'] != 1:
        raise RuntimeError('Installed binding shape changed')
    identity = binding['identity']
    if not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'} or identity['restRoutes'] != routes:
        raise RuntimeError('Installed binding identity changed')
    expires = activator._lease_moment(binding['leaseExpiresAt'], activator.DEADLINE_EPOCH)
    reviewed = activator._lease_moment(binding['reviewedAt'], None)
    not_before = activator._lease_moment(binding['leaseNotBefore'], None)
    if binding['leaseExpiresAt'] != EXPIRY or reviewed != not_before or not_before >= expires or now >= expires:
        raise RuntimeError('Installed binding lease changed')
    expected = {
        'version': 1, 'bindingSha256': hashlib.sha256(raw).hexdigest(),
        'identitySha256': hashlib.sha256(json.dumps(identity, separators=(',', ':')).encode()).hexdigest(),
        'routesSha256': hashlib.sha256(json.dumps(routes, separators=(',', ':')).encode()).hexdigest(),
        'leaseExpiresAt': EXPIRY,
    }
    if not isinstance(receipt, dict) or set(receipt) != set(expected) | {'inventorySha256'} or any(receipt[key] != value for key, value in expected.items()) or not isinstance(receipt['inventorySha256'], str) or not re.fullmatch('[a-f0-9]{64}', receipt['inventorySha256']):
        raise RuntimeError('Installed payment route receipt mismatch')


def prepare(base, activator, installer, candidate):
    current, current_bytes = activator._read_json(activator.BINDING_PATH, 0, (0o440,))
    before = base.routes_22(installer, candidate)
    target_rows = [{'path': path, 'methods': list(methods)} for path, methods in before] + [{'path': ROUTE, 'methods': ['POST']}]
    receipt_path = Path(activator.STATE_DIRECTORY) / RECEIPT
    if current.get('identity', {}).get('restRoutes') == target_rows:
        receipt = json.loads(activator._read_root_file(receipt_path, 0, (0o400,)))
        validate_resume(current, current_bytes, receipt, target_rows, activator, time.time())
        if any(activator._service_state(service)['ActiveState'] != 'active' for service in (activator.GATEWAY_SERVICE, activator.DRAFTS_SERVICE)):
            raise RuntimeError('Required staging service inactive')
        activator._firewall_preflight()
        activator._reachability_preflight(current['identity'])
        inventory, started_ms = activator._collect_inventory()
        evidence, _ = activator._build_evidence(current, inventory, started_ms)
        activator._validate_evidence(current, evidence, started_ms, int(time.time() * 1000))
        activator._verify_socket(*activator._gateway_account())
        activator._verify_post_transition(activator._probe_baseline())
        base._probe_routes(activator, before + ((ROUTE, ('POST',)),))
        return {'status': 'already_applied'}
    if receipt_path.exists() or receipt_path.is_symlink():
        raise RuntimeError('Unmatched payment route receipt exists')
    predecessor = base._prepare(activator, installer, candidate)
    if predecessor.get('status') != 'already_applied' or predecessor['current'] != current:
        raise RuntimeError('Verified 22-route predecessor required')
    target = extend(current, before)
    inventory, started_ms = activator._collect_inventory()
    evidence, evidence_bytes = activator._build_evidence(target, inventory, started_ms)
    activator._validate_evidence(target, evidence, started_ms, int(time.time() * 1000))
    uid, gid = activator._gateway_account()
    return {
        'current': current, 'currentBytes': current_bytes, 'target': target,
        'targetBytes': json.dumps(target, separators=(',', ':')).encode(),
        'evidenceBytes': evidence_bytes,
        'previousEvidence': activator._read_root_file(activator.EVIDENCE_PATH, 0, (0o440,)),
        'baseline': predecessor['baseline'], 'routeBaseline': predecessor['routeBaseline'],
        'beforeRoutes': before, 'gateway': activator._service_state(activator.GATEWAY_SERVICE),
        'uid': uid, 'gid': gid, 'inventory': inventory,
    }


def apply(activator, base, context):
    backup = base._save_backup(activator, context)
    try:
        activator._install_managed(activator.BINDING_PATH, context['targetBytes'], context['gid'])
        activator._install_managed(activator.EVIDENCE_PATH, context['evidenceBytes'], context['gid'])
        activator._restart_gateway()
        activator._poll_gateway(context['gateway']['InvocationID'], context['uid'], context['gid'])
        base._verify_health(activator, context)
        base._probe_routes(activator, ((ROUTE, ('POST',)),))
        receipt = base.build_own_receipt(context['target'], context['targetBytes'], context['inventory'])
        path = Path(activator.STATE_DIRECTORY) / RECEIPT
        activator._safe_ancestors(path, 0)
        base.publish_exclusive(path, receipt, 0o400)
    except BaseException:
        base._rollback(activator, context, backup)
        raise RuntimeError('Payment route activation failed; predecessor restored') from None
    return {'status': 'applied', 'routesBefore': 22, 'routesAfter': 23, 'leaseExpiresAt': EXPIRY}


def main():
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--apply', action='store_true')
    arguments = parser.parse_args()
    if os.geteuid() != 0 or time.time() >= 1790697550:
        raise RuntimeError('Owner authority unavailable or expired')
    base = load_base()
    activator, installer, candidate = base.load_dependencies()
    activator.verify_graph()
    with activator._locked(activator.LOCK_PATH):
        context = prepare(base, activator, installer, candidate)
        if context.get('status') == 'already_applied':
            result = context
        elif arguments.check:
            result = {'status': 'ready', 'routesBefore': 22, 'routesAfter': 23, 'leaseExpiresAt': EXPIRY}
        else:
            result = apply(activator, base, context)
        print(json.dumps(result))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'stage': 'test-payment-gateway', 'status': 'refused', 'errorType': type(error).__name__}), file=sys.stderr)
        raise SystemExit(1) from None

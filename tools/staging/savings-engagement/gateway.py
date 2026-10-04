#!/usr/bin/env python3
"""Root-only, fixed-lease extension of the savings staging gateway routes."""
import argparse
import hashlib
import json
import os
import stat
import sys
import time
import types
from pathlib import Path
from gateway_receipt import publish_exclusive
HERE = Path(__file__).resolve().parent
ACTIVATOR_PATH = HERE / 'funding-gateway-transition-activator.py'
INSTALLER_PATH = HERE / 'wallet-gateway-transition-installer.py'
CANDIDATE_PATH = HERE / 'funding-gateway-transition-candidate.py'
ACTIVATOR_SHA256 = '2c390e6196f72e86967d95a5e3ae104d3c0c5a3961eb7f765ba4d590c25cde72'
INSTALLER_SHA256 = 'df0eb8082b6cfe6146f92c6d81210fa4259e472f8480c30ca4a6a9cfb6d7bf13'
CANDIDATE_SHA256 = '82067e2a10bf1c1f9692c6a60ef7e48a0f889c76e4ab848fe5a211580633e0b8'
BASELINE_ROUTES_SHA256 = '6f444f5e89e75ec2cf853bd66179d929de5aa03b8d835d76078974a641ebfda5'
LEASE_EXPIRES_AT = '2026-09-29T15:59:10.442Z'
NEW_ROUTES = (
    ('/rest/v1/rpc/get_customer_savings_earnings', ('POST',)),
    ('/rest/v1/rpc/get_customer_savings_notifications', ('POST',)),
    ('/rest/v1/rpc/update_customer_savings_notification_preferences', ('POST',)),
    ('/rest/v1/rpc/mark_customer_savings_notification_read', ('POST',)),
    ('/rest/v1/rpc/register_push_token', ('POST',)),
    ('/rest/v1/push_tokens', ('PATCH',)),
)
TABLE_SELECTS = {
    '/rest/v1/piggyvest_plan_wallets': 'customer_id',
    '/rest/v1/piggyvest_interest_payouts': 'wallet_id',
}
RECEIPT_PATH_NAME = 'savings-engagement-route-receipt.json'
class Refused(RuntimeError):
    pass
class RolledBack(RuntimeError):
    pass
def _sha(content):
    return hashlib.sha256(content).hexdigest()
def _load_pinned_module(name, path, expected):
    if path.is_symlink() or not path.is_file():
        raise Refused('Pinned transition dependency unavailable.')
    content = path.read_bytes()
    if _sha(content) != expected:
        raise Refused('Pinned transition dependency drifted.')
    module = types.ModuleType(name)
    module.__file__ = str(path)
    exec(compile(content, str(path), 'exec'), module.__dict__)
    return module
def load_dependencies():
    activator = _load_pinned_module('savings_route_activator', ACTIVATOR_PATH, ACTIVATOR_SHA256)
    installer = _load_pinned_module('wallet_route_installer', INSTALLER_PATH, INSTALLER_SHA256)
    candidate = _load_pinned_module('savings_route_candidate', CANDIDATE_PATH, CANDIDATE_SHA256)
    routes = candidate.ROUTES
    valid = all(isinstance(r, tuple) and len(r) == 2 and isinstance(r[0], str) and isinstance(r[1], tuple) and r[1] and all(isinstance(m, str) for m in r[1]) for r in routes)
    if not valid or _sha(activator._routes_canonical(routes)) != activator.EXPECTED_ROUTES_SHA256 or tuple(routes[:5]) != tuple(activator.CURRENT_ROUTES):
        raise Refused('Pinned candidate contract mismatch.')
    return activator, installer, candidate
def routes_22(installer, candidate):
    try:
        predecessor = tuple(installer.routes_16(candidate))
    except Exception as error:
        raise Refused('Exact 16-route predecessor rejected.') from error
    canonical = json.dumps([{'path': p, 'methods': list(m)} for p, m in predecessor], separators=(',', ':')).encode()
    if len(predecessor) != 16 or _sha(canonical) != BASELINE_ROUTES_SHA256:
        raise Refused('Exact 16-route predecessor rejected.')
    result = predecessor + NEW_ROUTES
    paths = [path for path, _ in result]
    if len(result) != 22 or len(set(paths)) != 22:
        raise Refused('22-route contract is invalid.')
    return result
def _validate_current_16(current, activator, installer, candidate, now_seconds):
    if not isinstance(current, dict) or set(current) != {'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'} or current.get('version') != 1:
        raise Refused('Current binding shape rejected.')
    identity = current.get('identity')
    if not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'} or activator._routes_tuple(identity.get('restRoutes')) != tuple(installer.routes_16(candidate)):
        raise Refused('Exact 16-route predecessor rejected.')
    expires = activator._lease_moment(current.get('leaseExpiresAt'), activator.DEADLINE_EPOCH)
    reviewed = activator._lease_moment(current.get('reviewedAt'), None)
    not_before = activator._lease_moment(current.get('leaseNotBefore'), None)
    if reviewed != not_before or not_before >= expires or now_seconds >= expires:
        raise Refused('Fixed binding lease is invalid or expired.')
    return identity
def build_target_binding(current, activator, installer, candidate, now_seconds=None):
    now = int(time.time()) if now_seconds is None else now_seconds
    _validate_current_16(current, activator, installer, candidate, now)
    if current.get('leaseExpiresAt') != LEASE_EXPIRES_AT:
        raise Refused('Fixed binding lease changed.')
    target = json.loads(installer.render_binding(current, routes_22(installer, candidate)))
    if ({k: v for k, v in target.items() if k != 'identity'} != {k: v for k, v in current.items() if k != 'identity'} or
        {k: v for k, v in target['identity'].items() if k != 'restRoutes'} != {k: v for k, v in current['identity'].items() if k != 'restRoutes'}):
        raise Refused('Binding extension changed unrelated fields.')
    return target
def build_own_receipt(binding, binding_bytes, inventory):
    identity = json.dumps(binding['identity'], separators=(',', ':')).encode()
    routes = json.dumps(binding['identity']['restRoutes'], separators=(',', ':')).encode()
    receipt = {'version': 1, 'bindingSha256': _sha(binding_bytes),
               'identitySha256': _sha(identity), 'routesSha256': _sha(routes),
               'leaseExpiresAt': binding['leaseExpiresAt'],
               'inventorySha256': _sha(json.dumps(inventory, sort_keys=True, separators=(',', ':')).encode())}
    return json.dumps(receipt, separators=(',', ':')).encode()
def validate_own_receipt(binding, binding_bytes, receipt_bytes, activator, installer, candidate, now_ms=None):
    now = int(time.time() * 1000) if now_ms is None else now_ms
    expected_routes = [{'path': path, 'methods': list(methods)} for path, methods in routes_22(installer, candidate)]
    try:
        receipt = json.loads(receipt_bytes)
    except (ValueError, TypeError) as error:
        raise Refused('Own transition receipt is invalid.') from error
    if not isinstance(binding, dict) or set(binding) != {'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'} or binding.get('version') != 1:
        raise Refused('Current binding shape rejected.')
    identity = binding.get('identity')
    if not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'}:
        raise Refused('Current binding identity rejected.')
    if identity['restRoutes'] != expected_routes:
        raise Refused('Exact 22-route binding rejected.')
    expires = activator._lease_moment(binding.get('leaseExpiresAt'), activator.DEADLINE_EPOCH)
    reviewed = activator._lease_moment(binding.get('reviewedAt'), None)
    not_before = activator._lease_moment(binding.get('leaseNotBefore'), None)
    if binding['leaseExpiresAt'] != LEASE_EXPIRES_AT or reviewed != not_before or not_before >= expires or now // 1000 >= expires:
        raise Refused('Fixed binding lease is invalid or expired.')
    identity_bytes = json.dumps(identity, separators=(',', ':')).encode()
    route_bytes = json.dumps(identity['restRoutes'], separators=(',', ':')).encode()
    keys = {'version', 'bindingSha256', 'identitySha256', 'routesSha256', 'leaseExpiresAt', 'inventorySha256'}
    valid_hash = isinstance(receipt, dict) and isinstance(receipt.get('inventorySha256'), str) and len(receipt['inventorySha256']) == 64 and all(c in '0123456789abcdef' for c in receipt['inventorySha256'])
    if (not valid_hash or set(receipt) != keys or receipt['version'] != 1 or receipt['bindingSha256'] != _sha(binding_bytes) or
        receipt['identitySha256'] != _sha(identity_bytes) or receipt['routesSha256'] != _sha(route_bytes) or receipt['leaseExpiresAt'] != LEASE_EXPIRES_AT):
        raise Refused('Own transition receipt does not match current binding.')
    return receipt

def _route_probe(method, path):
    if method == 'GET': return method, f'{path}?select={TABLE_SELECTS.get(path, "id")}&limit=0'
    return method, path
def _probe_routes(activator, routes):
    probes = []
    for path, methods in routes:
        method, request_path = _route_probe(methods[0], path)
        status, content_type = activator.socket_probe(method, request_path)
        if status not in activator.ROUTED_STATUSES or 'json' not in content_type:
            raise Refused('Gateway route probe rejected.')
        probes.append((method, request_path, status, content_type))
    return probes
def _verify_routes(activator, expected, routes):
    if _probe_routes(activator, routes) != expected: raise Refused('Gateway route baseline changed.')

def _prepare_noop(activator, installer, candidate, current, current_bytes, receipt_bytes, now_ms=None):
    now = int(time.time() * 1000) if now_ms is None else now_ms
    validate_own_receipt(current, current_bytes, receipt_bytes, activator, installer, candidate, now)
    identity = current['identity']
    gateway = activator._service_state(activator.GATEWAY_SERVICE)
    drafts = activator._service_state(activator.DRAFTS_SERVICE)
    if gateway['ActiveState'] != 'active' or drafts['ActiveState'] != 'active':
        raise Refused('Required gateway service is inactive.')
    activator._firewall_preflight(); activator._reachability_preflight(identity)
    baseline = activator._probe_baseline()
    routes = tuple((route['path'], tuple(route['methods'])) for route in identity['restRoutes'])
    route_baseline = _probe_routes(activator, routes)
    inventory, started_ms = activator._collect_inventory()
    evidence, _ = activator._build_evidence(current, inventory, started_ms)
    evidence_now = now if now_ms is not None else int(time.time() * 1000); activator._validate_evidence(current, evidence, started_ms, evidence_now); activator._verify_post_transition(baseline)
    uid, gid = activator._gateway_account()
    activator._verify_socket(uid, gid); return {'status': 'already_applied', 'current': current, 'baseline': baseline, 'routeBaseline': route_baseline}
def _prepare(activator, installer, candidate):
    current, current_bytes = activator._read_json(activator.BINDING_PATH, 0, (0o440,))
    current_routes = activator._routes_tuple(current.get('identity', {}).get('restRoutes')) if isinstance(current, dict) and isinstance(current.get('identity'), dict) else ()
    expected_22 = tuple(routes_22(installer, candidate))
    if current_routes == expected_22:
        receipt = activator._read_root_file(Path(activator.STATE_DIRECTORY) / RECEIPT_PATH_NAME, 0, (0o400,))
        return _prepare_noop(activator, installer, candidate, current, current_bytes, receipt)
    target = build_target_binding(current, activator, installer, candidate)
    identity = current['identity']; before_routes = tuple(installer.routes_16(candidate))
    gateway = activator._service_state(activator.GATEWAY_SERVICE)
    drafts = activator._service_state(activator.DRAFTS_SERVICE)
    if gateway['ActiveState'] != 'active' or drafts['ActiveState'] != 'active':
        raise Refused('Required gateway service is inactive.')
    activator._firewall_preflight(); activator._reachability_preflight(identity)
    baseline = activator._probe_baseline()
    route_baseline = _probe_routes(activator, before_routes)
    inventory, started_ms = activator._collect_inventory()
    evidence, evidence_bytes = activator._build_evidence(target, inventory, started_ms)
    activator._validate_evidence(target, evidence, started_ms, int(time.time() * 1000))
    uid, gid = activator._gateway_account(); activator._verify_socket(uid, gid)
    previous_evidence = activator._read_root_file(activator.EVIDENCE_PATH, 0, (0o440,))
    target_bytes = json.dumps(target, separators=(',', ':')).encode()
    return {'current': current, 'currentBytes': current_bytes, 'target': target, 'targetBytes': target_bytes,
            'evidenceBytes': evidence_bytes, 'previousEvidence': previous_evidence, 'baseline': baseline,
            'routeBaseline': route_baseline, 'beforeRoutes': before_routes, 'gateway': gateway,
            'uid': uid, 'gid': gid, 'inventory': inventory}
def _write_exclusive(path, content, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, mode)
    with os.fdopen(descriptor, 'wb') as handle: handle.write(content); handle.flush(); os.fsync(handle.fileno())
def _save_backup(activator, context):
    root = Path(activator.STATE_DIRECTORY) / 'savings-engagement-route-backups'
    activator._safe_ancestors(root, 0)
    if root.exists() or root.is_symlink():
        info = root.lstat()
        if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or stat.S_IMODE(info.st_mode) != 0o700:
            raise Refused('Backup directory rejected.')
    else:
        root.mkdir(mode=0o700)
    activator._safe_ancestors(root / 'sentinel', 0)
    backup = root / f'gateway-{int(time.time())}-{os.getpid()}'
    backup.mkdir(mode=0o700, exist_ok=False)
    _write_exclusive(backup / 'binding.json', context['currentBytes'], 0o400); _write_exclusive(backup / 'startup-evidence.json', context['previousEvidence'], 0o400)
    directory_fd = os.open(backup, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try: os.fsync(directory_fd)
    finally: os.close(directory_fd)
    return backup
def _verify_health(activator, context):
    activator._verify_post_transition(context['baseline'])
    _verify_routes(activator, context['routeBaseline'], context['beforeRoutes'])
    _probe_routes(activator, NEW_ROUTES)
    if activator._service_state(activator.DRAFTS_SERVICE)['ActiveState'] != 'active': raise Refused('Drafts service did not stay active.')
def _write_receipt(activator, context):
    path = Path(activator.STATE_DIRECTORY) / RECEIPT_PATH_NAME
    content = build_own_receipt(context['target'], context['targetBytes'], context['inventory'])
    activator._safe_ancestors(path, 0); publish_exclusive(path, content, 0o400)
def _rollback(activator, context, backup):
    binding_bytes = activator._read_root_file(backup / 'binding.json', 0, (0o400,))
    saved = json.loads(binding_bytes)
    activator._install_managed(activator.BINDING_PATH, binding_bytes, context['gid']); inventory, started_ms = activator._collect_inventory()
    evidence, evidence_bytes = activator._build_evidence(saved, inventory, started_ms)
    activator._validate_evidence(saved, evidence, started_ms, int(time.time() * 1000))
    activator._install_managed(activator.EVIDENCE_PATH, evidence_bytes, context['gid'])
    previous = activator._service_state(activator.GATEWAY_SERVICE)['InvocationID']; activator._restart_gateway()
    activator._poll_gateway(previous, context['uid'], context['gid']); activator._verify_post_transition(context['baseline'])
    _verify_routes(activator, context['routeBaseline'], context['beforeRoutes'])
def apply_transition(activator, context):
    if os.geteuid() != 0:
        raise Refused('Root execution is required.')
    backup = _save_backup(activator, context)
    try:
        activator._install_managed(activator.BINDING_PATH, context['targetBytes'], context['gid']); activator._install_managed(activator.EVIDENCE_PATH, context['evidenceBytes'], context['gid'])
        activator._restart_gateway()
        activator._poll_gateway(
            context['gateway']['InvocationID'], context['uid'], context['gid']
        )
        _verify_health(activator, context); _write_receipt(activator, context)
    except BaseException as failure:
        try:
            _rollback(activator, context, backup)
        except BaseException as rollback_failure:
            raise Refused('Transition failed; rollback failed; backup retained.') from rollback_failure
        raise RolledBack('Transition failed; exact predecessor restored; backup retained.') from failure
    return {'status': 'applied', 'routesBefore': 16, 'routesAfter': 22, 'leaseExpiresAt': LEASE_EXPIRES_AT, 'backup': str(backup)}
def main(arguments=None):
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True); modes.add_argument('--check', action='store_true'); modes.add_argument('--apply', action='store_true')
    options = parser.parse_args(arguments)
    if os.geteuid() != 0:
        print('savings_gateway_transition:root_required', file=sys.stderr)
        return 1
    try:
        activator, installer, candidate = load_dependencies(); activator.verify_graph()
        with activator._locked(activator.LOCK_PATH):
            context = _prepare(activator, installer, candidate)
            if context.get('status') == 'already_applied':
                result = {'status': 'already_applied', 'routesBefore': 22, 'routesAfter': 22,
                          'leaseExpiresAt': LEASE_EXPIRES_AT, 'baselineProbes': len(context['routeBaseline'])}
            elif options.check:
                result = {'status': 'ready', 'routesBefore': 16, 'routesAfter': 22,
                          'leaseExpiresAt': LEASE_EXPIRES_AT, 'baselineProbes': len(context['routeBaseline']),
                          'dependencySha256': ACTIVATOR_SHA256}
            else:
                result = apply_transition(activator, context)
        print(json.dumps(result, separators=(',', ':'))); return 0
    except RolledBack:
        print('savings_gateway_transition:rolled_back', file=sys.stderr)
    except Exception:
        print('savings_gateway_transition:refused', file=sys.stderr)
    return 1

if __name__ == '__main__':
    raise SystemExit(main())

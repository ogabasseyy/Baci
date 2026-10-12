"""Execution, recovery, and root-safe IO for the wallet route transition."""

import argparse
import json
import os
import stat
import sys
import time
from datetime import UTC, datetime
from pathlib import Path
from types import SimpleNamespace

import importlib.util


HERE = Path(__file__).resolve().parent
INTENT = Path('/var/lib/baci-savings-gateway-install/wallet-route-transition-in-progress.json')
BACKUPS = Path('/var/lib/baci-savings-gateway-install/wallet-route-backups')
RECEIPT = Path('/var/lib/baci-savings-gateway-install/wallet-route-transition-receipt.json')
PACKAGE = Path('/etc/baci-savings-gateway/wallet-route-transition')
REVIEW_PIN = 'reviewed-manifest-sha256'


def _module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError('module unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _write_exclusive(path, content, mode):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)
        handle.flush()
        os.fsync(handle.fileno())
    directory_fd = os.open(path.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
    try:
        os.fsync(directory_fd)
    finally:
        os.close(directory_fd)


def _safe_directory(path):
    info = path.lstat()
    if not stat.S_ISDIR(info.st_mode) or info.st_uid != 0 or info.st_mode & 0o077:
        raise RuntimeError('unsafe directory')


def _probe_wallet_routes(activator):
    probes = (
        ('GET', '/rest/v1/customer_wallets?select=id&limit=0'),
        ('GET', '/rest/v1/customer_wallet_transactions?select=id&limit=0'),
        ('GET', '/rest/v1/customer_wallet_payment_accounts?select=id&limit=0'),
        ('GET', '/rest/v1/customer_wallet_accounts?select=id&limit=0'),
        ('POST', '/rest/v1/rpc/get_storefront_payment_settings'),
    )
    for method, path in probes:
        status, content_type = activator.socket_probe(method, path)
        if status not in activator.ROUTED_STATUSES or 'json' not in content_type:
            raise RuntimeError('wallet route health probe failed')

def _prepare(contract, activator, candidate, database):
    contract.legacy_preflight(candidate)
    current, current_bytes = activator._read_json(activator.BINDING_PATH, 0, (0o440,))
    identity = contract.validate_current_binding(current, activator, candidate)
    target, target_bytes, manifest_bytes = contract.read_package(
        candidate, activator, current, current_bytes
    )
    reviewed_pin = activator._read_root_file(PACKAGE / REVIEW_PIN, 0, (0o400,))
    if reviewed_pin != (contract.sha(manifest_bytes) + '\n').encode():
        raise RuntimeError('owner manifest pin mismatch')
    db_report = database.check_docker_database()
    gateway = activator._service_state(activator.GATEWAY_SERVICE)
    drafts = activator._service_state(activator.DRAFTS_SERVICE)
    if gateway['ActiveState'] != 'active' or drafts['ActiveState'] != 'active':
        raise RuntimeError('required service inactive')
    activator._firewall_preflight()
    activator._reachability_preflight(identity)
    baseline = activator._probe_baseline()
    inventory, started = activator._collect_inventory()
    evidence, evidence_bytes = activator._build_evidence(target, inventory, started)
    activator._validate_evidence(target, evidence, started, int(time.time() * 1000))
    uid, gid = activator._gateway_account()
    activator._verify_socket(uid, gid)
    previous_evidence = activator._read_root_file(activator.EVIDENCE_PATH, 0, (0o440,))
    return {
        'current': current, 'currentBytes': current_bytes, 'target': target,
        'targetBytes': target_bytes, 'manifestBytes': manifest_bytes,
        'evidenceBytes': evidence_bytes, 'previousEvidence': previous_evidence,
        'baseline': baseline, 'gateway': gateway, 'uid': uid, 'gid': gid,
        'database': db_report,
    }

def _health(activator, baseline):
    activator._verify_post_transition(baseline)
    _probe_wallet_routes(activator)
    if activator._service_state(activator.DRAFTS_SERVICE)['ActiveState'] != 'active':
        raise RuntimeError('drafts service inactive')

def _save_backups(contract, activator, context):
    if not BACKUPS.exists():
        BACKUPS.mkdir(mode=0o700)
    activator._safe_ancestors(BACKUPS / 'sentinel', 0)
    _safe_directory(BACKUPS)
    name = f"wallet-{int(time.time())}-{os.getpid()}"
    backup = BACKUPS / name
    backup.mkdir(mode=0o700, exist_ok=False)
    activator._safe_ancestors(backup / 'binding.json', 0)
    _write_exclusive(backup / 'binding.json', context['currentBytes'], 0o400)
    _write_exclusive(backup / 'startup-evidence.json', context['previousEvidence'], 0o400)
    intent = {
        'version': 1,
        'deadline': '2026-09-29T15:59:10.000Z',
        'backup': str(backup),
        'predecessorBindingSha256': contract.sha(context['currentBytes']),
        'targetBindingSha256': contract.sha(context['targetBytes']),
        'manifestSha256': contract.sha(context['manifestBytes']),
    }
    activator._safe_ancestors(INTENT, 0)
    _write_exclusive(INTENT, contract.compact(intent), 0o400)
    return backup, intent

def _record_receipt(contract, intent, recovery=False):
    report = {
        **intent,
        'event': 'recovered_to_11' if recovery else 'activated_16',
        'completedAt': datetime.now(UTC).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
    }
    target = RECEIPT if not recovery else RECEIPT.with_name(
        f'wallet-route-recovery-{int(time.time())}.json'
    )
    _write_exclusive(target, contract.compact(report), 0o400)
    return target

def _restore(contract, activator, candidate, backup, gid, previous_invocation, baseline):
    binding_bytes = activator._read_root_file(backup / 'binding.json', 0, (0o400,))
    saved = json.loads(binding_bytes)
    if activator._routes_tuple(saved['identity']['restRoutes']) != tuple(candidate.ROUTES):
        raise RuntimeError('backup is not exact 11-route predecessor')
    activator._install_managed(activator.BINDING_PATH, binding_bytes, gid)
    inventory, started = activator._collect_inventory()
    evidence, evidence_bytes = activator._build_evidence(saved, inventory, started)
    activator._validate_evidence(saved, evidence, started, int(time.time() * 1000))
    activator._install_managed(activator.EVIDENCE_PATH, evidence_bytes, gid)
    activator._restart_gateway()
    activator._poll_gateway(previous_invocation, *activator._gateway_account())
    activator._verify_post_transition(baseline)

def _activate(contract, activator, candidate, context):
    backup, intent = _save_backups(contract, activator, context)
    try:
        activator._install_managed(activator.BINDING_PATH, context['targetBytes'], context['gid'])
        activator._install_managed(activator.EVIDENCE_PATH, context['evidenceBytes'], context['gid'])
        activator._restart_gateway()
        activator._poll_gateway(
            context['gateway']['InvocationID'], context['uid'], context['gid']
        )
        _health(activator, context['baseline'])
        _record_receipt(contract, intent)
    except Exception as error:
        try:
            _restore(contract, activator, candidate, backup, context['gid'],
                     context['gateway']['InvocationID'], context['baseline'])
        except Exception as rollback_error:
            raise RuntimeError(f'rollback_failed_backup={backup.name}') from rollback_error
        raise RuntimeError(f'activation_rolled_back_backup={backup.name}') from error
    try:
        os.unlink(INTENT)
    except OSError:
        pass
    return {'status': 'activated', 'routesBefore': 11, 'routesAfter': 16,
            'leaseExpiresAt': context['target']['leaseExpiresAt'], 'backup': str(backup)}

def _recover(contract, activator, candidate):
    if int(time.time()) >= contract.DEADLINE:
        raise RuntimeError('fixed_deadline_expired')
    source = INTENT if INTENT.exists() else RECEIPT
    intent = json.loads(activator._read_root_file(source, 0, (0o400,)))
    if intent.get('version') != 1 or intent.get('deadline') != '2026-09-29T15:59:10.000Z':
        raise RuntimeError('recovery intent invalid')
    backup = Path(intent.get('backup', ''))
    if backup.parent != BACKUPS or not backup.name.startswith('wallet-'):
        raise RuntimeError('recovery backup path invalid')
    _safe_directory(backup)
    before_bytes = activator._read_root_file(backup / 'binding.json', 0, (0o400,))
    if contract.sha(before_bytes) != intent.get('predecessorBindingSha256'):
        raise RuntimeError('recovery predecessor hash mismatch')
    target, target_bytes = activator._read_json(activator.BINDING_PATH, 0, (0o440,))
    active_routes = activator._routes_tuple(target['identity']['restRoutes'])
    is_transitioned = active_routes == contract.routes_16(candidate)
    if is_transitioned:
        if contract.sha(target_bytes) != intent.get('targetBindingSha256'):
            raise RuntimeError('recovery target hash mismatch')
        activator._lease_moment(target.get('leaseExpiresAt'), contract.DEADLINE)
    elif active_routes != tuple(candidate.ROUTES) or contract.sha(target_bytes) != intent.get('predecessorBindingSha256'):
        raise RuntimeError('recovery active binding hash mismatch')
    manifest_bytes = activator._read_root_file(PACKAGE / 'manifest.json', 0, (0o400,))
    if contract.sha(manifest_bytes) != intent.get('manifestSha256'):
        raise RuntimeError('recovery manifest hash mismatch')
    baseline = activator._probe_baseline()
    current = activator._service_state(activator.GATEWAY_SERVICE)
    _, gid = activator._gateway_account()
    if is_transitioned:
        _restore(contract, activator, candidate, backup, gid, current['InvocationID'], baseline)
    else:
        activator._verify_post_transition(baseline)
    receipt = _record_receipt(contract, intent, recovery=True)
    if INTENT.exists():
        os.unlink(INTENT)
    return {'status': 'recovered_to_11', 'receipt': str(receipt), 'backup': str(backup)}

def main(argv=None):
    parser = argparse.ArgumentParser()
    group = parser.add_mutually_exclusive_group(required=True)
    group.add_argument('--build-package', action='store_true')
    group.add_argument('--stage-package', metavar='DIRECTORY')
    group.add_argument('--check', action='store_true')
    group.add_argument('--activate', action='store_true')
    group.add_argument('--recover', action='store_true')
    parser.add_argument('--manifest-sha256', help='owner-reviewed hash printed by --build-package')
    args = parser.parse_args(argv)
    if os.geteuid() != 0:
        print('wallet_transition:owner_root_required', file=sys.stderr)
        return 1
    contract = _module('wallet_transition_contract', HERE / 'wallet-gateway-transition-installer.py')
    activator, candidate = contract.legacy_modules()
    database = _module('wallet_database_preflight', HERE / 'wallet-gateway-database-preflight.py')
    try:
        activator.verify_graph()
        with activator._locked(activator.LOCK_PATH):
            if args.build_package:
                print(json.dumps(contract.build_package(activator=activator, candidate=candidate), sort_keys=True))
                return 0
            if args.stage_package:
                staged = contract.stage_package(
                    runtime=SimpleNamespace(PACKAGE=PACKAGE, REVIEW_PIN=REVIEW_PIN,
                                            _write_exclusive=_write_exclusive,
                                            _safe_directory=_safe_directory),
                    source=Path(args.stage_package),
                    expected_hash=args.manifest_sha256,
                )
                print(json.dumps(staged, sort_keys=True))
                return 0
            if args.recover:
                print(json.dumps(_recover(contract, activator, candidate), sort_keys=True))
                return 0
            if RECEIPT.exists() or RECEIPT.is_symlink() or INTENT.exists() or INTENT.is_symlink():
                raise RuntimeError('transition_already_started_or_completed')
            context = _prepare(contract, activator, candidate, database)
            if args.check:
                print(json.dumps({'status': 'ready', 'routesBefore': 11, 'routesAfter': 16,
                                  'leaseExpiresAt': context['target']['leaseExpiresAt'],
                                  'manifestSha256': contract.sha(context['manifestBytes']),
                                  'database': context['database']}, sort_keys=True))
                return 0
            print(json.dumps(_activate(contract, activator, candidate, context), sort_keys=True))
            return 0
    except Exception as error:
        stage = str(error) if isinstance(error, (contract.Refused, database.Refused, RuntimeError)) else type(error).__name__
        print(f'wallet_transition:refused:{stage}', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

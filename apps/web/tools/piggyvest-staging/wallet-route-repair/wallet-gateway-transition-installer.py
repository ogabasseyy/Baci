#!/usr/bin/env python3
"""Owner-run, fixed-deadline transition from the exact 11 routes to 16."""

import hashlib
import importlib.util
import json
import os
import shutil
import stat
import time
from pathlib import Path


HERE = Path(__file__).resolve().parent
LEGACY_DIRECTORY = HERE.parent / 'funding-gateway-transition'
CONFIG = Path('/etc/baci-savings-gateway')
STATE = Path('/var/lib/baci-savings-gateway-install')
PACKAGE = CONFIG / 'wallet-route-transition'
PACKAGE_OUTPUT = 'wallet-route-transition-package'
RECEIPT = STATE / 'wallet-route-transition-receipt.json'
DEADLINE = 1790697550
NEW_ROUTES = (
    ('/rest/v1/customer_wallets', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_transactions', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_payment_accounts', ('GET', 'HEAD')),
    ('/rest/v1/customer_wallet_accounts', ('GET', 'HEAD')),
    ('/rest/v1/rpc/get_storefront_payment_settings', ('POST',)),
)


class Refused(RuntimeError):
    pass


def load_module(name, path):
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise Refused('legacy_validator_unavailable')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def legacy_modules():
    return (
        load_module('wallet_legacy_activator', LEGACY_DIRECTORY / 'funding-gateway-transition-activator.py'),
        load_module('wallet_legacy_candidate', LEGACY_DIRECTORY / 'funding-gateway-transition-candidate.py'),
    )


def sha(content):
    return hashlib.sha256(content).hexdigest()


def compact(value):
    return json.dumps(value, separators=(',', ':'), sort_keys=True).encode()


def routes_16(candidate):
    if len(candidate.ROUTES) != 11:
        raise Refused('legacy_11_route_contract_drift')
    routes = tuple(candidate.ROUTES) + NEW_ROUTES
    paths = [path for path, _ in routes]
    if len(paths) != 16 or len(set(paths)) != 16:
        raise Refused('wallet_16_route_contract_invalid')
    return routes


def validate_current_binding(binding, activator, candidate, now=None):
    if not isinstance(binding, dict) or set(binding) != {
        'version', 'identity', 'reviewedAt', 'leaseNotBefore', 'leaseExpiresAt'
    } or binding.get('version') != 1:
        raise Refused('current_binding_shape_invalid')
    identity = binding.get('identity')
    if not isinstance(identity, dict) or set(identity) != {'host', 'containers', 'networks', 'restRoutes'}:
        raise Refused('current_binding_identity_invalid')
    if activator._routes_tuple(identity['restRoutes']) != tuple(candidate.ROUTES):
        raise Refused('current_binding_not_exact_11')
    expiry = activator._lease_moment(binding.get('leaseExpiresAt'), DEADLINE)
    reviewed = activator._lease_moment(binding.get('reviewedAt'), None)
    not_before = activator._lease_moment(binding.get('leaseNotBefore'), None)
    if reviewed != not_before or not_before >= expiry:
        raise Refused('current_binding_lease_triple_invalid')
    now = int(time.time()) if now is None else now
    if now >= expiry:
        raise Refused('fixed_deadline_expired')
    return identity


def render_binding(current, routes):
    target = json.loads(compact(current))
    target['identity']['restRoutes'] = [
        {'path': path, 'methods': list(methods)} for path, methods in routes
    ]
    return compact(target)


def render_manifest(predecessor_bytes, binding_bytes, routes):
    return compact({
        'version': 1,
        'deadline': '2026-09-29T15:59:10.000Z',
        'predecessorBindingSha256': sha(predecessor_bytes),
        'targetBindingSha256': sha(binding_bytes),
        'restRoutes': [{'path': path, 'methods': list(methods)} for path, methods in routes],
    })


def build_package(directory=None, *, activator=None, candidate=None, current=None,
                  current_bytes=None, binding=None, binding_bytes=None, now=None):
    if activator is None or candidate is None:
        activator, candidate = legacy_modules()
    current = binding if binding is not None else current
    current_bytes = binding_bytes if binding_bytes is not None else current_bytes
    if current is None:
        current, current_bytes = activator._read_json(activator.BINDING_PATH, 0, (0o440,))
    if current_bytes is None:
        current_bytes = compact(current)
    validate_current_binding(current, activator, candidate, now)
    routes = routes_16(candidate)
    target_bytes = render_binding(current, routes)
    manifest_bytes = render_manifest(current_bytes, target_bytes, routes)
    output = Path.cwd() / PACKAGE_OUTPUT if directory is None else Path(directory)
    if output.exists() or output.is_symlink():
        raise Refused('package_output_exists')
    output.mkdir(mode=0o700, parents=False)
    try:
        for name, content in (
            ('binding-before.json', current_bytes),
            ('binding.json', target_bytes),
            ('manifest.json', manifest_bytes),
        ):
            descriptor = os.open(output / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'wb') as handle:
                handle.write(content)
                handle.flush()
                os.fsync(handle.fileno())
        directory_fd = os.open(output, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except OSError as error:
        shutil.rmtree(output, ignore_errors=True)
        raise Refused('package_write_failed') from error
    return {'packageDirectory': str(output), 'manifestSha256': sha(manifest_bytes),
            'bindingSha256': sha(target_bytes), 'routesBefore': 11, 'routesAfter': 16}


def read_package(candidate, activator, current, current_bytes):
    manifest, manifest_bytes = activator._read_json(PACKAGE / 'manifest.json', 0, (0o400, 0o600))
    target_bytes = activator._read_root_file(PACKAGE / 'binding.json', 0, (0o400, 0o600))
    before_bytes = activator._read_root_file(PACKAGE / 'binding-before.json', 0, (0o400, 0o600))
    routes = routes_16(candidate)
    expected_manifest = render_manifest(current_bytes, target_bytes, routes)
    if manifest != json.loads(expected_manifest) or manifest_bytes != expected_manifest:
        raise Refused('package_manifest_mismatch')
    if before_bytes != current_bytes:
        raise Refused('predecessor_bytes_mismatch')
    if json.loads(target_bytes) != json.loads(render_binding(current, routes)):
        raise Refused('package_not_exact_route_extension')
    return json.loads(target_bytes), target_bytes, manifest_bytes


def legacy_preflight(candidate):
    inputs, _ = candidate._json_file(candidate.OWNER_INPUT_PATH, 0)
    candidate._validate_inputs(inputs, int(time.time()))
    candidate._validate_receipt_chain(inputs, candidate.STATE_DIRECTORY, 0)
    candidate._validate_post_renewal_manifest(
        inputs, candidate.POST_RENEWAL_MANIFEST_PATH, candidate.GATEWAY_UNIT_PATH, 0
    )
    candidate._validate_package_manifest(inputs, candidate.PACKAGE_MANIFEST_PATH, 0)


def stage_package(runtime, source, expected_hash):
    source_info = source.lstat()
    if not stat.S_ISDIR(source_info.st_mode) or source_info.st_uid != 0 or source_info.st_mode & 0o077:
        raise Refused('package_source_directory_rejected')
    activator, _ = legacy_modules()
    for ancestor in (source.parent, *source.parent.parents):
        ancestor_info = ancestor.lstat()
        if not stat.S_ISDIR(ancestor_info.st_mode) or ancestor_info.st_uid != 0 or ancestor_info.st_mode & 0o022:
            raise Refused('package_source_ancestry_rejected')
    names = ('binding-before.json', 'binding.json', 'manifest.json')
    source_files = {}
    for name in names:
        info = (source / name).lstat()
        if not stat.S_ISREG(info.st_mode) or info.st_uid != 0 or info.st_nlink != 1 or info.st_mode & 0o077:
            raise Refused('package_source_mode_rejected')
        source_files[name] = (source / name).read_bytes()
    manifest_bytes = source_files['manifest.json']
    manifest = json.loads(manifest_bytes)
    actual_hash = sha(manifest_bytes)
    if not expected_hash or actual_hash != expected_hash:
        raise Refused('owner_manifest_hash_mismatch')
    desired = {**source_files, runtime.REVIEW_PIN: (actual_hash + '\n').encode()}
    package = runtime.PACKAGE
    if package.exists() or package.is_symlink():
        runtime._safe_directory(package)
        activator._safe_ancestors(package / 'sentinel', 0)
        if {path.name for path in package.iterdir()} != set(desired):
            raise Refused('package_destination_drift')
        for name, content in desired.items():
            if activator._read_root_file(package / name, 0, (0o400,)) != content:
                raise Refused('package_destination_drift')
        return {'status': 'package_already_staged', 'path': str(package),
                'manifestSha256': actual_hash, 'routes': len(manifest.get('restRoutes', []))}
    temporary = package.with_name(f'.{package.name}.{os.getpid()}.stage')
    temporary.mkdir(mode=0o700)
    try:
        for name, content in desired.items():
            runtime._write_exclusive(temporary / name, content, 0o400)
        os.replace(temporary, package)
        directory_fd = os.open(package.parent, os.O_RDONLY | getattr(os, 'O_DIRECTORY', 0))
        try:
            os.fsync(directory_fd)
        finally:
            os.close(directory_fd)
    except BaseException:
        shutil.rmtree(temporary, ignore_errors=True)
        raise
    return {'status': 'package_staged', 'path': str(package),
            'manifestSha256': actual_hash, 'routes': len(manifest.get('restRoutes', []))}


def main(argv=None):
    runtime = load_module('wallet_gateway_transition_runtime', HERE / 'wallet-gateway-transition-runtime.py')
    return runtime.main(argv)


if __name__ == '__main__':
    raise SystemExit(main())

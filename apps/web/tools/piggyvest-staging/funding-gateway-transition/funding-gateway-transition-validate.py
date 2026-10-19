#!/usr/bin/env python3
"""Manifest and input validators for the funding gateway transition candidate."""

import importlib.util
import json
import sys
import time
from pathlib import Path

def _load_sibling(name):
    """Load a focused transition module once per process.

    Dash-named siblings cannot use plain imports; every module resolves them
    through this importlib loader with sys.modules singletons so the whole
    graph shares one Refused class and one set of constants.
    """
    key = f'funding_gateway_transition_{name}'
    cached = sys.modules.get(key)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(
        key, Path(__file__).parent / f'funding-gateway-transition-{name}.py'
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Transition {name} module is unavailable.')
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


_paths = _load_sibling('paths')
Refused = _paths.Refused
STATE_DIRECTORY = _paths.STATE_DIRECTORY
OWNER_INPUT_PATH = _paths.OWNER_INPUT_PATH
POST_RENEWAL_MANIFEST_PATH = _paths.POST_RENEWAL_MANIFEST_PATH
PACKAGE_MANIFEST_PATH = _paths.PACKAGE_MANIFEST_PATH
GATEWAY_UNIT_PATH = _paths.GATEWAY_UNIT_PATH
PROVENANCE_PATH = _paths.PROVENANCE_PATH
_sha = _paths._sha
_is_hash = _paths._is_hash
_safe_ancestors = _paths._safe_ancestors
_read_root_file = _paths._read_root_file
_json_file = _paths._json_file
_require_keys = _paths._require_keys

DEADLINE = '2026-09-29T15:59:10.000Z'
DEADLINE_EPOCH = 1790697550
WEEK_SECONDS = 7 * 24 * 60 * 60

ARCHIVE_MODES = (0o440,)
ROUTES = (
    ('/rest/v1/products', ('GET', 'HEAD')),
    ('/rest/v1/customers', ('GET', 'HEAD')),
    ('/rest/v1/merchants', ('GET', 'HEAD')),
    ('/rest/v1/rpc/customer_savings_draft_command', ('POST',)),
    ('/rest/v1/rpc/get_storefront_product_variants', ('POST',)),
    ('/rest/v1/customer_savings_goals', ('GET', 'HEAD')),
    ('/rest/v1/rpc/get_merchant_paystack_subaccount_code', ('POST',)),
    ('/rest/v1/rpc/get_customer_savings_feature_settings', ('POST',)),
    ('/rest/v1/rpc/create_customer_savings_goal', ('POST',)),
    # Minimum wallet reads required by getPlanWalletSnapshot: the customer
    # mapping row plus the verified interest payouts summed into the snapshot.
    # Both tables carry customer-scoped SELECT policies for authenticated.
    ('/rest/v1/piggyvest_plan_wallets', ('GET', 'HEAD')),
    ('/rest/v1/piggyvest_interest_payouts', ('GET', 'HEAD')),
)



def _routes(value: object) -> tuple[tuple[str, tuple[str, ...]], ...]:
    if not isinstance(value, list):
        raise Refused('Hosted-funding routes are invalid.')
    parsed = []
    for route in value:
        if not isinstance(route, dict) or set(route) != {'path', 'methods'}:
            raise Refused('Hosted-funding routes are invalid.')
        path, methods = route['path'], route['methods']
        if not isinstance(path, str) or not isinstance(methods, list) or not all(
            isinstance(method, str) for method in methods
        ):
            raise Refused('Hosted-funding routes are invalid.')
        parsed.append((path, tuple(methods)))
    return tuple(parsed)


def _archive_path(inputs: dict[str, object], state_directory: Path) -> Path:
    archive = inputs['archive']
    if not isinstance(archive, dict):
        raise Refused('Renewal archive input is invalid.')
    _require_keys(archive, {'name', 'bindingSha256', 'startupEvidenceSha256'})
    name = archive['name']
    if not isinstance(name, str) or not name or name in {'.', '..'} or '/' in name:
        raise Refused('Renewal archive input is invalid.')
    if not all(_is_hash(archive[key]) for key in ('bindingSha256', 'startupEvidenceSha256')):
        raise Refused('Renewal archive input is invalid.')
    return state_directory / 'renewals' / name


def _validate_inputs(inputs: dict[str, object], now_epoch: int) -> None:
    _require_keys(
        inputs,
        {
            'version',
            'deadline',
            'preRenewalManifestSha256',
            'postRenewalManifestSha256',
            'archive',
            'identity',
            'packageManifestSha256',
        },
    )
    if inputs['version'] != 1 or inputs['deadline'] != DEADLINE or now_epoch >= DEADLINE_EPOCH:
        raise Refused('Transition deadline is not the approved fixed expiry.')
    old, new, package = (
        inputs['preRenewalManifestSha256'],
        inputs['postRenewalManifestSha256'],
        inputs['packageManifestSha256'],
    )
    if not all(_is_hash(value) for value in (old, new, package)) or old == new:
        raise Refused('Post-renewal manifest pin is invalid or stale.')
    identity = inputs['identity']
    if not isinstance(identity, dict) or set(identity) != {'restRoutes'} or _routes(identity['restRoutes']) != ROUTES:
        raise Refused('Hosted-funding route contract is not exact.')


def _validate_receipt_chain(
    inputs: dict[str, object], state_directory: Path, owner_uid: int
) -> tuple[str, str]:
    receipt, receipt_bytes = _json_file(state_directory / 'receipt.json', owner_uid)
    renewal, renewal_bytes = _json_file(state_directory / 'renewal-receipt.json', owner_uid)
    if (
        set(receipt) != {'version', 'manifestSha256', 'entries'}
        or receipt.get('version') != 1
        or not isinstance(receipt.get('entries'), list)
        or receipt.get('manifestSha256') != inputs['preRenewalManifestSha256']
    ):
        raise Refused('Pre-renewal receipt does not match its supplied manifest pin.')
    archive = _archive_path(inputs, state_directory)
    archived = renewal.get('archivedEvidence')
    if (
        set(renewal) != {
            'version',
            'activatedAt',
            'expiresAt',
            'predecessorReceiptSha256',
            'archivedEvidence',
        }
        or renewal.get('version') != 1
        or not isinstance(renewal.get('activatedAt'), int)
        or renewal['activatedAt'] + WEEK_SECONDS != DEADLINE_EPOCH
        or renewal.get('expiresAt') != DEADLINE_EPOCH
        or renewal.get('predecessorReceiptSha256') != _sha(receipt_bytes)
        or not isinstance(archived, dict)
        or set(archived) != {'bindingSha256', 'startupEvidenceSha256'}
        or archived.get('bindingSha256') != inputs['archive']['bindingSha256']
        or archived.get('startupEvidenceSha256') != inputs['archive']['startupEvidenceSha256']
        or _sha(_read_root_file(archive / 'binding.json', owner_uid, ARCHIVE_MODES)) != archived['bindingSha256']
        or _sha(_read_root_file(archive / 'startup-evidence.json', owner_uid, ARCHIVE_MODES)) != archived['startupEvidenceSha256']
    ):
        raise Refused('Renewal receipt chain is invalid.')
    return _sha(receipt_bytes), _sha(renewal_bytes)


def _validate_post_renewal_manifest(
    inputs: dict[str, object], manifest_path: Path, gateway_unit_path: Path, owner_uid: int
) -> None:
    manifest, manifest_bytes = _json_file(manifest_path, owner_uid)
    files = manifest.get('files')
    expected = files.get('managed-gateway.service') if isinstance(files, dict) else None
    if (
        manifest.get('version') != 1
        or _sha(manifest_bytes) != inputs['postRenewalManifestSha256']
        or not _is_hash(expected)
        or _sha(_read_root_file(gateway_unit_path, owner_uid, (0o444, 0o644))) != expected
    ):
        raise Refused('Post-renewal gateway manifest does not match the installed unit.')


def _validate_package_manifest(
    inputs: dict[str, object], package_manifest_path: Path, owner_uid: int
) -> None:
    if _sha(_read_root_file(package_manifest_path, owner_uid)) != inputs['packageManifestSha256']:
        raise Refused('Sealed transition package manifest does not match its supplied pin.')


def validate_provenance_target(path: Path = PROVENANCE_PATH) -> None:
    if path.exists() or path.is_symlink():
        raise Refused('Transition provenance receipt already exists.')


def validate_preflight(
    inputs_path: Path = OWNER_INPUT_PATH,
    state_directory: Path = STATE_DIRECTORY,
    post_renewal_manifest_path: Path = POST_RENEWAL_MANIFEST_PATH,
    gateway_unit_path: Path = GATEWAY_UNIT_PATH,
    owner_uid: int = 0,
    now_epoch: int | None = None,
    package_manifest_path: Path = PACKAGE_MANIFEST_PATH,
) -> dict[str, object]:
    inputs, _ = _json_file(inputs_path, owner_uid)
    _validate_inputs(inputs, int(time.time()) if now_epoch is None else now_epoch)
    predecessor, renewal = _validate_receipt_chain(inputs, state_directory, owner_uid)
    _validate_post_renewal_manifest(
        inputs, post_renewal_manifest_path, gateway_unit_path, owner_uid
    )
    _validate_package_manifest(inputs, package_manifest_path, owner_uid)
    validate_provenance_target(state_directory / PROVENANCE_PATH.name)
    return {'predecessorReceiptSha256': predecessor, 'renewalReceiptSha256': renewal, **inputs}



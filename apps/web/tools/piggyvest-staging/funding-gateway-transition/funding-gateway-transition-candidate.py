#!/usr/bin/env python3
"""Read-only preflight for a fixed-deadline hosted-funding transition."""

import argparse
import hashlib
import json
import os
import stat
import sys
import time
from pathlib import Path


DEADLINE = '2026-09-29T15:59:10.000Z'
DEADLINE_EPOCH = 1790697550
WEEK_SECONDS = 7 * 24 * 60 * 60
STATE_DIRECTORY = Path('/var/lib/baci-savings-gateway-install')
OWNER_INPUT_PATH = Path('/etc/baci-savings-gateway/funding-transition-inputs.json')
POST_RENEWAL_MANIFEST_PATH = Path('/etc/baci-savings-gateway/post-renewal-install-manifest.json')
PACKAGE_MANIFEST_PATH = Path('/etc/baci-savings-gateway/funding-transition-package-manifest.json')
GATEWAY_UNIT_PATH = Path('/etc/systemd/system/baci-savings-gateway.service')
PROVENANCE_PATH = STATE_DIRECTORY / 'funding-transition-receipt.json'
# Renewal archives are placed 0440 by the renewal installer; the transition
# reads them back under exactly that mode.
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


class Refused(RuntimeError):
    pass


def _sha(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _is_hash(value: object) -> bool:
    return isinstance(value, str) and len(value) == 64 and all(
        character in '0123456789abcdef' for character in value
    )


def _safe_ancestors(path: Path, owner_uid: int) -> None:
    for ancestor in reversed((path.parent, *path.parent.parents)):
        try:
            metadata = ancestor.lstat()
        except OSError as error:
            raise Refused('Root-managed input path is unavailable.') from error
        if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != owner_uid or metadata.st_mode & 0o022:
            raise Refused('Root-managed input path is unsafe.')


def _read_root_file(
    path: Path, owner_uid: int = 0, modes: tuple[int, ...] = (0o400, 0o600)
) -> bytes:
    _safe_ancestors(path, owner_uid)
    try:
        descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    except OSError as error:
        raise Refused('Root-managed input is unavailable.') from error
    with os.fdopen(descriptor, 'rb') as handle:
        before = os.fstat(handle.fileno())
        if (
            not stat.S_ISREG(before.st_mode)
            or before.st_uid != owner_uid
            or before.st_nlink != 1
            or stat.S_IMODE(before.st_mode) not in modes
            or before.st_size > 1_048_576
        ):
            raise Refused('Root-managed input is unsafe.')
        content = handle.read()
        after = os.fstat(handle.fileno())
    if (before.st_dev, before.st_ino, before.st_size, before.st_mtime_ns, before.st_ctime_ns) != (
        after.st_dev,
        after.st_ino,
        after.st_size,
        after.st_mtime_ns,
        after.st_ctime_ns,
    ):
        raise Refused('Root-managed input changed while read.')
    return content


def _json_file(path: Path, owner_uid: int = 0) -> tuple[dict[str, object], bytes]:
    content = _read_root_file(path, owner_uid)
    try:
        value = json.loads(content)
    except (TypeError, ValueError) as error:
        raise Refused('Root-managed input is not valid JSON.') from error
    if not isinstance(value, dict):
        raise Refused('Root-managed input has an invalid shape.')
    return value, content


def _require_keys(value: dict[str, object], keys: set[str]) -> None:
    if set(value) != keys:
        raise Refused('Owner input has an unexpected shape.')


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


def render_provenance(preflight: dict[str, object]) -> bytes:
    return json.dumps(
        {
            'version': 1,
            'deadline': DEADLINE,
            'predecessorReceiptSha256': preflight['predecessorReceiptSha256'],
            'renewalReceiptSha256': preflight['renewalReceiptSha256'],
            'postRenewalManifestSha256': preflight['postRenewalManifestSha256'],
            'packageManifestSha256': preflight['packageManifestSha256'],
            'archive': preflight['archive'],
            'routeContract': preflight['identity']['restRoutes'],
        },
        separators=(',', ':'),
    ).encode()


def collect_transition_source(
    state_directory: Path = STATE_DIRECTORY,
    gateway_unit_path: Path = GATEWAY_UNIT_PATH,
    owner_uid: int = 0,
) -> dict[str, object]:
    """Strictly read the live renewal state a fresh inputs file pins.

    Returns predecessor/renewal receipt bytes plus the single renewal
    archive's name and file hashes and the installed unit hash. Refuses
    on anything but exactly one archive: discovery must never choose
    between candidates.
    """
    receipt, _ = _json_file(state_directory / 'receipt.json', owner_uid)
    renewal, _ = _json_file(state_directory / 'renewal-receipt.json', owner_uid)
    archived = renewal.get('archivedEvidence')
    if not isinstance(archived, dict):
        raise Refused('Renewal receipt has no archived evidence.')
    try:
        names = sorted(
            entry.name
            for entry in (state_directory / 'renewals').iterdir()
            if (state_directory / 'renewals' / entry.name).is_dir()
            and not (state_directory / 'renewals' / entry.name).is_symlink()
        )
    except OSError as error:
        raise Refused('Renewal archive directory is unavailable.') from error
    if len(names) != 1:
        raise Refused('Renewal archive is not exactly one directory.')
    archive = state_directory / 'renewals' / names[0]
    binding = _read_root_file(archive / 'binding.json', owner_uid, ARCHIVE_MODES)
    startup = _read_root_file(archive / 'startup-evidence.json', owner_uid, ARCHIVE_MODES)
    if _sha(binding) != archived.get(
        'bindingSha256'
    ) or _sha(startup) != archived.get('startupEvidenceSha256'):
        raise Refused('Renewal archive does not match its receipt.')
    unit = _read_root_file(gateway_unit_path, owner_uid, (0o444, 0o644))
    manifest_pin = receipt.get('manifestSha256')
    if not _is_hash(manifest_pin):
        raise Refused('Pre-renewal receipt pin is invalid.')
    return {
        'preRenewalManifestSha256': manifest_pin,
        'archive': {
            'name': names[0],
            'bindingSha256': _sha(binding),
            'startupEvidenceSha256': _sha(startup),
        },
        'unitSha256': _sha(unit),
    }


def render_owner_inputs(
    source: dict[str, object],
    package_manifest_sha256: str,
    post_renewal_manifest_sha256: str,
) -> dict[str, object]:
    """Render the owner inputs file a fresh preparation pins."""
    if not _is_hash(package_manifest_sha256) or not _is_hash(
        post_renewal_manifest_sha256
    ):
        raise Refused('Transition input pins are invalid.')
    archive = source['archive']
    if not isinstance(archive, dict):
        raise Refused('Transition source archive is invalid.')
    return {
        'version': 1,
        'deadline': DEADLINE,
        'preRenewalManifestSha256': source['preRenewalManifestSha256'],
        'postRenewalManifestSha256': post_renewal_manifest_sha256,
        'packageManifestSha256': package_manifest_sha256,
        'archive': {
            'name': archive['name'],
            'bindingSha256': archive['bindingSha256'],
            'startupEvidenceSha256': archive['startupEvidenceSha256'],
        },
        'identity': {
            'restRoutes': [
                {'path': path, 'methods': list(methods)} for path, methods in ROUTES
            ]
        },
    }


def render_post_renewal_manifest(unit_sha256: str) -> dict[str, object]:
    """Render the post-renewal manifest a fresh preparation pins."""
    if not _is_hash(unit_sha256):
        raise Refused('Gateway unit pin is invalid.')
    return {
        'version': 1,
        'files': {'managed-gateway.service': unit_sha256},
    }


def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true', required=True)
    parsed = parser.parse_args(arguments)
    try:
        validate_preflight()
    except (OSError, RuntimeError, TypeError):
        print('Funding gateway transition preflight refused; no activation occurred.', file=sys.stderr)
        return 1
    if parsed.check:
        print('Funding gateway transition preflight passed; no activation occurred.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))

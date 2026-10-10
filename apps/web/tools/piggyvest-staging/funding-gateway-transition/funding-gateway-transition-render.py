#!/usr/bin/env python3
"""Provenance and owner-input renderers for the gateway transition candidate."""

import importlib.util
import json
import sys
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
_validate = _load_sibling('validate')
Refused = _paths.Refused
_is_hash = _paths._is_hash
DEADLINE = _validate.DEADLINE
ROUTES = _validate.ROUTES

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



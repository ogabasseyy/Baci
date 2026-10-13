#!/usr/bin/env python3
"""Read-only preflight for a fixed-deadline hosted-funding transition."""

import argparse
import importlib.util
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
_render = _load_sibling('render')
_source = _load_sibling('source')

Refused = _paths.Refused
DEADLINE = _validate.DEADLINE
DEADLINE_EPOCH = _validate.DEADLINE_EPOCH
WEEK_SECONDS = _validate.WEEK_SECONDS
ARCHIVE_MODES = _validate.ARCHIVE_MODES
ROUTES = _validate.ROUTES
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
_routes = _validate._routes
_archive_path = _validate._archive_path
_validate_inputs = _validate._validate_inputs
_validate_receipt_chain = _validate._validate_receipt_chain
_validate_post_renewal_manifest = _validate._validate_post_renewal_manifest
_validate_package_manifest = _validate._validate_package_manifest
validate_provenance_target = _validate.validate_provenance_target
validate_preflight = _validate.validate_preflight
render_provenance = _render.render_provenance
render_owner_inputs = _render.render_owner_inputs
render_post_renewal_manifest = _render.render_post_renewal_manifest
collect_transition_source = _source.collect_transition_source

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

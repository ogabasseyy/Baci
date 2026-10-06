#!/usr/bin/env python3
"""Live renewal-state collector for the gateway transition candidate."""

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
Refused = _paths.Refused
STATE_DIRECTORY = _paths.STATE_DIRECTORY
GATEWAY_UNIT_PATH = _paths.GATEWAY_UNIT_PATH
_sha = _paths._sha
_is_hash = _paths._is_hash
_json_file = _paths._json_file
_read_root_file = _paths._read_root_file
ARCHIVE_MODES = _validate.ARCHIVE_MODES

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



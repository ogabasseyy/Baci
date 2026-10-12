#!/usr/bin/env python3
"""Unit installation and pinned update workflow for the funding service candidate."""

import hashlib
import importlib.util
import os
import stat
import sys
from pathlib import Path

def _load_sibling(name: str):
    """Load a focused funding-service module once per process.

    Dash-named siblings cannot use plain imports; every module resolves them
    through this importlib loader with sys.modules singletons so the whole
    graph shares one Refused class and one set of base constants.
    """
    key = f'funding_service_{name}'
    cached = sys.modules.get(key)
    if cached is not None:
        return cached
    spec = importlib.util.spec_from_file_location(
        key, Path(__file__).parent / f'funding-service-{name}.py'
    )
    if spec is None or spec.loader is None:
        raise RuntimeError(f'Funding service {name} module is unavailable.')
    module = importlib.util.module_from_spec(spec)
    sys.modules[key] = module
    spec.loader.exec_module(module)
    return module


_base = _load_sibling('candidate')
_validation = _load_sibling('validation')
_render = _load_sibling('render')
Refused = _base.Refused
UNIT_NAME = _base.UNIT_NAME
DEADLINE_SERVICE_NAME = _base.DEADLINE_SERVICE_NAME
DEADLINE_TIMER_NAME = _base.DEADLINE_TIMER_NAME
UNIT_DIRECTORY = _base.UNIT_DIRECTORY
verify_artifact = _validation.verify_artifact
verify_config_metadata = _validation.verify_config_metadata
verify_unit_directory = _validation.verify_unit_directory
render_unit = _render.render_unit
render_deadline_service = _render.render_deadline_service
render_deadline_timer = _render.render_deadline_timer
PRIOR_UNIT_SHA256 = _render.PRIOR_UNIT_SHA256

def install_unit() -> None:
    if os.geteuid() != 0:
        raise Refused('Owner-reviewed root execution is required.')
    verify_artifact()
    verify_config_metadata()
    verify_unit_directory()
    units = {
        UNIT_NAME: render_unit(),
        DEADLINE_SERVICE_NAME: render_deadline_service(),
        DEADLINE_TIMER_NAME: render_deadline_timer(),
    }
    for name in units:
        target = UNIT_DIRECTORY / name
        if target.exists() or target.is_symlink():
            raise Refused('Funding service unit already exists; refusing overwrite.')
    for name, content in units.items():
        target = UNIT_DIRECTORY / name
        descriptor = os.open(target, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
        with os.fdopen(descriptor, 'w', encoding='utf-8') as handle:
            handle.write(content)
        os.chown(target, 0, 0)
        os.chmod(target, 0o644)


def _remove_stale_update_staging(staging: Path) -> None:
    try:
        metadata = staging.lstat()
    except FileNotFoundError:
        return
    except OSError as error:
        raise Refused('Funding service update staging is unreadable.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_nlink != 1
    ):
        raise Refused('Funding service update staging is unsafe.')
    try:
        staging.unlink()
    except OSError as error:
        raise Refused('Funding service update staging cannot be cleared.') from error


def update_unit() -> str:
    if os.geteuid() != 0:
        raise Refused('Owner-reviewed root execution is required.')
    verify_artifact()
    verify_config_metadata()
    verify_unit_directory()
    target = UNIT_DIRECTORY / UNIT_NAME
    try:
        metadata = target.lstat()
    except OSError as error:
        raise Refused('Funding service unit is required for update.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != 0
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o644
    ):
        raise Refused('Funding service unit permissions are unsafe for update.')
    try:
        existing = target.read_bytes()
    except OSError as error:
        raise Refused('Funding service unit is unreadable for update.') from error
    current = render_unit().encode('utf-8')
    if existing == current:
        return 'already current'
    if hashlib.sha256(existing).hexdigest() != PRIOR_UNIT_SHA256:
        raise Refused('Funding service unit changed outside the candidate; refusing update.')
    staging = UNIT_DIRECTORY / (UNIT_NAME + '.candidate-update')
    _remove_stale_update_staging(staging)
    try:
        descriptor = os.open(staging, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o644)
    except OSError as error:
        raise Refused('Funding service update staging failed.') from error
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(current)
    os.chown(staging, 0, 0)
    os.chmod(staging, 0o644)
    os.replace(staging, target)
    return 'updated'

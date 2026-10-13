#!/usr/bin/env python3
"""Owner-run candidate for an inactive hosted savings funding service."""

import argparse
import importlib.util
import os
import stat
import sys
from pathlib import Path

UNIT_NAME = 'baci-savings-funding.service'
DEADLINE_SERVICE_NAME = 'baci-savings-funding-deadline.service'
DEADLINE_TIMER_NAME = 'baci-savings-funding-deadline.timer'
LEASE_DEADLINE = '2026-09-29 15:59:10 UTC'
LEASE_DEADLINE_EPOCH = '1790697550'
ARTIFACT_ROOT = Path('/opt/baci-savings-funding')
SERVICE_ACCOUNT = 'baci-savings-funding'
SERVICE_GROUP = 'baci-savings-funding'
CONFIG_PATH = Path('/etc/baci/piggyvest-staging/funding-service.env')
DB_CA_PATH = Path('/etc/baci/piggyvest-staging/postgres-ca.pem')
DB_CA_CREDENTIAL = 'PIGGYVEST_SAVINGS_FUNDING_DB_CA'
UNIT_DIRECTORY = Path('/etc/systemd/system')


# Base names stay in this file: install-funding-artifact.py execs this pinned
# candidate standalone from staging (no siblings present) and reads
# ARTIFACT_ROOT plus _verify_root_owned_ancestors. Workers are lazy-loaded
# only by the wrappers and main below, never at import.


class Refused(RuntimeError):
    pass


def _require_safe_path(
    path: Path, expected_type: int, label: str, owner_uid: int = 0
) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused(f'{label} is required.') from error
    if (
        stat.S_IFMT(metadata.st_mode) != expected_type
        or metadata.st_uid != owner_uid
        or metadata.st_mode & 0o022
    ):
        raise Refused(f'{label} is unsafe.')


def _verify_root_owned_ancestors(path: Path, label: str) -> None:
    for ancestor in reversed((path, *path.parents)):
        _require_safe_path(ancestor, stat.S_IFDIR, label)




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


def verify_artifact(root: Path = ARTIFACT_ROOT) -> None:
    _load_sibling('validation').verify_artifact(root)


def verify_config_metadata() -> None:
    _load_sibling('validation').verify_config_metadata()


def verify_unit_directory() -> None:
    _load_sibling('validation').verify_unit_directory()


def render_unit() -> str:
    return _load_sibling('render').render_unit()


def render_deadline_service() -> str:
    return _load_sibling('render').render_deadline_service()


def render_deadline_timer() -> str:
    return _load_sibling('render').render_deadline_timer()


def install_unit() -> None:
    _load_sibling('install').install_unit()


def update_unit() -> str:
    return _load_sibling('install').update_unit()



def main(arguments: list[str]) -> int:
    parser = argparse.ArgumentParser()
    modes = parser.add_mutually_exclusive_group(required=True)
    modes.add_argument('--check', action='store_true')
    modes.add_argument('--install', action='store_true')
    modes.add_argument('--update-unit', action='store_true')
    parsed = parser.parse_args(arguments)
    try:
        verify_artifact()
        verify_config_metadata()
        verify_unit_directory()
        if parsed.install:
            install_unit()
        elif parsed.update_unit:
            print(f'Funding service unit {update_unit()}; no service was started or enabled.')
            return 0
    except (OSError, RuntimeError):
        print('Funding service candidate refused; no service was started or enabled.', file=sys.stderr)
        return 1
    print('Funding service candidate checked; no service was started or enabled.')
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))

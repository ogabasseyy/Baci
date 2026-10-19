#!/usr/bin/env python3
"""Artifact, configuration, and service-identity verification for the funding service candidate."""

import grp
import importlib.util
import os
import pwd
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
Refused = _base.Refused
_require_safe_path = _base._require_safe_path
_verify_root_owned_ancestors = _base._verify_root_owned_ancestors
ARTIFACT_ROOT = _base.ARTIFACT_ROOT
SERVICE_ACCOUNT = _base.SERVICE_ACCOUNT
SERVICE_GROUP = _base.SERVICE_GROUP
CONFIG_PATH = _base.CONFIG_PATH
DB_CA_PATH = _base.DB_CA_PATH
UNIT_DIRECTORY = _base.UNIT_DIRECTORY

def _is_environment_file(path: Path) -> bool:
    return path.name == '.env' or path.name.startswith('.env.')


def _verify_resolved_artifact_path(root: Path, path: Path, owner_uid: int) -> None:
    try:
        relative_path = path.relative_to(root)
    except ValueError as error:
        raise Refused('Funding artifact link escapes the fixed root.') from error
    target_type = stat.S_IFDIR if path.is_dir() else stat.S_IFREG
    for index in range(len(relative_path.parts) + 1):
        ancestor = root.joinpath(*relative_path.parts[:index])
        expected_type = stat.S_IFDIR if ancestor != path else target_type
        _require_safe_path(ancestor, expected_type, 'Funding artifact link target', owner_uid)


def _verify_relative_link(entry: Path, root: Path, owner_uid: int) -> None:
    try:
        target = os.readlink(entry)
    except OSError as error:
        raise Refused('Funding artifact link is unreadable.') from error
    if Path(target).is_absolute():
        raise Refused('Funding artifact link must be relative.')
    lexical_target = Path(os.path.normpath(entry.parent / target))
    try:
        lexical_target.relative_to(root)
    except ValueError as error:
        raise Refused('Funding artifact link escapes the fixed root.') from error
    try:
        resolved = entry.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise Refused('Funding artifact link is dangling or cyclic.') from error
    if _is_environment_file(resolved):
        raise Refused('Funding artifact link targets an environment file.')
    _verify_resolved_artifact_path(root, resolved, owner_uid)


def _verify_artifact_tree(root: Path, owner_uid: int = 0) -> None:
    try:
        resolved_root = root.resolve(strict=True)
    except (OSError, RuntimeError) as error:
        raise Refused('Funding artifact root is unreadable.') from error
    _require_safe_path(resolved_root, stat.S_IFDIR, 'Funding artifact tree', owner_uid)
    for current_root, directories, files in os.walk(resolved_root, followlinks=False):
        current = Path(current_root)
        _require_safe_path(current, stat.S_IFDIR, 'Funding artifact tree', owner_uid)
        for name in (*directories, *files):
            entry = current / name
            try:
                metadata = entry.lstat()
            except OSError as error:
                raise Refused('Funding artifact tree is unreadable.') from error
            if stat.S_ISLNK(metadata.st_mode):
                _verify_relative_link(entry, resolved_root, owner_uid)
                continue
            expected_type = stat.S_IFDIR if name in directories else stat.S_IFREG
            _require_safe_path(entry, expected_type, 'Funding artifact tree', owner_uid)


def _service_identity() -> tuple[int, int]:
    try:
        account = pwd.getpwnam(SERVICE_ACCOUNT)
        group = grp.getgrnam(SERVICE_GROUP)
    except KeyError as error:
        raise Refused('Funding service account and group are required.') from error
    if account.pw_uid == 0 or group.gr_gid == 0:
        raise Refused('Funding service must not run as root.')
    return account.pw_uid, group.gr_gid


def _require_service_access(path: Path, required: int, uid: int, gid: int) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Funding artifact access cannot be verified.') from error
    shift = 6 if metadata.st_uid == uid else 3 if metadata.st_gid == gid else 0
    if ((metadata.st_mode >> shift) & required) != required:
        raise Refused('Funding service cannot read or traverse the artifact.')


def _verify_service_artifact_access(root: Path) -> None:
    uid, gid = _service_identity()
    for ancestor in reversed((root, *root.parents)):
        _require_service_access(ancestor, 0o1, uid, gid)
    for current_root, directories, files in os.walk(root, followlinks=False):
        current = Path(current_root)
        _require_service_access(current, 0o5, uid, gid)
        for name in (*directories, *files):
            entry = current / name
            if entry.is_symlink():
                try:
                    entry = entry.resolve(strict=True)
                except (OSError, RuntimeError) as error:
                    raise Refused('Funding artifact access cannot be verified.') from error
            required = 0o5 if entry.is_dir() else 0o4
            _require_service_access(entry, required, uid, gid)


def verify_artifact(root: Path = ARTIFACT_ROOT) -> None:
    if root != ARTIFACT_ROOT:
        raise Refused('Artifact root must be the fixed funding service path.')
    _verify_root_owned_ancestors(root, 'Funding artifact path')
    _verify_artifact_tree(root)
    _verify_service_artifact_access(root)
    required = (
        root / 'apps/web/server.js',
        root / 'apps/web/public',
        root / 'apps/web/.next/static',
        root / 'node_modules',
    )
    if not required[0].is_file() or not all(path.is_dir() for path in required[1:]):
        raise Refused('Standalone artifact is incomplete.')
    if any(_is_environment_file(path) for path in root.rglob('*')):
        raise Refused('Standalone artifact contains an environment file.')


def _verify_secret_config(path: Path, owner_uid: int = 0) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Root-managed funding configuration is required.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != owner_uid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) not in (0o400, 0o600)
    ):
        raise Refused('Funding configuration permissions are unsafe.')


def _verify_ca_config(path: Path, owner_uid: int = 0) -> None:
    try:
        metadata = path.lstat()
    except OSError as error:
        raise Refused('Root-managed funding CA certificate is required.') from error
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != owner_uid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o444
    ):
        raise Refused('Funding CA certificate permissions are unsafe.')


def verify_config_metadata() -> None:
    _verify_root_owned_ancestors(CONFIG_PATH.parent, 'Funding configuration path')
    _verify_secret_config(CONFIG_PATH)
    _verify_root_owned_ancestors(DB_CA_PATH.parent, 'Funding CA path')
    _verify_ca_config(DB_CA_PATH)


def verify_unit_directory() -> None:
    _verify_root_owned_ancestors(UNIT_DIRECTORY, 'Systemd unit path')

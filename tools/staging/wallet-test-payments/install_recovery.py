import hashlib
import json
import stat
from pathlib import Path
from typing import Callable, Dict, Optional

from install_io import InstallRefused, atomic_write, read_root_file


PHASE_FILE = 'install-phase.json'
ALLOWED_STATE_FILES = {PHASE_FILE, 'nginx-predecessor.conf'}


def service_stopped(exitcode: int, output: str) -> bool:
    fields = dict(line.split('=', 1) for line in output.splitlines() if '=' in line)
    return fields.get('ActiveState') == 'inactive' and (
        (exitcode == 0 and fields.get('LoadState') == 'loaded') or
        (exitcode in (0, 1) and fields.get('LoadState') == 'not-found')
    )


def begin(state: Path, manifest: str, server: bytes, nginx: str) -> None:
    if state.exists() or state.is_symlink():
        raise InstallRefused('Installation state already exists')
    state.mkdir(mode=0o700)
    metadata = state.stat()
    if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise InstallRefused('Installation state is unsafe')
    _write_phase(state, manifest, server, nginx, 'pre-activation')


def mark_gateway_applied(state: Path, manifest: str, server: bytes, nginx: str) -> None:
    _write_phase(state, manifest, server, nginx, 'gateway-applied')


def mark_database_started(state: Path, manifest: str, server: bytes, nginx: str) -> None:
    _write_phase(state, manifest, server, nginx, 'database-started')


def recover_pre_activation(
    state: Path, manifest: str, server: bytes, nginx: str, root: Path,
    units: Dict[Path, bytes], has_topups: Callable[[], bool], stop: Callable[[], None],
) -> bool:
    if not state.exists() and not state.is_symlink():
        return False
    receipt = _read_phase(state)
    if receipt != _receipt(manifest, server, nginx, 'pre-activation'):
        raise InstallRefused('Existing installation requires owner recovery')
    _validate_cleanup_targets(state, root, server, nginx, units)
    if has_topups():
        raise InstallRefused('Existing test top-ups prevent recovery')
    stop()
    for path, expected in units.items():
        _unlink_exact(path, expected)
    if root.exists() or root.is_symlink():
        _unlink_exact(root / 'server.cjs', server)
        if list(root.iterdir()):
            raise InstallRefused('Existing service root is not owned')
        root.rmdir()
    for path in state.iterdir():
        if path.name not in ALLOWED_STATE_FILES or path.is_symlink() or not path.is_file():
            raise InstallRefused('Existing installation state is not owned')
        path.unlink()
    state.rmdir()
    return True


def _validate_cleanup_targets(state: Path, root: Path, server: bytes, nginx: str, units: Dict[Path, bytes]) -> None:
    for path, expected in units.items():
        _validate_exact(path, expected)
    if root.exists() or root.is_symlink():
        _validate_exact(root / 'server.cjs', server)
        if {path.name for path in root.iterdir()} != {'server.cjs'}:
            raise InstallRefused('Existing service root is not owned')
    for path in state.iterdir():
        if path.name not in ALLOWED_STATE_FILES or path.is_symlink() or not path.is_file():
            raise InstallRefused('Existing installation state is not owned')
        if path.name == 'nginx-predecessor.conf' and hashlib.sha256(read_root_file(path)).hexdigest() != nginx:
            raise InstallRefused('Existing Nginx backup does not match')


def _write_phase(state: Path, manifest: str, server: bytes, nginx: str, phase: str) -> None:
    metadata = state.stat()
    if metadata.st_uid != 0 or stat.S_IMODE(metadata.st_mode) != 0o700:
        raise InstallRefused('Installation state is unsafe')
    atomic_write(state / PHASE_FILE, json.dumps(_receipt(manifest, server, nginx, phase), separators=(',', ':')).encode(), metadata, 0o400)


def _read_phase(state: Path) -> object:
    try:
        return json.loads(read_root_file(state / PHASE_FILE, 8192))
    except (json.JSONDecodeError, OSError) as error:
        raise InstallRefused('Installation phase receipt is invalid') from error


def _receipt(manifest: str, server: bytes, nginx: str, phase: str) -> Dict[str, object]:
    return {'version': 1, 'phase': phase, 'manifestSha256': manifest, 'serverSha256': hashlib.sha256(server).hexdigest(), 'nginxSha256': nginx}


def _unlink_exact(path: Path, expected: bytes) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if read_root_file(path, max(len(expected), 1) + 1) != expected:
        raise InstallRefused('Existing owned file does not match')
    path.unlink()


def _validate_exact(path: Path, expected: Optional[bytes]) -> None:
    if not path.exists() and not path.is_symlink():
        return
    if expected is not None and read_root_file(path, max(len(expected), 1) + 1) != expected:
        raise InstallRefused('Existing owned file does not match')

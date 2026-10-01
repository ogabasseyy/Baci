#!/usr/bin/env python3
"""Atomically hand remediation cron work from legacy launchers to the global lock."""

import hashlib
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path

from remediation_cron_transition_crontab import transition_crontab

TARGETS = (
    ('vercel-error-remediator', '*/15 * * * *', '-n'),
    ('sentry-mobile-error-remediator', '*/5 *  * * *', '-n'),
    ('remediation-codex-canary', '22 4   * * *', '-w 600'),
)
BARRIER_FILES = (
    'lib/remediation-global-lock.mjs',
    'lib/remediation-readonly-seccomp.mjs',
    'config/codex-readonly-seccomp.json',
    *(f'jobs/{name}.mjs' for name, _, _ in TARGETS),
)
BLOCK_START = '# >>> baci-remediation-transition >>>'
BLOCK_END = '# <<< baci-remediation-transition <<<'
SAFE_NODE_FLAGS = frozenset({'--no-warnings', '--enable-source-maps', '--trace-warnings'})


class TransitionError(RuntimeError):
    pass


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def read_crontab():
    result = subprocess.run(
        ['crontab', '-l'], check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True
    )
    if result.returncode == 0:
        return True, result.stdout
    if result.returncode == 1 and result.stderr.strip().lower().startswith('no crontab for '):
        return False, ''
    detail = result.stderr.strip() or f'exit status {result.returncode}'
    raise TransitionError(f'unable to read existing crontab: {detail}')


def write_crontab(exists, value):
    if not exists:
        result = subprocess.run(['crontab', '-r'], check=False, stderr=subprocess.PIPE, text=True)
        if result.returncode not in (0, 1):
            raise TransitionError(result.stderr.strip() or 'unable to remove crontab')
        try:
            current_exists, _ = read_crontab()
        except TransitionError as error:
            raise TransitionError(
                f'unable to verify crontab removal: {error}'
            ) from error
        if current_exists:
            raise TransitionError('unable to remove crontab')
        return
    with tempfile.NamedTemporaryFile(mode='w', encoding='utf-8', delete=False) as candidate:
        candidate.write(value)
    try:
        subprocess.run(['crontab', candidate.name], check=True)
    finally:
        os.unlink(candidate.name)


def atomic_copy(source, destination):
    destination.parent.mkdir(parents=True, exist_ok=True)
    descriptor, temporary = tempfile.mkstemp(prefix=f'.{destination.name}.', dir=destination.parent)
    os.close(descriptor)
    try:
        shutil.copy2(source, temporary)
        os.replace(temporary, destination)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def capture_entrypoints(remote_dir, backup_dir):
    captured = {}
    for relative in BARRIER_FILES:
        path = remote_dir / relative
        if path.is_file():
            backup = backup_dir / relative
            backup.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(path, backup)
            captured[relative] = True
        elif path.exists():
            raise TransitionError(f'live barrier path is not a file: {path}')
        else:
            captured[relative] = False
    return captured


def install_barrier(remote_dir, staging_dir, installed):
    for relative in BARRIER_FILES:
        source = staging_dir / relative
        if not source.is_file():
            raise TransitionError(f'staged barrier file is missing: {source}')
        destination = remote_dir / relative
        atomic_copy(source, destination)
        installed[relative] = source.read_bytes()


def restore_entrypoints(remote_dir, backup_dir, captured, installed):
    for relative, expected in installed.items():
        path = remote_dir / relative
        if not path.is_file() or path.read_bytes() != expected:
            raise TransitionError(f'live barrier file changed during rollback: {path}')
    for relative, existed in captured.items():
        destination = remote_dir / relative
        if existed:
            atomic_copy(backup_dir / relative, destination)
        elif destination.exists():
            destination.unlink()


def node_entry_script(arguments):
    for argument in arguments[1:]:
        if argument in SAFE_NODE_FLAGS:
            continue
        if argument.startswith('-'):
            return None
        return argument
    return None


def legacy_processes(remote_dir, proc_root):
    targets = {str((remote_dir / 'jobs' / f'{name}.mjs').resolve()) for name, _, _ in TARGETS}
    relative_targets = {f'jobs/{name}.mjs' for name, _, _ in TARGETS}
    active = []
    try:
        process_entries = list(proc_root.iterdir())
    except OSError as error:
        raise TransitionError(f'unable to inspect /proc for legacy remediation jobs: {error}') from error
    for process in process_entries:
        if not process.name.isdigit():
            continue
        try:
            argv = (process / 'cmdline').read_bytes().split(b'\0')
        except OSError:
            continue
        arguments = [part.decode(errors='surrogateescape') for part in argv if part]
        candidate = any(
            argument in relative_targets
            or (os.path.isabs(argument) and str(Path(argument).resolve()) in targets)
            for argument in arguments[1:]
        )
        if not candidate:
            continue
        try:
            executable = os.path.basename(os.readlink(process / 'exe'))
        except FileNotFoundError:
            continue
        except OSError as error:
            raise TransitionError(
                f'unable to inspect executable for possible legacy remediation process {process.name}: {error}'
            ) from error
        if executable not in {'node', 'nodejs'}:
            continue
        entry = node_entry_script(arguments)
        if entry is None:
            raise TransitionError(f'cannot safely identify possible legacy remediation process {process.name}')
        if os.path.isabs(entry):
            target = str(Path(entry).resolve())
        elif entry.startswith('jobs/'):
            try:
                target = str((Path(os.readlink(process / 'cwd')) / entry).resolve())
            except OSError as error:
                raise TransitionError(
                    f'unable to inspect cwd for possible legacy remediation process {process.name}: {error}'
                ) from error
        else:
            continue
        if target in targets:
            active.append(process.name)
    return active


def wait_for_legacy_processes(remote_dir, proc_root, timeout_seconds):
    deadline = time.monotonic() + timeout_seconds
    while legacy_processes(remote_dir, proc_root):
        if time.monotonic() >= deadline:
            raise TransitionError('legacy direct remediation processes did not drain before crontab rewrite')
        time.sleep(1)


def rollback_crontab(original_exists, original, candidate):
    current_exists, current = read_crontab()
    if current_exists and digest(current) == digest(candidate):
        write_crontab(original_exists, original)
    elif not current_exists and not candidate:
        write_crontab(original_exists, original)
    else:
        raise TransitionError('crontab changed during rollback; refusing to overwrite operator changes')


def main(arguments):
    if len(arguments) != 8:
        raise TransitionError(
            'expected remote_dir staging_dir node_bin codex_image codex_bin timeout proc_root global_lock_path'
        )
    remote_dir, staging_dir, node_bin, codex_image, codex_bin, timeout, proc_root, global_lock_path = arguments
    remote_dir = Path(remote_dir).resolve()
    staging_dir = Path(staging_dir).resolve()
    try:
        timeout_seconds = min(max(int(timeout), 1), 60)
    except ValueError:
        timeout_seconds = 60
    backup_dir = Path(tempfile.mkdtemp(prefix='baci-remediation-entrypoints.'))
    original_exists, original, candidate = False, '', ''
    candidate_installed = False
    installed, captured = {}, {}
    committed = False
    try:
        original_exists, original = read_crontab()
        captured = capture_entrypoints(remote_dir, backup_dir)
        install_barrier(remote_dir, staging_dir, installed)
        wait_for_legacy_processes(remote_dir, Path(proc_root), timeout_seconds)
        candidate = transition_crontab(
            original,
            str(remote_dir),
            node_bin,
            codex_image,
            codex_bin,
            TARGETS,
            BLOCK_START,
            BLOCK_END,
            global_lock_path,
        )
        current_exists, current = read_crontab()
        if current_exists != original_exists or current != original:
            raise TransitionError('crontab changed before replacement; refusing to overwrite operator changes')
        write_crontab(True, candidate)
        candidate_installed = True
        current_exists, current = read_crontab()
        if not current_exists or digest(current) != digest(candidate):
            raise TransitionError('crontab changed before transaction commit')
        committed = True
    finally:
        try:
            if not committed:
                errors = []
                if candidate_installed:
                    try:
                        rollback_crontab(original_exists, original, candidate)
                    except TransitionError as error:
                        errors.append(str(error))
                if installed:
                    try:
                        restore_entrypoints(remote_dir, backup_dir, captured, installed)
                    except TransitionError as error:
                        errors.append(str(error))
                if errors:
                    raise TransitionError('; '.join(errors))
        finally:
            shutil.rmtree(backup_dir, ignore_errors=True)


if __name__ == '__main__':
    try:
        main(sys.argv[1:])
    except (OSError, RuntimeError, subprocess.CalledProcessError) as error:
        print(f'remediation cron transition failed: {error}', file=sys.stderr)
        sys.exit(1)

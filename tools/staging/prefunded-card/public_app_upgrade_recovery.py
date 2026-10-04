import os
from pathlib import Path

from treasury_owner_contract import Refused


def app_state(path, old_files, new_files, verify_app):
    path = Path(path)
    if path.is_symlink():
        raise Refused('Public app symlink state differs')
    if not path.exists():
        return None
    try:
        verify_app(path, old_files)
        return 'old'
    except Refused:
        verify_app(path, new_files)
        return 'new'


def restore_original(root_app, stage_app, backup_app, state, rename):
    root_state = state(root_app)
    stage_state = state(stage_app)
    backup_state = state(backup_app)
    if root_state == 'new' and stage_state is None and backup_state == 'old':
        failed = Path(stage_app).parent / 'failed-app'
        if failed.exists() or failed.is_symlink():
            raise Refused('Existing failed public app retained')
        rename(root_app, failed)
    elif root_state is None and stage_state == 'new' and backup_state == 'old':
        pass
    elif root_state == 'old' and stage_state == 'new' and backup_state is None:
        return
    else:
        raise Refused('Public app recovery state differs')
    rename(backup_app, root_app)


def verify_backup(backup, with_app, old_files, old_archive, old_manifest, old_archive_sha256,
                  old_manifest_sha256, deadline, root_group, metadata, verify_app, exact, parsed, reader):
    backup = Path(backup)
    expected = {'public-app.tar.gz', 'public-app.manifest.json', 'receipt.json'}
    if with_app:
        expected.add('app')
    metadata(backup, 0o700, root_group, directory=True)
    if backup.is_symlink() or {item.name for item in backup.iterdir()} != expected:
        raise Refused('Public rollback backup differs')
    if with_app:
        verify_app(backup / 'app', old_files)
    exact(backup / 'public-app.tar.gz', old_archive, 0o600, root_group)
    exact(backup / 'public-app.manifest.json', old_manifest, 0o600, root_group)
    receipt = parsed(reader(backup / 'receipt.json', 0o600, 65536))
    if (receipt.get('archiveSha256') != old_archive_sha256
            or receipt.get('manifestSha256') != old_manifest_sha256
            or receipt.get('deadline') != deadline):
        raise Refused('Public rollback receipt differs')
    return backup


def prepare_backup(installer, root, old_manifest_sha256, owner, root_group, write_file, sync,
                   read_private, verify_backup):
    backup = Path(root).parent / (Path(root).name + '.app.rollback-' + old_manifest_sha256[:12])
    if backup.exists() or backup.is_symlink():
        return verify_backup(backup, False)
    backup.mkdir(mode=0o700)
    os.chown(backup, owner, root_group)
    write_file(backup / 'public-app.tar.gz', installer.old_archive_content, 0o600)
    write_file(backup / 'public-app.manifest.json', installer.old_manifest_content, 0o600)
    write_file(backup / 'receipt.json', read_private(Path(root) / 'receipt.json', 0o600, 65536), 0o600)
    sync(backup)
    return verify_backup(backup, False)


def recover_runtime(installer):
    try:
        installer.verify_active()
        files, state = installer.new_files, 'new'
    except Refused:
        installer.verify_current()
        files, state = installer.old_files, 'old'
    installer.verify_container(None)
    installer.prove_running(files)
    return {'state': state}

import hashlib
import json
import os
from pathlib import Path
import stat

from release_contract import DEADLINE, digest, pin_read, _require
from runtime_owner_support import DOCKER, command
from public_service_contract import IMAGE, NAME, ROOT, validate_container
from treasury_owner_io import read_file, root_ancestors

ARCHIVE = '882f0fd9d436a8117a48df1ae45bb4dba95d43da2c28b3a7f1d7c7e379cea1b2'
MANIFEST = '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8'
LAUNCHER = 'd0d0a249a940f9783cc2d8784868ca776c65f2e060ca4095736e4fea70b61f03'


def empty_entry(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        metadata = os.fstat(descriptor)
        _require(stat.S_ISREG(metadata.st_mode) and metadata.st_uid == metadata.st_gid == 0
                 and stat.S_IMODE(metadata.st_mode) == 0o444 and metadata.st_nlink == 1
                 and metadata.st_size == 0 and os.read(descriptor, 1) == b'',
                 'owner_public_empty_file_metadata_refused')
        return b''
    finally:
        os.close(descriptor)


def verify(bundle, run=command):
    manifest = json.loads(pin_read(bundle / 'public/public-app.manifest.json', MANIFEST))
    _require(manifest['tarballSha256'] == ARCHIVE, 'owner_public_archive_pin_refused')
    root = Path(ROOT)
    root_ancestors(root)
    receipt = json.loads(read_file(root / 'receipt.json', 0, 0o600, 32768))
    _require(receipt.get('archiveSha256') == ARCHIVE and receipt.get('manifestSha256') == MANIFEST
             and receipt.get('deadline') == DEADLINE and receipt.get('mutationsEnabled') is False
             and receipt.get('approvedBudgetKobo') == 10000
             and receipt.get('preservedPrincipalKobo') == 10000, 'owner_public_receipt_refused')
    for name in ('checkout', 'anon'):
        content = read_file(root / 'config' / (name + '.json'), 0, 0o440, 131072)
        _require(digest(content) == receipt[name + 'Sha256'], 'owner_public_config_pin_refused')
    expected = {row['path']: row for row in manifest['files']}
    app = root / 'app'
    observed = set()
    for path in (app, *sorted(app.rglob('*'))):
        metadata = path.lstat()
        _require(not path.is_symlink() and metadata.st_uid == 0 and metadata.st_gid == 0
                 and not metadata.st_mode & 0o022, 'owner_public_tree_metadata_refused')
        if stat.S_ISDIR(metadata.st_mode):
            continue
        relative = str(path.relative_to(app))
        _require(relative in expected and metadata.st_size == expected[relative]['size'],
                 'owner_public_tree_shape_refused')
        content = empty_entry(path) if metadata.st_size == 0 else read_file(path, 0, 0o444, 64_000_000)
        _require(hashlib.sha256(content).hexdigest() == expected[relative]['sha256'],
                 'owner_public_installed_file_pin_refused')
        observed.add(relative)
    _require(observed == set(expected) and expected['launch-public.cjs']['sha256'] == LAUNCHER,
             'owner_public_file_set_refused')
    image = json.loads(run([*DOCKER, 'image', 'inspect', IMAGE]))[0]
    container = json.loads(run([*DOCKER, 'inspect', NAME]))[0]
    validate_container(container, MANIFEST, image['Config']['Env'])
    _require(container['State']['Running'] is True, 'owner_public_container_not_running')
    return True

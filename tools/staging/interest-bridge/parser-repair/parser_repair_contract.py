import hashlib
import json
import os
from pathlib import Path
import stat


ORIGINAL_DIGEST = 'e880009ae5df7a8827d574a29eaa703a55f9f57c801659e47baa29fd6c130041'
REPAIRED_DIGEST = '78e98bcf19e6e59dad67d53c952b5494b05b0f646af31d2e0aa88270475635ca'
FACTORY_DIGEST = 'de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500'
MANIFEST_DIGEST = 'cf11c95d0724bcc45ac2dd4b0b689322c432ce40c2068d4e18a3a9fbbf734106'
CONFIGURATION_DIGESTS = {
    'config.json': '8b749e91accf23a9c1858793c034713bc3d49970f9079f670cff308b3746a160',
    'prefunded.json': 'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0',
}
ORIGINAL_CATEGORY = b'eventCategory: zod_default.literal("interest-payout"),'
REPAIRED_CATEGORY = b'eventCategory: zod_default.enum(["interest-payout", "interest_payout"]),'
FILES = {
    'replay-cutover-owner.py', 'replay_cutover_runtime.py', 'replay_cutover_installation.py',
    'replay_cutover_sql.py', 'runtime_owner_support.py', 'treasury_owner_contract.py',
    'treasury_owner_io.py', 'evidence-legacy.sql', 'enrollment-owner-candidate.sql',
    'replay-daemon.mjs', 'prefunded-replay-bundle.mjs',
}
DIRECTORY = Path('/opt/baci-prefunded-replay')
HISTORICAL = Path('/root/baci-replay-cutover.hIfMnF6G')
LABEL = 'com.baci.prefunded-replay.sha256'
CONTAINERS = ('pvb-staging-replay-prefunded', 'pvb-staging-replay-prefunded-check')


class Refused(RuntimeError):
    pass


def digest(content):
    return hashlib.sha256(content).hexdigest()


def validate_replacement(original, repaired):
    if digest(original) != ORIGINAL_DIGEST or digest(repaired) != REPAIRED_DIGEST:
        raise Refused('Artifact pin differs')
    if original.count(ORIGINAL_CATEGORY) != 1:
        raise Refused('Original category is not unique')
    if repaired != original.replace(ORIGINAL_CATEGORY, REPAIRED_CATEGORY, 1):
        raise Refused('Replacement is not parser-only')


def validate_metadata(metadata, owner, group, mode):
    if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != owner
            or metadata.st_gid != group or stat.S_IMODE(metadata.st_mode) != mode
            or metadata.st_nlink != 1 or not 0 < metadata.st_size <= 16_000_000):
        raise Refused('File metadata differs')


def check_parents(path):
    for parent in (path.parent, *path.parent.parents):
        metadata = parent.lstat()
        if (not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_mode & 0o022):
            raise Refused('Parent metadata differs')


def read_managed(path, group=0, mode=0o600, expected=None):
    check_parents(path)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        validate_metadata(os.fstat(descriptor), 0, group, mode)
        with os.fdopen(descriptor, 'rb', closefd=False) as handle:
            content = handle.read(16_000_001)
        if len(content) > 16_000_000 or (expected is not None and digest(content) != expected):
            raise Refused('File pin differs')
        return content
    finally:
        os.close(descriptor)


def write_new(path, content, group=0, mode=0o600):
    check_parents(path)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        with os.fdopen(descriptor, 'wb', closefd=False) as handle:
            handle.write(content)
            handle.flush()
            os.fchown(descriptor, 0, group)
            os.fchmod(descriptor, mode)
            os.fsync(descriptor)
    finally:
        os.close(descriptor)


def serialize(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def provenance():
    content = read_managed(HISTORICAL / 'manifest.json', expected=MANIFEST_DIGEST)
    manifest = json.loads(content)
    if (not isinstance(manifest, dict) or set(manifest) != FILES
            or manifest['replay-daemon.mjs'] != ORIGINAL_DIGEST
            or manifest['prefunded-replay-bundle.mjs'] != FACTORY_DIGEST):
        raise Refused('Historical manifest differs')
    contents = {
        name: read_managed(HISTORICAL / name, expected=expected)
        for name, expected in manifest.items()
    }
    return manifest, contents

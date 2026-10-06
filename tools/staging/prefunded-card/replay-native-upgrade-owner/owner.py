import argparse
import fcntl
import os
from pathlib import Path
import re
import subprocess
import tempfile

from owner_deadline import verify_deadline
from owner_io import Refused, ancestors, decode, digest, directory, read, require, serialized, write


HERE = Path(__file__).resolve().parent
MANIFEST = 'b0ac46778810cf5769dbd6c56c52df30ca845dc6a90e4245f1949b5826fc5e11'
BUNDLE = 'b73f5ed97441b8e1941badc340eefee787c43d300bdf033c46174e4e79bab9c4'
OLD_LABEL = 'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086'
OLD_ID = 'b9b35efd2ffb15f7f814903a7da0eedc1b5e277cd93badd0f156afab2eb9be1d'
OLD_ROOT = Path('/opt/baci-prefunded-replay')
GENERATIONS = Path('/opt/baci-prefunded-replay-generations')
PINS = {
    'code/replay-daemon.mjs': '02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457',
    'code/prefunded-replay-bundle.mjs': 'de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500',
    'config/config.json': '968499d8e16c83d7e9cd28c5d35cd380bf8d5dff72445ceda3bb2ab79ad8f980',
    'config/prefunded.json': 'a2356c72a4dbf7e2651c518dc97652733a2699f9321e7a60b848c771cb92a6f0',
}
RUNTIME_PINS = {
    'runtime/replay_cutover_runtime.py': '6a4b282a4324006a1ba44b1b17f1a5b8dff3ce2b8d20135991092b495e6a35aa',
    'runtime/treasury_owner_contract.py': 'ddc7796625f9b421d7c01266e1914607d69e849b3f2da874426492e467a94642',
}
KIT = ('artifact.mjs', 'configuration.mjs', 'constants.mjs', 'contract.mjs', 'upgrade.mjs')
OWNER = ('owner.py', 'owner_io.py', 'owner_runtime.py', 'owner_deadline.py', 'bridge.mjs')
ENVIRONMENT = {'HOME': '/root', 'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LANG': 'C', 'LC_ALL': 'C'}


def command(arguments, timeout=30):
    result = subprocess.run(arguments, stdin=subprocess.DEVNULL, capture_output=True, timeout=timeout, env=ENVIRONMENT)
    require(result.returncode == 0 and len(result.stdout) <= 65_536, 'bounded_command_refused')
    return result.stdout.decode('utf8')


def verify_release(root, expected, reader=read):
    require(re.fullmatch('[a-f0-9]{64}', expected or '') is not None, 'reviewed_release_pin_required')
    release = decode(reader(root / 'release.json', expected, limit=2_000_000))
    require(set(release) == {'schemaVersion', 'artifactManifestSha256', 'files'}
            and release['schemaVersion'] == 1 and release['artifactManifestSha256'] == MANIFEST,
            'release_scope_refused')
    files = release['files']
    required = {'owner/' + name for name in OWNER} | {'kit/' + name for name in KIT} | set(RUNTIME_PINS)
    required |= {'artifact/' + name for name in ('manifest.json', 'metafile.json', 'inventory.json',
                                                'virtual-entry.ts', 'prefunded-replay-bundle.mjs')}
    require(isinstance(files, dict) and required.issubset(files) and 17 <= len(files) <= 4113,
            'release_file_set_refused')
    total = 0
    for relative, pin in files.items():
        require(relative in required or re.fullmatch(r'artifact/captures/[a-f0-9]{64}\.source', relative)
                or relative in ('owner/README.md', 'owner/INTERFACE.md'), 'release_path_refused')
        require(isinstance(pin, str) and re.fullmatch('[a-f0-9]{64}', pin), 'release_file_pin_refused')
        if reader is read:
            ancestors(root / relative)
        total += len(reader(root / relative, pin))
    require(total <= 64_000_000, 'release_size_refused')
    for relative, pin in RUNTIME_PINS.items():
        require(files[relative] == pin, 'runtime_validator_pin_refused')
    manifest = decode(reader(root / 'artifact/manifest.json', MANIFEST))
    require(files['artifact/manifest.json'] == MANIFEST
            and files['artifact/prefunded-replay-bundle.mjs'] == BUNDLE, 'reviewed_artifact_pin_refused')
    for name in KIT:
        absolute = '/Users/mac/Baci-worktrees/cursor-savings-phase1/tools/staging/prefunded-card/replay-native-upgrade/' + name
        require(manifest['observed'][absolute]['beforeSha256'] == files['kit/' + name]
                == manifest['observed'][absolute]['afterSha256'], 'kit_source_closure_refused')
    return release


def verify_tree(root, pins, reader=read):
    for filename in (root, root / 'code', root / 'config'):
        directory(filename)
        info = filename.lstat()
        require(info.st_gid == 65532 and info.st_mode & 0o777 == 0o750, 'runtime_directory_metadata_refused')
    for section in ('code', 'config'):
        require({str(filename.relative_to(root)) for filename in (root / section).iterdir()}
                == {name for name in pins if name.startswith(section + '/')}, 'runtime_tree_set_refused')
    for relative, pin in pins.items():
        mode = 0o440 if relative.startswith('config/') else 0o644
        reader(root / relative, pin, modes=(mode,))
        require((root / relative).lstat().st_gid == 65532, 'runtime_file_group_refused')


def stage(root, release_sha, original, run=command):
    filename = Path(tempfile.mkdtemp(prefix='native-', dir=GENERATIONS))
    os.chown(filename, 0, 65532)
    os.chmod(filename, 0o750)
    for section in ('code', 'config'):
        (filename / section).mkdir(mode=0o750)
        os.chown(filename / section, 0, 65532)
        os.chmod(filename / section, 0o750)
    metadata = decode(run(['/usr/bin/node', str(HERE / 'bridge.mjs'), str(root / 'artifact'),
                          MANIFEST, str(OLD_ROOT), str(filename)], timeout=45).encode())
    require(set(metadata) == {'artifactManifestSha256', 'bundleSha256', 'files'}
            and metadata['artifactManifestSha256'] == MANIFEST and metadata['bundleSha256'] == BUNDLE
            and set(metadata['files']) == set(PINS)
            and metadata['files']['code/replay-daemon.mjs'] == PINS['code/replay-daemon.mjs']
            and metadata['files']['config/prefunded.json'] == PINS['config/prefunded.json'], 'derived_generation_refused')
    for relative in metadata['files']:
        mode = 0o440 if relative.startswith('config/') else 0o644
        os.chown(filename / relative, 0, 65532)
        os.chmod(filename / relative, mode)
    verify_tree(filename, metadata['files'])
    seal = {'schemaVersion': 1, 'status': 'staged-inactive', 'deadline': '2026-10-06T15:59:10Z',
            'helperReleaseSha256': release_sha, 'artifactManifestSha256': MANIFEST, 'bundleSha256': BUNDLE,
            'originalContainerId': original['Id'], 'originalRunning': original['State']['Running'],
            'predecessorLabel': OLD_LABEL, 'predecessorFiles': PINS, 'generation': str(filename),
            'files': metadata['files'], 'sqlAuthorityChanged': False, 'receiptCreditProved': False}
    seal_bytes = serialized(seal)
    write(filename / 'generation.json', seal_bytes)
    return filename, digest(seal_bytes), seal


def execute(root, release_sha, apply=False):
    ancestors(root / 'release.json')
    verify_release(root, release_sha)
    verify_tree(OLD_ROOT, PINS)
    verify_deadline(command)
    from owner_runtime import DockerRuntime, runtime
    operator = DockerRuntime(command, lambda: verify_deadline(command))
    require(operator.find(runtime.CONTAINER) == OLD_ID, 'exact_original_container_id_refused')
    original = operator.inspect(OLD_ID, str(OLD_ROOT), OLD_LABEL, name=runtime.CONTAINER)
    require(type(original['State']['Running']) is bool and original['State']['ExitCode'] == 0
            and original['State']['OOMKilled'] is False, 'original_current_state_refused')
    operator.deadline = lambda: verify_deadline(command, require_active=original['State']['Running'])
    generation, label, seal = stage(root, release_sha, original)
    def verify_generation():
        require(read(generation / 'generation.json', label) == serialized(seal), 'generation_seal_refused')
        verify_tree(generation, seal['files'])
        verify_tree(OLD_ROOT, PINS)
    verify_generation()
    operator.check(str(generation), label)
    verify_generation()
    result = {'status': 'staged-read-only-check-ready', 'generation': str(generation),
              'generationSealSha256': label, 'originalRunning': original['State']['Running'],
              'receiptCreditProved': False, 'providerPostCalled': False}
    if apply:
        result.update(operator.swap(str(OLD_ROOT), OLD_LABEL, str(generation), label, verify_generation,
                                    expected_original=(OLD_ID, original['State']['Running'])))
        result['status'] = 'swapped-running' if original['State']['Running'] else 'swapped-stopped'
    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--release-sha', required=True)
    parser.add_argument('--apply', action='store_true')
    arguments = parser.parse_args()
    require(os.geteuid() == 0 and HERE.name == 'owner' and HERE.parent.parent == Path('/root')
            and re.fullmatch(r'baci-replay-native-owner\.[A-Za-z0-9]+', HERE.parent.name), 'root_private_extraction_required')
    ancestors(GENERATIONS)
    if not GENERATIONS.exists():
        GENERATIONS.mkdir(mode=0o750)
        os.chown(GENERATIONS, 0, 65532)
    directory(GENERATIONS)
    descriptor = os.open(GENERATIONS / 'upgrade.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        info = os.fstat(handle.fileno())
        require(info.st_uid == 0 and info.st_nlink == 1 and info.st_mode & 0o777 == 0o600, 'upgrade_lock_metadata_refused')
        fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        print(serialized(execute(HERE.parent, arguments.release_sha, arguments.apply)).decode())


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        code = str(error) if isinstance(error, Refused) and re.fullmatch('[a-z0-9_]+', str(error)) else 'owner_preparation_or_swap_refused'
        print(serialized({'status': 'refused', 'code': code, 'receiptCreditProved': False}).decode())
        raise SystemExit(1) from None

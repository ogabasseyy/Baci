import argparse
import hashlib
import importlib.util
import json
from pathlib import Path
import shlex
from treasury_owner_io import write_private


SOURCE = Path(__file__).parent
SPEC = importlib.util.spec_from_file_location('runtime_owner', SOURCE / 'runtime-preparation-owner.py')
OWNER = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(OWNER)
REMOTE = '/home/bassey/baci-runtime-preparation-20260927-r3'
DIAGNOSTIC_REMOTE = '/home/bassey/baci-runtime-diagnostic-20260927'
READINESS_SHA256 = 'b8c01f0195820b7a7aed9c2093ec3bb7c6528251d4f5a954fdb1acac18ba0540'


def build_package(compiled, destination, diagnostic_only=False):
    compiled_content = Path(compiled).read_bytes()
    if hashlib.sha256(compiled_content).hexdigest() != READINESS_SHA256:
        raise ValueError('Reviewed runtime readiness artifact checksum differs')
    names = ('runtime-readiness-cli.cjs',) if diagnostic_only else OWNER.FILES
    remote = DIAGNOSTIC_REMOTE if diagnostic_only else REMOTE
    execution = ('/usr/bin/node "$root_dir/runtime-readiness-cli.cjs" --connect '
                 '/etc/baci/prefunded-card/activation.prepared.json' if diagnostic_only else
                 '/usr/bin/python3 -B "$root_dir/runtime-preparation-owner.py"\nprintf \'RESTRICTED_RUNTIME_PREPARED\\n\'')
    files = {name: compiled_content if name == 'runtime-readiness-cli.cjs' else (SOURCE / name).read_bytes()
             for name in names}
    if any(not 0 < len(content) <= 12_000_000 for content in files.values()):
        raise ValueError('Runtime bundle file size refused')
    manifest = {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}
    files['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n' for name, content in sorted(files.items())).encode()
    sums_digest = hashlib.sha256(sums).hexdigest()
    runner = f'''#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# = 0 && $(/usr/bin/id -u) = 0 ]]
root_dir="$(cd "$(dirname "$0")" && pwd -P)"
case "$root_dir" in /root/baci-runtime-preparation.*) ;; *) exit 1;; esac
cd "$root_dir"
source_dir={shlex.quote(remote)}
for name in SHA256SUMS {' '.join(sorted(files))}; do
  [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" ]]
  [[ $(/usr/bin/stat -c %s "$source_dir/$name") -le 12000000 ]]
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
printf '%s  SHA256SUMS\\n' '{sums_digest}' | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
{execution}
'''.encode()
    digest = hashlib.sha256(runner).hexdigest()
    inner = ('set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-runtime-preparation.XXXXXXXX); '
             f'/usr/bin/install -o root -g root -m 0600 {remote}/run-reviewed.sh "$root_dir/run-reviewed.sh"; '
             f"printf '%s  %s\\n' {digest} \"$root_dir/run-reviewed.sh\" | /usr/bin/sha256sum -c -; "
             'exec /bin/bash "$root_dir/run-reviewed.sh"')
    command = ('sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C '
               '/bin/bash -c ' + shlex.quote(inner))
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    for name, content in {**files, 'SHA256SUMS': sums, 'run-reviewed.sh': runner,
                          'owner-command.txt': (command + '\n').encode()}.items():
        write_private(destination / name, content)
    return dict(directory=str(destination), remoteDirectory=remote, runnerSha256=digest,
                checksumListSha256=sums_digest, ownerCommand=command)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--compiled', required=True)
    parser.add_argument('--destination', required=True)
    parser.add_argument('--diagnostic-only', action='store_true')
    arguments = parser.parse_args()
    print(json.dumps(build_package(arguments.compiled, arguments.destination, arguments.diagnostic_only)))

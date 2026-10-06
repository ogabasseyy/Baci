import argparse
import hashlib
import json
from pathlib import Path
import shlex
from runtime_worker_installation import FILES
from runtime_scheduler import background_wrapper
from treasury_owner_io import write_private


SOURCE = Path(__file__).parent
REMOTE = '/home/bassey/baci-prefunded-workers-20260927'
REVIEWED_OUTPUTS = {
    'background.cjs': '3619c9b637ab4d60e7379c5d2d902fa273e93e86b42ff1ce67481800a5409ec3',
    'snapshot.cjs': 'e702ff351f938958e6b8fd271deabc212cea0d92c9b3db283b64415322942355',
    'readiness.cjs': '1900adbea9de109b17638dc13915a7c24f3b867d3d756b84a2597e1466beae82',
}


def build_package(artifact, destination):
    artifact = Path(artifact)
    outputs = json.loads((artifact / 'artifact.manifest.json').read_bytes())['outputs']
    if outputs != REVIEWED_OUTPUTS:
        raise ValueError('Reviewed worker artifact outputs differ')
    compiled = {name: (artifact / name).read_bytes() for name in outputs}
    if any(hashlib.sha256(content).hexdigest() != outputs[name] for name, content in compiled.items()):
        raise ValueError('Worker artifact checksum differs')
    generated = {**compiled, 'background.sh': background_wrapper().encode()}
    files = {name: generated[name] if name in generated else (SOURCE / name).read_bytes() for name in FILES}
    if any(not 0 < len(content) <= 16_000_000 for content in files.values()):
        raise ValueError('Worker package size refused')
    files['manifest.json'] = json.dumps({name: hashlib.sha256(content).hexdigest()
                                        for name, content in files.items()}, sort_keys=True).encode()
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n' for name, content in sorted(files.items())).encode()
    sums_digest = hashlib.sha256(sums).hexdigest()
    runner = f'''#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# = 0 && $(/usr/bin/id -u) = 0 ]]
root_dir="$(cd "$(dirname "$0")" && pwd -P)"
case "$root_dir" in /root/baci-prefunded-workers.*) ;; *) exit 1;; esac
cd "$root_dir"
source_dir={shlex.quote(REMOTE)}
for name in SHA256SUMS {' '.join(sorted(files))}; do
  [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" ]]
  [[ $(/usr/bin/stat -c %s "$source_dir/$name") -le 16000000 ]]
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
printf '%s  SHA256SUMS\\n' '{sums_digest}' | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/python3 -B "$root_dir/runtime-workers-owner.py"
printf 'PREFUNDED_WORKERS_SCHEDULED\\n'
'''.encode()
    digest = hashlib.sha256(runner).hexdigest()
    inner = ('set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-prefunded-workers.XXXXXXXX); '
             f'/usr/bin/install -o root -g root -m 0600 {REMOTE}/run-reviewed.sh "$root_dir/run-reviewed.sh"; '
             f"printf '%s  %s\\n' {digest} \"$root_dir/run-reviewed.sh\" | /usr/bin/sha256sum -c -; "
             'exec /bin/bash "$root_dir/run-reviewed.sh"')
    command = ('sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C '
               '/bin/bash -c ' + shlex.quote(inner))
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    for name, content in {**files, 'SHA256SUMS': sums, 'run-reviewed.sh': runner,
                          'owner-command.txt': (command + '\n').encode()}.items():
        write_private(destination / name, content)
    return dict(directory=str(destination), remoteDirectory=REMOTE, runnerSha256=digest,
                checksumListSha256=sums_digest, ownerCommand=command)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact', required=True)
    parser.add_argument('--destination', required=True)
    arguments = parser.parse_args()
    print(json.dumps(build_package(arguments.artifact, arguments.destination)))

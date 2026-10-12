import argparse
import hashlib
import json
from pathlib import Path
import shlex
from replay_cutover_installation import FILES
from treasury_owner_io import write_private


SOURCE = Path(__file__).parent
REMOTE = '/home/bassey/baci-replay-cutover-20260927'
REVIEWED_OUTPUTS = {
    'replay-daemon.mjs': 'e880009ae5df7a8827d574a29eaa703a55f9f57c801659e47baa29fd6c130041',
    'prefunded-replay-bundle.mjs': 'de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500',
}


def build_package(artifact, destination):
    artifact = Path(artifact)
    outputs = json.loads((artifact / 'replay-artifact.manifest.json').read_bytes())['outputs']
    expected = {'replay-daemon.mjs', 'prefunded-replay-bundle.mjs'}
    if set(outputs) != expected or outputs != REVIEWED_OUTPUTS:
        raise ValueError('Replay artifact outputs differ')
    compiled = {name: (artifact / name).read_bytes() for name in expected}
    if any(hashlib.sha256(content).hexdigest() != outputs[name] for name, content in compiled.items()):
        raise ValueError('Replay artifact checksum differs')
    files = {name: compiled[name] if name in compiled else (SOURCE / name).read_bytes() for name in FILES}
    if any(not 0 < len(content) <= 16_000_000 for content in files.values()):
        raise ValueError('Replay package input size refused')
    manifest = {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}
    files['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n' for name, content in sorted(files.items())).encode()
    sums_digest = hashlib.sha256(sums).hexdigest()
    runner = f'''#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# = 0 && $(/usr/bin/id -u) = 0 ]]
root_dir="$(cd "$(dirname "$0")" && pwd -P)"
case "$root_dir" in /root/baci-replay-cutover.*) ;; *) exit 1;; esac
cd "$root_dir"
source_dir={shlex.quote(REMOTE)}
for name in SHA256SUMS {' '.join(sorted(files))}; do
  [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" ]]
  [[ $(/usr/bin/stat -c %s "$source_dir/$name") -le 16000000 ]]
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
printf '%s  SHA256SUMS\\n' '{sums_digest}' | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/python3 -B "$root_dir/replay-cutover-owner.py"
printf 'SIGNED_REPLAY_ENROLLED\\n'
'''.encode()
    digest = hashlib.sha256(runner).hexdigest()
    inner = ('set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-replay-cutover.XXXXXXXX); '
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

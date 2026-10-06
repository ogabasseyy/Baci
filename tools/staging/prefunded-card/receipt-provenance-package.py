import argparse
import hashlib
import json
from pathlib import Path
import shlex
from receipt_provenance_contract import FILES
from treasury_owner_io import write_private


SOURCE = Path(__file__).parent
REMOTE = '/home/bassey/baci-receipt-provenance-20260927-r2'


def build_package(compiled, receipt_sql, destination):
    external = {'intake-server.mjs': Path(compiled), 'receipt-signature-storage.sql': Path(receipt_sql)}
    files = {name: (external.get(name) or SOURCE / name).read_bytes() for name in FILES}
    if any(not 0 < len(content) <= 12_000_000 for content in files.values()):
        raise ValueError('Invalid receipt artifact size')
    manifest = {name: hashlib.sha256(content).hexdigest() for name, content in files.items()}
    files['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n' for name, content in sorted(files.items())).encode()
    sums_digest = hashlib.sha256(sums).hexdigest()
    runner = f'''#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# = 0 && $(/usr/bin/id -u) = 0 ]]
root_dir="$(cd "$(dirname "$0")" && pwd -P)"
case "$root_dir" in /root/baci-receipt-provenance.*) ;; *) exit 1;; esac
cd "$root_dir"
source_dir={shlex.quote(REMOTE)}
for name in SHA256SUMS {' '.join(sorted(files))}; do
  [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" ]]
  [[ $(/usr/bin/stat -c %s "$source_dir/$name") -le 12000000 ]]
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
printf '%s  SHA256SUMS\\n' '{sums_digest}' | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/python3 -B "$root_dir/receipt-provenance-owner.py"
printf 'RECEIPT_SIGNATURE_CAPTURE_READY\\n'
'''.encode()
    digest = hashlib.sha256(runner).hexdigest()
    inner = ('set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-receipt-provenance.XXXXXXXX); '
             f'/usr/bin/install -o root -g root -m 0600 {REMOTE}/run-reviewed.sh "$root_dir/run-reviewed.sh"; '
             f"printf '%s  %s\\n' {digest} \"$root_dir/run-reviewed.sh\" | /usr/bin/sha256sum -c -; "
             'exec /bin/bash "$root_dir/run-reviewed.sh"')
    command = ('sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C '
               '/bin/bash -c ' + shlex.quote(inner) + '\n')
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    for name, content in {**files, 'SHA256SUMS': sums, 'run-reviewed.sh': runner,
                          'owner-command.txt': command.encode()}.items():
        write_private(destination / name, content)
    return dict(directory=str(destination), remoteDirectory=REMOTE, runnerSha256=digest,
                checksumListSha256=sums_digest)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--compiled', required=True)
    parser.add_argument('--receipt-sql', required=True)
    parser.add_argument('--destination', required=True)
    arguments = parser.parse_args()
    print(json.dumps(build_package(arguments.compiled, arguments.receipt_sql, arguments.destination)))

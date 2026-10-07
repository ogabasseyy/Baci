import argparse
import ast
import hashlib
import json
from pathlib import Path
import shlex

from checkout_retirement_patches import PATCHES
from public_app_upgrade import OLD_ARCHIVE_SHA256, OLD_MANIFEST_SHA256
from public_artifact import validate_archive
from treasury_owner_contract import DEADLINE
from treasury_owner_io import write_private


SOURCE = Path(__file__).resolve().parent
ARTIFACTS = ('old-public-app.tar.gz', 'old-public-app.manifest.json',
             'public-app.tar.gz', 'public-app.manifest.json', 'pins.json')


def modules(source):
    pending = ['checkout_retirement_owner.py']
    files = {}
    while pending:
        name = pending.pop()
        if name in files:
            continue
        path = source / name
        if path.is_symlink() or not path.is_file():
            raise ValueError('Bundle module is not a regular file')
        content = path.read_bytes()
        if not 0 < len(content) < 1_000_000:
            raise ValueError('Bundle module size differs')
        files[name] = content
        for node in ast.walk(ast.parse(content)):
            imports = ([node.module] if isinstance(node, ast.ImportFrom) else
                       [item.name for item in node.names] if isinstance(node, ast.Import) else [])
            for module in imports:
                if module and '.' not in module and (source / (module + '.py')).exists():
                    pending.append(module + '.py')
    return files


def build_package(artifacts, destination):
    artifacts = Path(artifacts)
    if any((artifacts / name).is_symlink() or not (artifacts / name).is_file() for name in ARTIFACTS):
        raise ValueError('Public upgrade artifact missing or unsafe')
    compiled = {name: (artifacts / name).read_bytes() for name in ARTIFACTS}
    pins = json.loads(compiled['pins.json'])
    if (set(pins) != {'oldArchiveSha256', 'oldManifestSha256', 'archiveSha256', 'manifestSha256', 'deadline'}
            or pins['oldArchiveSha256'] != OLD_ARCHIVE_SHA256
            or pins['oldManifestSha256'] != OLD_MANIFEST_SHA256 or pins['deadline'] != DEADLINE):
        raise ValueError('Public upgrade approval pins differ')
    validate_archive(compiled['old-public-app.tar.gz'], compiled['old-public-app.manifest.json'],
                     OLD_ARCHIVE_SHA256, OLD_MANIFEST_SHA256)
    validate_archive(compiled['public-app.tar.gz'], compiled['public-app.manifest.json'],
                     pins['archiveSha256'], pins['manifestSha256'])
    sql = {item[0] for item in PATCHES} | {'checkout-retirement-storage.sql', 'checkout-retirement-apply.sql'}
    files = {**modules(SOURCE), **compiled, **{name: (SOURCE / name).read_bytes() for name in sql}}
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n'
                   for name, content in sorted(files.items())).encode()
    sums_digest = hashlib.sha256(sums).hexdigest()
    remote = '/home/bassey/baci-checkout-retirement-20260929-' + sums_digest[:12]
    runner = f'''#!/usr/bin/env bash
set -euo pipefail
umask 077
[[ $# = 0 && $(/usr/bin/id -u) = 0 ]]
root_dir="$(cd "$(dirname "$0")" && pwd -P)"
case "$root_dir" in /root/baci-checkout-retirement.*) ;; *) exit 1;; esac
cd "$root_dir"
source_dir={shlex.quote(remote)}
for name in SHA256SUMS {' '.join(sorted(files))}; do
  [[ -f "$source_dir/$name" && ! -L "$source_dir/$name" ]]
  [[ $(/usr/bin/stat -c %s "$source_dir/$name") -le 268435456 ]]
  /usr/bin/install -o root -g root -m 0600 "$source_dir/$name" "$root_dir/$name"
done
printf '%s  SHA256SUMS\\n' '{sums_digest}' | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/python3 -I -B -c 'import sys; sys.path.insert(0, sys.argv[1]); from checkout_retirement_owner import main; main()' "$root_dir"
'''.encode()
    runner_digest = hashlib.sha256(runner).hexdigest()
    inner = ('set -euo pipefail; umask 077; root_dir=$(/usr/bin/mktemp -d /root/baci-checkout-retirement.XXXXXXXX); '
             f'/usr/bin/install -o root -g root -m 0600 {remote}/run-reviewed.sh "$root_dir/run-reviewed.sh"; '
             f"printf '%s  %s\\n' {runner_digest} \"$root_dir/run-reviewed.sh\" | /usr/bin/sha256sum -c -; "
             'exec /bin/bash "$root_dir/run-reviewed.sh"')
    command = ('sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C '
               '/bin/bash -c ' + shlex.quote(inner))
    launcher = ('#!/bin/sh\nset -eu\nexec /usr/bin/ssh -t -o ServerAliveInterval=15 -o ConnectTimeout=15 '
                'bassey@82.29.190.219 ' + shlex.quote(command) + '\n').encode()
    destination = Path(destination)
    destination.mkdir(mode=0o700, exist_ok=False)
    for name, content in {**files, 'SHA256SUMS': sums, 'run-reviewed.sh': runner,
                          'owner-command.txt': (command + '\n').encode(), 'activation-retire-checkout.sh': launcher}.items():
        write_private(destination / name, content)
    return dict(directory=str(destination), remoteDirectory=remote, runnerSha256=runner_digest,
                checksumListSha256=sums_digest, payloadFiles=len(files))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifacts', required=True)
    parser.add_argument('--destination', required=True)
    arguments = parser.parse_args()
    print(json.dumps(build_package(arguments.artifacts, arguments.destination)))

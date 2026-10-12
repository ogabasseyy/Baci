import argparse
import hashlib
import json
import os
from pathlib import Path


SQL_FILES = (
    'legacy-enrollment-candidate.sql',
    'legacy-enrollment-scope-preflight.sql',
    'legacy-enrollment-preflight.sql',
)
PYTHON_FILES = ('legacy-history-owner.py', 'legacy_history_owner_proof.py', 'legacy_history_owner_diagnostic.py')
OWNER_SCRIPT = '''#!/usr/bin/env bash
set -euo pipefail
if (($# != 0)); then exit 64; fi
readonly source_dir="$(cd "$(dirname "$0")" && pwd -P)"
readonly sums_digest='__SUMS_DIGEST__'
cd "$source_dir"
printf '%s  SHA256SUMS\\n' "$sums_digest" | /usr/bin/sha256sum -c -
/usr/bin/sha256sum -c SHA256SUMS
sudo /usr/bin/env -i HOME=/root PATH=/usr/sbin:/usr/bin:/sbin:/bin LANG=C LC_ALL=C \\
  /bin/bash -s -- "$source_dir" "$sums_digest" <<'OWNER'
set -euo pipefail
umask 077
source_dir="$1"
sums_digest="$2"
root_stage="$(/usr/bin/mktemp -d /root/baci-legacy-migration.XXXXXXXX)"
/usr/bin/install -m 0600 "$source_dir/SHA256SUMS" "$root_stage/SHA256SUMS"
cd "$root_stage"
printf '%s  SHA256SUMS\\n' "$sums_digest" | /usr/bin/sha256sum -c -
for filename in __ALL_FILES__; do
  /usr/bin/install -m 0600 "$source_dir/$filename" "$root_stage/$filename"
done
/usr/bin/sha256sum -c SHA256SUMS
/usr/bin/mkdir -m 0700 "$root_stage/sql" "$root_stage/runtime"
for filename in __SQL_FILES__ manifest.json; do
  /usr/bin/mv "$root_stage/$filename" "$root_stage/sql/$filename"
done
for filename in __RUNTIME_FILES__; do
  /usr/bin/mv "$root_stage/$filename" "$root_stage/runtime/$filename"
done
/usr/bin/node "$root_stage/runtime/legacy-history.mjs" --owner-read-only
/usr/bin/python3 "$root_stage/runtime/legacy-history-owner.py" \\
  --bundle-dir "$root_stage/sql" --proof "$root_stage/runtime/legacy-proof.json" --check
/usr/bin/python3 "$root_stage/runtime/legacy-history-owner.py" \\
  --bundle-dir "$root_stage/sql" --proof "$root_stage/runtime/legacy-proof.json" --apply
/usr/bin/python3 "$root_stage/runtime/legacy-history-owner.py" \\
  --bundle-dir "$root_stage/sql" --proof "$root_stage/runtime/legacy-proof.json" --apply
printf 'Audit files retained: %s\\n' "$root_stage"
printf 'LEGACY_PLAN_MIGRATED\\n'
OWNER
'''


def write_new(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(content)


def build_package(source, collector, destination):
    source = Path(source)
    destination = Path(destination)
    files = {name: (source / name).read_bytes() for name in (*SQL_FILES, *PYTHON_FILES)}
    files['legacy-history.mjs'] = Path(collector).read_bytes()
    if any(not content for content in files.values()):
        raise ValueError('Empty package input')
    manifest = {
        'schemaVersion': 1,
        'container': 'baci-isolated-savings-db-1',
        'database': 'postgres',
        'systemIdentifier': '7685292944002592802',
        'deadline': '2026-09-29T15:59:10Z',
        'files': {name: hashlib.sha256(files[name]).hexdigest() for name in SQL_FILES},
    }
    files['manifest.json'] = json.dumps(manifest, sort_keys=True).encode()
    sums = ''.join(f'{hashlib.sha256(content).hexdigest()}  {name}\n'
                   for name, content in sorted(files.items())).encode()
    script = OWNER_SCRIPT.replace('__SUMS_DIGEST__', hashlib.sha256(sums).hexdigest())
    script = script.replace('__ALL_FILES__', ' '.join(sorted(files)))
    script = script.replace('__SQL_FILES__', ' '.join(SQL_FILES))
    script = script.replace('__RUNTIME_FILES__', ' '.join((*PYTHON_FILES, 'legacy-history.mjs')))
    destination.mkdir(mode=0o700, parents=False, exist_ok=False)
    for name, content in files.items():
        write_new(destination / name, content)
    write_new(destination / 'SHA256SUMS', sums)
    write_new(destination / 'run-reviewed.sh', script.encode())
    return {'directory': str(destination), 'files': len(files),
            'scriptSha256': hashlib.sha256(script.encode()).hexdigest(),
            'checksumsSha256': hashlib.sha256(sums).hexdigest()}


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--collector', required=True)
    parser.add_argument('--destination', required=True)
    arguments = parser.parse_args()
    print(json.dumps(build_package(Path(__file__).parent, arguments.collector, arguments.destination)))

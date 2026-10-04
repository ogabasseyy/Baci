import argparse
import json
import shutil
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE.parent / 'card-week-renewal'))

from release_contract import Refused, digest, _json, _require
from snapshot_binding_sql import collect_sql, render
from source_functions import APP_SYSTEM

from runtime_owner_support import database
from treasury_owner_io import private_directory, read_file, root_ancestors, write_private


def collect(output):
    import os
    _require(os.geteuid() == 0, 'snapshot_binding_root_required')
    root_ancestors(output.parent)
    private_directory(output.parent)
    _require(not output.exists() and not output.is_symlink(), 'snapshot_binding_output_exists')
    baseline = _json(database(collect_sql().decode()).encode())
    _require(baseline.get('readOnly') is True and baseline.get('systemIdentifier') == APP_SYSTEM,
             'snapshot_binding_collection_identity_refused')
    write_private(output, json.dumps(baseline, sort_keys=True, separators=(',', ':')).encode())
    return {'status': 'snapshot-binding-collected', 'readOnly': True,
            'baselineSha256': digest(output.read_bytes()), 'changesApplied': False}


def candidate(baseline_path, repository, output):
    import os
    _require(os.geteuid() == 0, 'snapshot_binding_root_required')
    root_ancestors(baseline_path)
    root_ancestors(output.parent)
    private_directory(output.parent)
    _require(not output.exists() and not output.is_symlink(), 'snapshot_binding_output_exists')
    baseline_bytes = read_file(baseline_path, 0, 0o600, 65536)
    baseline = _json(baseline_bytes)
    rehearsal = render(baseline, repository, rehearsal=True)
    commit = render(baseline, repository, rehearsal=False)
    manifest = {'status': 'snapshot-binding-expiry-renewal-prepared',
        'baselineSha256': digest(baseline_bytes), 'rehearsalSqlSha256': digest(rehearsal),
        'commitSqlSha256': digest(commit), 'changesApplied': False,
        'mutationsEnabled': False, 'newPaymentStarted': False}
    output.mkdir(mode=0o700)
    try:
        write_private(output / 'rehearsal.sql', rehearsal)
        write_private(output / 'commit.sql', commit)
        write_private(output / 'candidate.json', json.dumps(manifest, sort_keys=True).encode())
    except BaseException:
        shutil.rmtree(output)
        raise
    return manifest


def main(argv=None):
    parser = argparse.ArgumentParser()
    commands = parser.add_subparsers(dest='command', required=True)
    collector = commands.add_parser('collect')
    collector.add_argument('--output', type=Path, required=True)
    builder = commands.add_parser('candidate')
    builder.add_argument('--baseline', type=Path, required=True)
    builder.add_argument('--repository-root', type=Path, required=True)
    builder.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        result = collect(args.output) if args.command == 'collect' else candidate(
            args.baseline, args.repository_root, args.output)
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'refused', 'reason': error.args[0]
            if isinstance(error, Refused) else 'snapshot_binding_owner_refused',
            'changesApplied': False, 'mutationsEnabled': False, 'newPaymentStarted': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

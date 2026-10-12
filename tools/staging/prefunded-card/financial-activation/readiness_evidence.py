import argparse
from datetime import datetime, timezone
from pathlib import Path
import sys
import time
import os

from readiness_evidence_io import (Refused, check_output, command, decode, digest, pinned, require,
                                   root_request, save, window)
from readiness_evidence_jwt import verify as verify_jwt
from readiness_evidence_runtime import collect as runtime_checks, financial_state
from readiness_evidence_snapshot import collect as snapshot_tls
from readiness_evidence_timers import STOPS, collect as timers
from protected_snapshot import prove_unchanged, snapshot_sql
from release_contract import DAEMON
from runtime_owner_support import database

PATHS = {'readiness': '/opt/baci-prefunded-workers/code/readiness.cjs',
    'background': '/opt/baci-prefunded-workers/code/background.cjs',
    'snapshot': '/opt/baci-prefunded-workers/code/snapshot.cjs',
    'daemon': '/opt/baci-prefunded-replay/code/replay-daemon.mjs',
    'factory': '/opt/baci-prefunded-replay/code/prefunded-replay-bundle.mjs',
    'activationConfig': '/opt/baci-prefunded-workers/config/background.json',
    'snapshotConfig': '/opt/baci-prefunded-workers/config/snapshot.json',
    'replayConfig': '/opt/baci-prefunded-replay/config/config.json',
    'factoryConfig': '/opt/baci-prefunded-replay/config/prefunded.json'}
MISSING = ['public', 'roles', 'snapshotBinding', 'guardedRenewalCommitted',
    'rollbackRehearsalBoundToSql', 'constraintsAndHistoryPreserved', 'freshReplayCompletedPass']


def passwords(value):
    if isinstance(value, dict):
        return [item for key, item in value.items() if key == 'password'] + [
            password for item in value.values() for password in passwords(item)]
    if isinstance(value, list):
        return [password for item in value for password in passwords(item)]
    return []


def collect(request, now=time.time, run=command, query=database):
    require(os.geteuid() == 0, 'root_required')
    started = window(now())
    require(isinstance(request, dict) and set(request) == {
        'seal', 'artifacts', 'signingKeys', 'snapshotCaContainerPath', 'phase'}, 'request_shape_refused')
    seal = decode(pinned(request['seal'], private=True))
    seal_sha = request['seal']['sha256']
    require(seal.get('status') == 'source-verified-prepared-inactive'
            and seal.get('deadline') == '2026-10-06T15:59:10Z'
            and seal.get('approvedCompanyBudgetKobo') == 10000
            and seal.get('preservedPrincipalKobo') == 10000
            and seal.get('replay', {}).get('sourceVerified') is True
            and seal.get('workers', {}).get('sourceVerified') is True, 'seal_contract_refused')
    artifacts = request['artifacts']
    unit_names = {stem + suffix for stem in STOPS for suffix in ('.timer', '.service')}
    require(isinstance(artifacts, dict) and set(artifacts) == set(PATHS) | unit_names, 'artifact_set_refused')
    contents = {}
    for name, path in PATHS.items():
        require(artifacts[name]['path'] == path, 'installed_artifact_path_refused')
        contents[name] = pinned(artifacts[name])
    for name in ('readiness', 'background', 'snapshot', 'daemon', 'factory'):
        relative = ('replay/' + ('replay-daemon.mjs' if name == 'daemon' else 'prefunded-replay-bundle.mjs')
                    if name in ('daemon', 'factory') else 'workers/' + name + '.cjs')
        require(digest(contents[name]) == seal.get('files', {}).get(relative), 'installed_artifact_pin_mismatch')
    require(digest(contents['daemon']) == DAEMON, 'daemon_contract_refused')
    keys = decode(pinned(request['signingKeys'], private=True))
    replay = decode(contents['replayConfig'])
    fields = verify_jwt(replay, contents['factoryConfig'], keys, started)
    configuration = decode(contents['snapshotConfig'])
    other_passwords = passwords(decode(contents['activationConfig'])) + passwords(decode(contents['factoryConfig']))
    require(configuration.get('database', {}).get('password') not in other_passwords
            and other_passwords, 'snapshot_credential_not_separate')
    phase = request['phase']
    state = financial_state(phase, seal_sha, seal_sha, run)
    before = decode(query(snapshot_sql().decode()))
    checks = runtime_checks(seal_sha, seal_sha, run)
    checks.update(snapshot_tls(configuration, request['snapshotCaContainerPath'], run))
    deadlines = timers(artifacts, run)
    after = decode(query(snapshot_sql().decode()))
    prove_unchanged(before, after)
    state = financial_state(phase, seal_sha, seal_sha, run)
    for name in PATHS:
        require(pinned(artifacts[name]) == contents[name], 'artifact_changed_during_check')
    finished = window(now())
    require(0 <= finished - started <= 60, 'collection_too_slow')
    return {'status': 'financial-readiness-evidence-partial', 'sealSha256': seal_sha,
        'observedAt': datetime.fromtimestamp(finished, timezone.utc).isoformat(),
        **fields, **checks, **state, 'timers': deadlines, 'separateSnapshotCredential': True,
        'sourceAndInstalledArtifactPinsVerified': True, 'protectedBefore': before, 'protectedAfter': after,
        'ownerEvidenceStillRequired': MISSING if phase == 'preschedule' else MISSING[:-1],
        'mutationsEnabled': False, 'newPaymentStarted': False}


def main(argv=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--request', type=Path, required=True)
    parser.add_argument('--request-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    args = parser.parse_args(argv)
    try:
        request = root_request(args.request, args.request_sha256)
        check_output(args.output)
        report = collect(request)
        value = save(args.output, report)
        print('{"status":"financial-readiness-evidence-collected","evidenceSha256":"' + value +
              '","readOnly":true,"mutationsEnabled":false}')
        return 0
    except Exception:
        print('{"status":"refused","reason":"readiness_evidence_collection_refused",'
              '"redacted":true,"mutationsEnabled":false}')
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

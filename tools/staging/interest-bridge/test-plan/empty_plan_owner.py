import argparse
import hashlib
import json
import os
from pathlib import Path
import stat
import subprocess
from datetime import datetime, timedelta, timezone

from plan_constants import DEADLINE, IDENTITY_SHA, MAX_BYTES, MAX_INVENTORY_BYTES, PSQL, SCOPE
from plan_contract import SHA256, digest, validate_approval
from plan_sql import build_sql
from read_empty_wallet import _read_bounded_sealed, read_empty_wallet, read_sealed


ROOT = Path(__file__).parent
SQL_REFUSALS = {
    'test plan physical identity or fresh evidence refused': 'physical-or-fresh-evidence-refused',
    'test plan reviewed schema or state drift': 'reviewed-schema-or-state-drift',
    'test plan treasury cap refused': 'treasury-cap-refused',
    'test plan official RPC contract drift': 'official-rpc-contract-drift',
    'test plan owner or historical binding refused': 'owner-or-historical-binding-refused',
    'test plan restricted binding refused': 'restricted-binding-refused',
    'test plan idempotency cardinality refused': 'idempotency-cardinality-refused',
    'test plan merchant savings feature disabled': 'merchant-savings-disabled',
    'test plan old goal reuse refused': 'old-goal-reuse-refused',
    'test plan exact empty goal conflict': 'exact-empty-goal-conflict',
    'test plan candidate changed': 'candidate-changed',
    'test plan immutable binding conflict': 'immutable-binding-conflict',
    'test plan goal only policy must be absent': 'goal-only-policy-must-be-absent',
    'test plan protected state changed': 'protected-state-changed',
}
REFUSALS = set(SQL_REFUSALS.values()) | set(('artifact-pin source-manifest-shape source-pin '
    'source-manifest-incomplete database-refused database-output-shape root-or-deadline root-required '
    'required-evidence-absent snapshot-source-pin approval-shape provider-document-evidence-absent '
    'rollback-rehearsal-required rollback-rehearsal-pin sealed-file-metadata sealed-file-pin '
    'provider-helper-metadata provider-helper-pin provider-helper-scope wallet-read-bound wallet-read-status '
    'wallet-exact-identity wallet-not-empty-enabled deadline approval-scope identity-pin snapshot-drift '
    'snapshot-identity snapshot-stale physical-identity wallet-shape wallet-not-fresh-empty-enabled '
    'opt-in-shape owner-opt-in routing-shape payout-namespace-unproven eligibility-shape eligibility-unproven '
    'split-shape business-global-split-unproven goal-only-routing-must-be-absent timestamp report-size-bound').split())


def _json(path, expected_sha):
    if not isinstance(expected_sha, str) or SHA256.fullmatch(expected_sha) is None:
        raise ValueError('artifact-pin')
    return json.loads(read_sealed(path, expected_sha))


def read_snapshot(path, expected_sha):
    if not isinstance(expected_sha, str) or SHA256.fullmatch(expected_sha) is None:
        raise ValueError('artifact-pin')
    return json.loads(_read_bounded_sealed(path, expected_sha, MAX_INVENTORY_BYTES))


def _source(expected_sha):
    manifest = read_sealed(ROOT / 'SOURCE-SHA256SUMS', expected_sha)
    expected_files = {path.name for path in ROOT.iterdir()
                      if path.is_file() and path.name != 'SOURCE-SHA256SUMS'}
    records = {}
    for line in manifest.decode().splitlines():
        checksum, name = line.split('  ', 1)
        if (SHA256.fullmatch(checksum) is None or name not in expected_files or name in records
                or Path(name).name != name):
            raise ValueError('source-manifest-shape')
        path = ROOT / name
        metadata = path.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
                or metadata.st_mode & 0o022 or metadata.st_nlink != 1
                or metadata.st_size > MAX_BYTES or hashlib.sha256(path.read_bytes()).hexdigest() != checksum):
            raise ValueError('source-pin')
        records[name] = checksum
    if set(records) != expected_files:
        raise ValueError('source-manifest-incomplete')


def _database(sql, *, inventory=False):
    environment = {key: value for key, value in os.environ.items()
                   if not key.startswith('PG') and key not in ('DOCKER_HOST', 'DOCKER_CONTEXT')}
    process = subprocess.run(PSQL, input=sql, text=True, capture_output=True,
                             timeout=40, env=environment)
    max_bytes = MAX_INVENTORY_BYTES if inventory else MAX_BYTES
    if process.returncode or len(process.stdout.encode('utf-8')) > max_bytes:
        for message, code in SQL_REFUSALS.items():
            if message in process.stderr:
                raise ValueError(code)
        raise ValueError('database-refused')
    result = json.loads(process.stdout.strip())
    if not isinstance(result, dict):
        raise ValueError('database-output-shape')
    return result


def _rehearsal_valid(rehearsal, approval, args, now):
    if not isinstance(rehearsal, dict):
        return False
    observed = datetime.fromisoformat(rehearsal['observedAt'].replace('Z', '+00:00'))
    until = datetime.fromisoformat(rehearsal['validUntil'].replace('Z', '+00:00'))
    goal_only = args.mode.startswith('goal-')
    return (rehearsal.get('kind') == ('empty_interest_goal_rehearsal' if goal_only else 'empty_interest_plan_rehearsal')
            and rehearsal.get('status') == ('exact_empty_goal_bound_policy_pending' if goal_only else 'exact_empty_goal_bound')
            and rehearsal.get('changesMade') is False and rehearsal.get('rolledBack') is True
            and rehearsal.get('approvalSha256') == digest(approval)
            and rehearsal.get('snapshotSha256') == args.snapshot_sha256
            and rehearsal.get('sourceManifestSha256') == args.source_manifest_sha256
            and rehearsal.get('schemaMd5') == approval['schemaMd5']
            and rehearsal.get('stateMd5') == approval['stateMd5']
            and rehearsal.get('principalKobo') == 0 and rehearsal.get('newPrefundingKobo') == 0
            and rehearsal.get('interestPolicyEnabled') is (not goal_only)
            and rehearsal.get('interestPolicyPresent') is (not goal_only)
            and rehearsal.get('providerIdMappingApproved') is (not goal_only)
            and rehearsal.get('oldGoalPrincipalKobo') == 10000
            and 0 <= (now-observed).total_seconds() <= 120
            and now < until <= observed+timedelta(seconds=120))


def execute(args, now):
    if os.geteuid() != 0 or now >= datetime.fromisoformat(DEADLINE.replace('Z', '+00:00')):
        raise ValueError('root-or-deadline')
    _source(args.source_manifest_sha256)
    if args.mode == 'inventory':
        result = _database(build_sql('inventory'), inventory=True)
        if result.get('systemIdentifier') != SCOPE['systemIdentifier']:
            raise ValueError('physical-identity')
        return {**result, 'kind': 'empty_interest_plan_inventory', 'changesMade': False,
                'sourceManifestSha256': args.source_manifest_sha256}
    goal_only = args.mode.startswith('goal-')
    required = ('approval', 'approval_sha256', 'snapshot', 'snapshot_sha256',
                'identity', 'eligibility_proof', 'split_proof')
    if not goal_only:
        required += ('routing_proof',)
    if any(getattr(args, field) is None for field in required):
        raise ValueError('required-evidence-absent')
    approval = _json(args.approval, args.approval_sha256)
    snapshot = read_snapshot(args.snapshot, args.snapshot_sha256)
    if (not isinstance(snapshot, dict) or snapshot.get('kind') != 'empty_interest_plan_inventory'
            or snapshot.get('sourceManifestSha256') != args.source_manifest_sha256):
        raise ValueError('snapshot-source-pin')
    read_sealed(args.identity, IDENTITY_SHA)
    if not isinstance(approval, dict):
        raise ValueError('approval-shape')
    for kind in (('eligibility', 'split') if goal_only else ('routing', 'eligibility', 'split')):
        section = approval.get(kind)
        if not isinstance(section, dict) or not isinstance(section.get('artifactSha256'), str):
            raise ValueError('provider-document-evidence-absent')
        read_sealed(getattr(args, kind + '_proof'), section['artifactSha256'])
    wallet = read_empty_wallet()
    fresh_now = datetime.now(timezone.utc)
    payload = validate_approval(approval, snapshot, wallet, fresh_now, goal_only=goal_only)
    committed = args.mode in ('apply', 'goal-apply')
    if committed:
        if args.rehearsal is None or args.rehearsal_sha256 is None:
            raise ValueError('rollback-rehearsal-required')
        rehearsal = _json(args.rehearsal, args.rehearsal_sha256)
        if not _rehearsal_valid(rehearsal, approval, args, fresh_now):
            raise ValueError('rollback-rehearsal-pin')
    result = _database(build_sql(args.mode, payload))
    kind = 'empty_interest_goal' if goal_only else 'empty_interest_plan'
    return {**result, 'kind': kind + ('_commit' if committed else '_rehearsal'),
            'changesMade': committed, 'rolledBack': not committed,
            'approvalSha256': digest(approval), 'snapshotSha256': args.snapshot_sha256,
            'sourceManifestSha256': args.source_manifest_sha256,
            'providerEvidenceSha256': digest(wallet), 'identitySha256': IDENTITY_SHA,
            'observedAt': fresh_now.isoformat(timespec='seconds').replace('+00:00', 'Z'),
            'validUntil': min(fresh_now + timedelta(seconds=120),
                              datetime.fromisoformat(DEADLINE.replace('Z', '+00:00')))
                .isoformat(timespec='seconds').replace('+00:00', 'Z')}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('mode', choices=('inventory', 'rehearse', 'apply', 'goal-rehearse', 'goal-apply'))
    parser.add_argument('--source-manifest-sha256', required=True)
    parser.add_argument('--output', type=Path, required=True)
    for name in ('approval', 'snapshot', 'identity', 'routing-proof', 'eligibility-proof',
                 'split-proof', 'rehearsal'):
        parser.add_argument('--' + name, type=Path)
    for name in ('approval', 'snapshot', 'rehearsal'):
        parser.add_argument('--' + name + '-sha256')
    args = parser.parse_args()
    descriptor = None
    try:
        if os.geteuid() != 0:
            raise ValueError('root-required')
        descriptor = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        result = execute(args, datetime.now(timezone.utc))
        raw = (json.dumps(result, sort_keys=True, separators=(',', ':'), ensure_ascii=False) + '\n').encode('utf-8')
        max_bytes = MAX_INVENTORY_BYTES if args.mode == 'inventory' else MAX_BYTES
        if len(raw) > max_bytes:
            raise ValueError('report-size-bound')
        with os.fdopen(descriptor, 'wb') as stream:
            descriptor = None
            stream.write(raw)
            stream.flush()
            os.fsync(stream.fileno())
        print(json.dumps({'status': result.get('status', 'inventory_collected'),
                          'kind': result['kind'], 'changesMade': result['changesMade'],
                          'artifactSha256': hashlib.sha256(raw).hexdigest()}))
        return 0
    except Exception as error:
        if descriptor is not None:
            os.close(descriptor)
        committed = args.mode in ('apply', 'goal-apply')
        print(json.dumps({'status': 'apply_unconfirmed' if committed else 'refused',
                          'changesMade': None if committed else False, 'redacted': True,
                          'refusalCode': error.args[0] if error.args and isinstance(error.args[0], str)
                          and error.args[0] in REFUSALS else 'untrusted-error-redacted'}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

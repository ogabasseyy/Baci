import argparse
import json
from pathlib import Path
import shutil
import sys
import time

from protected_snapshot import snapshot_sql
from release_contract import (DEADLINE, Refused, digest, pin_read,
                              verify_replay, verify_worker, _require)

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'card-week-renewal'))
from activation_bundle import (APP_SHA256, APP_MANIFEST_SHA256, LAUNCHER_SHA256,
                               SOURCE_MANIFEST_SHA256, _write)
from public_artifact import validate_archive
from source_functions import _source_files

HERE = Path(__file__).resolve().parent
HELPERS = ('release_contract.py', 'protected_snapshot.py', 'replay_configuration.py', 'owner_gates.py',
           'snapshot_binding_sql.py', 'snapshot_binding_owner.py', 'prepare.py',
           'installation_files.py', 'installation_contract.py', 'installation_units.py',
           'installation_runtime.py', 'owner_database.py', 'owner_adapter.py', 'owner_public.py',
           'owner_public_artifacts.py')
SHARED = ('public_artifact.py', 'public_projection.py', 'public_service_contract.py',
          'treasury_owner_contract.py', 'treasury_owner_io.py', 'runtime_owner_support.py',
          'runtime_replay_configuration.py', 'runtime_scheduler.py', 'replay_cutover_runtime.py',
          'background-runner.sh')
CONTRACTS = ('runtime_scheduler.py', 'replay_cutover_runtime.py', 'runtime_replay_configuration.py',
             'runtime_worker_installation.py', 'runtime-workers-owner.py',
             'treasury-snapshot-store.sql', 'public_service_contract.py')


def prepare(replay_root, replay_sha, worker_root, worker_sha, receiver, repository,
            public_root, output):
    _require(time.time() < 1791301750, 'financial_preparation_window_expired')
    _require(not output.exists() and not output.is_symlink(), 'financial_output_exists')
    replay_manifest, replay_files, replay = verify_replay(replay_root, replay_sha,
        receiver / 'apps/web', repository / 'apps/web/src')
    worker_manifest, worker_files, worker = verify_worker(worker_root, worker_sha, repository)
    archive = pin_read(public_root / 'public-app.tar.gz', APP_SHA256, 268435456)
    manifest = pin_read(public_root / 'public-app.manifest.json', APP_MANIFEST_SHA256)
    public_source = pin_read(public_root.parent / 'source-readonly-r2/source-manifest.json',
                             SOURCE_MANIFEST_SHA256, 1_000_000)
    public_files = validate_archive(archive, manifest, APP_SHA256, APP_MANIFEST_SHA256)
    _require(digest(public_files['launch-public.cjs']) == LAUNCHER_SHA256, 'public_launcher_contract_refused')
    files = {**{'replay/' + name: content for name, content in replay_files.items()},
             **{'workers/' + name: content for name, content in worker_files.items()},
             'replay/replay-artifact.manifest.json': replay_manifest,
             'workers/artifact.manifest.json': worker_manifest,
             'public/public-app.manifest.json': manifest,
             'public/source-manifest.json': public_source,
             'protected-snapshot.sql': snapshot_sql()}
    for name in HELPERS:
        files['tooling/financial-activation/' + name] = (HERE / name).read_bytes()
    for path in sorted(HERE.glob('readiness_evidence*.py')):
        if '.test.' not in path.name:
            files['tooling/financial-activation/' + path.name] = path.read_bytes()
    for name in SHARED:
        files['tooling/' + name] = (HERE.parent / name).read_bytes()
    files['tooling/phone_authentication.py'] = (
        HERE.parent.parent / 'interest-bridge/activation/phone_authentication.py').read_bytes()
    for path in sorted((HERE.parent / 'card-week-renewal').iterdir()):
        if path.suffix in ('.py', '.sql', '.json') and '.test.' not in path.name:
            files['tooling/card-week-renewal/' + path.name] = path.read_bytes()
    files['procedure.md'] = (HERE / 'README.md').read_bytes()
    files['tooling/financial-activation/README.md'] = files['procedure.md']
    for name, content in _source_files(repository).items():
        files['source/tools/staging/prefunded-card/' + name] = content
    files['source/tools/staging/prefunded-card/treasury-storage.sql'] = (
        HERE.parent / 'treasury-storage.sql').read_bytes()
    contracts = {name: digest((HERE.parent / name).read_bytes()) for name in CONTRACTS}
    for name in CONTRACTS:
        files['contracts/' + name] = (HERE.parent / name).read_bytes()
    seal = {'version': 1, 'status': 'source-verified-prepared-inactive', 'deadline': DEADLINE,
        'approvedCompanyBudgetKobo': 10000, 'preservedPrincipalKobo': 10000,
        'retiredIntentId': 'd8bcf921-61b3-4647-90e2-5648e4d6967d',
        'publicArchiveSha256': APP_SHA256, 'publicManifestSha256': APP_MANIFEST_SHA256,
        'publicSourceManifestSha256': SOURCE_MANIFEST_SHA256,
        'launcherSha256': LAUNCHER_SHA256, 'replay': replay, 'workers': worker,
        'installationContractSha256': contracts,
        'files': {name: digest(content) for name, content in sorted(files.items())},
        'mutationsEnabled': False, 'financialStarted': False, 'newPaymentStarted': False,
        'changesApplied': False, 'installationAdapterImplemented': True,
        'ownerGatesRemaining': ['fresh-root-baseline-and-guarded-sql-rehearsal',
            'snapshot-verifier-role-and-immutable-binding-renewal',
            'expiry-only-commit-with-password-privilege-history-fences',
            'private-signed-jwt-and-prefunded-only-configuration',
            'fresh-reviewed-renewed-artifact-installation-adapter-execution',
            'isolated-installation-and-independent-full-protected-snapshot',
            'all-four-restricted-tls-identities-and-replay-check',
            'effective-fixed-deadline-stop-targets-before-start',
            'fresh-replay-pass-independent-snapshot-background-pass-and-schedules']}
    seal_bytes = json.dumps(seal, sort_keys=True, separators=(',', ':')).encode()
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    try:
        for name, content in files.items():
            _write(output, name, content)
        _write(output, 'financial-preparation.json', seal_bytes)
    except BaseException:
        shutil.rmtree(output)
        raise
    return {'status': seal['status'], 'sealSha256': digest(seal_bytes),
        'replaySourceCount': replay['sourceCount'], 'workerSourceCount': worker['sourceCount'],
        'mutationsEnabled': False, 'financialStarted': False, 'newPaymentStarted': False}


def main(argv=None):
    parser = argparse.ArgumentParser()
    for name in ('replay-root', 'replay-manifest-sha256', 'worker-root', 'worker-manifest-sha256',
                 'receiver-root', 'repository-root', 'public-root', 'output'):
        parser.add_argument('--' + name, required=True)
    args = parser.parse_args(argv)
    try:
        result = prepare(Path(args.replay_root), args.replay_manifest_sha256,
            Path(args.worker_root), args.worker_manifest_sha256,
            Path(args.receiver_root), Path(args.repository_root), Path(args.public_root), Path(args.output))
        print(json.dumps(result))
        return 0
    except Exception as error:
        print(json.dumps({'status': 'refused', 'reason': error.args[0]
            if isinstance(error, Refused) else 'financial_preparation_refused',
            'mutationsEnabled': False, 'financialStarted': False, 'newPaymentStarted': False}))
        return 1


if __name__ == '__main__':
    raise SystemExit(main())

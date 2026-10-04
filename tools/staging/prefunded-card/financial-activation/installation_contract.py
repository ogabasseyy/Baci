from pathlib import Path
import sys

from installation_files import tree_fingerprint
from release_contract import DEADLINE, FACTORY, HEX, digest, pin_read, _json, _require
from replay_configuration import APPROVED_SCOPE

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from replay_cutover_runtime import validate_container as validate_replay
from runtime_scheduler import validate_container as validate_worker

WORKER_ROOT = Path('/opt/baci-prefunded-workers')
REPLAY_ROOT = Path('/opt/baci-prefunded-replay')
WORKER_LABEL = '7e8b8f70975c53669a062a824099ec8d15267c69d1f03ac4af7f4e945ad571b5'
REPLAY_LABEL = '1445e1b2a7f9e7e28801c8bd036b833fdbe8ec02facb5bc4d5e00c0c71e7de42'
KINDS = ('background', 'snapshot', 'readiness')
TREE_FILES = {
    str(WORKER_ROOT): {'code/background.cjs', 'code/snapshot.cjs', 'code/readiness.cjs',
                      'code/background.sh', 'config/background.json', 'config/snapshot.json'},
    str(REPLAY_ROOT): {'code/replay-daemon.mjs', 'code/prefunded-replay-bundle.mjs',
                      'config/config.json', 'config/prefunded.json'},
}


def verify_seal(bundle, expected_sha):
    _require(HEX.fullmatch(expected_sha) is not None, 'installation_seal_pin_refused')
    seal = _json(pin_read(bundle / 'financial-preparation.json', expected_sha))
    _require(seal.get('status') == 'source-verified-prepared-inactive'
             and seal.get('deadline') == DEADLINE
             and seal.get('approvedCompanyBudgetKobo') == 10000
             and seal.get('preservedPrincipalKobo') == 10000
             and seal.get('mutationsEnabled') is False,
             'installation_seal_scope_refused')
    files = seal.get('files')
    _require(isinstance(files, dict) and files, 'installation_seal_incomplete')
    for relative, expected in files.items():
        path = Path(relative)
        _require(not path.is_absolute() and '..' not in path.parts
                 and str(path) == relative, 'installation_seal_path_refused')
        pin_read(bundle / path, expected)
    return seal


def validate_predecessor(containers, image_environment):
    _require(set(containers) == {'replay', 'replay-check', *KINDS},
             'installation_container_set_refused')
    for kind, container in containers.items():
        if kind.startswith('replay'):
            validate_replay(container, str(REPLAY_ROOT), REPLAY_LABEL, kind == 'replay-check')
        else:
            validate_worker(container, kind, WORKER_LABEL)
        _require(container.get('State', {}).get('Running') is False
                 and container['Config'].get('Env') == image_environment,
                 'installation_predecessor_active_or_environment_drift')


def validate_tree(root, rows):
    _require(isinstance(rows, dict) and set(rows) == TREE_FILES.get(str(root)),
             'installation_predecessor_tree_set_refused')
    for relative, row in rows.items():
        if root == WORKER_ROOT:
            owner = 65531 if relative == 'config/snapshot.json' else (
                65532 if relative == 'config/background.json' else 0)
            expected = (owner, owner, 0o600 if owner else 0o444)
        else:
            expected = (0, 65532, 0o440 if relative.startswith('config/') else 0o644)
        _require((row.get('uid'), row.get('gid'), row.get('mode')) == expected,
                 'installation_predecessor_metadata_contract_refused')
    return tree_fingerprint(root, rows)


def candidate_inputs(bundle, seal, candidate, replay_directory, private_pins, candidate_sha):
    _require(isinstance(candidate_sha, str) and HEX.fullmatch(candidate_sha),
             'installation_candidate_pin_refused')
    metadata = _json(pin_read(candidate / 'candidate.json', candidate_sha))
    _require(metadata.get('status') == 'expiry_rebuild_prepared'
             and metadata.get('deadline') == DEADLINE
             and metadata.get('changesApplied') is False,
             'installation_renewal_candidate_refused')
    required = {
        '/opt/baci-prefunded-workers/config/background.json': 'background.json',
        '/opt/baci-prefunded-workers/config/snapshot.json': 'snapshot.json',
    }
    configs = {}
    rows = metadata.get('artifacts', {}).get('artifacts', [])
    for row in rows:
        if row.get('sourcePath') in required:
            relative = Path(row['candidatePath'])
            _require(not relative.is_absolute() and '..' not in relative.parts,
                     'installation_candidate_path_refused')
            configs[required[row['sourcePath']]] = pin_read(
                candidate / 'artifacts' / relative, row['candidateSha256'])
    _require(set(configs) == set(required.values()), 'installation_private_configs_missing')
    _require(isinstance(private_pins, dict) and set(private_pins) == {'config.json', 'prefunded.json'},
             'installation_replay_private_pins_missing')
    replay_configs = {name: pin_read(replay_directory / name, expected)
                      for name, expected in private_pins.items()}
    replay = _json(replay_configs['config.json'])
    factory = _json(replay_configs['prefunded.json'])
    _require('financialDatabase' not in replay and replay.get('prefundedReplay') == {
        'bundleSha256': FACTORY, 'configurationSha256': digest(replay_configs['prefunded.json'])}
        and factory.get('scope') == APPROVED_SCOPE,
        'installation_replay_mode_refused')
    worker_outputs = seal['workers']['outputs']
    worker_files = {name: pin_read(bundle / 'workers' / name, expected)
                    for name, expected in worker_outputs.items()}
    replay_files = {name: pin_read(bundle / 'replay' / name, expected)
                    for name, expected in seal['replay']['outputs'].items()}
    _require(set(worker_files) == {'background.cjs', 'snapshot.cjs', 'readiness.cjs'}
             and set(replay_files) == {'replay-daemon.mjs', 'prefunded-replay-bundle.mjs'},
             'installation_release_output_set_refused')
    return configs, replay_configs, worker_files, replay_files

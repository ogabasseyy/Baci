import hashlib
import json
from pathlib import Path, PurePosixPath
import re
import sys

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / 'card-week-renewal'))
from activation_bundle import _json, _read
from source_functions import DEADLINE, Refused, _require

DAEMON = '02420ef54fe4061cb676ae01003acf4ed9c9280d22a1b3ca0d05e94bd9fe1457'
FACTORY = 'de2959f583189688a1bb8cf02153325ef314e68c6dded71d7bbce3c832057500'
WORKER_ENTRIES = {
    'background.cjs': 'apps/web/src/scripts/run-prefunded-card-background.ts',
    'snapshot.cjs': 'tools/staging/prefunded-card/treasury-snapshot-cli.ts',
    'readiness.cjs': 'tools/staging/prefunded-card/runtime-readiness-cli.ts',
}
HEX = re.compile(r'^[a-f0-9]{64}$')


def digest(content):
    return hashlib.sha256(content).hexdigest()


def pin_read(path, expected, limit=16_000_000):
    _require(isinstance(expected, str) and HEX.fullmatch(expected), 'release_pin_missing')
    return _read(Path(path), expected, limit)


def source_path(root, relative):
    name = PurePosixPath(relative)
    _require(isinstance(relative, str) and not name.is_absolute()
             and '..' not in name.parts and str(name) == relative, 'source_path_refused')
    target = root / relative
    allowed = root.resolve()
    if 'node_modules' in name.parts:
        index = name.parts.index('node_modules')
        allowed = root.joinpath(*name.parts[:index + 1]).resolve()
    _require(target.resolve().is_relative_to(allowed), 'source_path_refused')
    return target


def verify_worker(root, manifest_sha, repository):
    raw = pin_read(root / 'artifact.manifest.json', manifest_sha, 2_000_000)
    meta = _json(raw)
    _require(meta.get('schemaVersion') == 1 and meta.get('status') == 'compiled-artifact-only'
             and meta.get('deadline') == DEADLINE
             and meta.get('priorDeadline') == '2026-09-29T15:59:10Z'
             and meta.get('entrypoints') == WORKER_ENTRIES
             and meta.get('financialBounds') == {'companySandboxBudgetKobo': 10000,
                 'originalPrincipalKobo': 10000, 'principalMutation': False}
             and meta.get('runtimeConstraints') == {'roleLoginRequired': True,
                 'tls': 'strict', 'rlsBypass': False}
             and all(meta.get(key) is False for key in
                     ('changesApplied', 'providerWrites', 'runtimeActivated'))
             and meta.get('externalExternals') == ['pg-native'], 'worker_release_contract_refused')
    sources = meta.get('sourceClosureSha256')
    _require(isinstance(sources, dict) and sources, 'worker_source_closure_missing')
    for relative, expected in sources.items():
        pin_read(source_path(repository, relative), expected)
    _require(set(WORKER_ENTRIES.values()).issubset(sources), 'worker_entrypoint_missing')
    authority = meta.get('deadlineAuthority', {})
    for path_key, hash_key in (('path', 'sha256'), ('knownDeadlineSchemaPath', 'knownDeadlineSchemaSha256')):
        pin_read(source_path(repository, authority.get(path_key, '')), authority.get(hash_key))
    outputs = meta.get('outputSha256', {})
    _require(set(outputs) == set(WORKER_ENTRIES), 'worker_output_set_refused')
    files = {name: pin_read(root / name, expected) for name, expected in outputs.items()}
    return raw, files, {'manifestSha256': manifest_sha, 'outputs': outputs,
                        'sourceCount': len(sources), 'sourceVerified': True}


def verify_replay(root, manifest_sha, receiver, savings):
    _require(root is not None and (root / 'replay-artifact.manifest.json').is_file(),
             'financial_replay_release_missing_rebuild_from_source_required')
    raw = pin_read(root / 'replay-artifact.manifest.json', manifest_sha, 2_000_000)
    meta = _json(raw)
    _require(meta.get('version') == 1 and meta.get('outputs') == {
        'replay-daemon.mjs': DAEMON, 'prefunded-replay-bundle.mjs': FACTORY},
        'financial_replay_artifact_contract_refused')
    source = meta.get('source', {})
    roots = {'receiver': receiver, 'prefundedReplay': savings}
    _require(source.get('receiverRoot') == str(receiver)
             and source.get('savingsRoot') == str(savings), 'replay_source_roots_refused')
    inputs = source.get('inputs', {})
    entries = source.get('entrypoints', {})
    _require(set(inputs) == set(roots) and set(entries) == set(roots), 'replay_source_closure_missing')
    count = 0
    for kind, source_root in roots.items():
        rows = inputs[kind]
        _require(isinstance(rows, list) and rows, 'replay_source_closure_missing')
        paths = set()
        for row in rows:
            _require(isinstance(row, dict) and set(row) == {'path', 'sha256'}, 'replay_source_row_refused')
            absolute = Path(row['path'])
            _require(absolute.is_absolute() and absolute.is_relative_to(source_root)
                     and str(absolute) not in paths, 'replay_source_path_refused')
            paths.add(str(absolute))
            pin_read(source_path(source_root, str(absolute.relative_to(source_root))), row['sha256'])
            count += 1
        entry = entries[kind]
        expected_entry = source_root / ('tools/piggyvest-staging/replay-daemon.ts'
            if kind == 'receiver' else 'lib/piggyvest/prefunded-card-replay-runtime.ts')
        _require(isinstance(entry, dict) and entry.get('path') == str(expected_entry)
                 and entry in rows, 'replay_entrypoint_missing')
    files = {name: pin_read(root / name, expected) for name, expected in meta['outputs'].items()}
    return raw, files, {'manifestSha256': manifest_sha, 'outputs': meta['outputs'],
                        'sourceCount': count, 'sourceVerified': True}

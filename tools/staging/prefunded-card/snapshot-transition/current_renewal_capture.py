import hashlib
import json
from pathlib import Path, PurePosixPath
import sys
import sysconfig
import subprocess
from types import FunctionType
import urllib.request

import snapshot_collector
from snapshot_transition import _decode, _hex, _require
from transition_constants import MODULES, SEAL, SYSTEM

DEADLINE = '2026-10-06T15:59:10Z'
PHASES = ('prestart', 'preschedule', 'public-mutation')
ROLES = ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence',
         'prefunded_snapshot_verifier')
CAPTURE_LIMIT = 32 * 1024 * 1024
HELPERS = ('transition_constants.py', 'snapshot_collector.py', 'snapshot_transition.py',
           'current_renewal_capture.py', 'current_renewal_proof.py')
SOURCE_MODULES = {**MODULES,
    'snapshot_binding_sql': 'tooling/financial-activation/snapshot_binding_sql.py',
    'owner_database': 'tooling/financial-activation/owner_database.py',
    'release_contract': 'tooling/financial-activation/release_contract.py',
    'treasury_owner_io': 'tooling/treasury_owner_io.py',
    'treasury_owner_contract': 'tooling/treasury_owner_contract.py',
    'runtime_owner_support': 'tooling/runtime_owner_support.py'}


def _function_origin(function, paths):
    origin = function.__globals__.get('__file__')
    if origin in paths:
        return function.__code__.co_filename == origin
    standard = Path(sysconfig.get_path('stdlib')) / 'urllib/request.py'
    return (function is urllib.request.build_opener
        and origin == urllib.request.__file__ == str(standard)
        and standard == standard.resolve()
        and function.__globals__ is vars(urllib.request)
        and function.__code__.co_filename == origin)


def _helpers(pins):
    _require(isinstance(pins, dict) and set(pins) == set(HELPERS)
             and all(_hex(pin) for pin in pins.values()), 'reviewed_helper_pins_required')
    root = Path(__file__).parent
    _require(root.is_absolute() and root == root.resolve(), 'helper_root_refused')
    for filename, pin in pins.items():
        target = root / filename
        _require(target == target.resolve() and hashlib.sha256(target.read_bytes()).hexdigest() == pin,
                 'reviewed_helper_source_drift')
        module = sys.modules.get(target.stem)
        if module is not None:
            _require(getattr(module, '__file__', None) == str(target), 'helper_loaded_origin_refused')
            for function in vars(module).values():
                if isinstance(function, FunctionType) and function.__module__ == module.__name__:
                    _require(function.__globals__.get('__file__') == str(target)
                             and function.__code__.co_filename == str(target), 'helper_function_origin_refused')
    return root


def _sources(bundle, helper_pins):
    helper_root = _helpers(helper_pins)
    root = Path(bundle)
    _require(root.is_absolute() and root == root.resolve(), 'renewal_r8_root_refused')
    manifest_path = root / 'financial-preparation.json'
    _require(manifest_path == manifest_path.resolve(), 'renewal_manifest_origin_refused')
    raw = manifest_path.read_bytes()
    _require(len(raw) <= 16_000_000 and hashlib.sha256(raw).hexdigest() == SEAL,
             'renewal_exact_r8_seal_required')
    manifest = _decode(raw.decode())
    files = manifest['files']
    _require(isinstance(files, dict) and set(SOURCE_MODULES.values()) <= set(files),
             'renewal_executing_closure_missing')
    origins = {}
    modules = {}
    for relative, pin in files.items():
        name = PurePosixPath(relative)
        _require(not name.is_absolute() and '..' not in name.parts and str(name) == relative
                 and _hex(pin), 'renewal_sealed_path_refused')
        target = root / relative
        _require(target == target.resolve() and target.is_file(), 'renewal_sealed_origin_refused')
        with target.open('rb') as handle:
            digest = hashlib.sha256()
            for chunk in iter(lambda: handle.read(1024 * 1024), b''):
                digest.update(chunk)
        _require(digest.hexdigest() == pin, 'renewal_full_seal_file_drift')
        if relative.startswith('tooling/') and name.suffix == '.py':
            origins[relative] = {'path': str(target), 'sha256': pin}
            module = sys.modules.get(name.stem)
            if module is not None:
                _require(getattr(module, '__file__', None) == str(target), 'renewal_loaded_module_origin_refused')
                modules[name.stem] = module
    _require(set(SOURCE_MODULES) <= set(modules), 'renewal_loaded_dependencies_missing')
    paths = {entry['path'] for entry in origins.values()}
    for module in modules.values():
        for function in vars(module).values():
            if isinstance(function, FunctionType):
                _require(_function_origin(function, paths),
                         'renewal_executing_function_origin_refused')
    snapshot, unused = snapshot_collector._modules(root, SEAL)
    binding = modules['snapshot_binding_sql']
    owner = modules['owner_database']
    _require(binding.protected_expression is snapshot['protected_snapshot'].protected_expression
             and owner._role_fingerprint is snapshot['database_sql']._role_fingerprint
             and owner.database is modules['runtime_owner_support'].database
             and owner.ROLES == ROLES and modules['release_contract'].DEADLINE == DEADLINE,
             'renewal_shared_function_alias_refused')
    source = 'tooling/card-week-renewal/sealed-source.json'
    origins[source] = {'path': str(root / source), 'sha256': files[source]}
    modules['treasury_owner_io'].root_ancestors(manifest_path)
    modules['treasury_owner_io'].private_directory(root)
    return modules, raw, {'sealSha256': SEAL, 'bundleRoot': str(root), 'modules': origins,
        'helperRoot': str(helper_root), 'helpers': dict(helper_pins)}


def _render(bundle, phase, modules, origins):
    _require(phase in PHASES, 'renewal_phase_refused')
    statement = snapshot_collector.sql(bundle, SEAL)
    marker = "SELECT jsonb_build_object('version',1,'capturedAt',clock_timestamp(),"
    tail = 'FROM material CROSS JOIN bindings CROSS JOIN snapshots CROSS JOIN security;\nROLLBACK;\n'
    _require(statement.count(marker) == 1 and statement.endswith(tail), 'renewal_capture_contract_drift')
    prefix, projection = statement.split(marker)
    census = marker + projection[:-len(tail)] + tail.split(';')[0]
    guard = modules['snapshot_binding_sql'].identity_guard()
    roles = """SELECT jsonb_object_agg(rolname,jsonb_build_object(
 'expiresAt',to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'unsafe',NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole
 OR rolcreatedb OR rolreplication OR rolconnlimit<>-1)) FROM pg_roles
WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence',
 'prefunded_snapshot_verifier')"""
    boundary = 'WITH material AS MATERIALIZED'
    _require(prefix.count(boundary) == 1, 'renewal_capture_transaction_drift')
    prefix = prefix.replace(boundary, f'DO $renewal$ BEGIN {guard} END $renewal$;\n' + boundary, 1)
    provenance = json.dumps(origins, sort_keys=True, separators=(',', ':')).replace("'", "''")
    return prefix + f""", renewal AS MATERIALIZED (SELECT
 ({modules['snapshot_binding_sql'].metadata_expression()}) AS metadata,
 ({modules['database_sql']._role_fingerprint()}) AS fingerprint, ({roles}) AS roles)
SELECT jsonb_build_object('phase','{phase}','capture',({census}),
 'materialCanonical',state::text,'metadata',renewal.metadata,
 'executorFingerprint',renewal.fingerprint,'roles',renewal.roles,
 'sourceOrigins','{provenance}'::jsonb)
FROM material CROSS JOIN renewal;
ROLLBACK;
"""


def sql(bundle, *, phase, helper_pins):
    _require(phase in PHASES, 'renewal_phase_refused')
    modules, unused, origins = _sources(bundle, helper_pins)
    return _render(bundle, phase, modules, origins)


def decode_capture(text):
    _require(isinstance(text, str) and len(text.encode()) <= CAPTURE_LIMIT,
        'renewal_bounded_capture_size_refused')

    def pairs(rows):
        result = dict(rows)
        _require(len(result) == len(rows), 'renewal_duplicate_capture_key')
        return result

    return json.loads(text, object_pairs_hook=pairs,
        parse_constant=lambda unused: _require(False, 'renewal_nonfinite_capture_refused'))


def execute(bundle, *, phase, helper_pins, snapshot_only=False):
    _require(phase in PHASES and type(snapshot_only) is bool, 'renewal_query_scope_refused')
    modules, unused, origins = _sources(bundle, helper_pins)
    statement = (snapshot_collector.sql(bundle, SEAL) if snapshot_only
        else _render(bundle, phase, modules, origins))
    runtime = modules['runtime_owner_support']
    result = subprocess.run([*runtime.DOCKER, 'exec', '-i', 'baci-isolated-savings-db-1',
        runtime.PSQL, '-XqAt', '-v', 'ON_ERROR_STOP=1', '-v', 'VERBOSITY=sqlstate',
        '-U', 'postgres', '-d', 'postgres'], input=statement, text=True,
        capture_output=True, timeout=40, env=runtime.ENVIRONMENT)
    _require(result.returncode == 0, 'renewal_readonly_capture_query_refused')
    decode_capture(result.stdout)
    _sources(bundle, helper_pins)
    return result.stdout

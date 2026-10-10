import json
from pathlib import Path
import sys

from release_contract import DEADLINE, HEX, digest, _json, _require
from snapshot_binding_sql import collect_sql

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
sys.path.insert(0, str(Path(__file__).resolve().parent.parent / 'card-week-renewal'))
from database_sql import _role_fingerprint
from runtime_owner_support import database
from treasury_owner_io import private_directory, read_file, root_ancestors

ROLES = ('prefunded_treasury_operator', 'prefunded_authorizer', 'prefunded_evidence',
         'prefunded_snapshot_verifier')


def private_json(path):
    root_ancestors(path)
    private_directory(path.parent)
    return _json(read_file(path, 0, 0o600, 16_000_000))


def renewal_proof(audit, query=database):
    commit = private_json(audit / 'commit-result.json')
    rehearsal = private_json(audit / 'rehearsal-result.json')
    candidate = private_json(audit / 'renewal-candidate/candidate.json')
    sql = read_file(audit / 'renewal-candidate/database-renewal.sql', 0, 0o600, 16_000_000)
    _require(commit.get('status') == 'applied' and commit.get('protectedStateUnchanged') is True
             and commit.get('passwordsPrivilegesMembershipUnchanged') is True
             and commit.get('newPaymentStarted') is False and commit.get('publicMutationsEnabled') is False
             and commit.get('sqlSha256') == candidate.get('databaseSqlSha256') == digest(sql)
             and rehearsal.get('databaseSqlSha256') == digest(sql)
             and rehearsal.get('status') == 'rollback_rehearsal_passed'
             and rehearsal.get('rollbackConfirmed') is True
             and rehearsal.get('protectedStateUnchanged') is True,
             'owner_database_renewal_proof_refused')
    prior = read_file(audit / 'roles-before-sha256.txt', 0, 0o600, 128).decode().strip()
    _require(HEX.fullmatch(prior), 'owner_database_executor_fingerprint_invalid')
    current = query('BEGIN READ ONLY;SET LOCAL search_path=pg_catalog;SELECT (' +
                    _role_fingerprint() + ');ROLLBACK;').strip()
    _require(current == prior, 'owner_database_executor_fingerprint_changed')
    binding_before = private_json(audit / 'snapshot-baseline.json')
    binding_commit = private_json(audit / 'snapshot-commit-result.json')
    binding_rehearsal = private_json(audit / 'snapshot-rehearsal-result.json')
    binding_sql = read_file(audit / 'snapshot-candidate/commit.sql', 0, 0o600, 16_000_000)
    expected = {**binding_before['metadata'], 'bindingExpiry': DEADLINE, 'roleExpiry': DEADLINE}
    current_binding = _json(query(collect_sql().decode()).encode())
    _require(current_binding.get('metadata') == expected
             and binding_commit.get('status') == 'applied'
             and binding_commit.get('sqlSha256') == binding_rehearsal.get('sqlSha256') == digest(binding_sql)
             and binding_commit.get('passwordPrivilegesMembershipUnchanged') is True
             and binding_commit.get('immutableTriggerRestored') is True
             and binding_rehearsal.get('status') == 'rollback_rehearsal_passed'
             and binding_rehearsal.get('triggerRestored') is True,
             'owner_database_snapshot_fingerprint_changed')
    roles = _json(query("""BEGIN READ ONLY;SET LOCAL TIME ZONE 'UTC';
SELECT jsonb_object_agg(rolname,jsonb_build_object(
 'expiresAt',to_char(rolvaliduntil AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'),
 'unsafe',NOT rolcanlogin OR rolinherit OR rolsuper OR rolbypassrls OR rolcreaterole
 OR rolcreatedb OR rolreplication OR rolconnlimit<>-1)) FROM pg_roles
WHERE rolname IN ('prefunded_treasury_operator','prefunded_authorizer','prefunded_evidence',
 'prefunded_snapshot_verifier');ROLLBACK;""").encode())
    _require(set(roles) == set(ROLES) and all(row == {'expiresAt': DEADLINE, 'unsafe': False}
             for row in roles.values()), 'owner_database_role_expiry_or_safety_refused')
    return {'roles': {name: {**row, 'passwordUnchanged': True, 'privilegesUnchanged': True,
                            'membershipUnchanged': True} for name, row in roles.items()},
        'snapshotBinding': {'expiresAt': DEADLINE, 'identityUnchanged': True,
                            'immutableTriggerRestored': True},
        'guardedRenewalCommitted': True, 'rollbackRehearsalBoundToSql': True,
        'constraintsAndHistoryPreserved': True}

"""Parent-injected rollback rehearsal only; no CLI, installer or launch authority.

The parent authenticates all loaded source/callback origins and independently seals
reviewed inputs. authenticate_inputs(reviewed) performs protected reads of the whole
financial completion audit, original definition and prepared rendered rollback SQL.
exclusive_inventory() independently discovers unknown claimants and proves the held
global lock. collect() returns genuine current complete application snapshots plus
the replay_quiescence before/after/receipt measurements; it must not substitute or
normalize historical evidence. query is authenticated receipt-DB read-only transport;
execute(bytes) submits exactly one reviewed transaction and returns its actual ACK.
Returned full snapshots are private retention material, never a public response.
Unknown ACK, unavailable post evidence or drift refuse without retry or launch.
"""

import copy
from datetime import datetime
import hashlib
import json
from pathlib import Path
import re

import completion_snapshot
import cutover_database
import financial_completion
import financial_delta
import replay_quiescence


ROLLBACK_SQL_SHA256 = '315028b8f028f3537dcf2226123a495238f2f85eb6a88855275c25f05078c69d'
ORIGINAL_DEFINITION_SHA256 = '650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824'
DEADLINE = '2026-10-06T15:59:10Z'


def _require(condition):
    if not condition:
        raise ValueError('replay_fence_rehearsal_refused')


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _decode(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: _require(False))


def _now(clock):
    now = clock()
    _require(type(now) is datetime and now.tzinfo is not None and now.utcoffset().total_seconds() == 0
        and now < replay_quiescence._time(DEADLINE))
    return now


def _audit(raw):
    audit = _decode(raw)
    reconciled = audit['reconciliation']
    report = reconciled['completedReport']
    snapshot = reconciled['collection']['protectedSnapshot']
    proof = financial_completion.validate_completed(report)
    rows = snapshot['allowedTargetWitnesses']['savings_notifications.events']['targetRows']
    preserved = [row for row in rows if row['id'] == '914e9941-c9c1-44a1-9879-1de3e54ac365']
    completion_snapshot.verify_completion_snapshot(report, snapshot, preserved_notifications=preserved)
    return proof


def _same_application(before, after):
    _require(_encoded({key: value for key, value in before.items() if key != 'capturedAt'})
        == _encoded({key: value for key, value in after.items() if key != 'capturedAt'}))


def rehearse_replay_fence(*, reviewed: dict, reviewed_sha256: str, authenticate_inputs,
                         collect, exclusive_inventory, query, execute, clock) -> dict:
    attempted, acknowledged, before, after, outcome = False, False, None, None, None
    try:
        _require(type(reviewed) is dict and set(reviewed) == {'financialAuditPath', 'financialAuditSha256'}
            and _sha(_encoded(reviewed)) == reviewed_sha256
            and type(reviewed['financialAuditPath']) is str
            and Path(reviewed['financialAuditPath']).is_absolute()
            and '..' not in Path(reviewed['financialAuditPath']).parts
            and type(reviewed['financialAuditSha256']) is str
            and re.fullmatch('[a-f0-9]{64}', reviewed['financialAuditSha256'])
            and all(callable(callback) for callback in (
                authenticate_inputs, collect, exclusive_inventory, query, execute, clock)))
        reviewed = copy.deepcopy(reviewed)
        _require(cutover_database.DEADLINE == replay_quiescence.DEADLINE == DEADLINE
            and cutover_database.DEFINITION == ORIGINAL_DEFINITION_SHA256)

        def inputs():
            _now(clock)
            value = copy.deepcopy(authenticate_inputs(copy.deepcopy(reviewed)))
            _require(type(value) is dict and set(value) == {'financialAudit', 'originalDefinition', 'rollbackSql'}
                and all(type(raw) is bytes and 0 < len(raw) <= 16000000 for raw in value.values()))
            _require(_sha(value['financialAudit']) == reviewed['financialAuditSha256']
                and _sha(value['originalDefinition']) == ORIGINAL_DEFINITION_SHA256
                and _sha(value['rollbackSql']) == ROLLBACK_SQL_SHA256
                and value['rollbackSql'].endswith(b'ROLLBACK;\n'))
            return value

        sealed = inputs()
        proof = _audit(sealed['financialAudit'])

        def inventory():
            started = _now(clock)
            value = copy.deepcopy(exclusive_inventory())
            finished = _now(clock)
            _require(type(value) is dict and set(value) == {'observedAt', 'exclusive', 'unknownClaimants'}
                and value['exclusive'] is True and type(value['unknownClaimants']) is list
                and value['unknownClaimants'] == []
                and started <= replay_quiescence._time(value['observedAt']) <= finished
                and 0 <= (finished-started).total_seconds() <= 60)

        def capture():
            _require(inputs() == sealed)
            inventory()
            started = _now(clock)
            value = copy.deepcopy(collect())
            finished = _now(clock)
            _require(type(value) is dict and set(value) == {'applicationSnapshot', 'before', 'after', 'receipt'})
            replay_quiescence.verify_replay_quiescence(before=value['before'], after=value['after'],
                receipt=value['receipt'], now=finished)
            snapshot = value['applicationSnapshot']
            financial_delta._snapshot(snapshot)
            _require(snapshot['readOnly'] is True and 0 <= (finished-started).total_seconds() <= 60)
            for stamp in (snapshot['capturedAt'], value['before']['observedAt'],
                    value['after']['observedAt'], value['receipt']['observedAt']):
                _require(started <= replay_quiescence._time(stamp) <= finished)
            inventory()
            _require(inputs() == sealed)
            return snapshot

        before = capture()

        def readonly_query(sql):
            _require(type(sql) is str and sql == cutover_database.SNAPSHOT_SQL and inputs() == sealed)
            inventory()
            return copy.deepcopy(query(sql))

        def rollback_execute(sql):
            nonlocal attempted, acknowledged
            _require(not attempted and type(sql) is str and sql.encode('utf-8') == sealed['rollbackSql'])
            current = capture()
            _same_application(before, current)
            inventory()
            _require(inputs() == sealed)
            attempted = True
            ack = execute(sealed['rollbackSql'])
            acknowledged = type(ack) is str and ack == 'ROLLBACK'
            _require(acknowledged)
            return ack

        try:
            outcome = cutover_database.run_fence(readonly_query, rollback_execute,
                sealed['originalDefinition'].decode('utf-8'), proof, ROLLBACK_SQL_SHA256, mode='rollback')
        finally:
            after = capture()
        _same_application(before, after)
        _require(type(outcome) is dict and outcome['status'] == 'rollback_verified_keep_stopped'
            and acknowledged and outcome['receipt']['rollbackSqlSha256'] == ROLLBACK_SQL_SHA256
            and outcome['receipt']['originalDefinitionSha256'] == ORIGINAL_DEFINITION_SHA256
            and outcome['receipt']['financialProofSha256'] == proof['financialProofSha256']
            and outcome['receipt']['financialProofObservedAt'] == proof['financialProofObservedAt']
            and _sha(_encoded(outcome['receipt'])) == outcome['receiptSha256'])
        return dict(status='replay-fence-rollback-verified', transactionAttempted=attempted,
            rollbackAcknowledged=acknowledged, protectedApplicationUnchanged=True, launchAuthorized=False,
            beforeApplication=before, afterApplication=after, rehearsal=outcome,
            financialActionAttempted=False, newPaymentStarted=False)
    except Exception:
        return dict(status='replay-fence-rollback-refused', redacted=True, transactionAttempted=attempted,
            rollbackAcknowledged=acknowledged, protectedApplicationUnchanged=False, launchAuthorized=False,
            beforeApplication=before, afterApplication=after, financialActionAttempted=False, newPaymentStarted=False)

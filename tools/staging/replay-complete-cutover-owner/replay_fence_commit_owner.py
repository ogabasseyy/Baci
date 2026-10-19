"""Sealed parent invoke: commit=False checks; commit=True installs only the fence.

The parent authenticates this source and callback closure before importing it.
No CLI, worker, payment, claimant start, recovery SQL or submission retry exists.
The pinned successful rollback audit supplies the original financial proof.
"""

import copy
import hashlib
import os
from pathlib import Path
import uuid

import cutover_database as database
import replay_fence_rehearsal as rehearsal
from replay_rehearsal_owner import Callbacks, HeldLocks, REVIEWED, encoded
from replay_rehearsal_transport import LIMIT, RECEIPT_ARGV


AUDIT_PATH = Path('/root/baci-replay-rehearsal-r3.85HQ4psI/rehearsal-result-631a248b83894c95a579e2f229188999.json')
AUDIT_SHA256 = '2220425c4f261719bedc49355974eeae36b150071f404bca9c722be153d74a7b'
RECEIPT_SHA256 = 'c1c6376733c80550543184b91d32ac2aab8428091302be6bdd1c8ba28a282faa'
COMMIT_SQL_SHA256 = 'ff36e1b56df2247f416398a176eea613216831f9b54a45fe7f36f4c67455ce1f'


def require(value):
    if not value:
        raise ValueError('fence_commit_owner_refused')


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def diagnostic(error):
    allowed_types = {'ValueError', 'TypeError', 'OSError', 'PermissionError', 'FileNotFoundError',
        'TimeoutError', 'RuntimeError', 'KeyError', 'ImportError', 'SyntaxError'}
    allowed_modules = {'replay_fence_commit_owner', 'cutover_database', 'replay_fence_rehearsal',
        'financial_completion', 'financial_delta', 'completion_snapshot', 'cutover_runtime',
        'replay_quiescence', 'replay_rehearsal_owner', 'replay_rehearsal_support',
        'replay_rehearsal_transport', 'replay_rehearsal_inventory'}
    kind = type(error).__name__
    value = dict(type=kind if kind in allowed_types else 'Exception', module='replay_fence_commit_owner', line=0)
    trace = error.__traceback__
    while trace is not None:
        name = trace.tb_frame.f_globals.get('__name__')
        if name in allowed_modules and trace.tb_frame.f_code.co_name not in ('require', '_require'):
            value.update(module=name, line=trace.tb_lineno)
        trace = trace.tb_next
    return value


def checked_inputs(callbacks):
    values = copy.deepcopy(callbacks.authenticate_inputs(copy.deepcopy(REVIEWED)))
    require(type(values) is dict and set(values) == {'financialAudit', 'originalDefinition', 'rollbackSql'}
        and all(type(raw) is bytes and 0 < len(raw) <= LIMIT for raw in values.values()))
    require(sha(values['financialAudit']) == REVIEWED['financialAuditSha256']
        and sha(values['originalDefinition']) == rehearsal.ORIGINAL_DEFINITION_SHA256
        and sha(values['rollbackSql']) == rehearsal.ROLLBACK_SQL_SHA256
        and values['rollbackSql'].endswith(b'ROLLBACK;\n'))
    raw = callbacks.protected_read(AUDIT_PATH, AUDIT_SHA256)
    require(type(raw) is bytes and 0 < len(raw) <= LIMIT and sha(raw) == AUDIT_SHA256)
    return values, raw


def authenticate_review(callbacks):
    values, raw = checked_inputs(callbacks)
    audit = rehearsal._decode(raw)
    require(type(audit) is dict and set(audit) == {'kind', 'result'}
        and audit['kind'] == 'authenticated-rollback-only-rehearsal')
    result = audit['result']
    flags = dict(transactionAttempted=True, rollbackAcknowledged=True, protectedApplicationUnchanged=True,
        launchAuthorized=False, financialActionAttempted=False, newPaymentStarted=False)
    require(type(result) is dict and set(result) == set(flags) | {
        'status', 'beforeApplication', 'afterApplication', 'rehearsal'}
        and result['status'] == 'replay-fence-rollback-verified'
        and all(type(result[key]) is bool and result[key] is value for key, value in flags.items()))
    for snapshot in (result['beforeApplication'], result['afterApplication']):
        rehearsal.financial_delta._snapshot(snapshot)
        require(snapshot['readOnly'] is True)
    rehearsal._same_application(result['beforeApplication'], result['afterApplication'])
    outcome = result['rehearsal']
    require(type(outcome) is dict and set(outcome) == {'status', 'receipt', 'receiptSha256', 'before', 'after'}
        and outcome['status'] == 'rollback_verified_keep_stopped'
        and outcome['receiptSha256'] == RECEIPT_SHA256 and sha(encoded(outcome['receipt'])) == RECEIPT_SHA256)
    receipt = outcome['receipt']
    require(type(receipt) is dict)
    proof = dict(financialProofPassed=True, financialProofSha256=receipt['financialProofSha256'],
        financialProofObservedAt=receipt['financialProofObservedAt'])
    database._financial(proof)
    require(rehearsal._audit(values['financialAudit']) == proof)
    original = values['originalDefinition'].decode('utf-8')
    renderer = database._load_renderer()
    commit = renderer.render_transaction(original, mode='commit').encode('utf-8')
    require(sha(commit) == COMMIT_SQL_SHA256 and commit.endswith(b'COMMIT;\n')
        and renderer.render_transaction(original).encode('utf-8') == values['rollbackSql']
        and commit[:-len(b'COMMIT;\n')] == values['rollbackSql'][:-len(b'ROLLBACK;\n')])
    for row in (outcome['before'], outcome['after']):
        require(type(row) is dict and set(row) == {'observedAt', 'identity', 'drain', 'routine',
            'receipts', 'otherRoutinesSha256'} and row['identity'] == rehearsal.replay_quiescence.RECEIPT_IDENTITY
            and row['drain'] == rehearsal.replay_quiescence.DRAIN
            and row['routine']['bodySha256'] == database.BODY
            and row['routine']['definitionSha256'] == database.DEFINITION)
    require(database._state(outcome['before']) == database._state(outcome['after']))
    state_pin = sha(encoded(database._state(outcome['before'])))
    expected = dict(schemaVersion=1, status='rollback_rehearsed', systemIdentifier=database.SYSTEM,
        generation=database.GENERATION, fenceManifestSha256=database.FENCE_PIN,
        originalDefinitionSha256=database.DEFINITION, fencedBodySha256=database.FENCED_BODY,
        fencedDefinitionSha256=database.FENCED_DEFINITION, rollbackSqlSha256=rehearsal.ROLLBACK_SQL_SHA256,
        commitSqlSha256=COMMIT_SQL_SHA256, baselineStateSha256=state_pin, restoredStateSha256=state_pin,
        financialProofSha256=proof['financialProofSha256'], financialProofObservedAt=proof['financialProofObservedAt'])
    require(set(receipt) == set(expected) | {'observedAt'} and all(type(receipt[key]) is type(value)
        and receipt[key] == value for key, value in expected.items()))
    stamp = rehearsal.replay_quiescence._time
    require(stamp(proof['financialProofObservedAt']) <= stamp(receipt['observedAt']) <= callbacks.clock()
        and stamp(result['beforeApplication']['capturedAt']) <= stamp(receipt['observedAt'])
        <= stamp(result['afterApplication']['capturedAt'])
        and stamp(outcome['before']['observedAt']) <= stamp(outcome['after']['observedAt']) <= stamp(receipt['observedAt']))
    return dict(inputs=values, auditRaw=raw, receipt=receipt, proof=proof, original=original,
        commitSql=commit, application=result['afterApplication'])


def guard(callbacks, review):
    database._financial(review['proof'])
    require(checked_inputs(callbacks) == (review['inputs'], review['auditRaw']))
    started = callbacks.clock()
    inventory = copy.deepcopy(callbacks.inventory.exclusive_inventory())
    finished = callbacks.clock()
    require(type(inventory) is dict and set(inventory) == {'observedAt', 'exclusive', 'unknownClaimants'}
        and inventory['exclusive'] is True and inventory['unknownClaimants'] == []
        and started <= rehearsal.replay_quiescence._time(inventory['observedAt']) <= finished
        and 0 <= (finished - started).total_seconds() <= 60)


def capture(callbacks, review):
    guard(callbacks, review)
    started = callbacks.clock()
    current = copy.deepcopy(callbacks.collect())
    finished = callbacks.clock()
    require(type(current) is dict and set(current) == {'applicationSnapshot', 'before', 'after', 'receipt'}
        and 0 <= (finished - started).total_seconds() <= 60)
    rehearsal.replay_quiescence.verify_replay_quiescence(before=current['before'], after=current['after'],
        receipt=current['receipt'], now=finished)
    snapshot = current['applicationSnapshot']
    rehearsal.financial_delta._snapshot(snapshot)
    require(snapshot['readOnly'] is True)
    for stamp in (snapshot['capturedAt'], current['before']['observedAt'],
            current['after']['observedAt'], current['receipt']['observedAt']):
        require(started <= rehearsal.replay_quiescence._time(stamp) <= finished)
    guard(callbacks, review)
    return snapshot


def persist(path, raw):
    require(type(raw) is bytes and 0 < len(raw) <= LIMIT)
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(raw)
        handle.flush()
        os.fsync(handle.fileno())
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


class CommitTransport:
    def __init__(self, callbacks, review, directory, before):
        self.callbacks, self.review, self.directory = callbacks, review, directory
        self.before = copy.deepcopy(before)
        self.reserved = self.attempted = self.acknowledged = False

    def execute(self, sql):
        require(not self.reserved and not self.attempted and type(sql) is str)
        raw = sql.encode('utf-8')
        require(raw == self.review['commitSql'] and sha(raw) == COMMIT_SQL_SHA256 and raw.endswith(b'COMMIT;\n'))
        rehearsal._same_application(self.before, capture(self.callbacks, self.review))
        guard(self.callbacks, self.review)
        persist(self.directory/'fence-commit-submission.json', encoded(dict(commitSqlSha256=COMMIT_SQL_SHA256,
            rehearsalAuditSha256=AUDIT_SHA256, rehearsalReceiptSha256=RECEIPT_SHA256,
            submittedAt=self.callbacks.clock().isoformat(), acknowledgement='not-yet-observed')))
        self.reserved = True
        self.attempted = True
        output = self.callbacks.run(list(RECEIPT_ARGV), input=raw, timeout=60)
        require(type(output) is bytes and 0 < len(output) <= LIMIT)
        lines = output.decode('utf-8').splitlines()
        while lines and lines[-1] == '':
            lines.pop()
        require(bool(lines) and lines[0] == 'BEGIN' and lines[-1] == 'COMMIT'
            and lines.count('COMMIT') == 1 and 'ROLLBACK' not in lines)
        self.acknowledged = True
        return 'COMMIT'


def operate(callbacks, directory, *, commit):
    transport, before, after, outcome = None, None, None, None
    failure = None
    try:
        review = authenticate_review(callbacks)
        before = capture(callbacks, review)

        def query(sql):
            require(type(sql) is str and sql == database.SNAPSHOT_SQL)
            guard(callbacks, review)
            return copy.deepcopy(callbacks.transport.query(sql))

        live = database.capture_snapshot(query)
        require(database._state(live) == database._state(rehearsal._decode(review['auditRaw'])['result']['rehearsal']['before']))
        transport = CommitTransport(callbacks, review, directory, before)
        try:
            if commit:
                outcome = database.run_fence(query, transport.execute, review['original'], review['proof'],
                    COMMIT_SQL_SHA256, mode='commit', rehearsal_receipt=copy.deepcopy(review['receipt']),
                    reviewed_rehearsal_sha256=RECEIPT_SHA256)
        finally:
            after = capture(callbacks, review)
        rehearsal._same_application(before, after)
        require(not commit or transport.acknowledged and type(outcome) is dict
            and outcome['status'] == 'fence_committed_keep_stopped'
            and sha(encoded(outcome['receipt'])) == outcome['receiptSha256'])
        status = 'fence-committed-keep-stopped' if commit else 'replay-fence-commit-preflight-passed'
        unchanged = True
    except Exception as error:
        status, unchanged = 'replay-fence-commit-refused', False
        failure = diagnostic(error)
    return dict(status=status, submissionReserved=bool(transport and transport.reserved),
        transactionAttempted=bool(transport and transport.attempted), commitAcknowledged=bool(transport and transport.acknowledged),
        protectedApplicationUnchanged=unchanged, beforeApplication=before, afterApplication=after, fence=outcome,
        launchAuthorized=False, liveReplayStarted=False, financialActionAttempted=False, newPaymentStarted=False,
        diagnostic=failure)


def invoke(directory, reviewed, verify, read, *, commit):
    require(type(commit) is bool and isinstance(directory, Path) and directory.is_absolute()
        and directory.name == 'owner' and directory.parent.parent == Path('/root')
        and reviewed == REVIEWED and verify() is True)
    with HeldLocks() as locks:
        callbacks = Callbacks(verify, read, locks)
        result = operate(callbacks, directory.parent, commit=commit)
        require(verify() is True and locks.held() is True)
        raw = encoded(dict(kind='authenticated-fence-commit', result=result))
        audit = directory.parent/('fence-commit-result-'+uuid.uuid4().hex+'.json')
        persist(audit, raw)
        digest = sha(raw)
        require(read(audit, digest) == raw and verify() is True and locks.held() is True)
        public = {key: result[key] for key in ('status', 'submissionReserved', 'transactionAttempted',
            'commitAcknowledged', 'protectedApplicationUnchanged', 'launchAuthorized', 'liveReplayStarted',
            'financialActionAttempted', 'newPaymentStarted')}
        return dict(public, privateAuditPath=str(audit), auditSha256=digest,
            rehearsalAuditSha256=AUDIT_SHA256, rehearsalReceiptSha256=RECEIPT_SHA256, commitSqlSha256=COMMIT_SQL_SHA256)

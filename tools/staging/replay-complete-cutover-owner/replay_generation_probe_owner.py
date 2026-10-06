"""Parent-sealed generation checks and ephemeral invalid-bounds probes only.

Context must accept the parent's external_lock_guard; no secondary lock is taken.
The parent seals Context's external import closure and the original probe transport.
No runtime activation, valid claim bounds, SQL execution or token minting is exposed.
"""

import copy
from pathlib import Path
import re
import uuid

import cutover_database as database
from cutover_context import Context
import cutover_probes
from probe_transport import run_probes
import replay_fence_rehearsal as rehearsal
from replay_fence_commit_owner import COMMIT_SQL_SHA256, RECEIPT_SHA256 as REHEARSAL_RECEIPT_SHA256, persist, sha
from replay_rehearsal_owner import Callbacks, HeldLocks, encoded
from replay_rehearsal_transport import LIMIT


AUDIT_PATH = Path('/root/baci-replay-fence-commit.MTc1AqYx/fence-commit-result-6a22efcd1f1d460f81a8a5b03c6f89d4.json')
AUDIT_SHA256 = '2b960715c86bdad3b5bf708a21d8bfdb54dca7a67235bc6a77ca5db53c280928'
RECEIPT_SHA256 = 'c87f7c6f8c54f7e63220de4f43bf6604fbe36b90a11bba52fc50985584190f4a'
SCRIPT_SHA256 = '65498dbb3a67e4228e7cdaf1def6d172a2f0ca76c1462d46701e41761fe076be'
REVIEWED = dict(committedAuditPath=str(AUDIT_PATH), committedAuditSha256=AUDIT_SHA256,
    committedReceiptSha256=RECEIPT_SHA256, scriptSha256=SCRIPT_SHA256)


def require(value):
    if not value:
        raise ValueError('generation_probe_owner_refused')


def diagnostic(error):
    kinds = {'ValueError', 'TypeError', 'OSError', 'PermissionError', 'FileNotFoundError',
        'TimeoutError', 'RuntimeError', 'KeyError', 'ImportError', 'SyntaxError'}
    modules = {'replay_generation_probe_owner', 'cutover_context', 'cutover_database', 'cutover_runtime',
        'cutover_probes', 'probe_transport', 'replay_quiescence', 'financial_delta',
        'replay_rehearsal_inventory', 'replay_rehearsal_owner', 'replay_rehearsal_support',
        'replay_rehearsal_transport', 'replay_fence_commit_owner', 'replay_fence_rehearsal'}
    kind = type(error).__name__
    result = dict(type=kind if kind in kinds else 'Exception', module='replay_generation_probe_owner', line=0)
    trace = error.__traceback__
    while trace is not None:
        name = trace.tb_frame.f_globals.get('__name__')
        if name in modules and trace.tb_frame.f_code.co_name not in ('require', '_require'):
            result.update(module=name, line=trace.tb_lineno)
        trace = trace.tb_next
    return result


def authenticate_commit(callbacks):
    raw = callbacks.protected_read(AUDIT_PATH, AUDIT_SHA256)
    require(type(raw) is bytes and 0 < len(raw) <= LIMIT and sha(raw) == AUDIT_SHA256)
    audit = rehearsal._decode(raw)
    require(type(audit) is dict and set(audit) == {'kind', 'result'} and audit['kind'] == 'authenticated-fence-commit')
    result = audit['result']
    flags = dict(submissionReserved=True, transactionAttempted=True, commitAcknowledged=True,
        protectedApplicationUnchanged=True, launchAuthorized=False, liveReplayStarted=False,
        financialActionAttempted=False, newPaymentStarted=False)
    keys = set(flags) | {'status', 'beforeApplication', 'afterApplication', 'fence'}
    require(type(result) is dict and set(result) in (keys, keys | {'diagnostic'})
        and result.get('diagnostic') is None and result['status'] == 'fence-committed-keep-stopped'
        and all(type(result[key]) is bool and result[key] is value for key, value in flags.items()))
    for snapshot in (result['beforeApplication'], result['afterApplication']):
        rehearsal.financial_delta._snapshot(snapshot)
        require(snapshot['readOnly'] is True)
    rehearsal._same_application(result['beforeApplication'], result['afterApplication'])
    fence = result['fence']
    require(type(fence) is dict and set(fence) == {'status', 'receipt', 'receiptSha256', 'before', 'after'}
        and fence['status'] == 'fence_committed_keep_stopped' and fence['receiptSha256'] == RECEIPT_SHA256
        and sha(encoded(fence['receipt'])) == RECEIPT_SHA256)
    receipt = fence['receipt']
    require(type(receipt) is dict)
    proof = dict(financialProofPassed=True, financialProofSha256=receipt['financialProofSha256'],
        financialProofObservedAt=receipt['financialProofObservedAt'])
    database._financial(proof)
    require(database._state(fence['before'], preserve_body=False) == database._state(fence['after'], preserve_body=False)
        and fence['before']['routine']['bodySha256'] == database.BODY
        and fence['before']['routine']['definitionSha256'] == database.DEFINITION
        and fence['after']['routine']['bodySha256'] == database.FENCED_BODY
        and fence['after']['routine']['definitionSha256'] == database.FENCED_DEFINITION)
    expected = dict(schemaVersion=1, status='fence_committed', systemIdentifier=database.SYSTEM,
        generation=database.GENERATION, fenceManifestSha256=database.FENCE_PIN,
        originalDefinitionSha256=database.DEFINITION, fencedBodySha256=database.FENCED_BODY,
        fencedDefinitionSha256=database.FENCED_DEFINITION, rollbackSqlSha256=rehearsal.ROLLBACK_SQL_SHA256,
        commitSqlSha256=COMMIT_SQL_SHA256, baselineStateSha256=sha(encoded(database._state(fence['before']))),
        committedStateSha256=sha(encoded(database._state(fence['after']))), rehearsalReceiptSha256=REHEARSAL_RECEIPT_SHA256,
        financialProofSha256=proof['financialProofSha256'], financialProofObservedAt=proof['financialProofObservedAt'])
    require(set(receipt) == set(expected) | {'observedAt'} and all(type(receipt[key]) is type(value)
        and receipt[key] == value for key, value in expected.items()))
    stamp = rehearsal.replay_quiescence._time
    require(stamp(proof['financialProofObservedAt']) <= stamp(receipt['observedAt']) <= callbacks.clock()
        and stamp(fence['before']['observedAt']) <= stamp(fence['after']['observedAt']) <= stamp(receipt['observedAt'])
        and stamp(result['beforeApplication']['capturedAt']) <= stamp(receipt['observedAt'])
        <= stamp(result['afterApplication']['capturedAt']))
    script = callbacks.protected_read(Path(__file__).with_name('claim_probe.cjs'), SCRIPT_SHA256)
    require(type(script) is bytes and 0 < len(script) <= LIMIT and sha(script) == SCRIPT_SHA256)
    return dict(auditRaw=raw, scriptRaw=script, state=database._state(fence['after']), proof=proof)


def credential_pins(context):
    tokens, proofs = context.credentials()
    cutover_probes._credentials(tokens, proofs)
    return {name: proof['tokenSha256'] for name, proof in proofs.items()}


def guard(callbacks, context, review, pins):
    require(callbacks.locks_held() is True)
    database._financial(review['proof'])
    require(callbacks.protected_read(AUDIT_PATH, AUDIT_SHA256) == review['auditRaw']
        and callbacks.protected_read(Path(__file__).with_name('claim_probe.cjs'), SCRIPT_SHA256) == review['scriptRaw'])
    context.deadline()
    require(context.verify_files() is True and credential_pins(context) == pins)
    started = callbacks.clock()
    inventory = copy.deepcopy(callbacks.inventory.exclusive_inventory())
    finished = callbacks.clock()
    require(type(inventory) is dict and set(inventory) == {'observedAt', 'exclusive', 'unknownClaimants'}
        and inventory['exclusive'] is True and inventory['unknownClaimants'] == []
        and started <= rehearsal.replay_quiescence._time(inventory['observedAt']) <= finished
        and 0 <= (finished-started).total_seconds() <= 60)


def capture(callbacks, context, review, pins):
    guard(callbacks, context, review, pins)
    started = callbacks.clock()
    current = copy.deepcopy(callbacks.collect())
    receipt = database.capture_snapshot(callbacks.transport.query)
    finished = callbacks.clock()
    require(type(current) is dict and set(current) == {'applicationSnapshot', 'before', 'after', 'receipt'}
        and 0 <= (finished-started).total_seconds() <= 60)
    rehearsal.replay_quiescence.verify_replay_quiescence(before=current['before'], after=current['after'],
        receipt=current['receipt'], now=finished)
    application = current['applicationSnapshot']
    rehearsal.financial_delta._snapshot(application)
    require(application['readOnly'] is True and database._state(receipt) == review['state'])
    for stamp in (application['capturedAt'], current['before']['observedAt'], current['after']['observedAt'],
            current['receipt']['observedAt'], receipt['observedAt']):
        require(started <= rehearsal.replay_quiescence._time(stamp) <= finished)
    guard(callbacks, context, review, pins)
    return dict(applicationSnapshot=application, receiptSnapshot=receipt,
        before=current['before'], after=current['after'], receipt=current['receipt'])


def compact(frame):
    application = {key: value for key, value in frame['applicationSnapshot'].items() if key != 'capturedAt'}
    receipt = database._state(frame['receiptSnapshot'])
    return dict(receiptStateSha256=receipt['receipts']['receipts']['sha256'],
        quarantineStateSha256=receipt['receipts']['quarantine']['sha256'],
        signatureStateSha256=receipt['receipts']['signatures']['sha256'], financialStateSha256=sha(encoded(application)),
        principalStateSha256=sha(encoded(dict(application=application, receipt=receipt))))


def operate(callbacks, *, probe):
    before, after, report, failure, attempted = None, None, None, None, False
    try:
        review = authenticate_commit(callbacks)
        context = Context(external_lock_guard=callbacks.locks_held)
        pins = credential_pins(context)

        def snapshot():
            nonlocal before, after
            frame = capture(callbacks, context, review, pins)
            if before is None:
                before = copy.deepcopy(frame)
            after = copy.deepcopy(frame)
            rehearsal._same_application(before['applicationSnapshot'], after['applicationSnapshot'])
            require(database._state(before['receiptSnapshot']) == database._state(after['receiptSnapshot']))
            return compact(frame)

        snapshot()
        try:
            if probe:
                attempted = True
                report = run_probes(context, snapshot, SCRIPT_SHA256)
        finally:
            snapshot()
        if probe:
            require(type(report) is dict and set(report) == {'status', 'receiptSystemId', 'protectedSnapshotsUnchanged',
                'probes', 'tokenSha256', 'requestBatchSha256'} and report['status'] == 'claim-fence-probes-passed'
                and report['receiptSystemId'] == database.SYSTEM and report['protectedSnapshotsUnchanged'] is True
                and report['tokenSha256'] == pins['new'] and type(report['requestBatchSha256']) is str
                and re.fullmatch('[a-f0-9]{64}', report['requestBatchSha256'])
                and report['probes'] == [dict(credential=name, httpStatus=400 if name == 'new' else 403,
                    postgresCode='22023' if name == 'new' else '42501') for name in ('oldNative', 'oldInterest', 'new')])
        status = 'replay-generation-probes-passed' if probe else 'replay-generation-probe-preflight-passed'
        unchanged = True
    except Exception as error:
        status, unchanged, failure = 'replay-generation-probe-refused', False, diagnostic(error)
    return dict(status=status, probeAttempted=attempted, protectedApplicationUnchanged=unchanged,
        protectedReceiptUnchanged=unchanged, before=before, after=after, probeReport=report, diagnostic=failure,
        transactionAttempted=False, launchAuthorized=False, liveReplayStarted=False,
        financialActionAttempted=False, newPaymentStarted=False)


def invoke(directory, reviewed, verify, read, *, probe):
    require(type(probe) is bool and type(reviewed) is dict and reviewed == REVIEWED
        and isinstance(directory, Path) and directory.is_absolute() and directory.name == 'owner'
        and directory.parent.parent == Path('/root') and verify() is True)
    with HeldLocks() as locks:
        callbacks = Callbacks(verify, read, locks)
        result = operate(callbacks, probe=probe)
        require(verify() is True and locks.held() is True)
        raw = encoded(dict(kind='authenticated-generation-invalid-bounds-probe', result=result))
        audit = directory.parent/('generation-probe-result-'+uuid.uuid4().hex+'.json')
        persist(audit, raw)
        digest = sha(raw)
        require(read(audit, digest) == raw and verify() is True and locks.held() is True)
        public = {key: result[key] for key in ('status', 'probeAttempted', 'protectedApplicationUnchanged',
            'protectedReceiptUnchanged', 'transactionAttempted', 'launchAuthorized', 'liveReplayStarted',
            'financialActionAttempted', 'newPaymentStarted')}
        return dict(public, privateAuditPath=str(audit), auditSha256=digest,
            committedAuditSha256=AUDIT_SHA256, committedReceiptSha256=RECEIPT_SHA256, scriptSha256=SCRIPT_SHA256)

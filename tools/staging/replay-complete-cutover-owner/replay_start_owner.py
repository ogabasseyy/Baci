"""Sealed check/start entry; no SQL mutations or predecessor restoration."""

import copy
from pathlib import Path
import re
import uuid

import cutover_database as database
from cutover_context import Context
import cutover_runtime as runtime
import replay_fence_rehearsal as rehearsal
import replay_generation_probe_owner as probe_owner
from replay_fence_commit_owner import persist, sha
from replay_rehearsal_owner import Callbacks, HeldLocks, encoded
from replay_rehearsal_transport import LIMIT
from replay_start_inventory import StartupInventory
from replay_start_readiness import FOCUSED, validate_configuration, validate_readiness


PROBE_PATH = Path('/root/baci-generation-probes.LlLovPq2/generation-probe-result-9431348e28964275beb38e95f13f1791.json')
PROBE_SHA256 = '3b9b84840d92f9b5cd239ac544ca15bd0e00f213d3d4aa556744caf991a1b6b4'
REVIEWED = dict(probeAuditPath=str(PROBE_PATH), probeAuditSha256=PROBE_SHA256,
    committedAuditPath=str(probe_owner.AUDIT_PATH), committedAuditSha256=probe_owner.AUDIT_SHA256,
    committedReceiptSha256=probe_owner.RECEIPT_SHA256, scriptSha256=probe_owner.SCRIPT_SHA256)


def require(value):
    if not value:
        raise ValueError('replay_start_owner_refused')


def authenticate_probe(callbacks, committed, pins):
    raw = callbacks.protected_read(PROBE_PATH, PROBE_SHA256)
    require(type(raw) is bytes and 0 < len(raw) <= LIMIT and sha(raw) == PROBE_SHA256)
    audit = rehearsal._decode(raw)
    require(type(audit) is dict and set(audit) == {'kind', 'result'}
        and audit['kind'] == 'authenticated-generation-invalid-bounds-probe')
    result = audit['result']
    flags = dict(probeAttempted=True, protectedApplicationUnchanged=True, protectedReceiptUnchanged=True,
        transactionAttempted=False, launchAuthorized=False, liveReplayStarted=False,
        financialActionAttempted=False, newPaymentStarted=False)
    require(type(result) is dict and set(result) == set(flags) | {'status', 'before', 'after', 'probeReport', 'diagnostic'}
        and result['status'] == 'replay-generation-probes-passed' and result['diagnostic'] is None
        and all(type(result[key]) is bool and result[key] is value for key, value in flags.items()))
    for frame in (result['before'], result['after']):
        require(type(frame) is dict and set(frame) == {'applicationSnapshot', 'receiptSnapshot', 'before', 'after', 'receipt'})
        rehearsal.financial_delta._snapshot(frame['applicationSnapshot'])
        require(frame['applicationSnapshot']['readOnly'] is True
            and database._state(frame['receiptSnapshot']) == committed['state'])
        rehearsal.replay_quiescence.verify_replay_quiescence(before=frame['before'], after=frame['after'],
            receipt=frame['receipt'], now=rehearsal.replay_quiescence._time(frame['after']['observedAt']))
    rehearsal._same_application(result['before']['applicationSnapshot'], result['after']['applicationSnapshot'])
    require(database._state(result['before']['receiptSnapshot']) == database._state(result['after']['receiptSnapshot']))
    report = result['probeReport']
    require(type(report) is dict and set(report) == {'status', 'receiptSystemId', 'protectedSnapshotsUnchanged',
        'probes', 'tokenSha256', 'requestBatchSha256'} and report['status'] == 'claim-fence-probes-passed'
        and report['receiptSystemId'] == database.SYSTEM and report['protectedSnapshotsUnchanged'] is True
        and report['tokenSha256'] == pins['new'] and type(report['requestBatchSha256']) is str
        and re.fullmatch('[a-f0-9]{64}', report['requestBatchSha256'])
        and report['probes'] == [dict(credential=name, httpStatus=400 if name == 'new' else 403,
            postgresCode='22023' if name == 'new' else '42501') for name in ('oldNative', 'oldInterest', 'new')])
    return raw


class TrackedOperator:
    def __init__(self, owner):
        self.owner = owner

    def deadline(self):
        self.owner.context.deadline()

    def find(self, name):
        return self.owner.context.operator.find(name)

    def inspect(self, *args, **kwargs):
        return self.owner.context.operator.inspect(*args, **kwargs)

    def run(self, argv, timeout=30):
        owner = self.owner
        rename = [*runtime.DOCKER, 'rename', runtime.NATIVE_ID, runtime.RETAINED]
        stop = [*runtime.DOCKER, 'stop', '--time=45', self.find(runtime.CONTAINER)]
        require(argv == rename or argv == stop and argv[-1] not in (None, runtime.NATIVE_ID, runtime.COMPETITOR_ID))
        require(owner.callbacks.locks_held() is True)
        value = owner.context.operator.run(argv, timeout=timeout)
        if argv == rename:
            owner.inventory.retained = True
        return value

    def create(self, directory, label, name):
        owner = self.owner
        require((directory, label, name) == (runtime.CANDIDATE_ROOT, runtime.CANDIDATE_SEAL, runtime.CONTAINER))
        owner.prestart()
        identifier = owner.context.operator.create(directory, label, name=name)
        owner.inventory.candidate_id = identifier
        return identifier

    def start_bounded(self, identifier, directory, label, name):
        owner = self.owner
        require(identifier == owner.inventory.candidate_id and identifier is not None
            and (directory, label, name) == (runtime.CANDIDATE_ROOT, runtime.CANDIDATE_SEAL, runtime.CONTAINER))
        owner.prestart()
        owner.inventory.allow_running = True
        return owner.context.operator.start_bounded(identifier, directory, label, name=name)


class Startup:
    def __init__(self, callbacks, context, focused):
        self.callbacks, self.context, self.focused = callbacks, context, focused
        self.committed = probe_owner.authenticate_commit(callbacks)
        self.pins = probe_owner.credential_pins(context)
        self.probe_raw = authenticate_probe(callbacks, self.committed, self.pins)
        self.inventory = StartupInventory(callbacks, context.operator)
        self.before = self.after = self.check = self.evidence = None
        self.start_attempted = False

    def exclusive(self):
        require(self.callbacks.locks_held() is True)
        database._financial(self.committed['proof'])
        require(self.callbacks.protected_read(PROBE_PATH, PROBE_SHA256) == self.probe_raw
            and self.callbacks.protected_read(probe_owner.AUDIT_PATH, probe_owner.AUDIT_SHA256)
                == self.committed['auditRaw'])
        self.context.deadline()
        require(self.context.verify_files() is True and probe_owner.credential_pins(self.context) == self.pins)
        sample = self.inventory.sample()
        require(sample['exclusive'] is True and sample['unknownClaimants'] == [])
        return sample

    def capture(self):
        started = self.callbacks.clock()
        host_before = self.exclusive()
        require(not self.inventory.allow_running)
        application = copy.deepcopy(self.callbacks.transport.application_snapshot())
        receipt = database.capture_snapshot(self.callbacks.transport.query)
        host_after = self.exclusive()
        finished = self.callbacks.clock()
        rehearsal.financial_delta._snapshot(application)
        require(application['readOnly'] is True and database._state(receipt) == self.committed['state']
            and 0 <= (finished-started).total_seconds() <= 60)
        for stamp in (host_before['observedAt'], application['capturedAt'], receipt['observedAt'], host_after['observedAt']):
            require(started <= rehearsal.replay_quiescence._time(stamp) <= finished)
        frame = dict(applicationSnapshot=application, receiptSnapshot=receipt, before=host_before, after=host_after)
        if self.before is None:
            self.before = copy.deepcopy(frame)
        self.after = copy.deepcopy(frame)
        rehearsal._same_application(self.before['applicationSnapshot'], application)
        require(database._state(self.before['receiptSnapshot']) == database._state(receipt))
        return frame

    def bounded_check(self):
        self.capture()
        validate_configuration(self.context)
        started = self.callbacks.clock()
        try:
            self.context.operator.check(runtime.CANDIDATE_ROOT, runtime.CANDIDATE_SEAL)
        finally:
            self.capture()
        finished = self.callbacks.clock()
        validate_configuration(self.context)
        require(0 <= (finished-started).total_seconds() <= 60)
        self.check = dict(status='bounded-candidate-readonly-check-passed', sealSha256=runtime.CANDIDATE_SEAL,
            daemonSha256=self.context.seal['files']['code/replay-daemon.mjs'],
            outerConfigSha256=self.context.seal['files']['config/config.json'])
        self.check_time = finished

    def prestart(self):
        require(self.check is not None and 0 <= (self.callbacks.clock()-self.check_time).total_seconds() <= 60)
        frame = self.capture()
        validate_configuration(self.context)
        readiness = validate_readiness(self.callbacks.protected_read, self.focused, self.context.seal, self.check)
        contract = self.context.contract
        receipt = frame['receiptSnapshot']
        receipt_sha = sha(encoded(database._state(receipt)))
        original_receipt_sha = sha(encoded(database._state(self.before['receiptSnapshot'])))
        application = {key: value for key, value in frame['applicationSnapshot'].items() if key != 'capturedAt'}
        app_sha = sha(encoded(application))
        original_app_sha = sha(encoded({key: value for key, value in self.before['applicationSnapshot'].items()
            if key != 'capturedAt'}))
        evidence = dict(observedAt=self.callbacks.clock().isoformat().replace('+00:00', 'Z'),
            candidateSealSha256=runtime.CANDIDATE_SEAL, **self.committed['proof'],
            stoppedClaimantIds=sorted([runtime.NATIVE_ID, runtime.COMPETITOR_ID]),
            allClaimPathsAccountedFor=frame['after']['exclusive'], claimRpcTransactions=receipt['drain']['transactions'],
            processingReceipts=receipt['drain']['processingReceipts'],
            predecessorFilesSha256=contract.digest(contract.PREDECESSOR_FILES),
            receiptStateBeforeSha256=original_receipt_sha, receiptStateAfterSha256=receipt_sha,
            retryStateBeforeSha256=original_receipt_sha, retryStateAfterSha256=receipt_sha,
            financialStateBeforeSha256=original_app_sha, financialStateAfterSha256=app_sha,
            deadline=dict(epoch=contract.EXPIRY, active=True, stopTarget=runtime.CONTAINER,
                effectiveUnitsVerified=True, timerSha256=contract.TIMER_SHA256, stopperSha256=contract.STOPPER_SHA256),
            fence=dict(committed=True, bodySha256=receipt['routine']['bodySha256'],
                metadataUnchanged=True, oldTokenRefusedBeforeMutation=True),
            jwt=dict(tokenSha256=self.pins['new'], signatureVerified=True,
                serverRoleAudienceVerified=True, serverGenerationVerified=True), readiness=readiness)
        accepted = self.context.prestart.validate_prestart(self.context.seal, runtime.CANDIDATE_SEAL,
            evidence, sha(encoded(evidence)))
        require(accepted['status'] == 'parent-prestart-evidence-accepted-not-started')
        self.evidence = evidence
        return True

    def start(self, directory):
        self.prestart()
        persist(directory.parent/'replay-start-submission.json', encoded(dict(probeAuditSha256=PROBE_SHA256,
            candidateSealSha256=runtime.CANDIDATE_SEAL, evidenceSha256=sha(encoded(self.evidence)))))
        self.start_attempted = True
        return self.controller(directory).start()

    def controller(self, directory):
        return runtime.CutoverRuntime(TrackedOperator(self), self.context.verify_files,
            self.context.competitor, lambda: self.exclusive()['exclusive'], self.prestart,
            lambda phase, value: self.context.journal(directory.parent, phase, value))

    def stop_candidate(self, directory):
        if self.start_attempted:
            self.controller(directory)._stop_candidate(self.inventory.candidate_id)


def operate(callbacks, directory, focused, *, start, state=None):
    owner, running, failure, stopped = None, None, None, True
    try:
        context = Context(external_lock_guard=callbacks.locks_held)
        owner = Startup(callbacks, context, focused)
        if state is not None:
            state['owner'] = owner
        owner.bounded_check()
        owner.prestart()
        if start:
            running = owner.start(directory)
        status = 'replay-started' if start else 'replay-start-preflight-passed'
    except Exception as error:
        if owner is not None:
            try:
                owner.stop_candidate(directory)
            except Exception:
                stopped = False
        status = 'replay-start-refused'
        failure = probe_owner.diagnostic(error)
        trace = error.__traceback__
        while trace is not None:
            if trace.tb_frame.f_globals.get('__name__') in ('replay_start_owner', 'replay_start_inventory', 'replay_start_readiness'):
                failure.update(module=trace.tb_frame.f_globals['__name__'], line=trace.tb_lineno)
            trace = trace.tb_next
    return dict(status=status, checkPassed=owner is not None and owner.check is not None,
        liveReplayStarted=running is not None, launchAuthorized=running is not None,
        startAttempted=owner is not None and owner.start_attempted,
        readinessPassed=owner is not None and owner.check is not None,
        focusedRunnerPassed=owner is not None and owner.evidence is not None,
        prestartPassed=owner is not None and owner.evidence is not None,
        runtime=running, before=None if owner is None else owner.before,
        after=None if owner is None else owner.after, prestart=None if owner is None else owner.evidence,
        diagnostic=failure, transactionAttempted=False, financialActionAttempted=False,
        newPaymentStarted=False, predecessorRestarted=False, receiptCreditProved=False,
        candidateStopConfirmed=stopped if running is None else False)


def invoke(directory, reviewed, verify, read, *, start):
    require(type(start) is bool and type(reviewed) is dict and set(reviewed) in (set(REVIEWED), set(REVIEWED) | {'focusedRunner'})
        and all(reviewed[key] == value for key, value in REVIEWED.items())
        and isinstance(directory, Path) and directory.is_absolute() and directory.name == 'owner'
        and directory.parent.parent == Path('/root') and verify() is True)
    with HeldLocks() as locks:
        callbacks = Callbacks(verify, read, locks)
        state = {}
        result = operate(callbacks, directory, reviewed.get('focusedRunner', FOCUSED), start=start, state=state)
        try:
            require(verify() is True and locks.held() is True)
            raw = encoded(dict(kind='authenticated-replay-start', result=result))
            audit = directory.parent/('replay-start-result-'+uuid.uuid4().hex+'.json')
            persist(audit, raw)
            digest = sha(raw)
            require(read(audit, digest) == raw and verify() is True and locks.held() is True)
        except Exception:
            if 'owner' in state:
                state['owner'].stop_candidate(directory)
            raise ValueError('replay_start_audit_refused') from None
        public = {key: result[key] for key in ('status', 'checkPassed', 'liveReplayStarted', 'launchAuthorized',
            'startAttempted', 'readinessPassed', 'prestartPassed', 'focusedRunnerPassed', 'candidateStopConfirmed', 'transactionAttempted',
            'financialActionAttempted', 'newPaymentStarted', 'predecessorRestarted', 'receiptCreditProved')}
        return dict(public, privateAuditPath=str(audit), auditSha256=digest, probeAuditSha256=PROBE_SHA256)

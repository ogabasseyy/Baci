"""One real rollback rehearsal with authenticated callbacks; no runtime activation."""

from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import uuid

import replay_fence_rehearsal as rehearsal
from replay_rehearsal_inventory import ReplayRehearsalInventory
from replay_rehearsal_support import HeldLocks, command
from replay_rehearsal_transport import ReplayRehearsalTransport


REVIEWED = dict(
    financialAuditPath='/root/baci-existing-payment-continuation.xksoez3y/completed-533ee4d66f624a71b65cc9c268f4baaa.json',
    financialAuditSha256='b05cb92ae1d17fba8b9f09216ac198da08b5470ec11fd851aa0e9c97ec026c9c')
PREPARED = Path('/root/baci-replay-fence-prepared.z1q25lo7')


def require(value):
    if not value:
        raise ValueError('rehearsal_owner_refused')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


class Callbacks:
    def __init__(self, verify, read, locks):
        self.verify, self.read, self.locks = verify, read, locks
        require(self.verify() is True)
        self.transport = ReplayRehearsalTransport(self.run, self.protected_read)
        self.inventory = ReplayRehearsalInventory(run=self.inventory_run,
            clock=self.clock, locks_held=self.locks_held)

    def clock(self):
        return datetime.now(timezone.utc)

    def locks_held(self):
        require(self.verify() is True and self.locks.held() is True)
        return True

    def run(self, argv, input=None, timeout=30):
        require(self.locks_held())
        value = command(argv, input=input, timeout=timeout)
        require(self.locks_held())
        return value

    def inventory_run(self, argv, *, input=None, timeout):
        require(input is None and type(timeout) in (float, int) and 0 < timeout <= 5)
        raw = self.run(argv, timeout=math.ceil(timeout))
        require(len(raw) <= 1000000)
        return raw

    def protected_read(self, path, pin):
        require(self.verify() is True)
        raw = self.read(path, pin)
        require(self.verify() is True)
        return raw

    def authenticate_inputs(self, reviewed):
        require(reviewed == REVIEWED)
        return dict(financialAudit=self.protected_read(Path(REVIEWED['financialAuditPath']),
                REVIEWED['financialAuditSha256']),
            originalDefinition=self.protected_read(PREPARED/'original-definition.sql',
                rehearsal.ORIGINAL_DEFINITION_SHA256),
            rollbackSql=self.protected_read(PREPARED/'rehearsal.sql', rehearsal.ROLLBACK_SQL_SHA256))

    def collect(self):
        before = self.inventory.sample()
        application = self.transport.application_snapshot()
        full_receipt = self.transport.query(rehearsal.cutover_database.SNAPSHOT_SQL)
        receipt = {key: full_receipt[key] for key in ('observedAt', 'identity', 'drain')}
        after = self.inventory.sample()
        return dict(applicationSnapshot=application, before=before, after=after, receipt=receipt)


def public_summary(result, audit_sha256):
    return dict(status=result['status'], transactionAttempted=result.get('transactionAttempted', False),
        rollbackAcknowledged=result.get('rollbackAcknowledged', False),
        protectedApplicationUnchanged=result.get('protectedApplicationUnchanged', False),
        auditSha256=audit_sha256, liveReplayStarted=False, newPaymentStarted=False,
        financialActionAttempted=False, fenceInstalled=False, launchAuthorized=False)


def reserve_submission(directory, now):
    marker = directory/'transaction-submission.json'
    descriptor = os.open(marker, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(descriptor, 'wb') as handle:
        handle.write(encoded(dict(rollbackSqlSha256=rehearsal.ROLLBACK_SQL_SHA256,
            submittedAt=now.isoformat(), acknowledgement='not-yet-observed')))
        handle.flush()
        os.fsync(handle.fileno())
    descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    try:
        os.fsync(descriptor)
    finally:
        os.close(descriptor)


def preflight(callbacks, reviewed):
    inputs = callbacks.authenticate_inputs(reviewed)
    require(hashlib.sha256(inputs['financialAudit']).hexdigest() == reviewed['financialAuditSha256'])
    rehearsal._audit(inputs['financialAudit'])
    inventory = callbacks.inventory.exclusive_inventory()
    require(inventory['exclusive'] is True and inventory['unknownClaimants'] == [])
    current = callbacks.collect()
    rehearsal.replay_quiescence.verify_replay_quiescence(before=current['before'], after=current['after'],
        receipt=current['receipt'], now=callbacks.clock())
    rehearsal.financial_delta._snapshot(current['applicationSnapshot'])
    require(current['applicationSnapshot']['readOnly'] is True)
    snapshot = rehearsal.cutover_database.capture_snapshot(callbacks.transport.query)
    require(snapshot['routine']['bodySha256'] == rehearsal.cutover_database.BODY
        and snapshot['routine']['definitionSha256'] == rehearsal.ORIGINAL_DEFINITION_SHA256)
    return dict(status='replay-rehearsal-preflight-passed', transactionAttempted=False,
        rollbackAcknowledged=False, beforeApplication=current['applicationSnapshot'], receiptSnapshot=snapshot)


def invoke(directory, reviewed, verify, read, *, rehearse):
    require(type(rehearse) is bool)
    require(reviewed == REVIEWED and verify() is True)
    with HeldLocks() as locks:
        callbacks = Callbacks(verify, read, locks)

        def execute_once(raw):
            require(verify() is True and locks.held() is True)
            require(type(raw) is bytes and hashlib.sha256(raw).hexdigest() == rehearsal.ROLLBACK_SQL_SHA256)
            reserve_submission(directory.parent, callbacks.clock())
            return callbacks.transport.execute(raw)

        result = rehearsal.rehearse_replay_fence(reviewed=reviewed,
            reviewed_sha256=hashlib.sha256(encoded(reviewed)).hexdigest(),
            authenticate_inputs=callbacks.authenticate_inputs, collect=callbacks.collect,
            exclusive_inventory=callbacks.inventory.exclusive_inventory,
            query=callbacks.transport.query, execute=execute_once, clock=callbacks.clock) if rehearse else preflight(callbacks, reviewed)
        require(verify() is True and locks.held() is True)
        raw = encoded(dict(kind='authenticated-rollback-only-rehearsal', result=result))
        audit = directory.parent/('rehearsal-result-'+uuid.uuid4().hex+'.json')
        descriptor = os.open(audit, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'wb') as handle:
            handle.write(raw)
            handle.flush()
            os.fsync(handle.fileno())
        digest = hashlib.sha256(raw).hexdigest()
        require(read(audit, digest) == raw and verify() is True)
        summary = public_summary(result, digest)
        summary['privateAuditPath'] = str(audit)
        return summary

"""Source-only resume contract; no CLI, default executor, renewal or grant path.

Parent must authenticate the entire source/callback closure before importing it.
The scope collector executes fixed role guard and inventory SQL alongside the full
protected snapshot in one RO transaction. Successful return is a bounded initial
restoration proof, not a claim about future scheduler runs or physical delivery.
"""

import copy
import hashlib
from pathlib import Path

import notification_resume as BASE
import notification_scope as SCOPE


SQL_PINS = {
    str(Path(__file__).with_name('notification-scope-query.sql').resolve()):
        '1c7a8d44fb84f37d2357509abeefbc5d8465bdd1d7094c25beaa81ad8e3c30a7',
    str(Path(__file__).with_name('notification-role-guard.sql').resolve()):
        '9384fd9054ac08fc88b799ab7dfd666ca77dd049e12d9c7757d405bbf63d3e63',
}


def sources(callbacks):
    return BASE.source_paths(callbacks) | {str(Path(__file__).resolve()),
        str(Path(SCOPE.__file__).resolve()), *SQL_PINS}


def restore_timer(*, reviewed, reviewed_sha256, read, state, collect, scope_collect,
                  exclusive, run, job_state, settle, clock):
    attempted, terminal, cleanup, started = False, None, None, None
    stage = 'reviewed-inputs'
    try:
        BASE.require(type(reviewed) is dict and set(reviewed) == {'inspection', 'scopeBaselinePath',
            'scopeBaselineSha256', 'expectedEvents'}
            and hashlib.sha256(BASE.encoded(reviewed)).hexdigest() == reviewed_sha256)
        reviewed = BASE.decode(BASE.encoded(reviewed))
        inspection = reviewed['inspection']
        callbacks = (read, state, collect, scope_collect, exclusive, run, job_state, settle, clock)
        BASE.require(sources(callbacks) <= set(inspection['sources']))
        BASE.require(all(inspection['sources'][path] == pin for path, pin in SQL_PINS.items()))

        def guard(active=False):
            now = clock()
            BASE.require(now.tzinfo is not None and now.utcoffset().total_seconds() == 0
                and now.timestamp() < BASE.TARGET_EPOCH-90 and exclusive() is True)
            for path, pin in inspection['sources'].items():
                BASE.read_pin(read, path, pin, 0o600)
            for name, pin in BASE.UNIT_PINS.items():
                BASE.read_pin(read, BASE.UNIT_ROOT+name, pin, 0o444)
                value = state(name)
                BASE.notification_contract.validate_effective(name, value,
                    quiescent=name not in (BASE.DEADLINE, BASE.TIMER) or not active and name == BASE.TIMER)
                BASE.require(value['MainPID'] == '0' and value['pendingJobs'] == [])
                if name == BASE.DEADLINE:
                    BASE.require(value['ActiveState'] == 'active' and value['SubState'] == 'waiting'
                        and type(value['nextEpoch']) is int and value['nextEpoch'] == BASE.TARGET_EPOCH
                        and value['Triggers'] == BASE.STOPPER)
                elif name == BASE.TIMER and active:
                    BASE.require(value['ActiveState'] == 'active' and value['SubState'] == 'waiting'
                        and value['Triggers'] == BASE.SERVICE and type(value['nextEpoch']) is int
                        and value['nextEpoch'] > now.timestamp()+120)
                elif name == BASE.STOPPER:
                    BASE.notification_contract.verify_stopper(value)
            for path, pin in BASE.ASSET_PINS.items():
                BASE.read_pin(read, path, pin, 0o444)
            BASE.require(inspection['assets'] == BASE.ASSET_PINS)
            return BASE.decode(BASE.read_pin(read, reviewed['scopeBaselinePath'],
                reviewed['scopeBaselineSha256'], 0o600))

        def inventory():
            value = copy.deepcopy(scope_collect())
            BASE.require(type(value) is dict and set(value) == {'scope', 'protectedSnapshot', 'database'})
            BASE.financial_delta._snapshot(value['protectedSnapshot'])
            SCOPE.validate(value['scope'])
            SCOPE.validate_database(value['database'])
            BASE.require(abs((SCOPE.stamp(value['scope']['capturedAt'])
                -SCOPE.stamp(value['protectedSnapshot']['capturedAt'])).total_seconds()) <= 5
                and 0 <= (clock()-SCOPE.stamp(value['scope']['capturedAt'])).total_seconds() <= 30)
            return value

        def job_terminal():
            value = job_state(BASE.TIMER, started)
            BASE.require(type(value) is dict and set(value) == {'unit', 'submittedAt', 'observedAt',
                'jobId', 'terminal', 'pendingJobs', 'activating'} and value['unit'] == BASE.TIMER
                and value['submittedAt'] == started and type(value['jobId']) is int and value['jobId'] > 0
                and type(value['terminal']) is bool and type(value['pendingJobs']) is list
                and type(value['activating']) is bool)
            observed = SCOPE.stamp(value['observedAt'])
            BASE.require(SCOPE.stamp(started) <= observed <= clock()
                and (clock()-observed).total_seconds() <= 30)
            return value['terminal'] and not value['pendingJobs'] and not value['activating']

        stage = 'postcredit-and-scope'
        result = BASE.inspect_or_restore_check(reviewed=inspection,
            reviewed_sha256=hashlib.sha256(BASE.encoded(inspection)).hexdigest(), read=read, state=state,
            collect=collect, exclusive=exclusive, run=run, job_state=job_state, clock=clock)
        BASE.require(result['status'] == 'notification-resume-inspected'
            and result['protectedStateUnchanged'] is True)
        baseline = guard()
        before = inventory()
        BASE.require(before['database'] == baseline['database'])
        BASE.same(baseline['protectedSnapshot'], before['protectedSnapshot'])
        BASE.require(baseline['scope'] == {**before['scope'], 'capturedAt': baseline['scope']['capturedAt']})
        postcredit = BASE.decode(BASE.read_pin(read, inspection['baselinePath'],
            inspection['baselineSha256'], 0o600))
        BASE.same(postcredit['protectedSnapshot'], before['protectedSnapshot'])
        SCOPE.verify_transition(before['scope'], before['scope'], reviewed['expectedEvents'])
        BASE.require(guard() == baseline)
        started, attempted, stage = clock().isoformat(), True, 'timer-start'
        run([BASE.SYSTEMCTL, 'start', BASE.TIMER], timeout=30)
        terminal = job_terminal()
        BASE.require(terminal)
        settle(BASE.SERVICE, timeout=80)
        guard(active=True)
        stage = 'independent-readback'
        after = inventory()
        BASE.require(before['database'] == after['database'])
        counts = SCOPE.verify_transition(before['scope'], after['scope'], reviewed['expectedEvents'])
        SCOPE.verify_protected(before['protectedSnapshot'], after['protectedSnapshot'],
            before['scope'], after['scope'])
        guard(active=True)
        BASE.require(0 <= (clock()-SCOPE.stamp(started)).total_seconds() <= 120)
        return dict(status='notification-timer-resumed', schedulingRestored=True,
            protectedFinancialAuthCatalogUnchanged=True, existingEventsPreserved=True,
            noEventDuplication=True, financialActionAttempted=False, newPaymentStarted=False,
            deviceReceiptVerified=False, pushReadiness='no-token' if counts['activeStorefrontTokens'] == 0
                else 'token-present-unverified', **counts)
    except Exception:
        if attempted:
            try:
                run([BASE.SYSTEMCTL, 'stop', BASE.TIMER, BASE.SERVICE], timeout=30)
                values = [state(name) for name in (BASE.TIMER, BASE.SERVICE)]
                cleanup = True if all(value['ActiveState'] in ('inactive', 'failed') and value['MainPID'] == '0'
                    and value['pendingJobs'] == [] for value in values) else None
            except Exception:
                cleanup = None
        return dict(status='notification-timer-refused', stage=stage, redacted=True,
            timerStartAttempted=attempted, startJobTerminal=terminal, cleanupConfirmed=cleanup,
            schedulingRestored=False, protectedStateConfirmed=False, financialActionAttempted=False,
            newPaymentStarted=False, deviceReceiptVerified=False)

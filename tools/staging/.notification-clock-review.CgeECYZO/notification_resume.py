"""Parent-sealed postcredit inspection and readonly-check-only restoration.

Callbacks must be authenticated actual collectors: protected stable nofollow reads,
fresh effective unit/job state, held global cutover lock, actual RO financial and
notification inventory. No default live executor or CLI. This helper covers only
inspection/check; authorized normal processing requires separate scoped inventory.
"""

import copy
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import re

import completion_snapshot
import cutover_runtime
import financial_completion
import financial_delta
import notification_contract


SERVICE, CHECK, TIMER, STOPPER, DEADLINE = (notification_contract.SERVICE,
    notification_contract.CHECK, notification_contract.TIMER, notification_contract.STOPPER,
    notification_contract.DEADLINE)
UNIT_ROOT = notification_contract.UNIT_ROOT
TARGET_EPOCH = notification_contract.TARGET_EPOCH
SYSTEMCTL = '/usr/bin/systemctl'
UNITS = (SERVICE, CHECK, TIMER, STOPPER, DEADLINE)
WORKER = '/opt/baci-savings-notifications/worker.mjs'
CA = '/opt/baci-savings-notifications/postgres-ca.pem'
ASSET_PINS = {path: notification_contract.PINS[path] for path in (WORKER, CA)}
UNIT_PINS = dict(zip(UNITS, (
    '1389b96374891bec54d367f779f822f5cfb0314878e27a6a65a3e5a86a957d2d',
    '14cb3de58428a24ec5fdec10d3fc0b1b8825a09ae10a0091170257e6930973fd',
    '5b8ed97034b66bc0e68a8e585ae93cd9a2186ddd3bacd534481e309ce3003fbe',
    '0611c0d1c6ac5b0336e5e4e900e6e3f7393672a261edb52274b495f7cdc5874d',
    '48f37a81d85be48ba5529a61ea8931c80bae3aaf14f6cb9ba25426afb1d6a3ac')))
EVENT = 'ad00ea01-65f0-4594-b4f9-71cb609c6aaa'
REMINDER = '914e9941-c9c1-44a1-9879-1de3e54ac365'


def require(condition):
    if not condition:
        raise ValueError('notification_resume_refused')


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def source_paths(callbacks):
    paths = {str(Path(__file__).resolve()), *(str(Path(module.__file__).resolve()) for module in
        (completion_snapshot, cutover_runtime, financial_completion, financial_delta, notification_contract))}
    for callback in callbacks:
        function = callback.__func__ if hasattr(callback, '__func__') else callback
        require(callable(function) and hasattr(function, '__code__'))
        paths.add(str(Path(function.__code__.co_filename).resolve()))
    return paths


def read_pin(read, path, pin, mode):
    require(type(path) is str and Path(path).is_absolute() and '..' not in Path(path).parts
        and type(pin) is str and re.fullmatch('[a-f0-9]{64}', pin))
    raw, metadata = read(Path(path), mode)
    expected = dict(uid=0, gid=0, mode=mode, nlink=1, regularFile=True)
    require(type(raw) is bytes and 0 < len(raw) <= 16000000
        and hashlib.sha256(raw).hexdigest() == pin and type(metadata) is dict
        and set(metadata) == set(expected) and all(type(metadata[key]) is type(value)
            and metadata[key] == value for key, value in expected.items()))
    return raw


def decode(raw):
    def unique(pairs):
        value = {}
        for key, item in pairs:
            require(key not in value)
            value[key] = item
        return value
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda value: require(False))


def same(first, second):
    require({key: value for key, value in first.items() if key != 'capturedAt'}
        == {key: value for key, value in second.items() if key != 'capturedAt'})


def collection_times(bundle, baseline, now, started):
    require(all(type(value) is datetime and value.tzinfo is not None
        and value.utcoffset().total_seconds() == 0 for value in (now, started))
        and 0 <= (now-started).total_seconds() <= 60)
    report = bundle['completed']
    native = report['nativeEvidence']
    semantic = []
    for evidence in (native, baseline['completed']['nativeEvidence']):
        stable = copy.deepcopy(evidence)
        stable.pop('observedAt')
        stable['receiptStorage'].pop('observedAt')
        stable['provenance'].pop('sourceProofObservedAt')
        semantic.append(stable)
    require(semantic[0] == semantic[1])
    for value in (report['observedAt'], bundle['protectedSnapshot']['capturedAt'], native['observedAt'],
            native['receiptStorage']['observedAt'], native['provenance']['sourceProofObservedAt']):
        observed = datetime.fromisoformat(value.replace('Z', '+00:00'))
        require(observed.tzinfo is not None and observed.utcoffset().total_seconds() == 0
            and started <= observed <= now and 0 <= (now-observed).total_seconds() <= 60)


def completion(bundle, baseline, now, started):
    require(type(bundle) is dict and set(bundle) == {'completed', 'protectedSnapshot', 'activity'})
    report, snapshot = bundle['completed'], bundle['protectedSnapshot']
    collection_times(bundle, baseline, now, started)
    old = baseline['protectedSnapshot']
    financial_delta._snapshot(snapshot)
    financial_delta._snapshot(old)
    require(snapshot['readOnly'] is True and old['readOnly'] is True)
    rows = old['allowedTargetWitnesses']['savings_notifications.events']['targetRows']
    preserved = [row for row in rows if row['id'] == REMINDER]
    require(len(preserved) == 1 and len(rows) == 2)
    notification = report['notifications']
    require(len(notification) == 1 and notification[0]['notificationId'] == EVENT
        and notification[0]['type'] == 'first_contribution' and notification[0]['eventKey'] == 'first-contribution')
    completion_snapshot.verify_completion_snapshot(report, snapshot, preserved_notifications=preserved)
    completion_snapshot.verify_completion_snapshot(baseline['completed'], old, preserved_notifications=preserved)
    same(old, snapshot)
    activity = bundle['activity']
    require(type(activity) is dict and set(activity) == {'activeStorefrontTokens', 'deliveryRows', 'withTicket', 'role'})
    require(all(type(activity[name]) is int and activity[name] >= 0
        for name in ('activeStorefrontTokens', 'deliveryRows', 'withTicket'))
        and activity['withTicket'] <= activity['deliveryRows'])
    expected_role = dict(exists=True, canLogin=True, inherit=False, superuser=False, bypassRls=False,
        createDb=False, createRole=False, replication=False, configIsNull=True, memberCount=0,
        validUntil=notification_contract.TARGET)
    require(type(activity['role']) is dict and set(activity['role']) == set(expected_role)
        and all(type(activity['role'][key]) is type(value) and activity['role'][key] == value
            for key, value in expected_role.items()))
    require(activity == baseline['activity'])
    return activity


def inspect_or_restore_check(*, reviewed, reviewed_sha256, read, state, collect, exclusive,
                            run, job_state, clock, restore_check=False):
    attempted, stopped, terminal, stage = False, None, None, 'sealed-inputs'
    try:
        require(type(restore_check) is bool and type(reviewed) is dict
            and set(reviewed) == {'sources', 'baselinePath', 'baselineSha256', 'assets'}
            and hashlib.sha256(encoded(reviewed)).hexdigest() == reviewed_sha256)
        reviewed = decode(encoded(reviewed))
        callbacks = (read, state, collect, exclusive, run, job_state, clock)
        require(source_paths(callbacks) <= set(reviewed['sources']) and reviewed['assets'] == ASSET_PINS)

        def guard():
            now = clock()
            require(type(now) is datetime and now.tzinfo is not None and now.utcoffset().total_seconds() == 0
                and now.timestamp() < TARGET_EPOCH-90 and exclusive() is True)
            files = {path: read_pin(read, path, pin, 0o600) for path, pin in reviewed['sources'].items()}
            for name, pin in UNIT_PINS.items():
                files[UNIT_ROOT+name] = read_pin(read, UNIT_ROOT+name, pin, 0o444)
            for path, pin in ASSET_PINS.items():
                files[path] = read_pin(read, path, pin, 0o444)
            baseline = decode(read_pin(read, reviewed['baselinePath'], reviewed['baselineSha256'], 0o600))
            for name in UNITS:
                observed = state(name)
                notification_contract.validate_effective(name, observed, quiescent=name != DEADLINE)
                require(observed['MainPID'] == '0' and observed['pendingJobs'] == [])
                if name == DEADLINE:
                    require(observed['ActiveState'] == 'active' and observed['SubState'] == 'waiting'
                        and type(observed['nextEpoch']) is int and observed['nextEpoch'] == TARGET_EPOCH
                        and observed['Triggers'] == STOPPER)
                elif name == STOPPER:
                    notification_contract.verify_stopper(observed)
            started = clock()
            collected = copy.deepcopy(collect())
            finished = clock()
            activity = completion(collected, baseline, finished, started)
            require(exclusive() is True and 0 <= (clock()-now).total_seconds() < 30)
            return files, baseline, activity

        def job_terminal():
            value = job_state(CHECK, started)
            require(type(value) is dict and set(value) == {'unit', 'submittedAt', 'observedAt', 'jobId', 'terminal',
                'pendingJobs', 'activating'} and value['unit'] == CHECK and value['submittedAt'] == started
                and type(value['jobId']) is int and value['jobId'] > 0 and type(value['terminal']) is bool
                and type(value['pendingJobs']) is list and type(value['activating']) is bool)
            observed = datetime.fromisoformat(value['observedAt'].replace('Z', '+00:00'))
            require(datetime.fromisoformat(started) <= observed <= clock()
                and 0 <= (clock()-observed).total_seconds() <= 60)
            return value['terminal'] and not value['pendingJobs'] and not value['activating']

        stage = 'postcredit-inspection'
        files, baseline, activity = guard()
        if restore_check:
            previous = state(CHECK)
            require(guard() == (files, baseline, activity))
            started = clock().isoformat()
            stage, attempted = 'readonly-check', True
            run([SYSTEMCTL, 'start', CHECK], timeout=30)
            terminal = job_terminal()
            require(terminal)
            current = state(CHECK)
            require(current['ActiveState'] == 'active' and current['SubState'] == 'exited'
                and current['Result'] == 'success' and current['ExecMainStatus'] == '0'
                and current['ExecMainCode'] in ('1', 'exited')
                and int(current['ExecMainStartTimestampMonotonic']) > 0
                and int(current['ExecMainStartTimestampMonotonic']) > int(previous['ExecMainStartTimestampMonotonic']))
            run([SYSTEMCTL, 'stop', CHECK], timeout=15)
            require(guard() == (files, baseline, activity))
            stopped = True
        return dict(status='notification-readonly-check-verified' if restore_check else 'notification-resume-inspected',
            protectedStateUnchanged=True, schedulingRestored=False, deliveryRestored=False,
            schedulingPrerequisite='reviewed_current_scoped_processing_inventory', enqueueAttempted=False,
            financialActionAttempted=False, newPaymentStarted=False, deviceReceiptVerified=False,
            pushReadiness='no-token' if activity['activeStorefrontTokens'] == 0 else 'token-present-unverified',
            deliveryRows=activity['deliveryRows'], withTicket=activity['withTicket'], checkStopped=stopped)
    except Exception:
        if attempted:
            try:
                read_pin(read, UNIT_ROOT+CHECK, UNIT_PINS[CHECK], 0o444)
                notification_contract.validate_effective(CHECK, state(CHECK))
                run([SYSTEMCTL, 'stop', CHECK], timeout=15)
                terminal = job_terminal()
                current = state(CHECK)
                stopped = True if terminal and current['ActiveState'] == 'inactive' \
                    and current['SubState'] == 'dead' and current['MainPID'] == '0' and current['pendingJobs'] == [] else None
            except Exception:
                stopped = None
        return dict(status='notification-resume-refused', stage=stage, redacted=True,
            checkAttempted=attempted, checkStopped=stopped, startJobTerminal=terminal,
            schedulingRestored=False, deliveryRestored=False, enqueueAttempted=False,
            financialActionAttempted=False, newPaymentStarted=False, deviceReceiptVerified=False)

"""Parent-injected public-only resume; no CLI/live defaults or financial mutation.
Parent pins the full loaded source/callback closure and holds exclusive launch control.
read proves root-owned metadata, safe ancestors and stable no-follow descriptors;
inventory proves the complete protected app tree. inspect/unit_state provide actual
container profiles and effective commands, not reconstructed assumptions. deadline
proves the existing timer/stopper; exclusive proves the held lock. collect_completed
collects independent authenticated provenance and full read-only financial snapshots.
Optional notificationHistoryAudit pins retained precommit bytes, never current-row
inference. Shared precommit/completion validators bind both phases without normalization.
run is bounded, raises on failure and keeps output private. start_job_state proves
the exact tracked submitted job even after timeout, with no pending jobs/activation;
client exit or cleared InvocationID is insufficient. Unknown identity refuses.
No new HTTP/auth/provider calls, grants, files, timers, container creation, retries
or credit replay occur. Parent must separately seal real callbacks and inputs;
superseded financial packages or historical installers supply no resume authority.
"""

from datetime import datetime, timezone
import copy
import hashlib
import json
from pathlib import Path
import re
import shlex

import cutover_runtime
import financial_completion
import financial_delta
import completion_snapshot as snapshot_binding


CID = 'c6e802349659140803be6b5c2c2f79fca6036f8cbaad50598d67da573d33fa5c'
MANIFEST_PIN = '42b5f4e5f457ccea7fa1b61192251b60e0b8f01b05858fc2220b1944b5de62d8'
UNIT_PIN = '687f2f5b806e35f6d81abcf6aa8d8d3de87b2a6d1a0112d2dd0bbf00f7302d90'
NAME = 'baci-prefunded-public'
SERVICE = NAME + '.service'
UNIT = '/etc/systemd/system/' + SERVICE
ROOT = '/opt/' + NAME
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
DEADLINE = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)


def _require(condition):
    if not condition:
        raise ValueError('public_resume_prerequisite_refused')


def _encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def _pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def _time(value):
    _require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?Z', value))
    return datetime.fromisoformat(value.replace('Z', '+00:00'))


def _fresh(value, now):
    _require(0 <= (now - _time(value)).total_seconds() <= 60)


def _read(read, path, pin, mode):
    _require(type(path) is str and Path(path).is_absolute() and '..' not in Path(path).parts and _pin(pin))
    raw, metadata = read(Path(path), mode=mode)
    _require(type(raw) is bytes and len(raw) <= 64_000_000 and hashlib.sha256(raw).hexdigest() == pin)
    group = 65530 if path in {ROOT + '/config/' + name + '.json' for name in ('checkout', 'anon')} else 0
    expected = dict(uid=0, gid=group, mode=mode, nlink=1, regularFile=True)
    _require(type(metadata) is dict and set(metadata) == set(expected)
        and all(type(metadata[key]) is type(value) and metadata[key] == value for key, value in expected.items()))
    return raw


def _json(raw):
    def unique(pairs):
        result = {}
        for key, value in pairs:
            _require(key not in result)
            result[key] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda value: _require(False))


def _inputs(reviewed, read, inventory, callbacks):
    sources = reviewed['sources']
    required = {str(Path(__file__).resolve()), *(str(Path(module.__file__).resolve())
        for module in (financial_completion, financial_delta, cutover_runtime, snapshot_binding))}
    required.update(str(Path(callback.__func__.__code__.co_filename if hasattr(callback, '__func__')
        else callback.__code__.co_filename).resolve()) for callback in callbacks)
    _require(type(sources) is dict and required <= set(sources) and len(sources) <= 200)
    captured = {path: _read(read, path, pin, 0o600) for path, pin in sources.items()}
    manifest = _read(read, reviewed['manifestPath'], MANIFEST_PIN, 0o600)
    catalog = _json(manifest)
    _require(type(catalog) is dict and catalog['version'] == 1 and type(catalog['files']) is list
        and type(catalog['count']) is int and catalog['count'] == len(catalog['files']) and 2 <= catalog['count'] <= 40000)
    expected = {}
    for entry in catalog['files']:
        name = entry['path']
        _require(type(name) is str and len(name) <= 4096 and '\\' not in name
            and not name.startswith('/') and all(part not in ('', '.', '..') for part in name.split('/')))
        path = ROOT + '/app/' + name
        _require(path not in expected and type(entry['size']) is int and 0 <= entry['size'] <= 64_000_000)
        raw = _read(read, path, entry['sha256'], 0o444)
        _require(len(raw) == entry['size'])
        expected[path] = entry['sha256']
    _require({ROOT + '/app/launch-public.cjs', ROOT + '/app/apps/web/server.js'} <= set(expected)
        and inventory(Path(ROOT + '/app')) == sorted(expected))
    configs = reviewed['configPins']
    _require(type(configs) is dict and set(configs) == {ROOT + '/config/' + name + '.json' for name in ('checkout', 'anon')})
    for path, pin in configs.items():
        captured[path] = _read(read, path, pin, 0o440)
    captured[reviewed['manifestPath']] = manifest
    captured[UNIT] = _read(read, UNIT, UNIT_PIN, 0o644)
    if 'notificationHistoryAudit' in reviewed:
        audit = reviewed['notificationHistoryAudit']
        _require(type(audit) is dict and set(audit) == {'path', 'sha256'})
        captured[audit['path']] = _read(read, audit['path'], audit['sha256'], 0o600)
    return captured


def _unit(unit_state, raw, running):
    observed = unit_state()
    expected = dict(FragmentPath=UNIT, DropInPaths=[], NeedDaemonReload=False, LoadState='loaded',
        Transient=False, Restart='no', ActiveState='active' if running else 'inactive', SubState='running' if running else 'dead')
    _require(type(observed) is dict and all(type(observed[key]) is type(value) and observed[key] == value
        for key, value in expected.items()))
    commands = {}
    for line in raw.decode().splitlines():
        if line.startswith('Exec'):
            key, value = line.split('=', 1)
            _require(key in ('ExecCondition', 'ExecStart', 'ExecStopPost') and key not in commands)
            commands[key] = shlex.split(value.replace('%%', '%'))
    _require(set(commands) == {'ExecCondition', 'ExecStart', 'ExecStopPost'}
        and commands['ExecStart'] == [*DOCKER, 'start', '--attach', NAME]
        and commands['ExecStopPost'] == [*DOCKER, 'stop', '--time', '5', NAME]
        and commands['ExecCondition'] == ['/bin/sh', '-c', 'test "$(/bin/date -u +%s)" -lt "1791302350"']
        and observed['commands'] == commands)
    if running:
        _require(observed['Result'] == 'success' and type(observed['ExecMainStatus']) is int
            and observed['ExecMainStatus'] == 0 and type(observed['MainPID']) is int and observed['MainPID'] > 0
            and re.fullmatch('[a-f0-9]{32}', observed['InvocationID']) and observed['InvocationID'] != '0' * 32)
    return observed


def _container(inspect, contract, running):
    value = inspect(CID)
    _require(type(value['Mounts']) is list and all(type(mount) is dict and type(mount['RW']) is bool
        and all(type(mount[key]) is str for key in ('Type', 'Source', 'Destination')) for mount in value['Mounts']))
    value = dict(value, Mounts=sorted(({key: mount[key] for key in ('Type', 'Source', 'Destination', 'RW')}
        for mount in value['Mounts']), key=lambda mount: mount['Destination']))
    _require(value['Id'] == CID and value['Name'] == '/' + NAME and value['Image'] == IMAGE)
    _require(set(contract) == {'Image', 'Config', 'HostConfig', 'Mounts', 'networks'}
        and all(value[key] == expected for key, expected in contract.items()))
    config, host = value['Config'], value['HostConfig']
    _require(config['User'] == '65530:65530' and config['WorkingDir'] == '/app/apps/web'
        and config['Cmd'] == ['/usr/local/bin/node', '/app/launch-public.cjs']
        and config['Entrypoint'] == ['docker-entrypoint.sh']
        and config['Labels']['com.baci.prefunded.public-manifest'] == MANIFEST_PIN
        and host['ReadonlyRootfs'] is True and host['Privileged'] is False and host['CapDrop'] == ['ALL']
        and host['RestartPolicy'] == dict(Name='no', MaximumRetryCount=0))
    mounts = [dict(Type='bind', Source=ROOT + '/app', Destination='/app', RW=False)]
    mounts.extend(dict(Type='bind', Source=ROOT + '/config/' + name + '.json',
        Destination='/run/pvb-public/' + name + '.json', RW=False) for name in ('checkout', 'anon'))
    _require(value['Mounts'] == sorted(mounts, key=lambda mount: mount['Destination'])
        and value['networks'] == ['baci-isolated-savings_database', 'pvb-staging-intake-ingress'])
    state = value['State']
    _require(state['Running'] is running and all(state[key] is False for key in ('Paused', 'Restarting', 'Dead', 'OOMKilled'))
        and state['Status'] == ('running' if running else 'exited') and (running or state['ExitCode'] in (0, 143)))


def _history(reviewed, captured):
    if 'notificationHistoryAudit' not in reviewed:
        return ()
    audit = _json(captured[reviewed['notificationHistoryAudit']['path']])
    before, precommit = audit['before']['protectedSnapshot'], audit['precommit']
    financial_delta._snapshot(before)
    _require(before['readOnly'] is True)
    preserved = snapshot_binding._preserved_notifications(
        before['allowedTargetWitnesses']['savings_notifications.events']['targetRows'],
        precommit['report']['nativeEvidence']['scope'])
    snapshot_binding.verify_precommit_snapshot(precommit['report'], precommit['protectedSnapshot'],
        preserved_notifications=preserved)
    financial_delta.prove_allowed_deltas(before, precommit['protectedSnapshot'])
    return preserved


def _completion(collect_completed, clock, preserved=()):
    bundle = copy.deepcopy(collect_completed())
    now = clock()
    _require(type(now) is datetime and now.tzinfo is not None and now < DEADLINE)
    _require(type(bundle) is dict and set(bundle) == {'completed', 'protectedSnapshot'})
    report, snapshot = bundle['completed'], bundle['protectedSnapshot']
    proof = financial_completion.validate_completed(report)
    _fresh(report['observedAt'], now)
    _fresh(report['nativeEvidence']['observedAt'], now)
    _fresh(report['nativeEvidence']['provenance']['sourceProofObservedAt'], now)
    _fresh(report['nativeEvidence']['receiptStorage']['observedAt'], now)
    financial_delta._snapshot(snapshot)
    _require(snapshot['readOnly'] is True)
    _fresh(snapshot['capturedAt'], now)
    _require(report['treasury']['budgetKobo'] - report['treasury']['consumedKobo'] - report['treasury']['reservedKobo'] == 0)
    binding = snapshot_binding.verify_completion_snapshot(report, snapshot, preserved_notifications=preserved)
    _require(type(binding) is dict and binding.get('snapshotCompletionBound') is True)
    return proof, {key: value for key, value in snapshot.items() if key != 'capturedAt'}, snapshot['capturedAt']


def _terminal(start_job_state, started, clock):
    value = start_job_state(SERVICE, started)
    _require(type(value) is dict and set(value) == {'unit', 'submittedAt', 'observedAt', 'jobId',
        'terminal', 'pendingJobs', 'activating'} and value['unit'] == SERVICE
        and _time(value['submittedAt']) == started and type(value['jobId']) is int and value['jobId'] > 0
        and type(value['terminal']) is bool and type(value['pendingJobs']) is list
        and type(value['activating']) is bool)
    _fresh(value['observedAt'], clock())
    _require(_time(value['observedAt']) >= started)
    return value['terminal'] and value['pendingJobs'] == [] and not value['activating']


def resume_public(*, reviewed, reviewed_sha256, read, inventory, inspect, unit_state,
                  collect_completed, deadline, exclusive, run, start_job_state=None,
                  clock=lambda: datetime.now(timezone.utc)):
    attempted, unchanged, terminal, stage = False, None, None, 'reviewed-inputs'
    try:
        _require(_pin(reviewed_sha256) and hashlib.sha256(_encoded(reviewed)).hexdigest() == reviewed_sha256
            and type(reviewed) is dict and set(reviewed) in ({'manifestPath', 'configPins', 'sources', 'container'},
                {'manifestPath', 'configPins', 'sources', 'container', 'notificationHistoryAudit'}))
        reviewed = _json(_encoded(reviewed))
        callbacks = (read, inventory, inspect, unit_state, collect_completed, deadline, exclusive, run,
            start_job_state, clock)
        _require(all(callable(callback) for callback in callbacks))
        def guard(running):
            now = clock()
            _require(type(now) is datetime and now.tzinfo is not None and now < DEADLINE and exclusive() is True)
            _require(deadline() == dict(epoch=1791302350, active=True, stopTarget=NAME))
            captured = _inputs(reviewed, read, inventory, callbacks)
            _container(inspect, reviewed['container'], running)
            state = _unit(unit_state, captured[UNIT], running)
            _require(0 <= (clock() - now).total_seconds() <= 60 and clock() < DEADLINE and exclusive() is True)
            return captured, state
        stage = 'stopped-preflight'
        original, previous_unit = guard(False)
        preserved = _history(reviewed, original)
        before_proof, before, snapshot_at = _completion(collect_completed, clock, preserved)
        stage = 'fresh-prestart'
        _require(guard(False)[0] == original)
        before_proof, current, snapshot_at = _completion(collect_completed, clock, preserved)
        _require(current == before)
        _require(guard(False)[0] == original)
        started = clock()
        _fresh(before_proof['financialProofObservedAt'], started)
        _fresh(snapshot_at, started)
        _require((DEADLINE - started).total_seconds() > 30)
        stage, attempted = 'bounded-start', True
        run(['/usr/bin/systemctl', 'start', SERVICE], timeout=30)
        _require(0 <= (clock() - started).total_seconds() <= 30)
        terminal = _terminal(start_job_state, started, clock)
        _require(terminal)
        stage = 'running-postflight'
        installed, current_unit = guard(True)
        _require(installed == original and current_unit['InvocationID'] != previous_unit['InvocationID']
            and started <= _time(current_unit['startedAt']) <= clock())
        proof, after, snapshot_at = _completion(collect_completed, clock, preserved)
        _require(before == after)
        _require(guard(True) == (installed, current_unit))
        _fresh(proof['financialProofObservedAt'], clock())
        _fresh(snapshot_at, clock())
        unchanged = True
        return dict(status='public-service-resumed', containerId=CID, manifestSha256=MANIFEST_PIN,
            financialProofSha256=proof['financialProofSha256'], startAttempts=1,
            protectedStateUnchanged=True, httpAcceptanceVerified=False)
    except BaseException:
        stopped = None
        if attempted:
            try:
                value = inspect(CID)
                _require(value['Id'] == CID and value['Name'] == '/' + NAME and value['Image'] == IMAGE)
                try:
                    run([*DOCKER, 'stop', '--time', '5', CID], timeout=15)
                except BaseException:
                    pass
                terminal = None
                terminal = _terminal(start_job_state, started, clock)
                value = inspect(CID)
                _require(value['Id'] == CID and value['Name'] == '/' + NAME
                    and value['Image'] == IMAGE and type(value['State']['Running']) is bool)
                stopped = False if value['State']['Running'] else (True if terminal else None)
            except BaseException:
                pass
        return dict(status='public-resume-refused', stage=stage, startAttempted=attempted,
            startJobTerminal=terminal, ownedContainerStopped=stopped, protectedStateUnchanged=unchanged, redacted=True)

import time

from mutation_contract import EPOCH, fresh, window
from installation_contract import REPLAY_ROOT
from readiness_evidence import PATHS, passwords
from readiness_evidence_io import command, decode, inspection, pinned
from readiness_evidence_jwt import verify as verify_jwt
from readiness_evidence_runtime import collect as restricted_checks
from readiness_evidence_snapshot import collect as snapshot_tls
from readiness_evidence_timers import collect as timers
from release_contract import DEADLINE, Refused, digest, _require
from runtime_owner_support import DOCKER
from runtime_scheduler import validate_container as validate_worker
from replay_cutover_runtime import CONTAINER, validate_container as validate_replay
from systemd_deadline_reader import wrapper


def wait_public(check, run, now=time.time, *, clock=None, pause=None):
    clock = time.monotonic if clock is None else clock
    pause = time.sleep if pause is None else pause
    started = clock()

    def remaining():
        current = now()
        window(current)
        elapsed = clock() - started
        _require(0 <= elapsed < 30, 'public_mutation_startup_timeout')
        return min(30 - elapsed, EPOCH - 600 - current)

    def bounded_run(arguments, **kwargs):
        kwargs['timeout'] = min(kwargs.get('timeout', 30), remaining())
        result = run(arguments, **kwargs)
        remaining()
        return result

    while True:
        remaining()
        try:
            observed = check(bounded_run)
        except Refused as error:
            if str(error) != 'public_mutation_public_not_running':
                raise
        else:
            remaining()
            return observed
        pause(min(0.1, remaining()))


def active_runtime(seal_sha, run=command, now=time.time, *, bounds):
    started = now()
    window(started)
    bounds.verify_runtime(run)
    replay = inspection(CONTAINER, run)
    validate_replay(replay, str(REPLAY_ROOT), seal_sha)
    _require(replay['State']['Running'] is True, 'public_mutation_replay_stopped')
    heartbeat = run([*DOCKER, 'exec', '--user=65532:65532', CONTAINER, 'node', '-e',
        "process.stdout.write(require('node:fs').readFileSync('/tmp/replay-heartbeat','utf8'))"]).strip()
    _require(heartbeat.isdecimal() and len(heartbeat) == 13
             and 0 <= now() - int(heartbeat) / 1000 <= 60,
             'public_mutation_replay_pass_stale')
    for kind in ('snapshot', 'background'):
        name = 'baci-prefunded-' + kind
        row = inspection(name, run)
        validate_worker(row, kind, seal_sha)
        _require(row['State']['Running'] is False and row['State']['ExitCode'] == 0,
                 'public_mutation_worker_pass_required')
        fresh(row['State']['StartedAt'], now(), 120)
        fresh(row['State']['FinishedAt'], now(), 120)
        report = decode(run([*DOCKER, 'logs', '--since', row['State']['StartedAt'], name]))
        accepted = [{'status': 'completed'}] if kind == 'background' else [
            {'outcome': 'recorded'}, {'outcome': 'duplicate'}]
        _require(report in accepted, 'public_mutation_worker_report_refused')
        service = run(['/usr/bin/systemctl', 'show', name + '.service',
            '--property=ActiveState,Result,ExecMainStatus,DropInPaths,NeedDaemonReload'])
        from readiness_evidence_timers import properties
        _require(properties(service) == {'ActiveState': 'inactive', 'Result': 'success',
            'ExecMainStatus': '0', 'DropInPaths': '', 'NeedDaemonReload': 'no'},
            'public_mutation_worker_unit_refused')
        timer = run(['/usr/bin/systemctl', 'show', name + '.timer',
            '--property=ActiveState,SubState,DropInPaths,NeedDaemonReload'])
        _require(properties(timer) == {'ActiveState': 'active', 'SubState': 'waiting',
            'DropInPaths': '', 'NeedDaemonReload': 'no'}, 'public_mutation_schedule_refused')
    _require(0 <= now() - started <= 60, 'public_mutation_runtime_collection_stale')
    return {'status': 'activated-runtime-current', 'deadline': DEADLINE,
        'replay': 'fresh-completed-pass', 'snapshot': 'fresh-completed-pass',
        'background': 'fresh-completed-pass', 'schedules': ['snapshot', 'background']}


def collect(request, seal, seal_sha, run=command, now=time.time, *, bounds):
    started = now()
    window(started)
    _require(request['seal']['sha256'] == seal_sha, 'public_mutation_runtime_seal_mismatch')
    contents = {name: pinned(request['artifacts'][name]) for name in PATHS}
    for name, path in PATHS.items():
        _require(request['artifacts'][name]['path'] == path, 'public_mutation_artifact_path_refused')
    for name in ('readiness', 'background', 'snapshot', 'daemon', 'factory'):
        relative = ('replay/' + ('replay-daemon.mjs' if name == 'daemon'
                    else 'prefunded-replay-bundle.mjs') if name in ('daemon', 'factory')
                    else 'workers/' + name + '.cjs')
        _require(digest(contents[name]) == seal['files'][relative], 'public_mutation_artifact_drift')
    verify_jwt(decode(contents['replayConfig']), contents['factoryConfig'],
               decode(pinned(request['signingKeys'], private=True)), started)
    configuration = decode(contents['snapshotConfig'])
    other = passwords(decode(contents['activationConfig'])) + passwords(decode(contents['factoryConfig']))
    _require(other and configuration['database']['password'] not in other,
             'public_mutation_snapshot_credential_shared')
    current = active_runtime(seal_sha, run, now, bounds=bounds)
    checks = restricted_checks(seal_sha, seal_sha,
        lambda arguments: bounds.guarded_run(arguments, run=run))
    checks.update(snapshot_tls(configuration, request['snapshotCaContainerPath'], run))
    deadlines = timers(request['artifacts'], lambda arguments: wrapper(arguments, run=run))
    _require(len(deadlines) == 3, 'public_mutation_deadlines_missing')
    for name in PATHS:
        _require(pinned(request['artifacts'][name]) == contents[name], 'public_mutation_artifact_changed')
    _require(active_runtime(seal_sha, run, now, bounds=bounds) == current,
             'public_mutation_runtime_changed')
    _require(0 <= now() - started <= 60, 'public_mutation_runtime_collection_stale')
    return current, checks

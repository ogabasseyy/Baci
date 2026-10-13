from readiness_evidence_io import DOCKER, command, decode, inspection, require
from replay_cutover_runtime import CONTAINER as REPLAY, validate_container as validate_replay
from runtime_scheduler import validate_container as validate_worker

TLS = {'status': 'restricted-tls-ready', 'profiles': ['worker', 'authorizer', 'evidence'],
       'readOnly': True, 'cardPaymentsEnabled': False}
REPLAY_READY = {'status': 'replay-runtime-ready', 'readOnly': True}


def collect(worker_label_sha, replay_label_sha, run=command):
    checks = [('baci-prefunded-readiness', lambda value: validate_worker(value, 'readiness', worker_label_sha), TLS),
              (REPLAY + '-check', lambda value: validate_replay(value, '/opt/baci-prefunded-replay',
                                                               replay_label_sha, check=True), REPLAY_READY)]
    results = []
    for name, validate, expected in checks:
        before = inspection(name, run)
        validate(before)
        require(before.get('State', {}).get('Running') is False, 'check_container_already_running')
        output = decode(run([*DOCKER, 'start', '--attach', name]))
        after = inspection(name, run)
        validate(after)
        require(after.get('State', {}).get('Running') is False
                and after.get('State', {}).get('ExitCode') == 0 and output == expected,
                'runtime_check_refused')
        results.append(output)
    return {'tlsReadiness': results[0], 'replayReadiness': results[1], 'replayConfigurationChecked': True}


def financial_state(phase, worker_label_sha, replay_label_sha, run=command):
    require(phase in ('prestart', 'preschedule'), 'phase_refused')
    for kind in ('background', 'snapshot'):
        value = inspection('baci-prefunded-' + kind, run)
        validate_worker(value, kind, worker_label_sha)
        require(value.get('State', {}).get('Running') is False, 'financial_worker_running')
        observed = run(['/usr/bin/systemctl', 'show', '--property=ActiveState,SubState',
                        '--no-pager', 'baci-prefunded-' + kind + '.timer'])
        from readiness_evidence_timers import properties
        require(properties(observed) == {'ActiveState': 'inactive', 'SubState': 'dead'},
                'financial_schedule_running')
    value = inspection(REPLAY, run)
    validate_replay(value, '/opt/baci-prefunded-replay', replay_label_sha)
    require(value.get('State', {}).get('Running') is (phase == 'preschedule'), 'financial_replay_state_refused')
    return {'financialContainersStopped': phase == 'prestart', 'financialSchedulesStopped': True,
            'isolationContractsVerified': True}

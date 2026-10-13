"""Focused-runner evidence adapter: unavailable evidence never grants launch."""

from pathlib import Path
import re

from cutover_runtime import CANDIDATE_SEAL, CANDIDATE_ROOT
from replay_fence_commit_owner import sha
from replay_fence_rehearsal import _decode
from replay_rehearsal_transport import LIMIT
from replay_quiescence import _time, DEADLINE
import cutover_database as database
from replay_rehearsal_owner import encoded


FOCUSED = dict(path='/root/baci-complete-replay-focused-evidence-20261004.json',
    sha256='a7bf2464f576dcfc48def4bf966a1e9685795a025b7f8e408a6275861515353b')
REPORT_PATH = Path('/root/baci-reviewed-replay-focused-20261004.json')
REPORT_SHA256 = 'dd763b8e8d9cd6c874e3c0557c983a726171110f81e5d2bb3f5352dc6fa8ecf2'


def validate_configuration(context):
    contract, seal = context.contract, context.seal
    pin = seal['files']['config/config.json']
    raw = context.owner.read(Path(CANDIDATE_ROOT)/'config/config.json', pin, modes=(0o440, 0o600))
    if type(raw) is not bytes or not 0 < len(raw) <= LIMIT or sha(raw) != pin:
        raise ValueError('dual_executor_config_pin_refused')
    value = _decode(raw)
    expected = dict(environment='staging', appSystemId=contract.APP_SYSTEM, receiptSystemId=contract.RECEIPT_SYSTEM,
        prefundedReplay=dict(bundleSha256=seal['files']['code/prefunded-replay-bundle.mjs'],
            configurationSha256=seal['files']['config/prefunded.json']))
    if (type(value) is not dict or set(value) != contract.BASE_FIELDS | {'prefundedReplay', 'paidInterestDatabase'}
            or any(value.get(key) != item for key, item in expected.items())
            or type(value['receiptToken']) is not str or sha(value['receiptToken'].encode()) != seal['receiptTokenSha256']):
        raise ValueError('dual_executor_config_scope_refused')
    paid = value['paidInterestDatabase']
    scope = dict(host=contract.HOST, port=5432, database='postgres', role='prefunded_treasury_operator',
        integrationId=contract.INTEGRATION, businessId=contract.BUSINESS)
    if (type(paid) is not dict or set(paid) != set(scope) | {'password', 'ssl'}
            or any(type(paid[key]) is not type(item) or paid[key] != item for key, item in scope.items())
            or type(paid['password']) is not str or not 16 <= len(paid['password']) <= 1024
            or type(paid['ssl']) is not dict or set(paid['ssl']) != {'ca'}
            or type(paid['ssl']['ca']) is not str or not 1 <= len(paid['ssl']['ca']) <= 65536):
        raise ValueError('paid_interest_config_scope_refused')


def full_report(read, evidence):
    raw = read(REPORT_PATH, REPORT_SHA256)
    if type(raw) is not bytes or not 0 < len(raw) <= LIMIT or sha(raw) != REPORT_SHA256:
        raise ValueError('focused_full_report_pin_refused')
    report = _decode(raw)
    expected = dict(numTotalTestSuites=12, numPassedTestSuites=12, numFailedTestSuites=0,
        numPendingTestSuites=0, numTotalTests=111, numPassedTests=111, numFailedTests=0,
        numPendingTests=0, numTodoTests=0, success=True)
    if (type(report) is not dict or set(report) != set(expected) | {'snapshot', 'startTime', 'testResults'}
            or any(type(report[key]) is not type(value) or report[key] != value for key, value in expected.items())
            or type(report['testResults']) is not list or len(report['testResults']) != 11
            or type(report['snapshot']) is not dict or report['snapshot'].get('failure') is not False):
        raise ValueError('focused_full_report_totals_refused')
    witnessed, count = set(), 0
    for suite in report['testResults']:
        if (type(suite) is not dict or set(suite) != {'assertionResults', 'endTime', 'message', 'name', 'startTime', 'status'}
                or suite['status'] != 'passed' or suite['message'] != '' or type(suite['name']) is not str
                or type(suite['assertionResults']) is not list or not suite['assertionResults']):
            raise ValueError('focused_full_report_suite_refused')
        paths = [path for path in evidence['passedSuitePaths'] if suite['name'].endswith('/'+path)]
        if len(paths) != 1 or paths[0] in witnessed:
            raise ValueError('focused_full_report_scope_refused')
        witnessed.add(paths[0])
        for assertion in suite['assertionResults']:
            if (type(assertion) is not dict or assertion.get('status') != 'passed'
                    or assertion.get('failureMessages') != []):
                raise ValueError('focused_full_report_assertion_refused')
            count += 1
    if witnessed != set(evidence['passedSuitePaths']) or count != evidence['totalTests']:
        raise ValueError('focused_full_report_count_refused')


def validate_readiness(read, reviewed, seal, check):
    if type(reviewed) is not dict or reviewed != FOCUSED:
        raise ValueError('authenticated_focused_runner_evidence_required')
    path = Path(reviewed['path'])
    pin = reviewed['sha256']
    if (not path.is_absolute() or path.parts[:2] != ('/', 'root') or '..' in path.parts
            or type(pin) is not str or not re.fullmatch('[a-f0-9]{64}', pin)):
        raise ValueError('focused_runner_path_refused')
    raw = read(path, pin)
    if type(raw) is not bytes or not 0 < len(raw) <= LIMIT or sha(raw) != pin:
        raise ValueError('focused_runner_pin_refused')
    report = _decode(raw)
    expected = dict(kind='actual-focused-replay-runner', candidateSealSha256=CANDIDATE_SEAL,
        daemonSha256=seal['files']['code/replay-daemon.mjs'],
        sourceTableSha256=seal['daemonArtifact']['productionTableSha256'], allSuitesPassed=True, exitCode=0)
    if (type(report) is not dict or set(report) != set(expected) | {
                'runnerReportSha256', 'sourcePins', 'passedSuitePaths', 'totalTests', 'observedAt'}
            or any(type(report[key]) is not type(value) or report[key] != value for key, value in expected.items())
            or type(report['totalTests']) is not int or report['totalTests'] != 111):
        raise ValueError('focused_runner_schema_refused')
    suites, sources = report['passedSuitePaths'], report['sourcePins']
    if (type(suites) is not list or len(suites) != 11
            or any(type(name) is not str or not name or '..' in Path(name).parts for name in suites)
            or len(set(suites)) != len(suites) or type(sources) is not list or len(sources) != 47
            or any(type(row) is not dict or set(row) != {'path', 'sha256'}
                or type(row['path']) is not str or not row['path'] or '..' in Path(row['path']).parts
                or type(row['sha256']) is not str or not re.fullmatch('[a-f0-9]{64}', row['sha256']) for row in sources)
            or len({row['path'] for row in sources}) != 47 or sha(encoded(sources)) != report['sourceTableSha256']
            or type(report['runnerReportSha256']) is not str
            or report['runnerReportSha256'] != REPORT_SHA256
            or not _time(report['observedAt']) <= database._now() < _time(DEADLINE)):
        raise ValueError('focused_runner_suite_refused')
    full_report(read, report)
    if check != dict(status='bounded-candidate-readonly-check-passed', sealSha256=CANDIDATE_SEAL,
            daemonSha256=expected['daemonSha256'], outerConfigSha256=seal['files']['config/config.json']):
        raise ValueError('actual_candidate_check_required')
    return dict(checkExitedZero=True, readOnly=True, prefundedFactoryLoaded=True, paidInterestReady=True,
        focusedRunnerPassed=True, daemonSha256=expected['daemonSha256'],
        outerConfigSha256=seal['files']['config/config.json'], focusedRunnerEvidenceSha256=pin)

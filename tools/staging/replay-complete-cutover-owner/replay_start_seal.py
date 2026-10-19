"""Isolated guarded replay-start bootstrap; no SQL submission or financial workers.

The parent independently authenticates this file before python3 -I -S -B.
The owner must authenticate retained probe/commit audit bytes and readiness proof.
Only the explicit --start phase may authorize the exact sealed candidate runtime.
All source bytes, including nonloaded claim_probe.cjs, are revalidated under locks.
"""

import hashlib
import json
import os
from pathlib import Path
import re
import stat
import sys
from types import ModuleType


MODULES = ('cutover_runtime', 'financial_delta', 'financial_completion', 'completion_snapshot',
    'cutover_database', 'replay_quiescence', 'replay_fence_rehearsal',
    'replay_rehearsal_transport', 'replay_rehearsal_inventory',
    'replay_rehearsal_support', 'replay_rehearsal_owner', 'replay_fence_commit_owner',
    'cutover_context', 'cutover_probes', 'probe_transport', 'replay_generation_probe_owner',
    'replay_start_inventory', 'replay_start_readiness', 'replay_start_owner')
SOURCE_FILES = {name + '.py' for name in MODULES} | {'claim_probe.cjs'}
FENCE_PIN = '0a2f0610b68ec0565788bf4ad06a4e5f90c2eda63406e9639ef2418f8fcd5e29'
FOCUSED = dict(path='/root/baci-complete-replay-focused-evidence-20261004.json',
    sha256='a7bf2464f576dcfc48def4bf966a1e9685795a025b7f8e408a6275861515353b')
RUNNER_PATH = Path('/root/baci-reviewed-replay-focused-20261004.json')
RUNNER_SHA = 'dd763b8e8d9cd6c874e3c0557c983a726171110f81e5d2bb3f5352dc6fa8ecf2'
PRODUCTION_SHA = '281672df75f45d705ba5eab08c9c135565604e67151c76905c20d6dad07b5b45'
REVIEWED = dict(
    committedAuditPath='/root/baci-replay-fence-commit.MTc1AqYx/fence-commit-result-6a22efcd1f1d460f81a8a5b03c6f89d4.json',
    committedAuditSha256='2b960715c86bdad3b5bf708a21d8bfdb54dca7a67235bc6a77ca5db53c280928',
    committedReceiptSha256='c87f7c6f8c54f7e63220de4f43bf6604fbe36b90a11bba52fc50985584190f4a',
    scriptSha256='65498dbb3a67e4228e7cdaf1def6d172a2f0ca76c1462d46701e41761fe076be',
    probeAuditPath='/root/baci-generation-probes.LlLovPq2/generation-probe-result-9431348e28964275beb38e95f13f1791.json',
    probeAuditSha256='3b9b84840d92f9b5cd239ac544ca15bd0e00f213d3d4aa556744caf991a1b6b4', focusedRunner=FOCUSED)
FINGERPRINT = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
    'st_size', 'st_mtime_ns', 'st_ctime_ns')
SUCCESSES = ('replay-start-preflight-passed', 'replay-started')


def require(value):
    if not value:
        raise ValueError('replay_start_seal_refused')


def pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':'), allow_nan=False).encode()


def decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            require(name not in result)
            result[name] = value
        return result
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda _: require(False))


def protected(path, expected):
    path = Path(path)
    require(path.is_absolute() and '..' not in path.parts and pin(expected))
    parents = {parent: parent.lstat() for parent in path.parents}
    require(all(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o022 for info in parents.values()))
    before = path.lstat()
    require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1
        and 0 < before.st_size <= 16000000)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16000001)
        after = os.fstat(handle.fileno())
    fingerprint = lambda info: tuple(getattr(info, field) for field in FINGERPRINT)
    require(all(fingerprint(before) == fingerprint(info) for info in (opened, after, path.lstat()))
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == expected
        and all(fingerprint(parent.lstat()) == fingerprint(info) for parent, info in parents.items()))
    return raw


def validate_manifest(manifest):
    require(type(manifest) is dict and set(manifest) == {
        'kind', 'files', 'fenceInventorySha256', 'reviewed'}
        and manifest['kind'] == 'guarded-replay-start'
        and manifest['fenceInventorySha256'] == FENCE_PIN
        and type(manifest['files']) is dict
        and set(manifest['files']) == SOURCE_FILES
        and all(pin(value) for value in manifest['files'].values())
        and type(manifest['reviewed']) is dict
        and manifest['reviewed'] == REVIEWED)
    if 'focusedRunner' in manifest['reviewed']:
        focused = manifest['reviewed']['focusedRunner']
        require(type(focused) is dict and set(focused) == {'path', 'sha256'}
            and type(focused['path']) is str and pin(focused['sha256']))
        path = Path(focused['path'])
        require(path.is_absolute() and path.parts[:2] == ('/', 'root') and '..' not in path.parts)


def exact_directory(directory, names):
    require({entry.name for entry in directory.iterdir()} == set(names))
    info = directory.lstat()
    require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and stat.S_IMODE(info.st_mode) == 0o700)


def validate_focused(raw, runner_raw):
    require(hashlib.sha256(raw).hexdigest() == FOCUSED['sha256']
        and hashlib.sha256(runner_raw).hexdigest() == RUNNER_SHA)
    evidence, runner = decode(raw), decode(runner_raw)
    expected = dict(kind='actual-focused-replay-runner',
        candidateSealSha256='69585e50cb88aeac5e0660ed235b39f6ac6d675b35cf9acabd32cd2945d695ba',
        daemonSha256='20a14582973e49d77f13140854107d386586364c8831a23e203b1967e7223126',
        sourceTableSha256=PRODUCTION_SHA, runnerReportSha256=RUNNER_SHA, totalTests=111,
        allSuitesPassed=True, exitCode=0)
    require(type(evidence) is dict and set(evidence) == set(expected) | {'sourcePins', 'passedSuitePaths', 'observedAt'}
        and all(type(evidence[key]) is type(value) and evidence[key] == value for key, value in expected.items()))
    sources, suites = evidence['sourcePins'], evidence['passedSuitePaths']
    require(type(sources) is list and len(sources) == 47 and hashlib.sha256(encoded(sources)).hexdigest() == PRODUCTION_SHA
        and type(suites) is list and len(suites) == len(set(suites)) == 11)
    counts = dict(numTotalTests=111, numPassedTests=111, numFailedTests=0, numPendingTests=0,
        numTodoTests=0, numTotalTestSuites=12, numPassedTestSuites=12, numFailedTestSuites=0, numPendingTestSuites=0)
    require(type(runner) is dict and runner.get('success') is True
        and all(type(runner.get(key)) is int and runner[key] == value for key, value in counts.items())
        and runner['snapshot']['failure'] is False and type(runner['testResults']) is list
        and len(runner['testResults']) == 11)
    prefix = '/private/tmp/baci-reviewed-replay-harness-qc4tend2/'
    results = runner['testResults']
    require(sorted(row['name'] for row in results) == [prefix + name for name in suites]
        and all(row['status'] == 'passed' and row['message'] == '' and row['assertionResults'] for row in results))
    assertions = [test for row in results for test in row['assertionResults']]
    require(len(assertions) == 111 and all(test['status'] == 'passed' and test['failureMessages'] == [] for test in assertions))


def capture(directory, seal):
    raw = protected(directory / 'release.json', seal)
    require(hashlib.sha256(raw).hexdigest() == seal)
    manifest = decode(raw)
    validate_manifest(manifest)
    exact_directory(directory, set(manifest['files']) | {'release.json', 'replay_start_seal.py'})
    captured = {name: protected(directory / name, digest) for name, digest in manifest['files'].items()}
    fence = directory.parent / 'replay-claim-fence'
    inventory = protected(fence / 'SOURCE-INVENTORY.sha256', FENCE_PIN)
    fence_bytes = {}
    for line in inventory.decode().splitlines():
        digest, name = line.split('  ')
        require(pin(digest) and re.fullmatch('[a-zA-Z0-9_.-]+', name) and name not in fence_bytes)
        fence_bytes[name] = protected(fence / name, digest)
    require('renderer.py' in fence_bytes and 'contract.py' in fence_bytes)
    exact_directory(fence, set(fence_bytes) | {'SOURCE-INVENTORY.sha256'})
    return manifest, captured, fence_bytes


def load_modules(directory, captured):
    require(all(name not in sys.modules for name in MODULES)
        and set(captured) == SOURCE_FILES)
    modules = {}
    for name in MODULES:
        module = ModuleType(name)
        module.__file__ = str(directory / (name + '.py'))
        sys.modules[name] = module
        exec(compile(captured[name + '.py'], module.__file__, 'exec'), module.__dict__)
        modules[name] = module
    return modules


def public_summary(result, *, start):
    require(type(result) is dict and type(result.get('status')) is str)
    require(result['status'] in (*SUCCESSES, 'replay-start-refused'))
    require(all(result.get(name) is False for name in (
        'transactionAttempted', 'newPaymentStarted', 'financialActionAttempted')))
    require(all(name not in result or result[name] is False for name in (
        'predecessorRestarted', 'receiptCreditProved')))
    require(type(result.get('liveReplayStarted')) is bool
        and type(result.get('launchAuthorized')) is bool)
    running = result['status'] == SUCCESSES[1]
    require(result['liveReplayStarted'] is running and result['launchAuthorized'] is running
        and (not running or start))
    public = dict(status=result['status'], liveReplayStarted=running, launchAuthorized=running,
        newPaymentStarted=False, transactionAttempted=False, financialActionAttempted=False)
    for name in ('checkPassed', 'startAttempted', 'readinessPassed', 'prestartPassed', 'focusedRunnerPassed',
            'predecessorStopped', 'competitorStopped', 'backgroundStopped', 'redacted'):
        if name in result:
            require(type(result[name]) is bool)
            public[name] = result[name]
    if result['status'] == 'replay-start-refused' and 'candidateStopConfirmed' in result:
        require(type(result['candidateStopConfirmed']) is bool)
        public['candidateStopConfirmed'] = result['candidateStopConfirmed']
        if not result['candidateStopConfirmed']:
            public['liveReplayStarted'] = None
    if 'auditSha256' in result:
        require(pin(result['auditSha256']))
        public['auditSha256'] = result['auditSha256']
    return public


def diagnostic(error):
    kind = type(error).__name__
    allowed = ('ValueError', 'TypeError', 'OSError', 'PermissionError', 'FileNotFoundError',
        'TimeoutError', 'RuntimeError', 'KeyError', 'ImportError', 'SyntaxError')
    result = dict(type=kind if kind in allowed else 'Exception', module='replay_start_seal', line=0)
    trace = error.__traceback__
    while trace is not None:
        name = trace.tb_frame.f_globals.get('__name__')
        if name in MODULES or name in (__name__, '__main__'):
            result.update(module=name if name in MODULES else 'replay_start_seal', line=trace.tb_lineno)
        trace = trace.tb_next
    return result


def main(arguments=None):
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        directory = Path(__file__).resolve().parent
        require(os.geteuid() == 0 and sys.flags.isolated and sys.flags.no_site
            and sys.flags.dont_write_bytecode and not sys.flags.optimize
            and len(arguments) == 2 and pin(arguments[0]) and arguments[1] in ('--check', '--start')
            and directory.name == 'owner' and directory.parent.parent == Path('/root'))
        for parent in (directory, directory.parent):
            info = parent.lstat()
            require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
                and stat.S_IMODE(info.st_mode) == 0o700)
        manifest, captured, fence = capture(directory, arguments[0])
        audits = {name: protected(Path(REVIEWED[name + 'Path']), REVIEWED[name + 'Sha256'])
            for name in ('committedAudit', 'probeAudit')}
        focused = manifest['reviewed'].get('focusedRunner')
        focused_raw = None if focused is None else protected(Path(focused['path']), focused['sha256'])
        runner_raw = protected(RUNNER_PATH, RUNNER_SHA)
        validate_focused(focused_raw, runner_raw)
        modules = load_modules(directory, captured)
        require(modules['replay_start_owner'].REVIEWED in (
            REVIEWED, {key: value for key, value in REVIEWED.items() if key != 'focusedRunner'}))

        def verify():
            require(capture(directory, arguments[0]) == (manifest, captured, fence))
            require(all(protected(Path(REVIEWED[name + 'Path']), REVIEWED[name + 'Sha256']) == raw
                for name, raw in audits.items()))
            require(focused is None or protected(Path(focused['path']), focused['sha256']) == focused_raw)
            require(protected(RUNNER_PATH, RUNNER_SHA) == runner_raw)
            require(all(sys.modules.get(name) is module
                and module.__file__ == str(directory / (name + '.py')) for name, module in modules.items()))
            return True

        result = modules['replay_start_owner'].invoke(directory, manifest['reviewed'], verify, protected,
            start=arguments[1] == '--start')
        result = public_summary(result, start=arguments[1] == '--start')
        print(json.dumps(result, sort_keys=True))
        expected = SUCCESSES[arguments[1] == '--start']
        return 0 if result['status'] == expected else 1
    except Exception as error:
        print(json.dumps(dict(status='replay-start-bootstrap-refused', redacted=True,
            liveReplayStarted=None if arguments and '--start' in arguments else False,
            startupStateVerified=False, newPaymentStarted=False, financialActionAttempted=False,
            launchAuthorized=False, diagnostic=diagnostic(error))))
        return 1


if __name__ == '__main__':
    sys.exit(main())

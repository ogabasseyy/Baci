from datetime import datetime, timezone
import fcntl
import hashlib
import importlib
import json
import os
from pathlib import Path
import re
import stat
import sys
import tempfile


KIND = 'financial-readiness-readonly'
PROVIDER_FILES = frozenset(('cutover_context.py', 'cutover_database.py', 'cutover_runtime.py',
    'cutover_probes.py', 'cutover_preflight.py', 'receipt_provenance.py', 'receipt_report.sql',
    'receipt_crypto.cjs', 'receipt_preflight.py', 'provider_crosswalk.cjs', 'provider_json.cjs',
    'provider_preflight.py', 'financial_report.sql', 'background_preflight.sql'))
STOPPED_FILES = PROVIDER_FILES | {'financial_quiescence.py', 'stopped_provider_preflight.py'}
SOURCE_NAMES = {name: name for name in ('storage-functions.sql', 'dispatch-queue.sql',
    'checkout-retirement-storage.sql', 'checkout-storage.sql', 'projection-storage.sql', 'checkout_retirement_patches.py')}
SOURCE_NAMES['supabase/migrations/20261002160000_prefunded_first_card_claim_boundary.sql'] = 'claim-boundary.sql'
FILES = STOPPED_FILES | set(SOURCE_NAMES.values()) | {'financial_readiness_owner.py',
    'application_reports.py', 'financial_completion.py', 'financial_delta.py', 'worker_owner.py',
    'worker_source_authority.py', 'sealed_scheduler.py', 'natural_reclaim_authority.py', 'natural_reclaim_preflight.sql'}
LOCK = Path('/root/baci-complete-replay-cutover.lock')
STAT_FIELDS = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink', 'st_size', 'st_mtime_ns', 'st_ctime_ns')


def _require(condition):
    if not condition:
        raise ValueError('financial_readiness_refused')


def _pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def _fingerprint(info):
    return tuple(getattr(info, name) for name in STAT_FIELDS)


def _protected_read(path, pin):
    path = Path(path)
    _require(path.is_absolute() and '..' not in path.parts and _pin(pin))
    ancestors = {}
    for parent in reversed(path.parents):
        info = parent.lstat()
        _require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0 and not info.st_mode & 0o7022)
        ancestors[parent] = _fingerprint(info)
    before = path.lstat()
    _require(stat.S_ISREG(before.st_mode) and before.st_uid == before.st_gid == 0
        and stat.S_IMODE(before.st_mode) == 0o600 and before.st_nlink == 1 and 0 < before.st_size <= 16_000_000)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16_000_001)
        after = os.fstat(handle.fileno())
    _require(_fingerprint(before) == _fingerprint(opened) == _fingerprint(after) == _fingerprint(path.lstat())
        and len(raw) == before.st_size and hashlib.sha256(raw).hexdigest() == pin)
    _require(all(_fingerprint(parent.lstat()) == value for parent, value in ancestors.items()))
    return raw


def _decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            _require(name not in result)
            result[name] = value
        return result
    return json.loads(raw.decode('utf8'), object_pairs_hook=unique, parse_constant=lambda value: _require(False))


def _verify_files(directory, pins, read):
    _require(type(pins) is dict and set(pins) == FILES and all(_pin(pin) for pin in pins.values()))
    captured = {}
    for name, pin in sorted(pins.items()):
        raw = read(Path(directory)/name, pin)
        _require(type(raw) is bytes and 0 < len(raw) <= 16_000_000 and hashlib.sha256(raw).hexdigest() == pin)
        captured[name] = raw
    return captured


def _load_modules(directory):
    sys.path.insert(0, str(directory))
    names = sorted(name[:-3] for name in FILES if name.endswith('.py')
        and name not in ('financial_readiness_owner.py', 'checkout_retirement_patches.py'))
    modules = {name: importlib.import_module(name) for name in names}
    for name, value in modules.items():
        _require(sys.modules.get(name) is value and value.__file__ == str(Path(directory)/(name+'.py')))
    return modules


def _locked(context):
    _require(type(context.lock) is int and context.lock >= 0)
    info = os.fstat(context.lock)
    observed = LOCK.lstat()
    _require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0
        and stat.S_IMODE(info.st_mode) == 0o600 and info.st_nlink == 1
        and _fingerprint(info) == _fingerprint(observed))
    fcntl.flock(context.lock, fcntl.LOCK_EX | fcntl.LOCK_NB)


def _fresh(value):
    _require(type(value) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z', value))
    instant = datetime.fromisoformat(value.replace('Z', '+00:00'))
    now = datetime.now(timezone.utc)
    _require(now.timestamp() < 1791301750 and 0 <= (now-instant).total_seconds() <= 60)


def _catalog(report, natural):
    _require(type(report) is dict and type(report['version']) is int and report['version'] == 1
        and report['sourceClosureSha256'] == natural.SOURCE_CLOSURE)
    identity = report['identity']
    _require(type(identity) is dict and set(identity) == set(natural.IDENTITY) | {'databaseOid', 'roleOid'})
    _require(all(type(identity[name]) is type(value) and identity[name] == value
        for name, value in natural.IDENTITY.items()))
    _require(all(type(identity[name]) is int and identity[name] > 0 for name in ('databaseOid', 'roleOid')))
    _fresh(report['capturedAt'])
    natural.verify_catalog(report, report['catalogSha256'], identity['roleOid'])


def _canonical(captured, natural):
    _require(set(SOURCE_NAMES) == set(natural.SOURCE_FILES))
    pins = {source: hashlib.sha256(captured[name]).hexdigest() for source, name in SOURCE_NAMES.items()}
    _require(pins == natural.SOURCE_FILES and hashlib.sha256(natural.encoded(pins)).hexdigest() == natural.SOURCE_CLOSURE)


def collect_financial_readiness(context, directory, pins):
    try:
        _locked(context)
        captured = _verify_files(directory, pins, context.owner.read)
        modules = _load_modules(directory)
        natural = modules['natural_reclaim_authority']
        _canonical(captured, natural)
        stopped = modules['stopped_provider_preflight']
        _require(stopped.FILES == STOPPED_FILES)
        bundle = stopped.collect_stopped_provider(context, directory, {name: pins[name] for name in STOPPED_FILES})
        _require(type(bundle) is dict and bundle['status'] == 'stopped-provider-and-application-readonly-verified'
            and bundle['financialActionAttempted'] is False and bundle['newPaymentStarted'] is False)
        assemble = modules['application_reports'].assemble_native
        native = assemble(bundle['application'], bundle['original'], bundle['provider'])
        _require(native['receiptStorage']['status'] == 'processed')
        binder = modules['sealed_scheduler'].bind_sealed_scheduler
        worker, scheduler = modules['worker_owner'].collect_worker_authority(context,
            load_scheduler=lambda path, source_pins: binder(context, path, source_pins))
        _require(type(worker) is dict and worker['status'] == 'worker-source-inputs-bound'
            and worker['containerId'] == '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4')
        query = captured['natural_reclaim_preflight.sql'].decode()
        catalog = _decode(context.finance['database'](query).encode())
        _catalog(catalog, natural)
        quiet = modules['financial_quiescence'].verify_financial_quiescence(context)
        _require(type(quiet) is dict and quiet['status'] == 'financial-writers-quiescent')
        _require(_verify_files(directory, pins, context.owner.read) == captured)
        _locked(context)
        context.deadline()
        native = assemble(bundle['application'], bundle['original'], bundle['provider'])
        _fresh(catalog['capturedAt'])
        summary = dict(status='financial-readiness-readonly-review-candidate', catalogSha256=catalog['catalogSha256'],
            catalogReviewCandidate=True, nativeEvidenceRows=len(native['evidence']), workerAuthorityBound=True,
            originalProcessed=True, financialActionAuthorized=False, financialActionAttempted=False,
            databaseWritesAttempted=False, providerPostsAttempted=False, newPaymentStarted=False,
            fenceApplied=False, newRuntimeStarted=False)
        return dict(summary=summary, nativeEvidence=native, workerAuthority=worker, catalogReviewCandidate=catalog,
            background=bundle['background'], quiescenceBefore=bundle['quiescenceBefore'],
            quiescenceAfter=bundle['quiescenceAfter'], finalQuiescence=quiet)
    except Exception:
        raise ValueError('financial_readiness_refused') from None


def main(arguments=None):
    context = None
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        _require(not sys.flags.optimize and os.geteuid() == 0 and len(arguments) == 1 and _pin(arguments[0]))
        directory = Path(__file__).resolve().parent
        release = _decode(_protected_read(directory/'release.json', arguments[0]))
        _require(type(release) is dict and set(release) == {'kind', 'files'} and release['kind'] == KIND)
        captured = _verify_files(directory, release['files'], _protected_read)
        modules = _load_modules(directory)
        _require(_verify_files(directory, release['files'], _protected_read) == captured)
        _canonical(captured, modules['natural_reclaim_authority'])
        context = modules['cutover_context'].Context()
        result = collect_financial_readiness(context, directory, release['files'])
        audit = Path(tempfile.mkdtemp(prefix='baci-financial-readiness.', dir='/root'))
        os.chmod(audit, 0o700)
        context.journal(audit, 'readonly-review-candidate', result)
        print(json.dumps(result['summary'], sort_keys=True))
        return 0
    except Exception:
        print(json.dumps(dict(status='financial-readiness-refused', redacted=True,
            financialActionAuthorized=False, financialActionAttempted=False, newPaymentStarted=False)))
        return 1
    finally:
        if context is not None:
            try:
                os.close(context.lock)
            except (OSError, TypeError):
                pass


if __name__ == '__main__':
    raise SystemExit(main())

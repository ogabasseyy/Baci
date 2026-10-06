import hashlib
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import ModuleType


DEPENDENCY = Path('/root/baci-project-rollback-bootstrap.afv7kuzy/owner.py')
DEPENDENCY_SHA = '1893f5fa25ae2c1704e2d82f6c144dce750ed2c95731a875ba9ebea9069f9ccf'
CONTINUITY_SHA = 'fa884466e53a30f7154158914e284a29a78c602294fcea6a5ce40ed75ef9cdb2'
REMINDER_SHA = 'a915b8134b5626f6d664f3d3cf79245c59ee089373738ab37d6f24022283842f'
CANDIDATE_SHA = '279cdb825da57d95de10bf01f3a98c6887c100d239a95760f8b8bf44619784df'
BASELINE = Path('/root/baci-project-rollback-tls.81u8stms/after-ecaad936c2a5455c8ec35a53ecf1f365.json')
BASELINE_SHA = '1696661109ae4bcaaa0b8c10f0573c4df558b89f79a32f3aade2907d4b5879b8'
CHECKER = 'piggyvest_savings_ledger.check_balance()'
MASK_FROM = "CASE WHEN oid IN (SELECT oid FROM targets) THEN to_jsonb(entry)-'prosrc'"
MASK_TO = ("CASE WHEN oid=to_regprocedure('piggyvest_savings_ledger.check_balance()')::oid "
           "THEN to_jsonb(entry)-'prosecdef' WHEN oid IN (SELECT oid FROM targets) "
           "THEN to_jsonb(entry)-'prosrc'")
IDENTITY = """
SET LOCAL standard_conforming_strings=on;
DO $repair_identity$ BEGIN
 IF session_user IS DISTINCT FROM 'postgres' OR current_user IS DISTINCT FROM 'postgres'
 OR current_database() IS DISTINCT FROM 'postgres' OR inet_client_addr() IS NOT NULL
 OR (SELECT system_identifier::text FROM pg_control_system()) IS DISTINCT FROM '7685292944002592802'
 OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz
 OR current_setting('session_replication_role') IS DISTINCT FROM 'origin' THEN
 RAISE EXCEPTION 'repair identity refused' USING ERRCODE='42501'; END IF;
END $repair_identity$;
"""
CHECKER_QUERY = ("BEGIN READ ONLY; SET LOCAL search_path=pg_catalog; "
    "SET LOCAL statement_timeout='8s'; SET LOCAL lock_timeout='2s'; " + IDENTITY +
    "SELECT to_jsonb(routine) FROM pg_proc routine WHERE "
    "oid='piggyvest_savings_ledger.check_balance()'::regprocedure; ROLLBACK;")
REHEARSAL = """
SET SESSION AUTHORIZATION prefunded_treasury_operator;
DO $repair_projection$ DECLARE outcome text; BEGIN
 outcome := prefunded_card.project('ff561046-58e7-428d-9163-f6e60b0dab65'::uuid,
 '7685292944002592802'::text);
 IF outcome IS DISTINCT FROM 'applied' THEN
 RAISE EXCEPTION 'projection rehearsal refused' USING ERRCODE='42501'; END IF;
END $repair_projection$;
SELECT jsonb_build_object('status','projection-rehearsal','outcome','applied');
SET CONSTRAINTS ALL IMMEDIATE;
SELECT jsonb_build_object('status','repair-constraints-validated','financialCommitted',false);
RESET SESSION AUTHORIZATION;
ROLLBACK;
"""


def require(condition):
    if not condition:
        raise ValueError('ledger_balance_repair_refused')


def protected_bytes(path, pin):
    parents = {parent: parent.lstat() for parent in path.parents}
    require(path.is_absolute() and '..' not in path.parts and all(
        stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
        and not info.st_mode & 0o7022 for info in parents.values()))
    info = path.lstat()
    require(stat.S_ISREG(info.st_mode) and info.st_uid == info.st_gid == 0
        and info.st_nlink == 1 and stat.S_IMODE(info.st_mode) == 0o600
        and 0 < info.st_size <= 16000000)
    fields = ('st_dev', 'st_ino', 'st_mode', 'st_uid', 'st_gid', 'st_nlink',
              'st_size', 'st_mtime_ns', 'st_ctime_ns')
    fingerprint = lambda value: tuple(getattr(value, name) for name in fields)
    with os.fdopen(os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK), 'rb') as handle:
        opened = os.fstat(handle.fileno())
        raw = handle.read(16000001)
        after = os.fstat(handle.fileno())
    require(all(fingerprint(value) == fingerprint(info) for value in (opened, after, path.lstat()))
        and len(raw) == info.st_size and hashlib.sha256(raw).hexdigest() == pin
        and all(fingerprint(value) == fingerprint(parent.lstat()) for parent, value in parents.items()))
    return raw


def dependency():
    raw = protected_bytes(DEPENDENCY, DEPENDENCY_SHA)
    continuity_path = Path(__file__).resolve().with_name('reboot_continuity.py')
    continuity_raw = protected_bytes(continuity_path, CONTINUITY_SHA)
    module = ModuleType('sealed_ledger_diagnostic')
    module.__file__ = str(DEPENDENCY)
    exec(compile(raw, str(DEPENDENCY), 'exec'), module.__dict__)
    continuity = ModuleType('sealed_reboot_continuity')
    continuity.__file__ = str(continuity_path)
    exec(compile(continuity_raw, str(continuity_path), 'exec'), continuity.__dict__)
    return continuity.install(module)


def masked_source(raw):
    source = raw.decode('utf-8')
    require(source.count(MASK_FROM) == 1 and MASK_TO not in source)
    return source.replace(MASK_FROM, MASK_TO, 1)


def candidate_query(raw, mode, fence):
    source = raw.decode('utf-8')
    require(mode in ('--rehearse', '--apply') and source.startswith('BEGIN;\n')
        and source.endswith('COMMIT;\n') and source.count('COMMIT;') == 1
        and source.count('BEGIN;') == 1 and type(fence) is str
        and fence.startswith('CREATE TEMP TABLE ledger_repair_full_expected ON COMMIT DROP AS')
        and fence.endswith('END $repair_full_snapshot$;\n'))
    source = source.replace('BEGIN;\n', 'BEGIN;\n' + IDENTITY, 1)
    return source.removesuffix('COMMIT;\n') + fence + (REHEARSAL if mode == '--rehearse' else 'COMMIT;\n')


def transaction_fence(raw, expected):
    source = masked_source(raw)
    start = 'WITH full_snapshot AS MATERIALIZED ('
    end = 'DO $financial_deadline$ BEGIN'
    require(source.count(start) == source.count(end) == 1 and type(expected) is dict
        and expected.get('readOnly') is True and expected.get('unsupportedRelations') == [])
    query = source[source.index(start):source.index(end)].strip()
    require(query.endswith(';'))
    witness = dict(expected, readOnly=False)
    encoded = json.dumps(witness, sort_keys=True, separators=(',', ':'), allow_nan=False)
    require(len(encoded) <= 2000000)
    literal = "'" + encoded.replace("'", "''") + "'::jsonb"
    return ('CREATE TEMP TABLE ledger_repair_full_expected ON COMMIT DROP AS SELECT ' + literal +
        ' AS evidence;\nCREATE TEMP TABLE ledger_repair_full_actual ON COMMIT DROP AS ' + query +
        '\nDO $repair_full_snapshot$ BEGIN\n' +
        " IF current_setting('transaction_read_only') IS DISTINCT FROM 'off'\n" +
        ' OR (SELECT count(*) FROM ledger_repair_full_expected)<>1\n' +
        ' OR (SELECT count(*) FROM ledger_repair_full_actual)<>1\n' +
        " OR (SELECT evidence-'capturedAt' FROM ledger_repair_full_expected) IS DISTINCT FROM\n" +
        " (SELECT evidence-'capturedAt' FROM ledger_repair_full_actual)\n" +
        " OR clock_timestamp()>='2026-10-06T15:59:10Z'::timestamptz THEN\n" +
        " RAISE EXCEPTION 'repair full snapshot refused' USING ERRCODE='42501'; END IF;\n" +
        'END $repair_full_snapshot$;\n')


def capture(context, diagnostic, modules, pins):
    normal = modules['application_reports'].capture_application(context,
        diagnostic.ROOT / 'financial_report.sql', pins['financial_report.sql'],
        diagnostic.ROOT / 'financial_snapshot.sql', pins['financial_snapshot.sql'])
    raw = diagnostic.protected_root_read(diagnostic.ROOT / 'financial_snapshot.sql',
                                        pins['financial_snapshot.sql'])
    masked = json.loads(context.finance['database'](masked_source(raw)))
    checker = json.loads(context.finance['database'](CHECKER_QUERY))
    require(normal['protectedSnapshot']['tableRows'] == masked['tableRows']
        and normal['protectedSnapshot']['identity'] == masked['identity']
        and type(checker) is dict and type(checker.get('prosecdef')) is bool)
    return dict(normal=normal, masked=masked, checker=checker)


def prove(before, after, mode, same_snapshot):
    require(mode in ('--rehearse', '--apply'))
    same_snapshot(before['masked'], after['masked'])
    first = dict(before['checker'])
    second = dict(after['checker'])
    require(first.pop('prosecdef') is False
        and second.pop('prosecdef') is (mode == '--apply') and first == second)
    if mode == '--rehearse':
        same_snapshot(before['normal']['protectedSnapshot'], after['normal']['protectedSnapshot'])
    else:
        first = dict(before['normal']['protectedSnapshot'])
        second = dict(after['normal']['protectedSnapshot'])
        require(first.pop('permanentMetadataSha256') != second.pop('permanentMetadataSha256'))
        same_snapshot(first, second)


def baseline_matches(diagnostic, before, same_snapshot):
    retained = diagnostic.decode(diagnostic.protected_root_read(BASELINE, BASELINE_SHA))
    require(type(retained) is dict and set(retained) == {'application', 'protectedSnapshot'}
        and retained['protectedSnapshot'].get('readOnly') is True)
    previous, current = retained['protectedSnapshot'], before['normal']['protectedSnapshot']
    relation = 'savings_notifications.events'
    if previous['tableRows'].get(relation) != current['tableRows'].get(relation):
        require(relation in previous['tableRows'] and relation in current['tableRows'])
        path = Path(__file__).resolve().with_name('reminder_continuity.py')
        raw = protected_bytes(path, REMINDER_SHA)
        reminder = ModuleType('sealed_reminder_continuity')
        reminder.__file__ = str(path)
        exec(compile(raw, str(path), 'exec'), reminder.__dict__)
        proof = diagnostic.decode(diagnostic.protected_root_read(Path(reminder.PROOF_PATH), reminder.PROOF_SHA))
        current = reminder.normalize(previous, current, proof)
    same_snapshot(previous, current)


def main(arguments=None):
    context, finder, audit, after, attempted = None, None, None, None, False
    stage = 'sealed-inputs'
    try:
        arguments = sys.argv[1:] if arguments is None else arguments
        require(os.geteuid() == 0 and not sys.flags.optimize and len(arguments) == 1
            and arguments[0] in ('--rehearse', '--apply'))
        mode = arguments[0]
        directory = Path(__file__).resolve().parent
        raw = protected_bytes(directory / 'candidate.sql', CANDIDATE_SHA)
        diagnostic = dependency()
        authenticated = diagnostic.authenticate_root()
        owner, readiness, finder = diagnostic.bootstrap(authenticated)
        pins, captured = owner._closure(diagnostic.ROOT, diagnostic.RELEASE)
        require(captured == authenticated)
        modules = readiness._load_modules(diagnostic.ROOT)
        context = modules['cutover_context'].Context()
        import financial_reconcile_pass as finite
        stage = 'before-evidence'
        original = diagnostic.guard(context, modules)
        audit = Path(tempfile.mkdtemp(prefix='baci-ledger-balance-repair.', dir='/root'))
        os.chmod(audit, 0o700)
        before = capture(context, diagnostic, modules, pins)
        require(before['checker']['prosecdef'] is False)
        context.journal(audit, 'before', before)
        baseline_matches(diagnostic, before, finite._same_snapshot)
        snapshot_raw = diagnostic.protected_root_read(diagnostic.ROOT / 'financial_snapshot.sql',
                                                     pins['financial_snapshot.sql'])
        query = candidate_query(raw, mode, transaction_fence(snapshot_raw, before['masked']))
        require(protected_bytes(directory / 'candidate.sql', CANDIDATE_SHA) == raw
            and diagnostic.guard(context, modules) == original
            and owner._closure(diagnostic.ROOT, diagnostic.RELEASE) == (pins, captured))
        stage = 'rollback-rehearsal' if mode == '--rehearse' else 'metadata-apply'
        attempted = True
        try:
            output = context.finance['command']([*diagnostic.DOCKER, 'exec', '-i',
                'baci-isolated-savings-db-1', '/usr/bin/psql', '-XqAt', '-v', 'ON_ERROR_STOP=1',
                '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres'], input_text=query)
            context.journal(audit, 'execution', dict(mode=mode, output=output))
            if mode == '--rehearse':
                records = [json.loads(line) for line in output.splitlines() if line.startswith('{')]
                require(records == [dict(status='projection-rehearsal', outcome='applied'),
                    dict(status='repair-constraints-validated', financialCommitted=False)])
        except Exception as failure:
            try:
                name = type(failure).__name__
                context.journal(audit, 'execution-failure', dict(mode=mode, redacted=True,
                    exceptionType=name if name in ('ValueError', 'OSError', 'TimeoutExpired',
                        'CalledProcessError', 'RuntimeError') else 'UnknownError'))
            except Exception:
                pass
            raise
        finally:
            after = capture(context, diagnostic, modules, pins)
            context.journal(audit, 'after', after)
        stage = 'independent-postconditions'
        prove(before, after, mode, finite._same_snapshot)
        require(diagnostic.guard(context, modules) == original
            and owner._closure(diagnostic.ROOT, diagnostic.RELEASE) == (pins, captured))
        context.deadline()
        result = dict(status='ledger-balance-rehearsed' if mode == '--rehearse' else 'ledger-balance-repaired',
            metadataApplied=mode == '--apply', financialCommitted=False, newPaymentStarted=False,
            rowsUnchanged=True, onlyCheckerAuthorityChanged=mode == '--apply',
            failedWorkerStatePreserved=True, privateAudit=str(audit))
        context.journal(audit, 'result', result)
        code = 0
    except Exception:
        result = dict(status='ledger-balance-repair-unconfirmed', stage=stage, redacted=True,
            metadataApplied=None if attempted else False, financialCommitted=False,
            newPaymentStarted=False, postEvidenceRetained=after is not None,
            privateAudit=str(audit) if audit else None)
        code = 1
    finally:
        if context is not None:
            try:
                os.close(context.lock)
            except Exception:
                code = 1
                result.update(status='ledger-balance-repair-unconfirmed', stage='lock-cleanup', redacted=True)
        if finder is not None:
            try:
                sys.meta_path.remove(finder)
            except Exception:
                code = 1
                result.update(status='ledger-balance-repair-unconfirmed', stage='import-cleanup', redacted=True)
    print(json.dumps(result))
    return code


if __name__ == '__main__':
    raise SystemExit(main())

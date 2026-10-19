"""Finite composition for a separately authenticated, source-verified root runner.

The parent owns activation approval and a gracefully stopped native replay.
No CLI, retry, scheduler setup, lease reset or replay/public restart is provided.
"""

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sys

import application_reports
import completion_snapshot
import financial_delta
import financial_quiescence
import financial_readiness_owner as readiness
import natural_reclaim_authority as natural
import sealed_scheduler
import stopped_provider_preflight
import worker_adapter
import worker_owner
import worker_source_authority as authority


REVIEWED_CATALOG_SHA256 = 'a1443b22b5fb2573608c854baa4d02a8b2036a631c1b4163b940b1b1f7562b7d'
FILES = readiness.FILES | {'financial_snapshot.sql', 'worker_adapter.py', 'financial_reconcile_pass.py',
    'completion_snapshot.py'}
ROW_QUERY = """SELECT jsonb_build_object(
  'capturedAt',to_char(clock_timestamp() AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"'),
  'rowCount',count(*),
  'targetHash',encode(sha256(convert_to(coalesce(jsonb_agg(to_jsonb(operation)
    ORDER BY to_jsonb(operation)::text COLLATE "C"),'[]'::jsonb)::text,'UTF8')),'hex'),
  'rowSha256',CASE WHEN count(*)=1 THEN encode(sha256(convert_to(
    (jsonb_agg(to_jsonb(operation))->0)::text,'UTF8')),'hex') END)
FROM prefunded_card.operations operation
WHERE operation.id='ff561046-58e7-428d-9163-f6e60b0dab65'::uuid;
"""


class _Refused(ValueError):
    def __init__(self, evidence):
        super().__init__('financial_reconcile_pass_refused')
        self.private_evidence = evidence


def _require(condition):
    if not condition:
        raise ValueError('financial_reconcile_pass_refused')


def _files(context, directory, pins):
    _require(type(pins) is dict and set(pins) == FILES and all(readiness._pin(pin) for pin in pins.values()))
    captured = readiness._verify_files(directory, {name: pins[name] for name in readiness.FILES}, context.owner.read)
    for name in FILES - readiness.FILES:
        raw = context.owner.read(directory/name, pins[name])
        _require(type(raw) is bytes and 0 < len(raw) <= 16_000_000 and hashlib.sha256(raw).hexdigest() == pins[name])
        captured[name] = raw
    readiness._canonical(captured, natural)
    for loaded in (application_reports, completion_snapshot, financial_delta, financial_quiescence, readiness, natural,
        sealed_scheduler, stopped_provider_preflight, worker_adapter, worker_owner, authority, sys.modules[__name__]):
        _require(sys.modules.get(loaded.__name__) is loaded
            and loaded.__file__ == str(directory/(loaded.__name__+'.py')))
    return captured


def _quiet(context):
    report = financial_quiescence.verify_financial_quiescence(context)
    _require(type(report) is dict and report['status'] == 'financial-writers-quiescent')
    readiness._fresh(report['observedAt'])
    context.deadline()
    return True


def _capture(context, directory, pins):
    _quiet(context)
    result = application_reports.capture_application(context, directory/'financial_report.sql',
        pins['financial_report.sql'], directory/'financial_snapshot.sql', pins['financial_snapshot.sql'])
    _quiet(context)
    readiness._fresh(result['protectedSnapshot']['capturedAt'])
    return result


def _bundle(context, directory, pins):
    result = stopped_provider_preflight.collect_stopped_provider(context, directory,
        {name: pins[name] for name in stopped_provider_preflight.FILES})
    _require(type(result) is dict and result['status'] == 'stopped-provider-and-application-readonly-verified'
        and result['financialActionAttempted'] is False and result['newPaymentStarted'] is False)
    return result


def _catalog(context, captured, pin):
    report = readiness._decode(context.finance['database'](captured['natural_reclaim_preflight.sql'].decode()).encode())
    readiness._catalog(report, natural)
    _require(report['catalogSha256'] == pin)
    return report


def _classify(context, captured, catalog, pin, row_pin=None):
    background = readiness._decode(context.finance['database'](captured['background_preflight.sql'].decode()).encode())
    classified = natural.classify_natural_reclaim(catalog, background,
        source_files={source: captured[name] for source, name in readiness.SOURCE_NAMES.items()},
        reviewed_catalog_sha256=pin, now=datetime.now(timezone.utc), projection_target_row_sha256=row_pin)
    return classified, background


def _same_snapshot(first, second):
    _require({name: value for name, value in first.items() if name != 'capturedAt'}
        == {name: value for name, value in second.items() if name != 'capturedAt'})


def _pending_operation(application, phase, snapshot):
    scope = application['nativeApplication']['scope']
    report = application['completedApplication']
    operation = report['operation']
    names = ('operationId', 'goalId', 'integrationId', 'treasuryBindingId', 'merchantId', 'customerId',
        'amountKobo', 'currency', 'destinationWalletId', 'destinationCustomerId')
    expected = {name: scope[name] for name in names}
    expected.update(collectionStatus='verified_success', projectionStatus='unapplied', checkoutRetired=False,
        collectionProofPresent=True, collectionProviderTransactionId=application['nativeApplication']['collection']['providerTransactionId'],
        transferStatus='dispatching' if phase == 'verify_existing_transfer' else 'verified_success',
        transferProviderTransactionId=None if phase == 'verify_existing_transfer' else natural.TRANSACTION)
    _require(type(operation) is dict and all(type(operation[name]) is type(value)
        and operation[name] == value for name, value in expected.items()))
    for name in ('projections', 'ledgerOperations', 'contributions', 'postings', 'aliases', 'notifications'):
        _require(type(report[name]) is list and not report[name])
    for name in financial_delta.INSERTIONS:
        witness = snapshot['allowedTargetWitnesses'][name]
        _require(type(witness['targetCount']) is int and witness['targetCount'] == 0
            and witness['targetRows'] == [] and witness['targetRowColumnHashes'] == [])
    treasury = {name: scope[name] for name in ('treasuryBindingId', 'integrationId', 'businessId', 'sourceWalletId')}
    treasury.update(budgetKobo=10000, openingAvailableKobo=10000, replenishedKobo=0,
        reservedKobo=10000 if phase == 'verify_existing_transfer' else 0,
        consumedKobo=0 if phase == 'verify_existing_transfer' else 10000)
    _require(type(report['treasury']) is dict and set(report['treasury']) == set(treasury)
        and all(type(report['treasury'][name]) is type(value) and report['treasury'][name] == value
            for name, value in treasury.items()))
    goals = report['goals']
    _require(type(goals) is list and len(goals) == 2 and all(type(goal) is dict for goal in goals)
        and {goal['goalId'] for goal in goals} == {scope['goalId'], scope['oldGoalId']})
    for goal in goals:
        principal = 0 if goal['goalId'] == scope['goalId'] else 10000
        _require(all(type(goal[name]) is int and goal[name] == principal
            for name in ('displayedPrincipalKobo', 'canonicalPrincipalKobo')))
        if principal == 0:
            _require(type(goal['targetKobo']) is int and goal['targetKobo'] >= 10000
                and goal['status'] == 'active' and goal['completedAt'] is None)


def _worker_reader(context, worker):
    pins = worker['fileHashes'] | {authority.UNIT: worker_owner.UNIT_SHA256}
    seen = {}
    def read(path, pin):
        path = Path(path)
        _require(str(path) in pins and pins[str(path)] == pin)
        uid = 65532 if str(path) == authority.CONFIGURATION else 0
        mode = 0o600 if uid else 0o644 if str(path) == authority.UNIT else 0o444
        raw, metadata = worker_owner._read(context, worker_owner._lstat, seen, path, pin, mode, uid)
        _require(all(worker_owner._fingerprint(worker_owner._lstat(observed)) == fingerprint
            for observed, fingerprint in seen.items()))
        return raw
    return read


def _projection_pin(context, captured, snapshot, catalog):
    witness = snapshot['allowedTargetWitnesses']['prefunded_card.operations']
    _require(witness['targetCount'] == 1 and witness['targetRows'][0]['id'] == natural.TARGET)
    source = captured['natural_reclaim_preflight.sql'].decode()
    _require(source.count('WITH moment AS MATERIALIZED') == source.count('DO $natural_deadline$') == 1)
    query = source.split('WITH moment AS MATERIALIZED')[0] + ROW_QUERY
    query += 'DO $natural_deadline$' + source.split('DO $natural_deadline$')[1]
    observed = readiness._decode(context.finance['database'](query).encode())
    _require(type(observed) is dict and set(observed) == {'capturedAt', 'rowCount', 'targetHash', 'rowSha256'}
        and type(observed['rowCount']) is int and observed['rowCount'] == 1
        and observed['targetHash'] == witness['targetHash'] and readiness._pin(observed['rowSha256']))
    readiness._fresh(observed['capturedAt'])
    target = [row for row in catalog['operations'] if row['id'] == natural.TARGET]
    _require(len(target) == 1 and target[0]['rowSha256'] == observed['rowSha256'])
    return observed['rowSha256']


def run_financial_reconcile_pass(context, directory, pins, *, reviewed_catalog_sha256=REVIEWED_CATALOG_SHA256):
    result = None
    try:
        _require(not sys.flags.optimize and reviewed_catalog_sha256 == REVIEWED_CATALOG_SHA256)
        directory = Path(directory)
        _require(directory.is_absolute() and '..' not in directory.parts)
        readiness._locked(context)
        context.deadline()
        captured = _files(context, directory, pins)
        candidate = readiness.collect_financial_readiness(context, directory,
            {name: pins[name] for name in readiness.FILES})
        _require(candidate['summary']['status'] == 'financial-readiness-readonly-review-candidate'
            and candidate['catalogReviewCandidate']['catalogSha256'] == reviewed_catalog_sha256)
        worker, scheduler = worker_owner.collect_worker_authority(context,
            load_scheduler=lambda path, source_pins: sealed_scheduler.bind_sealed_scheduler(context, path, source_pins))
        expected = dict(status='worker-source-inputs-bound', containerId=authority.BACKGROUND_CONTAINER_ID,
            manifestSha256=authority.MANIFEST_SHA256, approvedCompanyBudgetKobo=10000,
            approvedPreservedPrincipalKobo=10000)
        _require(all(type(worker[name]) is type(value) and worker[name] == value for name, value in expected.items()))
        readiness._fresh(worker['observedAt'])
        bundle = _bundle(context, directory, pins)
        before = _capture(context, directory, pins)
        application_reports.assemble_native(before['application'], bundle['original'], bundle['provider'])
        _pending_operation(before['application'], 'verify_existing_transfer', before['protectedSnapshot'])
        financial_delta.prove_allowed_deltas(before['protectedSnapshot'], before['protectedSnapshot'])
        catalog = _catalog(context, captured, reviewed_catalog_sha256)
        classified, background_before = _classify(context, captured, catalog, reviewed_catalog_sha256)
        catalog_before = catalog
        _require(classified['phase'] == 'verify_existing_transfer')
        _require(_files(context, directory, pins) == captured)
        readiness._locked(context)
        def guarded_command(arguments, **options):
            if arguments == ['/usr/bin/systemctl', 'start', worker_adapter.SERVICE]:
                _require(_files(context, directory, pins) == captured)
                readiness._locked(context)
                context.deadline()
                for observed in (worker['observedAt'], before['protectedSnapshot']['capturedAt'],
                    catalog_before['capturedAt'], background_before['capturedAt']):
                    readiness._fresh(observed)
                current = _capture(context, directory, pins)
                _same_snapshot(before['protectedSnapshot'], current['protectedSnapshot'])
                _pending_operation(current['application'], 'verify_existing_transfer', current['protectedSnapshot'])
                current_catalog = _catalog(context, captured, reviewed_catalog_sha256)
                current_classification, current_background = _classify(
                    context, captured, current_catalog, reviewed_catalog_sha256)
                _require(current_classification['phase'] == 'verify_existing_transfer')
                readiness._fresh(worker['observedAt'])
                application_reports.assemble_native(current['application'], bundle['original'], bundle['provider'])
            return context.owner.command(arguments, **options)
        adapter = worker_adapter.WorkerAdapter(run=guarded_command, read=_worker_reader(context, worker),
            inspect=lambda name: worker_owner._inspect(context.owner.command, [*worker_adapter.DOCKER, 'inspect', name]),
            scheduler=scheduler, container_id=worker['containerId'], manifest_sha=worker['manifestSha256'],
            file_hashes=worker['fileHashes'], quiescent=lambda: _quiet(context))
        result = dict(workerAuthority=worker, readiness=candidate, classificationBefore=classified,
            catalogBefore=catalog_before, backgroundBefore=background_before,
            baseline=before['protectedSnapshot'], applicationBefore=before['application'],
            original=bundle['original'], provider=bundle['provider'])
        worker_result, worker_failed = None, False
        try:
            worker_result = adapter.run_once()
        except Exception:
            worker_failed = True
        result.update(worker=worker_result, workerFailed=worker_failed)
        first_post = _capture(context, directory, pins)
        result.update(firstPost=first_post['protectedSnapshot'], firstPostApplication=first_post['application'])
        delta = financial_delta.prove_allowed_deltas(before['protectedSnapshot'], first_post['protectedSnapshot'])
        result['delta'] = delta
        _require(not worker_failed)
        bundle = _bundle(context, directory, pins)
        result.update(original=bundle['original'], provider=bundle['provider'])
        final = _capture(context, directory, pins)
        result.update(final=final['protectedSnapshot'], finalApplication=final['application'])
        financial_delta.prove_allowed_deltas(first_post['protectedSnapshot'], final['protectedSnapshot'])
        _same_snapshot(first_post['protectedSnapshot'], final['protectedSnapshot'])
        application_reports.assemble_native(final['application'], bundle['original'], bundle['provider'])
        catalog = _catalog(context, captured, reviewed_catalog_sha256)
        result['catalogAfter'] = catalog
        applied = final['application']['completedApplication']['operation']['projectionStatus'] == 'applied'
        if applied:
            result['completedReport'] = application_reports.assemble_completed(
                final['application'], bundle['original'], bundle['provider'])
            result['snapshotCompletion'] = completion_snapshot.verify_completion_snapshot(
                result['completedReport'], final['protectedSnapshot'])
        else:
            _pending_operation(final['application'], 'apply_verified_projection', final['protectedSnapshot'])
            _require(set(delta['changedTargetRelations']) <= {'prefunded_card.operations',
                'prefunded_card.treasury_bindings', 'prefunded_card.dispatch_queue'})
            row_pin = _projection_pin(context, captured, first_post['protectedSnapshot'], catalog)
            result['classificationAfter'], result['backgroundAfter'] = _classify(
                context, captured, catalog, reviewed_catalog_sha256, row_pin)
            _require(result['classificationAfter']['phase'] == 'apply_verified_projection')
            result['projectionTargetRowSha256'] = row_pin
        _quiet(context)
        _require(_files(context, directory, pins) == captured)
        readiness._locked(context)
        context.deadline()
        readiness._fresh(final['application']['observedAt'])
        readiness._fresh(catalog['capturedAt'])
        if applied:
            result['completedReport'] = application_reports.assemble_completed(
                final['application'], bundle['original'], bundle['provider'])
            result['snapshotCompletion'] = completion_snapshot.verify_completion_snapshot(
                result['completedReport'], final['protectedSnapshot'])
        else:
            readiness._fresh(result['backgroundAfter']['capturedAt'])
            application_reports.assemble_native(final['application'], bundle['original'], bundle['provider'])
        result['summary'] = dict(status='financial-reconcile-completed' if applied else 'financial-reconciliation-only',
            operationId=natural.TARGET, financialCompleted=applied, workerInvocations=1,
            newPaymentStarted=False, automaticRetryAttempted=False, replayRestarted=False,
            phase='completed' if applied else 'apply_verified_projection', catalogSha256=reviewed_catalog_sha256)
        return result
    except Exception:
        raise _Refused(result) from None

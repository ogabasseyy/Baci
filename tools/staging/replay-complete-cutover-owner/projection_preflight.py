"""Read-only projection evidence for a separately sealed parent finite runner."""

from datetime import datetime, timezone
import hashlib
from pathlib import Path
import sys

import application_reports
import financial_completion
import financial_delta
import financial_readiness_owner as readiness
import financial_reconcile_pass as finite
import natural_reclaim_authority as natural


AUDIT_PATH = Path('/root/baci-financial-reconciliation.k785s099/'
    'refused-partial-pass-4bc6d1f553b640bc910d754c961574a3.json')
AUDIT_SHA = 'd1f3c7d7b1b7940731ddb196b5d7bf18e122354fc7541e70eda480e6472fc249'
AUDIT_SIZE = 195682
CATALOG_SHA256 = 'a1443b22b5fb2573608c854baa4d02a8b2036a631c1b4163b940b1b1f7562b7d'
PROJECTION_ROW_SHA256 = '9ab7ba2d467d2e6bfea059085e6616dbe264903d4732ac9ee49664719741ad21'
PHASE = 'apply_verified_projection'
FIRST_PHASE_RELATIONS = frozenset(('prefunded_card.operations',
    'prefunded_card.treasury_bindings', 'prefunded_card.dispatch_queue'))


def _require(condition):
    if not condition:
        raise ValueError('projection_preflight_refused')


def _audit():
    raw = readiness._protected_read(AUDIT_PATH, AUDIT_SHA)
    _require(type(raw) is bytes and len(raw) == AUDIT_SIZE
        and hashlib.sha256(raw).hexdigest() == AUDIT_SHA)
    retained = readiness._decode(raw)
    _require(type(retained) is dict and retained.get('workerFailed') is True
        and retained['classificationBefore']['phase'] == 'verify_existing_transfer')
    return raw, retained


def _historical_application(application, phase, snapshot):
    _require(type(application) is dict and set(application) == {'schemaVersion', 'reportKind',
        'observedAt', 'appIdentity', 'nativeApplication', 'completedApplication'}
        and type(application['schemaVersion']) is int and application['schemaVersion'] == 1
        and application['reportKind'] == 'application_financial_subreport'
        and natural.encoded(application['appIdentity']) == natural.encoded(application_reports.IDENTITY)
        and natural.encoded(application['nativeApplication']['scope']) == natural.encoded(financial_completion.SCOPE))
    application_reports._instant(application['observedAt'])
    _require(snapshot.get('readOnly') is True)
    finite._pending_operation(application, phase, snapshot)


def _retained(retained):
    before, after = retained['baseline'], retained['firstPost']
    delta = financial_delta.prove_allowed_deltas(before, after)
    _require(set(delta['changedTargetRelations']) <= FIRST_PHASE_RELATIONS)
    _historical_application(retained['applicationBefore'], 'verify_existing_transfer', before)
    _historical_application(retained['firstPostApplication'], PHASE, after)
    now = datetime.now(timezone.utc)
    moments = [application_reports._instant(value) for value in (
        before['capturedAt'], after['capturedAt'],
        retained['applicationBefore']['observedAt'], retained['firstPostApplication']['observedAt'])]
    _require(moments[0] <= moments[1] <= now and moments[2] <= moments[3] <= now)
    return delta


def _current(context, directory, pins, captured, retained):
    bundle = finite._bundle(context, directory, pins)
    current = finite._capture(context, directory, pins)
    baseline, application = current['protectedSnapshot'], current['application']
    _require(baseline.get('readOnly') is True)
    finite._same_snapshot(retained['firstPost'], baseline)
    financial_delta.prove_allowed_deltas(retained['firstPost'], baseline)
    finite._pending_operation(application, PHASE, baseline)
    native = application_reports.assemble_native(application, bundle['original'], bundle['provider'])
    catalog = finite._catalog(context, captured, CATALOG_SHA256)
    _require(catalog['catalogSha256'] == CATALOG_SHA256 and catalog['phase'] == PHASE)
    row_pin = finite._projection_pin(context, captured, baseline, catalog)
    _require(row_pin == PROJECTION_ROW_SHA256)
    classified, background = finite._classify(context, captured, catalog, CATALOG_SHA256, row_pin)
    _require(classified['status'] == 'classified_only' and classified['phase'] == PHASE
        and classified['operationId'] == natural.TARGET
        and classified['financialActionAuthorized'] is False)
    for stamp in (baseline['capturedAt'], application['observedAt'], catalog['capturedAt'],
        background['capturedAt'], bundle['provider']['observedAt'],
        bundle['original']['receiptStorage']['observedAt'],
        bundle['original']['provenance']['sourceProofObservedAt']):
        readiness._fresh(stamp)
    return dict(baseline=baseline, applicationBefore=application, original=bundle['original'],
        provider=bundle['provider'], catalogBefore=catalog, backgroundBefore=background,
        classificationBefore=classified, projectionTargetRowSha256=row_pin,
        nativeEvidence=native)


def collect_projection_preflight(context, directory, pins):
    try:
        directory = Path(directory)
        _require(not sys.flags.optimize and directory.is_absolute() and '..' not in directory.parts
            and __file__ == str(directory / 'projection_preflight.py'))
        for loaded in (sys.modules[__name__], finite, readiness, application_reports,
            financial_completion, financial_delta, natural):
            _require(sys.modules.get(loaded.__name__) is loaded
                and loaded.__file__ == str(directory / (loaded.__name__ + '.py')))
        readiness._locked(context)
        context.deadline()
        captured = finite._files(context, directory, pins)
        raw, retained = _audit()
        delta = _retained(retained)
        first = _current(context, directory, pins, captured, retained)
        result = _current(context, directory, pins, captured, retained)
        _require(first['projectionTargetRowSha256'] == result['projectionTargetRowSha256'])
        finite._quiet(context)
        _require(finite._files(context, directory, pins) == captured and _audit()[0] == raw)
        readiness._locked(context)
        context.deadline()
        for stamp in (result['baseline']['capturedAt'], result['applicationBefore']['observedAt'],
            result['catalogBefore']['capturedAt'], result['backgroundBefore']['capturedAt'],
            result['provider']['observedAt'], result['original']['receiptStorage']['observedAt'],
            result['original']['provenance']['sourceProofObservedAt']):
            readiness._fresh(stamp)
        result.update(retainedAuditSha256=AUDIT_SHA, retainedDelta=delta,
            summary=dict(status='projection-preflight-readonly-ready', phase=PHASE,
                operationId=natural.TARGET, retainedAuditSha256=AUDIT_SHA,
                catalogSha256=CATALOG_SHA256, readOnly=True, actionAttempted=False,
                financialActionAuthorized=False, newPaymentStarted=False,
                workerStarted=False, providerPostAttempted=False, sqlWriteAttempted=False))
        return result
    except Exception:
        raise ValueError('projection_preflight_refused') from None

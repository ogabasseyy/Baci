import hashlib
from pathlib import Path
import sys

import application_reports
import completion_snapshot
import financial_delta
import financial_readiness_owner as readiness
import financial_reconcile_pass as finite
import natural_reclaim_authority as natural
import projection_preflight as preflight
import sealed_scheduler
import worker_adapter
import worker_owner
import worker_source_authority as authority


ROW_SHA256 = '9ab7ba2d467d2e6bfea059085e6616dbe264903d4732ac9ee49664719741ad21'
FILES = finite.FILES | {'projection_preflight.py', 'projection_pass.py', 'completion_snapshot.py'}


class _Refused(ValueError):
    def __init__(self, evidence):
        super().__init__('projection_pass_refused')
        self.private_evidence = evidence


def _require(condition):
    if not condition:
        raise ValueError('projection_pass_refused')


def _files(context, directory, pins):
    _require(type(pins) is dict and set(pins) == FILES and all(readiness._pin(pin) for pin in pins.values()))
    captured = finite._files(context, directory, {name: pins[name] for name in finite.FILES})
    for name in FILES - finite.FILES:
        raw = context.owner.read(directory/name, pins[name])
        _require(type(raw) is bytes and 0 < len(raw) <= 16_000_000
            and hashlib.sha256(raw).hexdigest() == pins[name])
        captured[name] = raw
    for loaded in (preflight, completion_snapshot, sys.modules[__name__]):
        _require(sys.modules.get(loaded.__name__) is loaded
            and loaded.__file__ == str(directory/(loaded.__name__+'.py')))
    return captured


def _prepared(result):
    _require(type(result) is dict and result['summary']['status'] == 'projection-preflight-readonly-ready'
        and result['summary']['actionAttempted'] is False
        and result['summary']['newPaymentStarted'] is False
        and result['classificationBefore']['phase'] == 'apply_verified_projection'
        and result['projectionTargetRowSha256'] == ROW_SHA256
        and result['catalogBefore']['catalogSha256'] == finite.REVIEWED_CATALOG_SHA256)
    for value in (result['baseline']['capturedAt'], result['applicationBefore']['observedAt'],
        result['catalogBefore']['capturedAt'], result['backgroundBefore']['capturedAt']):
        readiness._fresh(value)


def _delta(before, after):
    result = financial_delta.prove_allowed_deltas(before, after)
    relation = 'prefunded_card.treasury_bindings'
    _require(before['tableRows'][relation] == after['tableRows'][relation]
        and before['allowedTargetWitnesses'][relation] == after['allowedTargetWitnesses'][relation])
    return result


def run_projection_pass(context, directory, pins):
    result = None
    try:
        _require(not sys.flags.optimize)
        directory = Path(directory)
        _require(directory.is_absolute() and '..' not in directory.parts)
        readiness._locked(context)
        context.deadline()
        captured = _files(context, directory, pins)
        finite_pins = {name: pins[name] for name in finite.FILES}
        prepared = preflight.collect_projection_preflight(context, directory, finite_pins)
        _prepared(prepared)
        result = dict(prepared)
        result.pop('summary')
        worker, scheduler = worker_owner.collect_worker_authority(context,
            load_scheduler=lambda path, source_pins: sealed_scheduler.bind_sealed_scheduler(context, path, source_pins))
        result['workerAuthority'] = worker
        expected = dict(status='worker-source-inputs-bound', containerId=authority.BACKGROUND_CONTAINER_ID,
            manifestSha256=authority.MANIFEST_SHA256, approvedCompanyBudgetKobo=10000,
            approvedPreservedPrincipalKobo=10000)
        _require(all(type(worker[name]) is type(value) and worker[name] == value for name, value in expected.items()))
        readiness._fresh(worker['observedAt'])

        def guarded_command(arguments, **options):
            if arguments == ['/usr/bin/systemctl', 'start', worker_adapter.SERVICE]:
                _require(_files(context, directory, pins) == captured)
                readiness._locked(context)
                context.deadline()
                _prepared(prepared)
                readiness._fresh(worker['observedAt'])
                current = preflight.collect_projection_preflight(context, directory, finite_pins)
                result['startBoundaryPreflight'] = current
                _prepared(current)
                finite._same_snapshot(prepared['baseline'], current['baseline'])
                readiness._fresh(worker['observedAt'])
            return context.owner.command(arguments, **options)

        adapter = worker_adapter.WorkerAdapter(run=guarded_command, read=finite._worker_reader(context, worker),
            inspect=lambda name: worker_owner._inspect(context.owner.command, [*worker_adapter.DOCKER, 'inspect', name]),
            scheduler=scheduler, container_id=worker['containerId'], manifest_sha=worker['manifestSha256'],
            file_hashes=worker['fileHashes'], quiescent=lambda: finite._quiet(context))
        worker_result, worker_failed = None, False
        try:
            worker_result = adapter.run_once()
        except Exception:
            worker_failed = True
        result.update(worker=worker_result, workerFailed=worker_failed)
        first_post = application_reports.capture_application(context, directory/'financial_report.sql',
            finite_pins['financial_report.sql'], directory/'financial_snapshot.sql',
            finite_pins['financial_snapshot.sql']) if worker_failed else finite._capture(context, directory, finite_pins)
        result.update(firstPost=first_post['protectedSnapshot'], firstPostApplication=first_post['application'])
        result['delta'] = _delta(prepared['baseline'], first_post['protectedSnapshot'])
        _require(not worker_failed)
        bundle = finite._bundle(context, directory, finite_pins)
        result.update(original=bundle['original'], provider=bundle['provider'])
        final = finite._capture(context, directory, finite_pins)
        result.update(final=final['protectedSnapshot'], finalApplication=final['application'])
        _delta(first_post['protectedSnapshot'], final['protectedSnapshot'])
        finite._same_snapshot(first_post['protectedSnapshot'], final['protectedSnapshot'])
        result['completedReport'] = application_reports.assemble_completed(
            final['application'], bundle['original'], bundle['provider'])
        result['snapshotCompletion'] = completion_snapshot.verify_completion_snapshot(
            result['completedReport'], final['protectedSnapshot'])
        catalog = finite._catalog(context, captured, finite.REVIEWED_CATALOG_SHA256)
        result['catalogAfter'] = catalog
        _require(_files(context, directory, pins) == captured)
        readiness._locked(context)
        context.deadline()
        finite._quiet(context)
        readiness._fresh(catalog['capturedAt'])
        readiness._fresh(final['protectedSnapshot']['capturedAt'])
        result['completedReport'] = application_reports.assemble_completed(
            final['application'], bundle['original'], bundle['provider'])
        result['summary'] = dict(status='existing-payment-financially-completed', operationId=natural.TARGET,
            financialCompleted=True, workerInvocations=1, newPaymentStarted=False,
            automaticRetryAttempted=False, replayRestarted=False, publicRestarted=False,
            preservedOldPrincipalKobo=10000, newPrincipalKobo=10000, consumedCompanyBudgetKobo=10000)
        return result
    except Exception:
        raise _Refused(result) from None

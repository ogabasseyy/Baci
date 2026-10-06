"""Single existing-payment transaction; execution requires the sealed root adapter."""

import copy
from datetime import datetime, timezone
import json


COMMAND = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock', 'exec', '-i',
    'baci-isolated-savings-db-1', '/usr/bin/psql', '-XqAt', '-w', '-v', 'ON_ERROR_STOP=1',
    '-v', 'VERBOSITY=sqlstate', '-U', 'postgres', '-d', 'postgres']
OPERATION = 'ff561046-58e7-428d-9163-f6e60b0dab65'
DEADLINE = '2026-10-06T15:59:10Z'


def _require(condition):
    if not condition:
        raise ValueError('existing_payment_continuation_refused')


def _deadline():
    _require(datetime.now(timezone.utc) < datetime.fromisoformat(DEADLINE.replace('Z', '+00:00')))


def _decode(raw):
    def unique(pairs):
        result = {}
        for name, value in pairs:
            _require(name not in result)
            result[name] = value
        return result
    _require(type(raw) is str and len(raw.encode('utf-8')) <= 4000000)
    return json.loads(raw, object_pairs_hook=unique, parse_constant=lambda value: _require(False))


def _same(first, second):
    _require({key: value for key, value in first.items() if key not in ('capturedAt', 'readOnly')}
        == {key: value for key, value in second.items() if key not in ('capturedAt', 'readOnly')})


def run_continuation(root, modules, captured, verify_release):
    transaction, prepared, precommit, evidence = None, None, None, {}
    mutation_attempted, succeeded, reconciled, audit_recorded = False, False, False, False
    stage = 'root-prerequisites'
    reports = modules['application_reports']
    delta = modules['financial_delta']

    def guard(boundary):
        verify_release()
        _deadline()
        root.guard(boundary, transaction=transaction)

    try:
        guard('prepare')
        prepared = copy.deepcopy(root.prepare())
        _require(type(prepared) is dict and set(prepared) == {'protectedSnapshot', 'original', 'provider'})
        baseline = prepared['protectedSnapshot']
        delta._snapshot(baseline)
        _require(baseline.get('readOnly') is True)
        reports._fresh(baseline['capturedAt'])
        preserved_notifications = modules['completion_snapshot']._preserved_notifications(
            baseline['allowedTargetWitnesses']['savings_notifications.events']['targetRows'],
            modules['projection_sql'].SCOPE)
        evidence['before'] = prepared
        root.journal('before', copy.deepcopy(evidence))
        inspection = ''.join(modules['inspection_sql'].inspection_sql(captured[filename], kind)
            for filename, kind in (('financial_report.sql', 'application'), ('financial_snapshot.sql', 'snapshot')))
        guard('transaction-start')
        stage = 'transaction'
        transaction = modules['psql_transaction'].PsqlTransaction(list(COMMAND))
        _require(transaction.execute(modules['projection_sql'].start_sql()) == [])
        root.guard('transaction-bound', transaction=transaction)
        mutation_attempted = True
        _require(transaction.execute(modules['projection_sql'].mutate_sql()) == [])
        stage = 'precommit-inspection'
        records = transaction.execute(inspection)
        _require(type(records) is list and len(records) == 2)
        observed = {}
        for raw in records:
            record = _decode(raw)
            _require(type(record) is dict and set(record) == {'kind', 'value'}
                and record['kind'] in ('application', 'snapshot') and record['kind'] not in observed)
            observed[record['kind']] = record['value']
        evidence['inspection'] = copy.deepcopy(observed)
        precommit = copy.deepcopy(observed['snapshot'])
        report = reports.assemble_precommit(observed['application'], prepared['original'], prepared['provider'])
        proof = modules['projection_fence'].verify_projection_fence(baseline, precommit, report)
        evidence['precommit'] = dict(report=report, protectedSnapshot=precommit, proof=proof)
        root.journal('precommit', copy.deepcopy(evidence))
        guard('commit-boundary')
        _require(transaction.execute(modules['projection_sql'].deadline_sql()) == [])
        stage = 'commit'
        transaction.finish(commit=True)
        _require(transaction.commit_attempted is True and transaction.commit_acknowledged is True
            and transaction.cleanup_confirmed is True)
        succeeded = True
    except Exception:
        succeeded = False
    finally:
        if transaction is not None and not transaction.closed:
            try:
                if not transaction.commit_attempted:
                    transaction.finish(commit=False)
                else:
                    transaction.close()
            except Exception:
                succeeded = False
                try:
                    transaction.close()
                except Exception:
                    pass

    if transaction is not None:
        try:
            verify_release()
            final = copy.deepcopy(root.reconcile())
            evidence['reconciliation'] = final
            _require(type(final) is dict and set(final) == {
                'application', 'protectedSnapshot', 'original', 'provider'})
            snapshot = final['protectedSnapshot']
            delta._snapshot(snapshot)
            _require(snapshot.get('readOnly') is True)
            reports._fresh(snapshot['capturedAt'])
            if transaction.commit_attempted is True:
                _require(precommit is not None)
                completed = reports.assemble_completed(final['application'], final['original'], final['provider'])
                bound = modules['completion_snapshot'].verify_completion_snapshot(completed, snapshot,
                    preserved_notifications=preserved_notifications)
                _same(precommit, snapshot)
                reconciled = True
                evidence['reconciliation'] = dict(collection=final, completedReport=completed, proof=bound)
            else:
                _same(prepared['protectedSnapshot'], snapshot)
                evidence['reconciliation'] = dict(collection=final, unchanged=True)
            if succeeded:
                guard('completed-readback')
        except Exception:
            succeeded = False
    try:
        root.journal('completed' if succeeded and reconciled else 'unconfirmed', copy.deepcopy(evidence))
        audit_recorded = True
    except Exception:
        succeeded = False
    completed = succeeded and reconciled
    return dict(status='existing-payment-continuation-completed' if completed else
        'existing-payment-continuation-unconfirmed' if transaction is not None else
        'existing-payment-continuation-refused', stage=stage, operationId=OPERATION, redacted=True,
        financialCommitted=True if completed else None if mutation_attempted else False,
        financialCompleted=completed, reconciledFinancialCompleted=reconciled,
        financialActionAttempted=mutation_attempted, commitAttempted=bool(transaction and transaction.commit_attempted),
        commitAcknowledged=bool(transaction and transaction.commit_acknowledged),
        localCleanupConfirmed=bool(transaction and transaction.cleanup_confirmed),
        privateAuditRecorded=audit_recorded, newPaymentStarted=False, automaticRetryAttempted=False,
        replayRestarted=False, publicRestarted=False)

"""Existing-payment-only root adapter; no entrypoint or activation permission."""

import copy
import json
import os
from pathlib import Path
import tempfile
import time
import stat

import continuation_checks as checks
import continuation_evidence as evidence
import continuation_legacy as legacy
from owned_transaction_drain import OwnedTransactionDrain
from continuation_release import require


class Root:
    def __init__(self, captured):
        self.context, self.closed, self.prepared = None, False, False
        self.owned_transaction, self.drain = None, None
        self.inputs = evidence.capture()
        self.diagnostic = evidence.module(self.inputs[next(path for path in evidence.PINS
            if 'baci-project-rollback-bootstrap.' in str(path))],
            next(path for path in evidence.PINS if 'baci-project-rollback-bootstrap.' in str(path)))
        continuity = evidence.module(self.inputs[evidence.REPAIR/'reboot_continuity.py'],
            evidence.REPAIR/'reboot_continuity.py')
        continuity.install(self.diagnostic)
        self.legacy = legacy.Legacy(self.diagnostic, legacy.capture(self.diagnostic))
        legacy.verify_mapping(self.legacy.captured, captured)
        try:
            with self.legacy.scope() as modules:
                self.after, self.repair = evidence.verify(self.inputs, modules)
                require(all(captured[name] == self.legacy.captured[name]
                    for name in ('financial_report.sql', 'financial_snapshot.sql')))
                self.context = modules['cutover_context'].Context.__new__(modules['cutover_context'].Context)
                self.context.__init__()
                self.profile = checks.guard(self.context, self.diagnostic, modules)
            self.audit = Path(tempfile.mkdtemp(prefix='baci-existing-payment-continuation.', dir='/root'))
            os.chmod(self.audit, 0o700)
        except BaseException:
            self.close()
            raise

    def _sources(self):
        require(not self.closed and evidence.capture() == self.inputs)
        self.legacy.recheck()

    def guard(self, stage, transaction=None):
        started = time.monotonic()
        require(stage in ('prepare', 'transaction-start', 'transaction-bound',
            'commit-boundary', 'completed-readback'))
        if stage == 'transaction-bound':
            require(self.prepared and transaction is not None and not transaction.closed
                and self.owned_transaction is None)
            self.owned_transaction = transaction
            self.drain = OwnedTransactionDrain(transaction)
            return
        self._sources()
        if transaction is not None:
            require(self.prepared)
            if stage == 'completed-readback':
                require(transaction is self.owned_transaction and transaction.closed
                    and transaction.commit_acknowledged is True and transaction.cleanup_confirmed is True)
                transaction = None
            else:
                require(stage == 'commit-boundary' and not transaction.closed)
                require(self.owned_transaction is transaction and self.drain is not None)
        else:
            require(stage != 'commit-boundary')
        with self.legacy.scope() as modules:
            require(checks.guard(self.context, self.diagnostic, modules, transaction,
                self.drain if transaction is not None else None, started) == self.profile)
            if transaction is not None:
                modules['provider_preflight'].checked_provider(self.provider)
                modules['provider_preflight'].fresh(self.original['receiptStorage']['observedAt'])
                modules['provider_preflight'].fresh(self.original['provenance']['sourceProofObservedAt'])

    def _collect(self):
        self._sources()
        with self.legacy.scope() as modules:
            require(checks.guard(self.context, self.diagnostic, modules) == self.profile)
            original, provider = checks.provenance(self.context, modules, legacy.ROOT, self.legacy.pins)
            normal = modules['application_reports'].capture_application(self.context,
                legacy.ROOT/'financial_report.sql', self.legacy.pins['financial_report.sql'],
                legacy.ROOT/'financial_snapshot.sql', self.legacy.pins['financial_snapshot.sql'])
            require(checks.guard(self.context, self.diagnostic, modules) == self.profile)
        self._sources()
        return dict(**normal, original=original, provider=provider)

    def prepare(self):
        require(not self.prepared)
        current = self._collect()
        evidence.same(self.after['normal']['protectedSnapshot'], current['protectedSnapshot'])
        with self.legacy.scope() as modules:
            checker = modules['financial_readiness_owner']._decode(
                self.context.finance['database'](self.repair.CHECKER_QUERY).encode())
            require(checker == self.after['checker'])
            catalog = modules['financial_reconcile_pass']._catalog(self.context,
                self.legacy.captured, modules['projection_preflight'].CATALOG_SHA256)
            row_pin = modules['financial_reconcile_pass']._projection_pin(self.context,
                self.legacy.captured, current['protectedSnapshot'], catalog)
            require(row_pin == modules['projection_preflight'].PROJECTION_ROW_SHA256)
            classified, background = modules['financial_reconcile_pass']._classify(self.context,
                self.legacy.captured, catalog, modules['projection_preflight'].CATALOG_SHA256, row_pin)
            require(classified['status'] == 'classified_only'
                and classified['phase'] == 'apply_verified_projection'
                and classified['financialActionAuthorized'] is False)
            modules['application_reports'].assemble_native(current['application'],
                current['original'], current['provider'])
        self.original, self.provider = copy.deepcopy(current['original']), copy.deepcopy(current['provider'])
        self.prepared = True
        return {name: copy.deepcopy(current[name]) for name in ('protectedSnapshot', 'original', 'provider')}

    def reconcile(self):
        return self._collect()

    def journal(self, phase, value):
        require(not self.closed and phase in ('before', 'precommit', 'completed', 'unconfirmed'))
        require(len(json.dumps(value, allow_nan=False).encode()) <= 4000000)
        info = self.audit.lstat()
        require(stat.S_ISDIR(info.st_mode) and info.st_uid == info.st_gid == 0
            and stat.S_IMODE(info.st_mode) == 0o700)
        with self.legacy.scope():
            self.context.journal(self.audit, phase, value)

    def close(self):
        if self.closed:
            return
        self.closed = True
        if self.context is not None:
            descriptor = getattr(self.context, 'lock', None)
            self.context = None
            if descriptor is not None:
                os.close(descriptor)


def prepare_root(captured):
    return Root(captured)

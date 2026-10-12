"""Actual notification-only root callbacks; financial sources are authenticated R2."""

import hashlib
import fcntl
import os
from pathlib import Path
import tempfile
import stat
from types import SimpleNamespace

import continuation_evidence as evidence
import continuation_legacy as legacy
from continuation_root import Root
import notification_collection as collection
import notification_resume as BASE
import notification_scope as SCOPE
from notification_io import operation_lock
from notification_systemd import NotificationSystemd
from public_resume_adapter import PublicCallbacks, AUDIT_PINS
import public_resume


OWNED = {BASE.TIMER, BASE.SERVICE, BASE.CHECK}
ORIGINAL_UNITS = ('baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
    BASE.TIMER, BASE.SERVICE, BASE.CHECK, 'baci-staging-test-payments.service',
    'baci-prefunded-public.service', 'baci-prefunded-background.service')


class ReadonlyRoot:
    _sources = Root._sources

    def __init__(self, captured):
        self.context, self.closed, self.prepared = None, False, False
        self.owned_transaction, self.drain, self.notification_lock = None, None, None
        try:
            self.inputs = evidence.capture()
            path = next(path for path in evidence.PINS if 'baci-project-rollback-bootstrap.' in str(path))
            self.diagnostic = evidence.module(self.inputs[path], path)
            continuity = evidence.module(self.inputs[evidence.REPAIR/'reboot_continuity.py'],
                evidence.REPAIR/'reboot_continuity.py')
            continuity.install(self.diagnostic)
            self.legacy = legacy.Legacy(self.diagnostic, legacy.capture(self.diagnostic))
            legacy.verify_mapping(self.legacy.captured, captured)
            with self.legacy.scope() as modules:
                evidence.verify(self.inputs, modules)
                BASE.require(all(captured[name] == self.legacy.captured[name]
                    for name in ('financial_report.sql', 'financial_snapshot.sql')))
                self.context = modules['cutover_context'].Context.__new__(modules['cutover_context'].Context)
                self.context.__init__()
                self.profile = dict(worker=self.diagnostic.inspect(self.diagnostic.WORKER),
                    unit=self.diagnostic.worker_unit())
            self.notification_lock = operation_lock()
            self.audit = Path(tempfile.mkdtemp(prefix='baci-notification-timer.', dir='/root'))
            os.chmod(self.audit, 0o700)
        except BaseException:
            self.close()
            raise

    def close(self):
        descriptor, self.notification_lock = self.notification_lock, None
        error = None
        try:
            Root.close(self)
        except Exception as failure:
            error = failure
        finally:
            if descriptor is not None:
                try:
                    os.close(descriptor)
                except Exception as failure:
                    error = failure
        if error is not None:
            raise ValueError('notification_lock_cleanup_unconfirmed') from None


class NotificationCallbacks(NotificationSystemd, PublicCallbacks):
    def __init__(self, root, verify, reviewed, files):
        self.public_reviewed, self.public_running, self.files = reviewed['public'], reviewed['publicRunning'], files
        BASE.require(type(self.public_running) is bool)
        PublicCallbacks.__init__(self, root, AUDIT_PINS, verify)

    def public_guard(self):
        origins = (self.read, self.inventory, self.inspect, self.unit_state,
            self.collect_completed, self.deadline, self.exclusive, self.run, self.job_state, self.clock)
        captured = public_resume._inputs(self.public_reviewed, self.read, self.inventory, origins)
        public_resume._container(self.inspect, self.public_reviewed['container'], self.public_running)
        public_resume._unit(self.unit_state, captured[public_resume.UNIT], self.public_running)
        BASE.require(self.deadline()['epoch'] == BASE.TARGET_EPOCH)

    def guard_collectors(self, modules):
        quiet = modules['financial_quiescence']
        BASE.require(quiet.UNITS == ORIGINAL_UNITS)
        mapped = SimpleNamespace(**vars(quiet))
        mapped.UNITS = tuple(name for name in quiet.UNITS if name not in OWNED)
        PublicCallbacks.guard_collectors(self, dict(modules, financial_quiescence=mapped))
        self.public_guard()

    def exclusive(self):
        BASE.require(self.sealed_guard() is True and self.owned_lock() is True)
        self.root._sources()
        BASE.require(self.audit_bytes() == self.audits)
        with self.root.legacy.scope() as modules:
            context = self.root.context
            modules['financial_readiness_owner']._locked(context)
            context.deadline()
            BASE.require(context.exclusive() is True and context.verify_files() is True)
        BASE.require(self.sealed_guard() is True)
        return True

    def owned_lock(self):
        BASE.require(self.root.closed is False and self.root.notification_lock is not None)
        opened = os.fstat(self.root.notification_lock)
        linked = Path('/run/baci-notifications-renewal.lock').lstat()
        BASE.require(stat.S_ISREG(opened.st_mode) and stat.S_ISREG(linked.st_mode)
            and opened.st_uid == opened.st_gid == 0 and opened.st_nlink == 1
            and stat.S_IMODE(opened.st_mode) == 0o600
            and (opened.st_dev, opened.st_ino, opened.st_mode, opened.st_uid, opened.st_gid, opened.st_nlink)
                == (linked.st_dev, linked.st_ino, linked.st_mode, linked.st_uid, linked.st_gid, linked.st_nlink))
        fcntl.flock(self.root.notification_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        return True

    def scope_collect(self):
        BASE.require(self.exclusive() is True)
        root = self.root
        with root.legacy.scope() as modules:
            self.guard_collectors(modules)
            snapshot = root.context.owner.read(legacy.ROOT/'financial_snapshot.sql',
                root.legacy.pins['financial_snapshot.sql'])
            query = collection.compose(snapshot, self.files['notification-scope-query.sql'],
                self.files['notification-role-guard.sql'])
            value = collection.decode_output(root.context.finance['database'](query))
            self.guard_collectors(modules)
        BASE.financial_delta._snapshot(value['protectedSnapshot'])
        BASE.require(value['protectedSnapshot']['readOnly'] is True)
        SCOPE.validate(value['scope'])
        SCOPE.validate_database(value['database'])
        BASE.require(self.exclusive() is True)
        return value

    def collect(self):
        completed = PublicCallbacks.collect_completed(self)
        scope = self.scope_collect()
        BASE.same(completed['protectedSnapshot'], scope['protectedSnapshot'])
        deliveries = [row for row in scope['scope']['deliveries'] if row['notificationId'] == BASE.EVENT]
        return dict(completed, activity=dict(activeStorefrontTokens=len(scope['scope']['tokens']),
            deliveryRows=len(deliveries), withTicket=sum(row['ticketSha256'] is not None for row in deliveries),
            role=scope['database']['role']))

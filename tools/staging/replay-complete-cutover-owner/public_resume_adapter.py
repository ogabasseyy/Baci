"""Postcredit public callbacks using an authenticated r2 Root, never Root.prepare."""

import copy
import hashlib
import json
from pathlib import Path
import stat

import application_reports
import completion_snapshot
import continuation_checks as checks
import continuation_legacy as legacy
import financial_completion
import public_resume
from public_resume_runtime import PublicRuntime, require


AUDITS = {
    'before': '/root/baci-existing-payment-continuation.xksoez3y/before-2e5a1e38934048e1b03ec380ce12b90a.json',
    'precommit': '/root/baci-existing-payment-continuation.xksoez3y/precommit-88e2e88dc607467380a284b319710ef3.json',
    'completed': '/root/baci-existing-payment-continuation.xksoez3y/completed-533ee4d66f624a71b65cc9c268f4baaa.json',
}
AUDIT_PINS = dict(before='bfecd8757ef8578526b260c597b727cfff510e503071610c64a1e18ea4a3fdef',
    precommit='c652782a4e377ae8463db14b9443809affd789da508ea52f93696ffb17e30a5e',
    completed='b05cb92ae1d17fba8b9f09216ac198da08b5470ec11fd851aa0e9c97ec026c9c')


class PublicCallbacks(PublicRuntime):
    def __init__(self, root, audit_pins, sealed_guard):
        super().__init__()
        require(callable(sealed_guard) and sealed_guard() is True)
        self.sealed_guard = sealed_guard
        require(type(audit_pins) is dict and set(audit_pins) == set(AUDITS)
            and audit_pins == AUDIT_PINS and all(public_resume._pin(pin) for pin in audit_pins.values()))
        require(root.context is not None and root.closed is False and root.prepared is False
            and root.owned_transaction is None and root.drain is None)
        self.root, self.audit_pins = root, copy.deepcopy(audit_pins)
        self.audits = self.audit_bytes()
        values = {name: public_resume._json(raw) for name, raw in self.audits.items()}
        require(values['before']['before'] == values['precommit']['before'] == values['completed']['before']
            and values['precommit']['precommit'] == values['completed']['precommit'])
        precommit = values['precommit']['precommit']
        self.preserved = completion_snapshot._preserved_notifications(
            values['before']['before']['protectedSnapshot']['allowedTargetWitnesses']['savings_notifications.events']['targetRows'],
            precommit['report']['nativeEvidence']['scope'])
        completion_snapshot.verify_precommit_snapshot(precommit['report'], precommit['protectedSnapshot'],
            preserved_notifications=self.preserved)
        reconciled = values['completed']['reconciliation']
        financial_completion.validate_completed(reconciled['completedReport'])
        completion_snapshot.verify_completion_snapshot(reconciled['completedReport'],
            reconciled['collection']['protectedSnapshot'], preserved_notifications=self.preserved)
        require(reconciled['proof'].get('snapshotCompletionBound') is True)

    def audit_bytes(self):
        result = {}
        for name, path in AUDITS.items():
            raw, _ = self.read(Path(path), mode=0o600)
            require(hashlib.sha256(raw).hexdigest() == self.audit_pins[name])
            result[name] = raw
        return result

    def exclusive(self):
        require(self.sealed_guard() is True)
        self.root._sources()
        require(self.audit_bytes() == self.audits)
        with self.root.legacy.scope() as modules:
            self.guard_collectors(modules)
        require(self.sealed_guard() is True)
        return True

    def before_start(self):
        require(self.exclusive() is True)

    def guard_collectors(self, modules):
        context, diagnostic = self.root.context, self.root.diagnostic
        quiet = modules['financial_quiescence']
        modules['financial_readiness_owner']._locked(context)
        context.deadline()
        require(context.exclusive() is True and context.verify_files() is True)
        image, worker = diagnostic.inspect(diagnostic.IMAGE), diagnostic.inspect(diagnostic.WORKER)
        modules['worker_source_authority']._profile(worker, image)
        require(worker['State']['ExitCode'] == 1 and worker['State']['OOMKilled'] is False)
        unit = diagnostic.worker_unit()
        require(dict(worker=worker, unit=unit) == self.root.profile)
        raw = diagnostic.read_regular(diagnostic.CONFIGURATION, 65532, 131072)
        info = diagnostic.CONFIGURATION.lstat()
        require(hashlib.sha256(raw).hexdigest() == diagnostic.CONFIGURATION_SHA
            and info.st_gid == 65532 and stat.S_IMODE(info.st_mode) == 0o600)
        native = context.operator.inspect(quiet.NATIVE_ID, quiet.NATIVE_ROOT, quiet.NATIVE_SEAL,
            name='pvb-staging-replay-prefunded')
        quiet._stopped(native, quiet.NATIVE_ID, 'pvb-staging-replay-prefunded')
        quiet._stopped(context.competitor(), quiet.COMPETITOR_ID, 'baci-interest-replay')
        require(quiet.STOPPED['baci-prefunded-public'] == public_resume.CID)
        for name, identifier in quiet.STOPPED.items():
            if identifier not in (diagnostic.WORKER, public_resume.CID):
                quiet._stopped(diagnostic.inspect(identifier), identifier, name)
        for name in quiet.UNITS:
            if name not in ('baci-prefunded-background.service', public_resume.SERVICE):
                quiet._unit(context, name)
        observed = json.loads(context.finance['database'](quiet.DRAIN_SQL))
        require(type(observed) is dict and set(observed) == set(quiet.IDENTITY)
            and all(type(observed[key]) is type(value) and observed[key] == value
                for key, value in quiet.IDENTITY.items()))
        context.deadline()
        modules['financial_readiness_owner']._locked(context)

    def collect_completed(self):
        require(self.exclusive())
        root = self.root
        with root.legacy.scope() as modules:
            self.guard_collectors(modules)
            original, provider = checks.provenance(root.context, modules, legacy.ROOT, root.legacy.pins)
            observed = modules['application_reports'].capture_application(root.context,
                legacy.ROOT/'financial_report.sql', root.legacy.pins['financial_report.sql'],
                legacy.ROOT/'financial_snapshot.sql', root.legacy.pins['financial_snapshot.sql'])
            self.guard_collectors(modules)
        completed = application_reports.assemble_completed(observed['application'], original, provider)
        completion_snapshot.verify_completion_snapshot(completed, observed['protectedSnapshot'],
            preserved_notifications=self.preserved)
        require(self.exclusive())
        return dict(completed=completed, protectedSnapshot=observed['protectedSnapshot'])

    def resume(self, reviewed, reviewed_sha256):
        require(reviewed.get('notificationHistoryAudit') == dict(path=AUDITS['precommit'],
            sha256=self.audit_pins['precommit']))
        return public_resume.resume_public(reviewed=reviewed, reviewed_sha256=reviewed_sha256,
            read=self.read, inventory=self.inventory, inspect=self.inspect, unit_state=self.unit_state,
            collect_completed=self.collect_completed, deadline=self.deadline, exclusive=self.exclusive,
            run=self.run, start_job_state=self.start_job_state, clock=self.clock)

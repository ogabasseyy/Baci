import copy
from datetime import datetime, timedelta, timezone
import hashlib
import importlib.util
import json
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
CONTRACTS = HERE.parents[1]/'replay-complete-cutover-owner'
sys.path.insert(0, str(CONTRACTS))
sys.path.insert(0, str(HERE))


def load(name, path):
    specification = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(module)
    return module


FIXTURE = load('notification_snapshot_fixture', CONTRACTS/'completion_snapshot.test.py')
SUBJECT = load('notification_resume', HERE/'notification_resume.py') if (HERE/'notification_resume.py').exists() else None


def encoded(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


class Host:
    def __init__(self):
        self.now = datetime(2026, 10, 3, 20, tzinfo=timezone.utc)
        report = FIXTURE.REPORTS.completed_fixture()
        report['notifications'][0]['notificationId'] = 'ad00ea01-65f0-4594-b4f9-71cb609c6aaa'
        report['notifications'][0].update(eventKey='first-contribution', type='first_contribution')
        report['goals'][0].update(targetKobo=40001, status='active', completedAt=None)
        stamp = self.now.isoformat().replace('+00:00', 'Z')
        report['observedAt'] = stamp
        native = report['nativeEvidence']
        for value in (native, native['receiptStorage']):
            value['observedAt'] = stamp
        native['provenance']['sourceProofObservedAt'] = stamp
        snapshot = FIXTURE.consistent_snapshot(report)
        snapshot['capturedAt'] = stamp
        witness = json.loads((HERE.parents[1]/'ledger-balance-repair'/'notification-witness.fixture.json').read_bytes())
        relation = 'savings_notifications.events'
        contribution = snapshot['allowedTargetWitnesses'][relation]
        witness['targetRows'].extend(contribution['targetRows'])
        witness['targetRowColumnHashes'].extend(contribution['targetRowColumnHashes'])
        witness.update(targetCount=2, targetHash='a'*64)
        snapshot['allowedTargetWitnesses'][relation] = witness
        snapshot['tableRows'][relation].update(count=9, oid=44963)
        role = dict(exists=True, canLogin=True, inherit=False, superuser=False, bypassRls=False,
            createDb=False, createRole=False, replication=False, configIsNull=True, memberCount=0,
            validUntil=SUBJECT.notification_contract.TARGET)
        self.bundle = dict(completed=report, protectedSnapshot=snapshot,
            activity=dict(activeStorefrontTokens=0, deliveryRows=0, withTicket=0, role=role))
        self.baseline = copy.deepcopy(self.bundle)
        self.files, self.commands = {}, []
        self.units = {name: dict(LoadState='loaded', FragmentPath=SUBJECT.UNIT_ROOT+name,
            DropInPaths='', NeedDaemonReload='no', Transient='no', ActiveState='inactive', SubState='dead',
            MainPID='0', Result='success', ExecMainStatus='0', pendingJobs=[]) for name in SUBJECT.UNITS}
        self.units[SUBJECT.DEADLINE].update(ActiveState='active', SubState='waiting',
            nextEpoch=SUBJECT.TARGET_EPOCH, Triggers=SUBJECT.STOPPER)
        self.units[SUBJECT.STOPPER]['ExecStart'] = '{ argv[]=/usr/bin/systemctl stop ' + ' '.join(
            (SUBJECT.TIMER, SUBJECT.SERVICE, SUBJECT.CHECK)) + ' ; ignore_errors=no ; }'
        self.units[SUBJECT.CHECK]['ExecMainStartTimestampMonotonic'] = '0'
        specification = importlib.util.spec_from_file_location('notification_units', HERE.parents[1]/'savings-engagement/worker_contract.py')
        factory = importlib.util.module_from_spec(specification)
        specification.loader.exec_module(factory)
        for name, raw in factory.unit_files().items():
            if name in (SUBJECT.SERVICE, SUBJECT.CHECK):
                raw = raw.replace(b'1790697550', str(SUBJECT.TARGET_EPOCH).encode())
            if name == SUBJECT.CHECK:
                raw += b'RemainAfterExit=yes\n'
            if name == SUBJECT.DEADLINE:
                raw = raw.replace(b'2026-09-29 15:59:10 UTC', b'2026-10-06 15:59:10 UTC')
            self.files[SUBJECT.UNIT_ROOT+name] = raw
        self.reviewed = dict(sources={}, baselinePath='/root/notification-postcredit.json',
            baselineSha256=hashlib.sha256(encoded(self.baseline)).hexdigest(),
            assets={SUBJECT.WORKER: hashlib.sha256(b'worker').hexdigest(),
                SUBJECT.CA: hashlib.sha256(b'ca').hexdigest()})
        self.files.update({self.reviewed['baselinePath']: encoded(self.baseline), SUBJECT.WORKER: b'worker', SUBJECT.CA: b'ca'})
        for path in SUBJECT.source_paths((self.read, self.state, self.collect, self.exclusive,
            self.run, self.job, self.clock)):
            raw = Path(path).read_bytes()
            self.files[path] = raw
            self.reviewed['sources'][path] = hashlib.sha256(raw).hexdigest()

    def read(self, path, mode):
        return self.files[str(path)], dict(uid=0, gid=0, mode=mode, nlink=1, regularFile=True)

    def state(self, name):
        return copy.deepcopy(self.units[name])

    def collect(self):
        return copy.deepcopy(self.bundle)

    def exclusive(self):
        return True

    def clock(self):
        return self.now

    def run(self, command, timeout):
        self.commands.append(command)
        if command[1] == 'start':
            self.units[SUBJECT.CHECK].update(ActiveState='active', SubState='exited',
                ExecMainCode='exited', ExecMainStartTimestampMonotonic='1')
        else:
            self.units[SUBJECT.CHECK].update(ActiveState='inactive', SubState='dead')

    def job(self, name, started):
        return dict(unit=name, submittedAt=started, observedAt=self.now.isoformat(),
            jobId=1, terminal=True, pendingJobs=[], activating=False)

    def invoke(self, restore=False):
        with patch.object(SUBJECT, 'ASSET_PINS', self.reviewed['assets']):
            return SUBJECT.inspect_or_restore_check(reviewed=self.reviewed,
                reviewed_sha256=hashlib.sha256(encoded(self.reviewed)).hexdigest(), read=self.read,
                state=self.state, collect=self.collect, exclusive=self.exclusive, run=self.run,
                job_state=self.job, clock=self.clock, restore_check=restore)


class NotificationResumeTests(unittest.TestCase):
    def setUp(self):
        self.assertIsNotNone(SUBJECT, 'resume-only source missing')
        self.host = Host()

    def test_inspection_preserves_actual_reminder_and_never_runs_a_command(self):
        result = self.host.invoke()
        self.assertEqual(result['status'], 'notification-resume-inspected')
        self.assertEqual(self.host.commands, [])
        self.assertFalse(result['schedulingRestored'])
        self.assertEqual(result['pushReadiness'], 'no-token')
        self.assertEqual((result['deliveryRows'], result['withTicket']), (0, 0))
        self.assertFalse(result['deviceReceiptVerified'])

    def test_collector_advancing_clock_accepts_real_dynamic_timestamps(self):
        host = Host()
        retained = copy.deepcopy(host.bundle)
        provider_date = retained['completed']['nativeEvidence']['evidence'][0]['createdAt']
        def collect():
            host.now += timedelta(seconds=2)
            value = copy.deepcopy(host.bundle)
            stamp = host.now.isoformat().replace('+00:00', 'Z')
            value['completed']['observedAt'] = stamp
            value['protectedSnapshot']['capturedAt'] = stamp
            native = value['completed']['nativeEvidence']
            native['observedAt'] = native['receiptStorage']['observedAt'] = stamp
            native['provenance']['sourceProofObservedAt'] = stamp
            self.assertEqual(native['evidence'][0]['createdAt'], provider_date)
            return value
        host.collect = collect
        self.assertEqual(host.invoke()['status'], 'notification-resume-inspected')
        self.assertEqual(host.bundle, retained)

    def test_all_five_dynamic_times_refuse_stale_future_and_outside_collect_interval(self):
        host = Host()
        paths = (('completed', 'observedAt'), ('protectedSnapshot', 'capturedAt'),
            ('completed', 'nativeEvidence', 'observedAt'),
            ('completed', 'nativeEvidence', 'receiptStorage', 'observedAt'),
            ('completed', 'nativeEvidence', 'provenance', 'sourceProofObservedAt'))
        for path in paths:
            for delta in (-61, 1, -1):
                with self.subTest(path=path, delta=delta):
                    value = copy.deepcopy(host.bundle)
                    selected = value
                    for part in path[:-1]:
                        selected = selected[part]
                    selected[path[-1]] = (host.now+timedelta(seconds=delta)).isoformat()
                    with self.assertRaises(ValueError):
                        SUBJECT.collection_times(value, host.baseline, host.now, host.now)
        with self.assertRaises(ValueError):
            SUBJECT.collection_times(host.bundle, host.baseline, host.now, host.now-timedelta(seconds=61))

    def test_native_semantics_cannot_change_with_fresh_times(self):
        host = Host()
        for section, field in (('provenance', 'sourceProofSha256'), ('receiptStorage', 'payloadSha256'),
                ('crosswalk', 'publicWalletId')):
            value = copy.deepcopy(host.bundle)
            value['completed']['nativeEvidence'][section][field] = 'changed'
            with self.assertRaises(ValueError):
                SUBJECT.collection_times(value, host.baseline, host.now, host.now)

    def test_two_hour_baseline_accepts_fresh_actual_proof_without_modifying_provider_dates(self):
        host = Host()
        host.now += timedelta(hours=2)
        def collect():
            value = copy.deepcopy(host.bundle)
            stamp = host.now.isoformat().replace('+00:00', 'Z')
            value['completed']['observedAt'] = value['protectedSnapshot']['capturedAt'] = stamp
            native = value['completed']['nativeEvidence']
            native['observedAt'] = native['receiptStorage']['observedAt'] = stamp
            native['provenance']['sourceProofObservedAt'] = stamp
            return value
        host.collect = collect
        self.assertEqual(host.invoke()['status'], 'notification-resume-inspected')

    def test_restore_only_checks_then_stops_never_enqueues_or_starts_delivery(self):
        result = self.host.invoke(True)
        self.assertEqual(result['status'], 'notification-readonly-check-verified')
        self.assertEqual(self.host.commands, [[SUBJECT.SYSTEMCTL, 'start', SUBJECT.CHECK],
            [SUBJECT.SYSTEMCTL, 'stop', SUBJECT.CHECK]])
        self.assertTrue(result['protectedStateUnchanged'])
        self.assertFalse(result['schedulingRestored'])

    def test_deadline_unit_or_old_and_new_notification_drift_refuses_before_start(self):
        for selected in ('deadline', 'unit', 'reminder', 'old-goal', 'contribution'):
            with self.subTest(selected=selected):
                host = Host()
                witness = host.bundle['protectedSnapshot']['allowedTargetWitnesses']['savings_notifications.events']
                if selected == 'deadline':
                    host.units[SUBJECT.DEADLINE]['nextEpoch'] += 1
                elif selected == 'unit':
                    host.files[SUBJECT.UNIT_ROOT+SUBJECT.CHECK] += b'changed'
                elif selected == 'old-goal':
                    witness['excludedTargetHash'] = 'e'*64
                elif selected == 'reminder':
                    witness['targetRowColumnHashes'][0]['body'] = 'e'*64
                else:
                    witness['targetRows'][1]['id'] = 'aaaaaaaa-0000-4000-8000-000000000001'
                self.assertEqual(host.invoke(True)['status'], 'notification-resume-refused')
                self.assertEqual(host.commands, [])

    def test_postcheck_drift_and_pending_job_never_claim_cleanup_or_delivery(self):
        original_run = self.host.run
        def run(command, timeout):
            original_run(command, timeout)
            if command[1] == 'start':
                self.host.bundle['protectedSnapshot']['permanentMetadataSha256'] = 'e'*64
        self.host.run = run
        self.assertEqual(self.host.invoke(True)['status'], 'notification-resume-refused')
        host = Host()
        original_job = host.job
        def job(name, started):
            return dict(original_job(name, started), terminal=False, pendingJobs=[1])
        host.job = job
        result = host.invoke(True)
        self.assertIsNone(result['checkStopped'])
        self.assertFalse(result['schedulingRestored'])

    def test_expiry_role_and_source_drift_refuse_without_any_start(self):
        for selected in ('expiry', 'role', 'source'):
            with self.subTest(selected=selected):
                host = Host()
                if selected == 'expiry':
                    host.now = datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)
                elif selected == 'role':
                    host.bundle['activity']['role']['bypassRls'] = True
                else:
                    host.files[str(Path(SUBJECT.__file__).resolve())] += b'changed'
                self.assertEqual(host.invoke(True)['status'], 'notification-resume-refused')
                self.assertEqual(host.commands, [])

    def test_current_unit_hashes_are_derived_not_unverified_fresh_inventory_pins(self):
        for name, pin in SUBJECT.UNIT_PINS.items():
            raw = self.host.files[SUBJECT.UNIT_ROOT+name]
            self.assertEqual(hashlib.sha256(raw).hexdigest(), pin)


if __name__ == '__main__':
    unittest.main()

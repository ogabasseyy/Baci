import copy
import importlib.util
from pathlib import Path
import sys
import unittest
from unittest.mock import patch


HERE = Path(__file__).resolve().parent
sys.path[:0] = [str(HERE), str(HERE.parents[1]/'replay-complete-cutover-owner')]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE/(name+'.test.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


HOST = load('notification_resume')
SCOPE = load('notification_scope')
SPEC = importlib.util.spec_from_file_location('notification_timer_resume', HERE/'notification_timer_resume.py')
SUBJECT = importlib.util.module_from_spec(SPEC)
if Path(SPEC.origin).exists():
    SPEC.loader.exec_module(SUBJECT)


class TimerHost(HOST.Host):
    def __init__(self):
        super().__init__()
        self.scope = SCOPE.fixture()
        self.scope['capturedAt'] = self.bundle['protectedSnapshot']['capturedAt']
        self.bundle['protectedSnapshot']['tableRows']['savings_notifications.deliveries']['count'] = 0
        self.bundle['protectedSnapshot']['allowedTargetWitnesses']['savings_notifications.deliveries'].update(
            targetCount=0, excludedTargetCount=0, targetRows=[], targetRowColumnHashes=[])
        for position in range(8):
            row = copy.deepcopy(self.scope['events'][0])
            row.update(id=f'00000000-0000-4000-8000-{position:012d}', eventKey=f'historical:{position}')
            self.scope['events'].append(row)
        self.scope['tables'] = {name: copy.deepcopy(self.bundle['protectedSnapshot']['tableRows'][name])
            for name in SUBJECT.SCOPE.TABLES}
        self.files[self.reviewed['baselinePath']] = HOST.encoded(self.bundle)
        self.reviewed['baselineSha256'] = HOST.hashlib.sha256(self.files[self.reviewed['baselinePath']]).hexdigest()
        contract = SUBJECT.BASE.notification_contract
        routines = [dict(signature=name, bodyMd5=body, language=language, owner='postgres',
            securityDefiner=True, config=['search_path=""'], acl=contract.routine_acl(name))
            for name, (body, language) in contract.ROUTINES.items()]
        functions = sorted('savings_notifications.'+name.replace(', ', ',') for name in contract.EXECUTABLE)
        database = dict(role=self.bundle['activity']['role'], routines=routines,
            directExecutions=functions, effectiveDefiners=functions)
        self.scope_bundle = dict(scope=self.scope, protectedSnapshot=self.bundle['protectedSnapshot'], database=database)
        self.files['/root/scope.json'] = HOST.encoded(self.scope_bundle)
        self.timer_review = dict(inspection=self.reviewed, scopeBaselinePath='/root/scope.json',
            scopeBaselineSha256=HOST.hashlib.sha256(self.files['/root/scope.json']).hexdigest(), expectedEvents=[])
        for path in SUBJECT.sources((self.read, self.state, self.collect, self.scope_collect,
                self.exclusive, self.run, self.job, self.settle, self.clock)):
            self.files[path] = Path(path).read_bytes()
            self.reviewed['sources'][path] = HOST.hashlib.sha256(self.files[path]).hexdigest()
        self.pending = False
        self.drift = False
        self.seal_drift = False

    def scope_collect(self):
        value = copy.deepcopy(self.scope_bundle)
        if self.drift and self.commands:
            value['protectedSnapshot']['permanentMetadataSha256'] = '2'*64
        return value

    def run(self, command, timeout):
        self.commands.append(command)
        if command[1] == 'start':
            self.units[SUBJECT.BASE.TIMER].update(ActiveState='active', SubState='waiting',
                Triggers=SUBJECT.BASE.SERVICE, nextEpoch=int(self.now.timestamp())+900)
            if self.pending:
                self.units[SUBJECT.BASE.TIMER]['pendingJobs'] = [1]
        else:
            for name in command[2:]:
                self.units[name].update(ActiveState='inactive', SubState='dead')

    def job(self, name, started):
        return dict(unit=name, submittedAt=started, observedAt=self.now.isoformat(), jobId=1,
            terminal=not self.pending, pendingJobs=[1] if self.pending else [], activating=self.pending)

    def settle(self, name, timeout):
        self.assert_settle = (name, timeout)

    def exclusive(self):
        if self.seal_drift and self.commands:
            raise ValueError('seal drift')
        return True

    def invoke_timer(self):
        callbacks = dict(read=self.read, state=self.state, collect=self.collect, scope_collect=self.scope_collect,
            exclusive=self.exclusive, run=self.run, job_state=self.job, settle=self.settle, clock=self.clock)
        with patch.object(SUBJECT.BASE, 'ASSET_PINS', self.reviewed['assets']), \
                patch.object(SUBJECT.BASE, 'inspect_or_restore_check', return_value={
                    'status': 'notification-resume-inspected', 'protectedStateUnchanged': True}):
            return SUBJECT.restore_timer(reviewed=self.timer_review,
                reviewed_sha256=HOST.hashlib.sha256(HOST.encoded(self.timer_review)).hexdigest(), **callbacks)


class TimerTests(unittest.TestCase):
    def test_inspection_refusal_or_unsettled_worker_never_claims_restoration(self):
        host = TimerHost()
        host.units[SUBJECT.BASE.SERVICE].update(ActiveState='active', SubState='running', MainPID='123')
        result = host.invoke_timer()
        self.assertEqual(result['status'], 'notification-timer-refused')
        self.assertFalse(result['schedulingRestored'])
        self.assertEqual(host.commands, [])

    def test_changed_role_expiry_or_additional_execution_grant_never_starts(self):
        for field in ('role', 'directExecutions'):
            host = TimerHost()
            if field == 'role':
                host.scope_bundle['database']['role']['validUntil'] = '2026-10-07T15:59:10Z'
            else:
                host.scope_bundle['database'][field].append('public.unapproved()')
            result = host.invoke_timer()
            self.assertEqual(result['status'], 'notification-timer-refused')
            self.assertEqual(host.commands, [])

    def test_starts_only_existing_timer_and_no_token_is_not_permanent_blocker(self):
        host = TimerHost()
        result = host.invoke_timer()
        self.assertEqual(result['status'], 'notification-timer-resumed')
        self.assertEqual(host.commands, [[SUBJECT.BASE.SYSTEMCTL, 'start', SUBJECT.BASE.TIMER]])
        self.assertFalse(result['deviceReceiptVerified'])
        self.assertEqual(result['pushReadiness'], 'no-token')

    def test_pending_start_is_uncertain_not_false_cleanup_success(self):
        host = TimerHost()
        host.pending = True
        result = host.invoke_timer()
        self.assertEqual(result['status'], 'notification-timer-refused')
        self.assertIsNone(result['cleanupConfirmed'])
        self.assertEqual(host.commands[-1][2:], [SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE])

    def test_catalog_drift_stops_only_owned_timer_and_worker(self):
        host = TimerHost()
        host.drift = True
        result = host.invoke_timer()
        self.assertEqual(result['status'], 'notification-timer-refused')
        self.assertTrue(result['cleanupConfirmed'])

    def test_poststart_seal_drift_cannot_prevent_owned_withdrawal(self):
        host = TimerHost()
        host.seal_drift = True
        result = host.invoke_timer()
        self.assertEqual(result['status'], 'notification-timer-refused')
        self.assertTrue(result['cleanupConfirmed'])
        self.assertEqual(host.commands[-1][2:], [SUBJECT.BASE.TIMER, SUBJECT.BASE.SERVICE])

    def test_foreign_goal_and_expired_deadline_never_start(self):
        for case in ('foreign', 'expired'):
            host = TimerHost()
            if case == 'foreign':
                host.scope['goals'][0]['actor'] = 'foreign'
            else:
                host.now = HOST.datetime(2026, 10, 6, 16, tzinfo=HOST.timezone.utc)
            self.assertEqual(host.invoke_timer()['status'], 'notification-timer-refused')
            self.assertEqual(host.commands, [])


if __name__ == '__main__':
    unittest.main()

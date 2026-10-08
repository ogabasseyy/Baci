import copy
from datetime import datetime, timedelta, timezone
import importlib.util
from pathlib import Path
import unittest


HERE = Path(__file__).resolve().parent
NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)
DEADLINE = '2026-10-06T15:59:10Z'
IDS = {
    'pvb-staging-replay-prefunded': '5426aa344490d93dac4f6f777ef31a5ce49ec3f889a8e9cb1e99ae708a4ca111',
    'baci-interest-replay': 'c187f78aa0fd3676b08ef84e8e85192e4437943817b895ed2d5a65e3d884cbef',
    'baci-prefunded-background': '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4',
}


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / (name + '.py'))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def fixture():
    containers = {}
    for name, identifier in IDS.items():
        containers[name] = dict(Id=identifier, Name='/' + name,
            State=dict(Running=False, Paused=False, Restarting=False, Dead=False, OOMKilled=False,
                ExitCode=1 if name == 'baci-prefunded-background' else 0, Status='exited', Pid=0),
            HostConfig=dict(RestartPolicy=dict(Name='no', MaximumRetryCount=0)))
    units = {}
    for name in ('baci-prefunded-background.service', 'baci-prefunded-background.timer',
            'baci-staging-test-payments.service'):
        failed = name == 'baci-prefunded-background.service'
        units[name] = dict(LoadState='loaded', ActiveState='failed' if failed else 'inactive',
            SubState='failed' if failed else 'dead', FragmentPath='/etc/systemd/system/' + name,
            DropInPaths='', NeedDaemonReload='no', Transient='no', pendingJobs=[])
        if name.endswith('.service'):
            units[name].update(Restart='no', MainPID='0')
        if failed:
            units[name].update(Result='exit-code', ExecMainStatus='1')
    before = dict(observedAt='2026-10-04T11:59:58Z', deadline=DEADLINE, containers=containers, units=units)
    after = copy.deepcopy(before)
    after['observedAt'] = '2026-10-04T12:00:00Z'
    receipt = dict(observedAt='2026-10-04T11:59:59Z',
        identity=dict(systemIdentifier='7686901100561231906', sessionUser='supabase_admin',
            currentUser='supabase_admin', authenticatedUser='supabase_admin', database='postgres',
            localUnix=True, superuser=True, readOnly=True),
        drain=dict(transactions=0, preparedTransactions=0, processingReceipts=0))
    return before, after, receipt


class Tests(unittest.TestCase):
    def setUp(self):
        self.subject = load('replay_quiescence')
        self.before, self.after, self.receipt = fixture()

    def verify(self):
        return self.subject.verify_replay_quiescence(before=self.before, after=self.after,
            receipt=self.receipt, now=NOW)

    def test_failed_background_is_halted_not_healthy_and_input_is_not_modified(self):
        original = copy.deepcopy((self.before, self.after, self.receipt))
        result = self.verify()
        self.assertEqual(result['status'], 'replay-claimants-quiescent')
        self.assertEqual(result['stoppedClaimants'], IDS)
        self.assertTrue(result['failedBackgroundHalted'])
        self.assertFalse(result['financialActionAuthorized'])
        self.assertFalse(result['runtimeStartAuthorized'])
        self.assertEqual((self.before, self.after, self.receipt), original)

    def test_public_and_notification_services_can_remain_running_outside_claimant_scope(self):
        self.assertNotIn('baci-prefunded-public', self.subject.CLAIMANTS)
        self.assertFalse(any('notifications' in name or 'public.service' in name for name in self.subject.UNITS))
        self.assertEqual(self.verify()['status'], 'replay-claimants-quiescent')
        old = load('financial_quiescence.test')
        context = old.Context()
        context.states['baci-prefunded-background']['State']['ExitCode'] = 1
        context.states['baci-prefunded-public']['State']['Running'] = True
        context.changed_unit = 'baci-savings-notifications.service'
        with self.assertRaises(ValueError):
            old.verify_financial_quiescence(context)

    def test_pins_and_receipt_identity_match_existing_reviewed_contracts(self):
        database = load('cutover_database')
        worker = load('worker_source_authority')
        self.assertEqual(self.subject.RECEIPT_IDENTITY['systemIdentifier'], database.SYSTEM)
        self.assertEqual(self.subject.DEADLINE, database.DEADLINE)
        self.assertEqual(self.subject.CLAIMANTS['baci-prefunded-background'], worker.BACKGROUND_CONTAINER_ID)
        self.assertEqual(self.subject.DEADLINE, worker.DEADLINE)

    def test_each_claimant_replacement_running_state_and_restart_policy_refuse(self):
        for sample in ('before', 'after'):
            for name in IDS:
                for field, value in (('Running', True), ('Paused', True), ('Restarting', True),
                        ('Dead', True), ('OOMKilled', True), ('Running', 0), ('ExitCode', False),
                        ('Status', 'running'), ('Pid', 47), ('Pid', False)):
                    before, after, receipt = fixture()
                    selected = before if sample == 'before' else after
                    selected['containers'][name]['State'][field] = value
                    with self.subTest(sample=sample, name=name, field=field), self.assertRaises(ValueError):
                        self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
                for field in ('Id', 'Name'):
                    before, after, receipt = fixture()
                    selected = before if sample == 'before' else after
                    selected['containers'][name][field] = 'foreign'
                    with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                        self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
                before, after, receipt = fixture()
                selected = before if sample == 'before' else after
                selected['containers'][name]['HostConfig']['RestartPolicy']['MaximumRetryCount'] = False
                with self.assertRaises(ValueError):
                    self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)

    def test_exact_failed_exit_and_other_claimants_clean_exits_required(self):
        for name in IDS:
            for exit_code in (0, 1, 143, 137):
                before, after, receipt = fixture()
                after['containers'][name]['State']['ExitCode'] = exit_code
                accepted = exit_code == (1 if name == 'baci-prefunded-background' else 0)
                with self.subTest(name=name, exit_code=exit_code):
                    if accepted:
                        self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
                    else:
                        with self.assertRaises(ValueError):
                            self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)

    def test_actual_postreboot_inactive_success_unit_preserves_failed_container_exit_one(self):
        for sample in (self.before, self.after):
            sample['units']['baci-prefunded-background.service'].update(
                ActiveState='inactive', SubState='dead', Result='success', ExecMainStatus='0')
        self.assertTrue(self.verify()['failedBackgroundHalted'])
        self.after['containers']['baci-prefunded-background']['State']['ExitCode'] = 0
        with self.assertRaises(ValueError):
            self.verify()

    def test_background_unit_only_accepts_two_exact_unmixed_historical_or_reboot_states(self):
        for active, sub, result, status in (
                ('inactive', 'dead', 'exit-code', '1'), ('inactive', 'dead', 'success', '1'),
                ('failed', 'failed', 'success', '0'), ('failed', 'failed', 'exit-code', '0'),
                ('inactive', 'failed', 'success', '0'), ('failed', 'dead', 'exit-code', '1')):
            before, after, receipt = fixture()
            after['units']['baci-prefunded-background.service'].update(
                ActiveState=active, SubState=sub, Result=result, ExecMainStatus=status)
            with self.subTest(active=active, sub=sub, result=result, status=status), self.assertRaises(ValueError):
                self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)

    def test_pending_active_or_altered_claimant_unit_refuses(self):
        for name in self.after['units']:
            for field, value in (('pendingJobs', [47]), ('MainPID', '47'), ('ActiveState', 'active'),
                    ('DropInPaths', '/foreign.conf'), ('NeedDaemonReload', 'yes'), ('Transient', 'yes'),
                    ('FragmentPath', '/foreign')):
                before, after, receipt = fixture()
                after['units'][name][field] = value
                with self.subTest(name=name, field=field), self.assertRaises(ValueError):
                    self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
        self.after['units']['baci-prefunded-background.service']['ExecMainStatus'] = '0'
        with self.assertRaises(ValueError):
            self.verify()

    def test_receipt_physical_identity_readonly_and_zero_drain_are_exactly_typed(self):
        for section in ('identity', 'drain'):
            for key in self.receipt[section]:
                before, after, receipt = fixture()
                receipt[section][key] = False if section == 'drain' else 'foreign'
                with self.subTest(section=section, key=key), self.assertRaises(ValueError):
                    self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
        for key in self.receipt['drain']:
            before, after, receipt = fixture()
            receipt['drain'][key] = 1
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
        self.receipt['identity']['systemIdentifier'] = '7685292944002592802'
        with self.assertRaises(ValueError):
            self.verify()

    def test_deadline_freshness_order_and_utc_time_are_required(self):
        for stamp in ('2026-10-04T11:58:00Z', '2026-10-04T12:00:01Z', '2026-10-04T11:59:57Z',
                '2026-10-04T11:59:59', 'not-a-time'):
            before, after, receipt = fixture()
            receipt['observedAt'] = stamp
            with self.subTest(stamp=stamp), self.assertRaises(ValueError):
                self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)
        self.before['deadline'] = '2026-10-07T15:59:10Z'
        with self.assertRaises(ValueError):
            self.verify()
        before, after, receipt = fixture()
        for now in (NOW.replace(tzinfo=None), datetime(2026, 10, 6, 15, 59, 10, tzinfo=timezone.utc)):
            with self.assertRaises(ValueError):
                self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=now)
        with self.assertRaises(ValueError):
            self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt,
                now=NOW+timedelta(seconds=61))
        before['observedAt'] = '2026-10-04T11:59:29Z'
        with self.assertRaises(ValueError):
            self.subject.verify_replay_quiescence(before=before, after=after, receipt=receipt, now=NOW)

    def test_missing_malformed_or_extra_scoped_claimants_refuse_redacted(self):
        self.after['containers']['foreign'] = {}
        with self.assertRaisesRegex(ValueError, '^replay_quiescence_refused$'):
            self.verify()
        self.after = None
        with self.assertRaisesRegex(ValueError, '^replay_quiescence_refused$') as failure:
            self.verify()
        self.assertTrue(failure.exception.__suppress_context__)


if __name__ == '__main__':
    unittest.main()

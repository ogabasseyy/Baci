import copy
from datetime import datetime, timezone
import json
from types import SimpleNamespace
import unittest

from cutover_runtime import COMPETITOR_ID, NATIVE_ID
from financial_quiescence import verify_financial_quiescence


BACKGROUND = '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4'
STOPPED = {
    'baci-prefunded-background': BACKGROUND,
    'baci-prefunded-snapshot': '2d299353bfa0457bb7486ba5be97c6630286b74f9e9b057439bcb83ad3708818',
    'baci-prefunded-readiness': 'a59ecc7c88b857bb8ba5a2fbdda55d5d48b6cf12e8e40973bacf7f69258d23c4',
    'baci-prefunded-public': 'c6e802349659140803be6b5c2c2f79fca6036f8cbaad50598d67da573d33fa5c',
}


class Context:
    def __init__(self):
        self.calls = []
        self.states = {name: self.container(name, identifier) for name, identifier in STOPPED.items()}
        self.native = self.container('pvb-staging-replay-prefunded', NATIVE_ID)
        self.competitor_value = self.container('baci-interest-replay', COMPETITOR_ID)
        self.changed_unit = None
        self.drain = dict(systemIdentifier='7685292944002592802', sessionUser='postgres',
            currentUser='postgres', database='postgres', localUnix=True, readOnly=True,
            preparedTransactions=0, otherClientTransactions=0)
        self.operator = SimpleNamespace(inspect=lambda *args, **kwargs: self.native)
        self.owner = SimpleNamespace(command=self.command)
        self.finance = {'database': self.database}

    def container(self, name, identifier):
        return dict(Id=identifier, Name='/' + name, State=dict(Running=False, Paused=False,
            Restarting=False, Dead=False, OOMKilled=False, ExitCode=0, Status='exited'),
            HostConfig=dict(RestartPolicy=dict(Name='no', MaximumRetryCount=0)))

    def deadline(self):
        self.calls.append('deadline')

    def verify_files(self):
        self.calls.append('verify_files')
        return True

    def exclusive(self):
        self.calls.append('exclusive')
        return True

    def competitor(self):
        return copy.deepcopy(self.competitor_value)

    def database(self, sql):
        self.calls.append(sql)
        return json.dumps(self.drain)

    def command(self, arguments, **kwargs):
        self.calls.append(arguments)
        if 'inspect' in arguments:
            return json.dumps([self.states[arguments[-1]]])
        name = arguments[2]
        values = dict(LoadState='loaded', ActiveState='inactive', SubState='dead',
            FragmentPath='/etc/systemd/system/' + name, DropInPaths='', NeedDaemonReload='no',
            Transient='no', Restart='no')
        if name == self.changed_unit:
            values['ActiveState'] = 'active'
        requested = [argument.removeprefix('--property=') for argument in arguments
            if argument.startswith('--property=')]
        return ''.join(key + '=' + values[key] + '\n' for key in requested)


class FinancialQuiescenceTests(unittest.TestCase):
    def setUp(self):
        self.context = Context()

    def test_accepts_only_measured_stopped_writers_and_readonly_transaction_drain(self):
        report = verify_financial_quiescence(self.context)
        self.assertEqual(report['status'], 'financial-writers-quiescent')
        self.assertEqual(set(report['stoppedContainers']), set(STOPPED) | {
            'pvb-staging-replay-prefunded', 'baci-interest-replay'})
        observed = datetime.fromisoformat(report['observedAt'].replace('Z', '+00:00'))
        self.assertLess((datetime.now(timezone.utc) - observed).total_seconds(), 2)
        commands = [call for call in self.context.calls if type(call) is list]
        self.assertTrue(all('inspect' in call or 'show' in call for call in commands))
        queries = [call for call in self.context.calls if type(call) is str and 'SELECT' in call]
        self.assertEqual(len(queries), 1)
        self.assertIn('REPEATABLE READ READ ONLY', queries[0])
        self.assertTrue(queries[0].rstrip().endswith('ROLLBACK;'))

    def test_refuses_active_checkout_service_even_when_background_is_stopped(self):
        self.context.states['baci-prefunded-public']['State']['Running'] = True
        with self.assertRaisesRegex(ValueError, 'financial_quiescence_refused'):
            verify_financial_quiescence(self.context)

    def test_accepts_expected_sigterm_only_for_stopped_public_http_not_a_financial_worker(self):
        self.context.states['baci-prefunded-public']['State']['ExitCode'] = 143
        self.assertEqual(verify_financial_quiescence(self.context)['status'], 'financial-writers-quiescent')
        self.context.states['baci-prefunded-background']['State']['ExitCode'] = 143
        with self.assertRaises(ValueError):
            verify_financial_quiescence(self.context)

    def test_refuses_background_and_timer_restarted_during_readonly_sql_drain(self):
        original = self.context.database
        def database(sql):
            result = original(sql)
            self.context.states['baci-prefunded-background']['State']['Running'] = True
            self.context.changed_unit = 'baci-prefunded-background.timer'
            return result
        self.context.finance['database'] = database
        with self.assertRaisesRegex(ValueError, '^financial_quiescence_refused$'):
            verify_financial_quiescence(self.context)

    def test_refuses_each_of_six_known_containers_restarted_during_sql(self):
        for name in (*STOPPED, 'native', 'competitor_value'):
            context = Context()
            target = context.states[name] if name in STOPPED else getattr(context, name)
            original = context.database
            def database(sql):
                result = original(sql)
                target['State']['Running'] = True
                return result
            context.finance['database'] = database
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^financial_quiescence_refused$'):
                verify_financial_quiescence(context)

    def test_rechecks_each_unit_after_the_postdrain_global_exclusivity_check(self):
        names = ('baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
            'baci-savings-notifications.timer', 'baci-savings-notifications.service',
            'baci-savings-notifications-check.service', 'baci-staging-test-payments.service',
            'baci-prefunded-public.service', 'baci-prefunded-background.service')
        for name in names:
            context = Context()
            original = context.exclusive
            def exclusive():
                result = original()
                if context.calls.count('exclusive') == 2:
                    context.changed_unit = name
                return result
            context.exclusive = exclusive
            with self.subTest(name=name), self.assertRaisesRegex(ValueError, '^financial_quiescence_refused$'):
                verify_financial_quiescence(context)

    def test_postdrain_sigterm_exit143_remains_public_only(self):
        for name in (*STOPPED, 'native', 'competitor_value'):
            context = Context()
            target = context.states[name] if name in STOPPED else getattr(context, name)
            original = context.database
            def database(sql):
                result = original(sql)
                target['State']['ExitCode'] = 143
                return result
            context.finance['database'] = database
            with self.subTest(name=name):
                if name == 'baci-prefunded-public':
                    self.assertEqual(verify_financial_quiescence(context)['status'], 'financial-writers-quiescent')
                else:
                    with self.assertRaisesRegex(ValueError, '^financial_quiescence_refused$'):
                        verify_financial_quiescence(context)

    def test_refuses_a_replaced_stopped_container(self):
        self.context.states['baci-prefunded-snapshot']['Id'] = '9' * 64
        with self.assertRaises(ValueError):
            verify_financial_quiescence(self.context)

    def test_refuses_each_active_schedule_or_service(self):
        for name in ('baci-prefunded-background.timer', 'baci-prefunded-snapshot.timer',
            'baci-savings-notifications.timer', 'baci-savings-notifications.service',
            'baci-savings-notifications-check.service', 'baci-staging-test-payments.service',
            'baci-prefunded-public.service', 'baci-prefunded-background.service'):
            with self.subTest(name=name):
                self.context.changed_unit = name
                with self.assertRaises(ValueError):
                    verify_financial_quiescence(self.context)

    def test_refuses_live_native_or_competing_claimant(self):
        for key in ('native', 'competitor_value'):
            context = Context()
            getattr(context, key)['State']['Running'] = True
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_financial_quiescence(context)

    def test_refuses_each_unsafe_container_state_or_restart_policy(self):
        changes = [('Running', True), ('Paused', True), ('Restarting', True), ('Dead', True),
            ('OOMKilled', True), ('ExitCode', 1), ('ExitCode', False), ('Status', 'running')]
        for key, value in changes:
            context = Context()
            context.states['baci-prefunded-background']['State'][key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_financial_quiescence(context)
        self.context.states['baci-prefunded-background']['HostConfig']['RestartPolicy']['Name'] = 'always'
        with self.assertRaises(ValueError):
            verify_financial_quiescence(self.context)

    def test_refuses_pending_transactions_or_wrong_physical_identity(self):
        for key, value in [('preparedTransactions', 1), ('otherClientTransactions', 1),
            ('preparedTransactions', False), ('readOnly', False), ('localUnix', False),
            ('systemIdentifier', 'wrong'), ('sessionUser', 'prefunded_treasury_operator')]:
            context = Context()
            context.drain[key] = value
            with self.subTest(key=key), self.assertRaises(ValueError):
                verify_financial_quiescence(context)

    def test_refuses_nonliteral_exclusive_authority_and_sanitizes_failures(self):
        self.context.exclusive = lambda: 1
        with self.assertRaises(ValueError):
            verify_financial_quiescence(self.context)
        def failing_deadline():
            raise RuntimeError('PRIVATE_DETAILS')
        self.context.deadline = failing_deadline
        with self.assertRaisesRegex(ValueError, '^financial_quiescence_refused$') as failure:
            verify_financial_quiescence(self.context)
        self.assertTrue(failure.exception.__suppress_context__)


if __name__ == '__main__':
    unittest.main()

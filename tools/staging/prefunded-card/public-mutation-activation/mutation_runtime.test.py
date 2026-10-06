from contextlib import ExitStack
import json
import subprocess
from types import SimpleNamespace
import unittest
from unittest.mock import Mock, patch

import mutation_contract
import mutation_runtime as runtime
import readiness_evidence_io as evidence_io
import readiness_evidence_snapshot as snapshot

NOW = 1790899200
SEAL = 'a' * 64
DATE = '2026-10-02T00:00:00Z'


def inspection(name, run):
    return {'State': {'Running': name == runtime.CONTAINER, 'ExitCode': 0,
                     'StartedAt': DATE, 'FinishedAt': DATE}}


def run(arguments):
    if 'exec' in arguments:
        return str(NOW * 1000)
    if 'logs' in arguments:
        return json.dumps({'outcome': 'recorded'} if arguments[-1].endswith('snapshot')
                          else {'status': 'completed'})
    if any(argument.endswith('.service') for argument in arguments):
        return 'ActiveState=inactive\nResult=success\nExecMainStatus=0\nDropInPaths=\nNeedDaemonReload=no'
    return 'ActiveState=active\nSubState=waiting\nDropInPaths=\nNeedDaemonReload=no'


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.bounds = Mock()
        self.bounds.guarded_run.side_effect = lambda arguments, run: run(arguments)
        self.patches = [patch.object(runtime, 'inspection', side_effect=inspection),
            patch.object(runtime, 'validate_worker'), patch.object(runtime, 'validate_replay')]
        for item in self.patches:
            item.start()
            self.addCleanup(item.stop)

    def test_completed_pass_logs_and_armed_schedules_prove_current_runtime(self):
        report = runtime.active_runtime(SEAL, run=run, now=lambda: NOW, bounds=self.bounds)
        self.assertEqual(report['status'], 'activated-runtime-current')

    def test_running_replay_with_stale_or_future_heartbeat_refuses(self):
        for heartbeat in (str((NOW - 61) * 1000), str((NOW + 1) * 1000), 'ready'):
            def altered(arguments):
                return heartbeat if 'exec' in arguments else run(arguments)
            with self.subTest(heartbeat=heartbeat), self.assertRaises(ValueError):
                runtime.active_runtime(SEAL, run=altered, now=lambda: NOW, bounds=self.bounds)

    def test_old_successful_worker_container_is_not_current_financial_activation(self):
        def old(name, runner):
            value = inspection(name, runner)
            value['State']['StartedAt'] = '2026-09-29T15:59:10Z'
            return value
        with patch.object(runtime, 'inspection', side_effect=old), self.assertRaises(ValueError):
            runtime.active_runtime(SEAL, run=run, now=lambda: NOW, bounds=self.bounds)

    def test_zero_exit_without_completed_pass_report_refuses(self):
        def altered(arguments):
            return '{"status":"ready"}' if 'logs' in arguments else run(arguments)
        with self.assertRaises(ValueError):
            runtime.active_runtime(SEAL, run=altered, now=lambda: NOW, bounds=self.bounds)

    def test_inactive_schedule_or_unloaded_change_refuses(self):
        def altered(arguments):
            return run(arguments).replace('ActiveState=active', 'ActiveState=inactive')
        with self.assertRaises(ValueError):
            runtime.active_runtime(SEAL, run=altered, now=lambda: NOW, bounds=self.bounds)

    def collector_fixture(self):
        contents = {name: b'compiled' for name in runtime.PATHS}
        contents.update(snapshotConfig=json.dumps({'database': {'password': 'independent'}}).encode(),
            activationConfig=b'{"password":"worker"}', factoryConfig=b'{"password":"factory"}',
            replayConfig=b'{}')
        request = {'seal': {'sha256': SEAL}, 'artifacts': {
            name: {'path': path} for name, path in runtime.PATHS.items()},
            'signingKeys': {'path': 'private-keys'}, 'snapshotCaContainerPath': '/ca.pem'}
        files = {('replay/' + ('replay-daemon.mjs' if name == 'daemon' else 'prefunded-replay-bundle.mjs')
                  if name in ('daemon', 'factory') else 'workers/' + name + '.cjs'):
                 runtime.digest(contents[name])
                 for name in ('readiness', 'background', 'snapshot', 'daemon', 'factory')}
        paths = {runtime.PATHS[name]: content for name, content in contents.items()}
        paths['private-keys'] = b'{}'
        return contents, request, {'files': files}, paths

    def test_collector_rechecks_installed_pins_jwt_restricted_tls_and_fixed_timers(self):
        contents, request, seal, paths = self.collector_fixture()
        with patch.object(runtime, 'pinned', side_effect=lambda row, **kwargs: paths[row['path']]), \
                patch.object(runtime, 'verify_jwt') as jwt, \
                patch.object(runtime, 'restricted_checks', return_value={'tls': 'checked'}) as restricted, \
                patch.object(runtime, 'snapshot_tls', return_value={'snapshot': 'checked'}) as tls, \
                patch.object(runtime, 'timers', return_value={'public': {}, 'workers': {}, 'replay': {}}) as timers, \
                patch.object(runtime, 'wrapper', return_value='normalized-deadline') as reader:
            current, checks = runtime.collect(request, seal, SEAL, run=run,
                                             now=lambda: NOW, bounds=self.bounds)
            self.assertEqual(timers.call_args.args[1](['deadline-fixture']), 'normalized-deadline')
            reader.assert_called_once_with(['deadline-fixture'], run=run)
        self.assertEqual(current['status'], 'activated-runtime-current')
        self.assertEqual(checks, {'tls': 'checked', 'snapshot': 'checked'})
        jwt.assert_called_once()
        self.assertEqual(restricted.call_args.args[:2], (SEAL, SEAL))
        self.bounds.verify_runtime.assert_called_with(run)
        self.assertEqual(tls.call_args.args[0]['database']['password'], 'independent')

    def test_collector_refuses_modified_compiled_artifact_before_connect_checks(self):
        contents, request, seal, paths = self.collector_fixture()
        paths[runtime.PATHS['background']] = b'changed'
        with patch.object(runtime, 'pinned', side_effect=lambda row, **kwargs: paths[row['path']]), \
                patch.object(runtime, 'restricted_checks') as restricted, self.assertRaises(ValueError):
            runtime.collect(request, seal, SEAL, run=run, now=lambda: NOW, bounds=self.bounds)
        restricted.assert_not_called()

    def test_shared_snapshot_password_refuses_before_any_runtime_connect_check(self):
        contents, request, seal, paths = self.collector_fixture()
        paths[runtime.PATHS['snapshotConfig']] = b'{"database":{"password":"worker"}}'
        with patch.object(runtime, 'pinned', side_effect=lambda row, **kwargs: paths[row['path']]), \
                patch.object(runtime, 'verify_jwt'), \
                patch.object(runtime, 'restricted_checks') as restricted, self.assertRaises(ValueError):
            runtime.collect(request, seal, SEAL, run=run, now=lambda: NOW, bounds=self.bounds)
        restricted.assert_not_called()

    def test_bounds_failure_refuses_before_any_restricted_check_or_active_runtime_probe(self):
        contents, request, seal, paths = self.collector_fixture()
        self.bounds.verify_runtime.side_effect = ValueError('financial_environment_drift')
        with patch.object(runtime, 'pinned', side_effect=lambda row, **kwargs: paths[row['path']]), \
                patch.object(runtime, 'verify_jwt'), patch.object(runtime, 'restricted_checks') as checks, \
                self.assertRaisesRegex(ValueError, 'financial_environment_drift'):
            runtime.collect(request, seal, SEAL, run=run, now=lambda: NOW, bounds=self.bounds)
        checks.assert_not_called()

    def default_collector(self, stack, failure=None):
        contents, request, seal, paths = self.collector_fixture()
        database = {'environment': 'staging', 'transport': 'tls', 'host': snapshot.HOST,
            'expectedHost': snapshot.HOST, 'port': 5432, 'login': 'prefunded_snapshot_verifier',
            'expectedLogin': 'prefunded_snapshot_verifier', 'database': 'postgres',
            'expectedDatabase': 'postgres', 'expectedSystemId': snapshot.SYSTEM,
            'certificateAuthority': 'fixture-ca', 'password': 'A' * 64}
        configuration = {'database': database,
            'scope': {'integrationId': snapshot.INTEGRATION, 'merchantId': snapshot.MERCHANT},
            'verifier': {'environment': 'staging', 'systemIdentifier': snapshot.SYSTEM,
                'treasuryBindingId': snapshot.TREASURY, 'expectedBusinessId': snapshot.BUSINESS,
                'sourceWalletId': snapshot.SOURCE, 'expiresAt': snapshot.DEADLINE}}
        paths[runtime.PATHS['snapshotConfig']] = json.dumps(configuration).encode()

        def process(arguments, **kwargs):
            if 'inspect' in arguments:
                output = json.dumps([{'State': {'Running': True}, 'Config': {'Labels': {
                    'com.docker.compose.project': 'baci-isolated-savings'}},
                    'NetworkSettings': {'Networks': {snapshot.NETWORK: {'IPAddress': snapshot.ADDRESS}}}}])
            elif '/bin/cat' in arguments:
                output = 'fixture-ca'
            elif kwargs.get('input') == snapshot.SESSION_SQL:
                if isinstance(failure, Exception):
                    raise failure
                if failure == 'denied':
                    return SimpleNamespace(returncode=1, stdout='credentials-redacted', stderr='denied')
                output = json.dumps({'login': 'prefunded_snapshot_verifier', 'database': 'postgres',
                    'address': snapshot.ADDRESS, 'readOnly': True, 'tls': failure != 'unsafe-tls',
                    'roleSafe': True, 'membershipSafe': True})
            elif kwargs.get('input') == snapshot.BINDING_SQL:
                output = '{"bindingVerified":true}'
            else:
                output = '{}'
            return SimpleNamespace(returncode=0, stdout=output, stderr='')

        stack.enter_context(patch.object(runtime, 'pinned', side_effect=lambda row, **kwargs: paths[row['path']]))
        stack.enter_context(patch.object(runtime, 'verify_jwt'))
        active = stack.enter_context(patch.object(runtime, 'active_runtime',
            return_value={'status': 'activated-runtime-current'}))
        stack.enter_context(patch.object(runtime, 'restricted_checks', side_effect=lambda *args:
            {'restricted': json.loads(args[2](['restricted-fixture']))}))
        stack.enter_context(patch.object(runtime, 'timers', return_value={'public': {}, 'workers': {}, 'replay': {}}))
        stack.enter_context(patch.object(evidence_io.time, 'time', return_value=NOW))
        runner = stack.enter_context(patch.object(evidence_io.subprocess, 'run', side_effect=process))
        return request, seal, runner, active

    def test_default_runner_propagates_real_snapshot_tls_input_environment_and_runtime_guards(self):
        with ExitStack() as stack:
            request, seal, runner, active = self.default_collector(stack)
            current, checks = runtime.collect(request, seal, SEAL, now=lambda: NOW, bounds=self.bounds)
        self.assertTrue(checks['snapshotTlsIdentityVerified'])
        self.assertEqual(current['status'], 'activated-runtime-current')
        self.assertIs(runtime.active_runtime.__defaults__[0], evidence_io.command)
        self.assertIs(runtime.collect.__defaults__[0], evidence_io.command)
        self.assertTrue(all(call.args[1] is evidence_io.command for call in active.call_args_list))
        self.bounds.guarded_run.assert_called_once_with(['restricted-fixture'], run=evidence_io.command)
        session = next(call for call in runner.call_args_list if call.kwargs.get('input') == snapshot.SESSION_SQL)
        self.assertEqual(session.kwargs['timeout'], 35)
        self.assertEqual(session.kwargs['env'], {**evidence_io.ENV, 'PGHOST': snapshot.HOST,
            'PGHOSTADDR': snapshot.ADDRESS, 'PGPORT': '5432', 'PGUSER': 'prefunded_snapshot_verifier',
            'PGDATABASE': 'postgres', 'PGPASSWORD': 'A' * 64, 'PGSSLMODE': 'verify-full',
            'PGSSLROOTCERT': '/ca.pem', 'PGCONNECT_TIMEOUT': '3',
            'PGAPPNAME': 'baci-snapshot-readonly-readiness'})
        self.assertIn('--env', session.args[0])
        self.assertIsNone(session.kwargs['stdin'])
        self.assertTrue(any(call.kwargs.get('input') == snapshot.BINDING_SQL for call in runner.call_args_list))

    def test_default_snapshot_runner_refuses_denied_unsafe_and_unavailable_sessions(self):
        for failure in ('denied', 'unsafe-tls', FileNotFoundError('unavailable'),
                        subprocess.TimeoutExpired(['mock-only'], 35)):
            with self.subTest(failure=type(failure).__name__), ExitStack() as stack:
                request, seal, runner, unused = self.default_collector(stack, failure)
                with self.assertRaises(ValueError):
                    runtime.collect(request, seal, SEAL, now=lambda: NOW, bounds=self.bounds)
                self.assertFalse(any(call.kwargs.get('input') == snapshot.BINDING_SQL
                                     for call in runner.call_args_list))


if __name__ == '__main__':
    unittest.main()

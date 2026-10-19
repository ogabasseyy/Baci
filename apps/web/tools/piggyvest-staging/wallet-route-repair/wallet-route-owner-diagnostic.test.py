import importlib.util
import json
import os
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT = Path(__file__).with_name('wallet-route-owner-diagnostic.py')
SPEC = importlib.util.spec_from_file_location('wallet_route_diagnostic', SCRIPT)
diagnostic = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(diagnostic)


class WalletRouteDiagnosticTests(unittest.TestCase):
    def test_reports_only_route_status_and_grant_metadata(self):
        state = 'ActiveState=active\nMainPID=123\nResult=success\nExecMainStatus=0\n'
        with (
            patch.object(diagnostic.os, 'geteuid', return_value=0),
            patch.object(diagnostic, 'run', return_value=state),
            patch.object(diagnostic, 'gateway_status', return_value=404),
            patch.object(diagnostic, 'database_grants', return_value={'status': 'not_checked'}),
            patch('builtins.open', side_effect=OSError('private file')),
            patch('builtins.print') as output,
        ):
            self.assertEqual(diagnostic.main(['--check']), 0)
        payload = json.loads(output.call_args.args[0])
        self.assertIsNone(payload['routeChecks']['/rest/v1/customer_wallets']['unauthenticatedHttpStatus'])
        self.assertIsNone(payload['routeChecks']['/rest/v1/customer_wallets']['allowlisted'])
        self.assertEqual(payload['databaseGrants']['status'], 'not_checked')
        self.assertNotIn('private', output.call_args.args[0])

    def test_database_probe_uses_service_alias_and_suppresses_failure_output(self):
        with patch.object(diagnostic.subprocess, 'run', return_value=type('Result', (), {'returncode': 1, 'stdout': '', 'stderr': 'password=secret'})()) as run:
            result = diagnostic.database_grants('staging_readonly')
        self.assertEqual(result, {'status': 'unavailable'})
        self.assertEqual(run.call_args.kwargs['env']['PGSERVICE'], 'staging_readonly')
        self.assertNotIn('secret', json.dumps(result))

    def test_requires_root(self):
        with patch.object(diagnostic.os, 'geteuid', return_value=501), patch('builtins.print'):
            self.assertEqual(diagnostic.main(['--check']), 1)


if __name__ == '__main__':
    unittest.main()

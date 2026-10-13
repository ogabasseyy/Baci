from pathlib import Path
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import connectivity_runtime as runtime
from renewal_contract import Refused


class ConnectivityRuntimeTests(unittest.TestCase):
    def test_commands_cannot_start_other_services_containers_or_issue_arbitrary_sql(self):
        for arguments in (['/usr/bin/systemctl', 'start', 'production.service'],
                          ['/usr/bin/docker', 'start', 'baci-prefunded-public'],
                          ['/bin/sh', '-c', 'anything'], ['/usr/bin/curl', 'https://example.com']):
            with self.subTest(arguments=arguments), self.assertRaises(Refused):
                runtime.command(arguments)

    def test_http_probes_disable_curl_configuration_and_never_submit_payments(self):
        result = SimpleNamespace(returncode=0, stdout=b'401 application/json', stderr=b'')
        with patch.object(runtime.subprocess, 'run', return_value=result) as run:
            self.assertEqual(runtime.http('https://staging.ogabassey.com/api/storefront/customer/wallet'), 401)
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[:2], ['/usr/bin/curl', '-q'])
        self.assertNotIn('--data', arguments)
        self.assertNotIn('--request', arguments)
        self.assertNotIn('--location', arguments)
        for url in ('https://ogabassey.com/api/storefront/customer/wallet', 'http://127.0.0.1:4795/unreviewed'):
            with self.assertRaises(Refused):
                runtime.http(url)

    def test_auth_401_html_is_not_accepted_as_application_readiness(self):
        result = SimpleNamespace(returncode=0, stdout=b'401 text/html', stderr=b'')
        with patch.object(runtime.subprocess, 'run', return_value=result), self.assertRaises(Refused):
            runtime.http('https://staging.ogabassey.com/api/storefront/customer/wallet')

    def test_socket_file_is_not_enough_without_a_live_json_auth_response(self):
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout=b'401 application/json')) as run:
            runtime.socket_http()
        arguments = run.call_args.args[0]
        self.assertEqual(arguments[:2], ['/usr/bin/curl', '-q'])
        self.assertEqual(arguments[arguments.index('--unix-socket') + 1], '/run/baci-savings-gateway/ingress.sock')
        self.assertEqual(arguments[-1], 'http://staging-auth.ogabassey.com/auth/v1/user')
        for response in (SimpleNamespace(returncode=7, stdout=b''),
                         SimpleNamespace(returncode=0, stdout=b'401 text/html'),
                         SimpleNamespace(returncode=0, stdout=b'503 application/json')):
            with patch.object(runtime.subprocess, 'run', return_value=response), self.assertRaises(Refused):
                runtime.socket_http()

    def test_errors_never_expose_command_stderr_or_credentials(self):
        with patch.object(runtime.subprocess, 'run', return_value=SimpleNamespace(
                returncode=1, stdout=b'secret', stderr=b'secret')):
            with self.assertRaisesRegex(Refused, '^connectivity-command$'):
                runtime.command(['/usr/bin/systemctl', 'stop', 'baci-savings-funding.service'])

    def test_effective_stop_command_must_match_pinned_fragment_argv(self):
        command = ['path=/usr/bin/systemctl', 'argv[]=/usr/bin/systemctl stop baci-savings-drafts.service',
                   'ignore_errors=no', 'start_time=[n/a]']
        value = '{ ' + ' ; '.join(command) + ' ; }'
        runtime.effective_stop(value, ['/usr/bin/systemctl', 'stop', 'baci-savings-drafts.service'])
        for changed in (value.replace('drafts.service', 'funding.service'), value + value,
                        value.replace('ignore_errors=no', 'ignore_errors=yes')):
            with self.assertRaises(Refused):
                runtime.effective_stop(changed, ['/usr/bin/systemctl', 'stop', 'baci-savings-drafts.service'])

    def test_simple_services_wait_for_http_startup_before_socket_and_listener_assertions(self):
        events = []
        def probe(url):
            events.append('http')
            return 401
        def listener(arguments):
            if len(events) < 4:
                raise Refused('startup-listener-not-ready')
            return (b'LISTEN 0 511 127.0.0.1:4792 0.0.0.0:* users:(("node",pid=102,fd=20))\n'
                    b'LISTEN 0 511 127.0.0.1:4795 0.0.0.0:* users:(("node",pid=103,fd=20))\n')
        def state(name, extra):
            return {'ActiveState': 'active', 'SubState': 'running', 'MainPID': str(101 + runtime.SERVICES.index(name)),
                    'Restart': 'no', 'KillMode': 'control-group', 'RuntimeMaxUSec': '1w'}
        with patch.object(runtime, 'show', side_effect=state), patch.object(runtime, 'command', side_effect=listener), \
                patch.object(runtime, 'http', side_effect=probe), patch.object(runtime, 'protected_stopped'), \
                patch.object(runtime, 'socket_http') as socket_probe, patch.object(runtime.time, 'time', return_value=runtime.TARGET_EPOCH - 1000), \
                patch.object(Path, 'lstat', return_value=SimpleNamespace(st_mode=0o140660, st_uid=998, st_gid=984)):
            checks = runtime.Runtime().verify(998, 984)
        self.assertEqual(len(checks), 13)
        socket_probe.assert_called_once()


if __name__ == '__main__':
    unittest.main()

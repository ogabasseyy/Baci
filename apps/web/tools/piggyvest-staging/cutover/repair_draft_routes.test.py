import unittest
import io
import contextlib
from types import SimpleNamespace
from unittest.mock import Mock, patch

import repair_draft_routes as repair


class RouteRepairTests(unittest.TestCase):
    def test_health_probe_identifies_itself_instead_of_blocked_default_user_agent(self):
        response = Mock()
        response.__enter__ = Mock(return_value=SimpleNamespace(status=401))
        response.__exit__ = Mock(return_value=False)
        opener = Mock()
        opener.open.return_value = response
        with patch.object(repair.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(repair.status('/auth/v1/user'), 401)
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_header('User-agent'),
                         'Baci-Staging-Healthcheck/1.0 (Python urllib; owner-authorized staging verification)')

    def test_preflight_error_reports_stage_without_private_error_text(self):
        output = io.StringIO()
        def fail_load():
            repair.report_stage('installer-open')
            raise FileNotFoundError(2, 'sensitive-error-text')
        with patch.object(repair.os, 'geteuid', return_value=0), \
                patch.object(repair.time, 'time', return_value=1789930000), \
                patch.object(repair.subprocess, 'run'), \
                patch.object(repair, 'load_installer', side_effect=fail_load), \
                contextlib.redirect_stdout(output):
            self.assertEqual(repair.main(), 1)
        self.assertIn('installer-open', output.getvalue())
        self.assertIn('FileNotFoundError', output.getvalue())
        self.assertNotIn('sensitive-error-text', output.getvalue())

    def fixture(self):
        state = {'content': b'original'}
        installer = SimpleNamespace(
            read_target=Mock(side_effect=lambda: (state['content'], 'metadata')),
            render_config=Mock(return_value=b'candidate'),
            unchanged=Mock(), make_backup=Mock(return_value='backup'),
            atomic_write=Mock(side_effect=lambda content, *_: state.update(content=content)),
            validate_reload=Mock(),
        )
        return installer, state

    def test_success_requires_persistent_file_and_public_method_probes(self):
        installer, state = self.fixture()
        with patch.object(repair, 'status', side_effect=lambda route, method='GET': 405 if method == 'PUT' else 401) as status, \
                patch.object(repair.time, 'sleep'):
            repair.repair(installer)
        self.assertEqual(state['content'], b'candidate')
        self.assertEqual(status.call_count, 22)

    def test_regression_reload_success_but_public_404_rolls_back(self):
        installer, state = self.fixture()
        with patch.object(repair, 'status', side_effect=lambda route, method='GET': 401 if route == '/auth/v1/user' else 404), \
                patch.object(repair.time, 'sleep'):
            with self.assertRaisesRegex(RuntimeError, 'route-health'):
                repair.repair(installer)
        self.assertEqual(state['content'], b'original')
        self.assertEqual(installer.validate_reload.call_count, 2)

    def test_regression_waits_for_new_nginx_workers_after_asynchronous_reload(self):
        installer, state = self.fixture()
        remaining = [2]
        def delayed_status(route, method='GET'):
            if route == '/auth/v1/user':
                return 401
            if remaining[0]:
                remaining[0] -= 1
                return 404
            return 405 if method == 'PUT' else 401
        with patch.object(repair, 'status', side_effect=delayed_status), \
                patch.object(repair.time, 'sleep'):
            repair.repair(installer)
        self.assertEqual(state['content'], b'candidate')
        self.assertEqual(installer.atomic_write.call_count, 1)

    def test_external_edit_is_not_overwritten_during_failure(self):
        installer, state = self.fixture()
        installer.validate_reload.side_effect = lambda: state.update(content=b'operator-edit')
        with patch.object(repair, 'status', return_value=401):
            with self.assertRaisesRegex(RuntimeError, 'configuration-changed'):
                repair.repair(installer)
        self.assertEqual(state['content'], b'operator-edit')
        self.assertEqual(installer.atomic_write.call_count, 1)

    def test_existing_auth_failure_makes_no_changes(self):
        installer, state = self.fixture()
        with patch.object(repair, 'status', return_value=503):
            with self.assertRaisesRegex(RuntimeError, 'existing-auth-health'):
                repair.repair(installer)
        installer.atomic_write.assert_not_called()
        installer.make_backup.assert_not_called()


if __name__ == '__main__':
    unittest.main()

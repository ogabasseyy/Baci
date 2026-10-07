import contextlib
import importlib.util
import io
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch


spec = importlib.util.spec_from_file_location(
    'wallet_runtime_tests', Path(__file__).with_name('wallet-gateway-transition-runtime.py')
)
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)


class RuntimeTests(unittest.TestCase):
    def test_non_root_activation_refuses_before_loading_privileged_helpers(self):
        with patch.object(runtime.os, 'geteuid', return_value=501), \
                patch.object(runtime, '_module') as loader, \
                contextlib.redirect_stderr(io.StringIO()):
            self.assertEqual(runtime.main(['--activate']), 1)
        loader.assert_not_called()

    def test_all_five_new_paths_must_reach_json_data_plane(self):
        probe = Mock(return_value=(401, 'application/json'))
        runtime._probe_wallet_routes(SimpleNamespace(
            socket_probe=probe, ROUTED_STATUSES={200, 400, 401, 403, 404}
        ))
        self.assertEqual(probe.call_count, 5)

    def test_gateway_html_denial_is_not_mistaken_for_routed_json_response(self):
        with self.assertRaisesRegex(RuntimeError, 'health probe failed'):
            runtime._probe_wallet_routes(SimpleNamespace(
                socket_probe=Mock(return_value=(404, 'text/html')),
                ROUTED_STATUSES={200, 400, 401, 403, 404},
            ))


if __name__ == '__main__':
    unittest.main()

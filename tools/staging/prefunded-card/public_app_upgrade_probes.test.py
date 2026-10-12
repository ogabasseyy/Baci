import subprocess
from pathlib import Path
import tempfile
import unittest

from public_app_upgrade_probes import MOUNTED_APP_SCRIPT, mounted_app_digest, prove_running
from treasury_owner_contract import Refused


class PublicAppUpgradeProbeTests(unittest.TestCase):
    def test_node_digest_uses_global_relative_path_order_for_prefix_entries(self):
        files = {
            'pages/route.js': b'route',
            'pages-manifest.json': b'manifest',
        }
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name, content in files.items():
                path = root / name
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_bytes(content)
            script = MOUNTED_APP_SCRIPT.replace("const root='/app'", f"const root={root.as_posix()!r}")
            observed = subprocess.run(['/usr/local/bin/node', '-e', script], check=True,
                                     text=True, capture_output=True).stdout
        self.assertEqual(observed, mounted_app_digest(files))

    def test_prove_running_waits_readonly_after_one_start_without_restarting(self):
        events = []
        running = False

        def verify(expected):
            if expected is not None and expected is not running:
                raise Refused('state differs')

        def command(arguments):
            nonlocal running
            events.append(arguments)
            running = True
            return ''

        prove_running(
            type('Contract', (), {'NAME': 'service'})(), {'server.js': b'current'}, verify, command,
            lambda: events.append('probe'),
            wait_ready=lambda _contract: events.append('wait'),
            prove_mount=lambda _contract, _files, _command: events.append('mount'),
        )
        self.assertEqual(events, [
            ['/usr/bin/systemctl', 'start', 'service.service'], 'wait', 'mount', 'probe',
        ])


if __name__ == '__main__':
    unittest.main()

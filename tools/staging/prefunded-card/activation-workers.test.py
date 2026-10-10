import shlex
from pathlib import Path
import subprocess
import unittest


class WorkerLauncherTests(unittest.TestCase):
    def test_permanent_mac_launcher_pins_bootstrap_and_opens_interactive_ssh(self):
        launcher = Path(__file__).with_name('activation-workers.sh')
        result = subprocess.run(['/bin/sh', '-n', str(launcher)], capture_output=True, text=True, timeout=5)
        self.assertEqual(result.returncode, 0, result.stderr)
        command = shlex.split(launcher.read_text().splitlines()[2])
        self.assertEqual(command[:4], ['exec', '/usr/bin/ssh', '-t', '-o'])
        self.assertEqual(command[-2], 'bassey@82.29.190.219')
        remote = shlex.split(command[-1])
        self.assertEqual(remote[:3], ['sudo', '/usr/bin/env', '-i'])
        self.assertIn('/bin/bash', remote)
        body = remote[-1]
        self.assertIn('/home/bassey/baci-prefunded-workers-20260927/run-reviewed.sh', body)
        self.assertIn('1b59f6c586df2e99448699804707821a7c761de5f1232de8a27128bc5bc6f6fd', body)
        self.assertLess(body.index('/usr/bin/sha256sum -c -'), body.index('exec /bin/bash'))
        self.assertNotIn('owner-command.txt', body)
        self.assertNotIn('curl ', body)


if __name__ == '__main__':
    unittest.main()

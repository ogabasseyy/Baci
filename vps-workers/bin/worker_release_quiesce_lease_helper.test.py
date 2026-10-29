"""Exercise the real shell lease protocol with isolated command shims."""
from __future__ import annotations

import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


HELPER = Path(__file__).parents[1] / "lib" / "worker-release-quiesce-lease.sh"
SERVICE = "baci-domain-event-router"


class QuiesceLeaseHelperTests(unittest.TestCase):
    def test_fresh_empty_latch_stops_and_restarts_discovered_active_service(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            state = root / "latch.json"
            state.write_text(json.dumps({
                "phase": "quiescing", "services_to_restore": [], "stop_intent": []
            }), encoding="utf-8")
            active = root / "active"
            active.write_text(SERVICE, encoding="utf-8")
            log = root / "systemctl.log"
            fake_python = root / "python3"
            fake_systemctl = root / "systemctl"
            helper = root / "lease.sh"
            fake_python.write_text("""#!/usr/bin/env python3
import json, os, sys
path = os.environ['TEST_LATCH']
args = sys.argv[1:]
if len(args) < 3 or args[0:2] != ['-m', 'worker_release_recovery_latch']:
    raise SystemExit(90)
command = args[2:]
data = json.loads(open(path, encoding='utf-8').read())
if command == ['services']:
    print('\\n'.join(data['services_to_restore']))
elif len(command) == 2 and command[0] == 'intent':
    for key in ('services_to_restore', 'stop_intent'):
        if command[1] not in data[key]: data[key].append(command[1])
    open(path, 'w', encoding='utf-8').write(json.dumps(data))
elif command == ['recovery']:
    data['phase'] = 'recovery_required'
    open(path, 'w', encoding='utf-8').write(json.dumps(data))
elif command == ['clear']:
    pass
else:
    raise SystemExit(91)
""", encoding="utf-8")
            fake_systemctl.write_text("""#!/usr/bin/env python3
import os, sys
args = sys.argv[1:]
active, log = os.environ['TEST_ACTIVE'], os.environ['TEST_LOG']
if args[:2] == ['is-active', '--quiet']:
    raise SystemExit(0 if os.path.exists(active) else 3)
if len(args) == 2 and args[0] in ('stop', 'start'):
    with open(log, 'a', encoding='utf-8') as stream: stream.write(args[0] + ' ' + args[1] + '\\n')
    if args[0] == 'stop':
        try: os.unlink(active)
        except FileNotFoundError: pass
    else:
        open(active, 'w').close()
    raise SystemExit(0)
raise SystemExit(92)
""", encoding="utf-8")
            for path in (fake_python, fake_systemctl):
                path.chmod(0o755)
            source = HELPER.read_text(encoding="utf-8")
            source = source.replace("/usr/bin/python3", str(fake_python))
            source = source.replace("/usr/bin/systemctl", str(fake_systemctl))
            helper.write_text(source, encoding="utf-8")
            helper.chmod(0o755)

            environment = {
                "PATH": "/usr/bin:/bin", "TEST_LATCH": str(state),
                "TEST_ACTIVE": str(active), "TEST_LOG": str(log),
            }
            process = subprocess.Popen(
                ["/bin/bash", str(helper)], stdin=subprocess.PIPE,
                stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, env=environment,
            )
            try:
                ready = process.stdout.readline()
                if ready != "READY\n":
                    self.fail(f"helper failed before READY: {process.stderr.read()}")
                self.assertEqual(json.loads(state.read_text())["services_to_restore"], [SERVICE])
                process.stdin.write("START_HEALTH\n")
                process.stdin.flush()
                self.assertEqual(process.stdout.readline(), "STARTED\n")
                self.assertTrue(active.exists())
                self.assertEqual(log.read_text().splitlines(), [f"stop {SERVICE}", f"start {SERVICE}"])
                process.stdin.write("HEALTHY\n")
                process.stdin.flush()
                self.assertEqual(process.stdout.readline(), "DONE\n")
                self.assertEqual(process.wait(timeout=2), 0)
            finally:
                if process.poll() is None:
                    process.kill()
                    process.wait(timeout=2)
                for stream in (process.stdin, process.stdout, process.stderr):
                    if stream is not None:
                        stream.close()


if __name__ == "__main__":
    unittest.main()

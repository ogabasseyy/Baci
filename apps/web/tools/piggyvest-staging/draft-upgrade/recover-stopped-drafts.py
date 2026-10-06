import argparse
import json
import os
import re
import subprocess

from artifact_validation import Refused
from systemd_identity import SERVICE, assert_timer, assert_unit, command, show


def recover(expected_invocation: str) -> None:
    if os.geteuid() != 0 or not re.fullmatch('[a-f0-9]{32}', expected_invocation):
        raise Refused('Recovery requires root and the observed invocation.')
    assert_timer()
    assert_unit(SERVICE, '/etc/systemd/system/baci-savings-drafts.service', False)
    expected = {'ActiveState': 'failed', 'MainPID': '0', 'ControlPID': '0',
                'Result': 'exit-code', 'ExecMainStatus': '143',
                'InvocationID': expected_invocation}
    for name, value in expected.items():
        if show(SERVICE, name) != value:
            raise Refused('Stopped service identity changed; no recovery attempted.')
    if show(SERVICE, 'InvocationID') != expected_invocation:
        raise Refused('Stopped invocation changed before recovery.')
    command(['/usr/bin/systemctl', 'start', SERVICE])


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--invocation', required=True)
    arguments = parser.parse_args()
    try:
        recover(arguments.invocation)
    except (Refused, OSError, subprocess.SubprocessError):
        print(json.dumps({'stage': 'recover-stopped-drafts', 'status': 'refused'}))
        raise SystemExit(1)
    print(json.dumps({'stage': 'recover-stopped-drafts', 'status': 'start-requested'}))

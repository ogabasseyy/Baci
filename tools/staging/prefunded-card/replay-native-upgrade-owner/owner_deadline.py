from pathlib import Path
import re
import time

from owner_io import read, require


EPOCH = 1791302350
DATE = '2026-10-06 15:59:10 UTC'
STEM = 'baci-prefunded-replay-deadline'
STOPPER = b'''[Unit]
Description=Stop bounded prefunded staging receipt replay
[Service]
Type=oneshot
ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded
TimeoutStartSec=30
'''
TIMER = b'''[Unit]
Description=Fixed prefunded staging receipt replay deadline
[Timer]
OnCalendar=2026-10-06 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit=baci-prefunded-replay-deadline.service
'''


def verify_deadline(run, reader=read, now=time.time, require_active=False):
    require(now() < EPOCH, 'fixed_deadline_expired')
    for suffix, expected in (('.timer', TIMER), ('.service', STOPPER)):
        name = STEM + suffix
        filename = Path('/etc/systemd/system') / name
        require(reader(filename, modes=(0o644,), limit=8192) == expected, 'deadline_unit_bytes_changed')
        fields = ['FragmentPath', 'DropInPaths', 'NeedDaemonReload']
        fields += ['ActiveState', 'TimersCalendar', 'NextElapseUSecRealtime', 'Unit'] if suffix == '.timer' else ['ExecStart']
        output = run(['/usr/bin/systemctl', 'show', name, *['--property=' + field for field in fields]])
        rows = output.strip().splitlines()
        require(len(rows) == len(fields), 'deadline_property_shape_refused')
        values = dict(row.split('=', 1) for row in rows)
        require(set(values) == set(fields) and values['FragmentPath'] == str(filename)
                and values['DropInPaths'] == '' and values['NeedDaemonReload'] == 'no',
                'deadline_effective_unit_refused')
        if suffix == '.timer':
            require(values['ActiveState'] in ('active', 'inactive')
                    and (not require_active or values['ActiveState'] == 'active')
                    and values['Unit'] == STEM + '.service'
                    and [value.strip() for value in re.findall(r'OnCalendar=([^;}]*)', values['TimersCalendar'])] == [DATE]
                    and (values['ActiveState'] == 'inactive' or
                         re.fullmatch(r'[A-Za-z]{3} ' + re.escape(DATE), values['NextElapseUSecRealtime'])),
                    'deadline_effective_calendar_refused')
        else:
            executable = '/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded'
            require(values['ExecStart'].count('argv[]=') == 1
                    and 'argv[]=' + executable + ' ;' in values['ExecStart']
                    and values['ExecStart'].count('ignore_errors=no') == 1
                    and 'path=/usr/bin/docker ;' in values['ExecStart'], 'deadline_effective_stop_target_refused')
    require(now() < EPOCH, 'fixed_deadline_expired')

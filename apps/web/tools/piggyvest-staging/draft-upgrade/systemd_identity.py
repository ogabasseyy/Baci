import os
import pwd
import re
import shlex
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path

from artifact_validation import Refused


ENV = {'PATH': '/usr/sbin:/usr/bin:/sbin:/bin', 'LC_ALL': 'C'}
SERVICE = 'baci-savings-drafts.service'
SMOKE = 'baci-savings-drafts-smoke.service'
TIMER = 'baci-savings-drafts-deadline.timer'
USER = 'baci-savings-gateway'
WORKING_DIRECTORY = '/opt/baci-savings-drafts/apps/web'
EXECUTABLE = '/usr/bin/node'
LEASE_UNTIL = 1790697550


@dataclass(frozen=True)
class Invocation:
    unit: str
    identifier: str
    process_id: int


def command(arguments: list[str]) -> str:
    return subprocess.run(arguments, check=True, stdin=subprocess.DEVNULL,
                          stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
                          timeout=45, env=ENV, text=True).stdout.strip()


def show(unit: str, property_name: str) -> str:
    return command(['/usr/bin/systemctl', 'show', unit, f'--property={property_name}', '--value'])


def parse_exec_start(value: str) -> dict[str, str]:
    if not value.startswith('{ ') or not value.endswith(' }'):
        raise Refused('ExecStart is not parseable.')
    fields: dict[str, str] = {}
    for field in value[2:-2].split(' ; '):
        if '=' not in field or '{' in field or '}' in field:
            raise Refused('ExecStart is not parseable.')
        name, field_value = field.split('=', 1)
        if not name or not field_value or name in fields:
            raise Refused('ExecStart is not parseable.')
        fields[name] = field_value
    required = {'path', 'argv[]', 'ignore_errors', 'start_time', 'stop_time', 'pid', 'code', 'status'}
    if set(fields) != required or not fields['start_time'].startswith('[') or not fields['start_time'].endswith(']'):
        raise Refused('ExecStart is not parseable.')
    if not fields['stop_time'].startswith('[') or not fields['stop_time'].endswith(']') or not fields['pid'].isdecimal():
        raise Refused('ExecStart is not parseable.')
    if fields['code'] not in ('(null)', 'exited') or not re.fullmatch(r'\d+(?:/\d+)?', fields['status']):
        raise Refused('ExecStart is not parseable.')
    return fields


def assert_exec(unit: str) -> None:
    value = parse_exec_start(show(unit, 'ExecStart'))
    if value['path'] != EXECUTABLE or value['argv[]'] != f'{EXECUTABLE} server.js' or value['ignore_errors'] != 'no':
        raise Refused(f'{unit} ExecStart identity changed.')
    for property_name in ('ExecStartPre', 'ExecStartPost', 'ExecReload', 'ExecStop', 'ExecStopPost'):
        if show(unit, property_name) != '':
            raise Refused(f'{unit} has an unexpected {property_name}.')


def assert_unit(unit: str, fragment: str, restricted: bool) -> None:
    expected = {'FragmentPath': fragment, 'User': USER, 'WorkingDirectory': WORKING_DIRECTORY,
                'DropInPaths': '', 'NeedDaemonReload': 'no'}
    for property_name, value in expected.items():
        if show(unit, property_name) != value:
            raise Refused(f'{unit} {property_name} identity changed.')
    assert_exec(unit)
    if unit == SMOKE:
        if show(unit, 'EnvironmentFiles') != '' or 'PORT=4794' not in shlex.split(show(unit, 'Environment')):
            raise Refused(f'{unit} environment identity changed.')
    if restricted:
        expected_restrictions = {'NoNewPrivileges': 'yes', 'ProtectSystem': 'strict',
                                 'ProtectHome': 'yes', 'PrivateTmp': 'yes', 'PrivateDevices': 'yes',
                                 'CapabilityBoundingSet': ''}
        for property_name, value in expected_restrictions.items():
            if show(unit, property_name) != value:
                raise Refused(f'{unit} restricted identity changed.')


def assert_timer() -> None:
    if time.time() >= LEASE_UNTIL or show(TIMER, 'ActiveState') != 'active':
        raise Refused('Lease deadline is inactive or expired.')
    if show(TIMER, 'FragmentPath') != '/etc/systemd/system/baci-savings-drafts-deadline.timer':
        raise Refused('Lease deadline identity changed.')
    if show(TIMER, 'DropInPaths') != '' or show(TIMER, 'NeedDaemonReload') != 'no':
        raise Refused('Lease deadline has unreviewed unit changes.')
    if show(TIMER, 'NextElapseUSecRealtime') != 'Tue 2026-09-29 15:59:10 UTC':
        raise Refused('Lease deadline identity changed.')


def capture_live(unit: str, fragment: str, restricted: bool) -> Invocation:
    assert_unit(unit, fragment, restricted)
    if show(unit, 'ActiveState') != 'active':
        raise Refused(f'{unit} is not active.')
    identifier = show(unit, 'InvocationID')
    process_value = show(unit, 'MainPID')
    if len(identifier) < 16 or not process_value.isdecimal() or int(process_value) < 2:
        raise Refused(f'{unit} invocation identity is unavailable.')
    process = Path('/proc') / process_value
    if (process.stat().st_uid != pwd.getpwnam(USER).pw_uid
            or os.readlink(process / 'exe') != EXECUTABLE
            or os.readlink(process / 'cwd') != WORKING_DIRECTORY):
        raise Refused(f'{unit} process identity changed.')
    return Invocation(unit, identifier, int(process_value))


def stop_owned(invocation: Invocation, fragment: str, restricted: bool) -> None:
    current = capture_live(invocation.unit, fragment, restricted)
    if current.identifier != invocation.identifier or current.process_id != invocation.process_id:
        raise Refused(f'{invocation.unit} invocation changed; refusing stop.')
    command(['/usr/bin/systemctl', 'stop', invocation.unit])
    state = show(invocation.unit, 'ActiveState')
    if show(invocation.unit, 'MainPID') != '0' or show(invocation.unit, 'ControlPID') != '0':
        raise Refused(f'{invocation.unit} still has a live process.')
    if show(invocation.unit, 'InvocationID') not in ('', invocation.identifier):
        raise Refused(f'{invocation.unit} invocation changed after stop.')
    terminated_next = (state == 'failed'
                       and show(invocation.unit, 'InvocationID') == invocation.identifier
                       and show(invocation.unit, 'Result') == 'exit-code'
                       and show(invocation.unit, 'ExecMainStatus') == '143')
    if state != 'inactive' and not terminated_next:
        raise Refused(f'{invocation.unit} did not stop.')

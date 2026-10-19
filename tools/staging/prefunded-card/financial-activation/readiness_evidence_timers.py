import re

from readiness_evidence_io import DEADLINE, DOCKER, command, pinned, require

PREFIX = '/etc/systemd/system/'
STOPS = {
    'baci-prefunded-public-deadline': [
        '/usr/bin/systemctl stop baci-prefunded-public.service',
        ' '.join([*DOCKER, 'stop', '--time', '5', 'baci-prefunded-public'])],
    'baci-prefunded-deadline': [
        '/usr/bin/systemctl stop baci-prefunded-snapshot.timer baci-prefunded-background.timer',
        '/usr/bin/systemctl stop baci-prefunded-snapshot.service baci-prefunded-background.service'],
    'baci-prefunded-replay-deadline': [
        ' '.join([*DOCKER, 'stop', '--time', '15', 'pvb-staging-replay-prefunded'])],
}
DATE = '2026-10-06 15:59:10 UTC'


def properties(text):
    rows = text.strip().splitlines()
    require(all('=' in row for row in rows), 'systemd_properties_refused')
    value = dict(row.split('=', 1) for row in rows)
    require(len(value) == len(rows), 'systemd_duplicate_properties')
    return value


def loaded(name, artifacts, fields, run):
    record = artifacts[name]
    require(record['path'] == PREFIX + name, 'unit_path_refused')
    content = pinned(record).decode()
    value = properties(run(['/usr/bin/systemctl', 'show', '--no-pager',
        '--property=' + ','.join(['FragmentPath', 'DropInPaths', 'NeedDaemonReload', 'LoadState', *fields]), name]))
    require(value.get('FragmentPath') == PREFIX + name and value.get('DropInPaths') == ''
            and value.get('NeedDaemonReload') == 'no' and value.get('LoadState') == 'loaded',
            'unit_not_exactly_loaded')
    return content, value


def collect(artifacts, run=command):
    result = {}
    for stem, stops in STOPS.items():
        timer = stem + '.timer'
        content, observed = loaded(timer, artifacts,
            ['ActiveState', 'SubState', 'Unit', 'TimersCalendar', 'NextElapseUSecRealtime'], run)
        require(re.findall(r'^OnCalendar=(.*)$', content, re.MULTILINE) == [DATE]
                and re.findall(r'^Unit=(.*)$', content, re.MULTILINE) == [stem + '.service'],
                'timer_fragment_refused')
        calendars = re.fullmatch(r'\{\s*OnCalendar=(.*?)\s*;\s*next_elapse=(.*?)\s*;?\s*\}',
                                 observed.get('TimersCalendar', ''))
        require(calendars is not None and calendars[1] in (DATE, 'Tue ' + DATE)
                and calendars[2] == observed.get('NextElapseUSecRealtime')
                and observed.get('NextElapseUSecRealtime') in (DATE, 'Tue ' + DATE)
                and observed.get('Unit') == stem + '.service'
                and observed.get('ActiveState') == 'active' and observed.get('SubState') == 'waiting',
                'effective_deadline_refused')
        stopper, service = loaded(stem + '.service', artifacts, ['ExecStart'], run)
        require(re.findall(r'^ExecStart=(.*)$', stopper, re.MULTILINE) == stops,
                'stop_targets_refused')
        executed = re.findall(r'\{\s*path=([^;]+);\s*argv\[\]=(.*?);\s*ignore_errors=',
                              service.get('ExecStart', ''))
        executed = [(path.strip(), arguments.strip()) for path, arguments in executed]
        require(executed == [(entry.split()[0], entry) for entry in stops]
                and service['ExecStart'].count('ignore_errors=no') == len(stops),
                'effective_stop_targets_refused')
        result[timer] = {'active': True, 'effectiveDeadline': DEADLINE, 'dropIns': [],
                        'needDaemonReload': False, 'stopTargetsVerified': True}
    return result

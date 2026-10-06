from pathlib import Path
import sys

from installation_files import fingerprint, retained_replace
from release_contract import DEADLINE, HEX, pin_read, _require

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from runtime_owner_support import command
from runtime_scheduler import PREFIX, units
from public_service_contract import units as public_units

SYSTEMD = Path('/etc/systemd/system')
TIMERS = ('baci-prefunded-public-deadline.timer', 'baci-prefunded-deadline.timer',
          'baci-prefunded-replay-deadline.timer')
REPLAY_STOPPER = b'''[Unit]
Description=Stop bounded prefunded staging receipt replay
[Service]
Type=oneshot
ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 15 pvb-staging-replay-prefunded
TimeoutStartSec=30
'''


def properties(name, fields):
    output = command(['/usr/bin/systemctl', 'show', name,
                      *['--property=' + field for field in fields]])
    result = dict(line.split('=', 1) for line in output.strip().splitlines())
    _require(set(result) == set(fields), 'installation_unit_properties_incomplete')
    return result


def unit_fingerprint(path):
    metadata, content = fingerprint(path)
    _require(metadata['uid'] == metadata['gid'] == 0 and metadata['mode'] == 0o644,
             'installation_unit_metadata_refused')
    return metadata, content


def verified_plan(candidate, candidate_sha):
    import json
    _require(isinstance(candidate_sha, str) and HEX.fullmatch(candidate_sha),
             'installation_candidate_pin_refused')
    metadata = json.loads(pin_read(candidate / 'candidate.json', candidate_sha))
    rows = metadata['artifacts']['unitArtifacts']
    replacements = {}
    for row in rows:
        name = row['name']
        _require(name in (*TIMERS, 'baci-prefunded-public.service'),
                 'installation_unit_scope_refused')
        relative = Path(row['candidatePath'])
        _require(not relative.is_absolute() and '..' not in relative.parts,
                 'installation_unit_path_refused')
        content = pin_read(candidate / 'artifacts' / relative, row['candidateSha256'])
        predecessor, original = unit_fingerprint(SYSTEMD / name)
        _require(predecessor['sha256'] == row['sourceSha256'],
                 'installation_unit_pin_mismatch')
        if name.startswith('baci-prefunded-public'):
            _require(original == content, 'installation_public_must_be_preserved')
        else:
            _require(original.count(b'OnCalendar=2026-09-29 15:59:10 UTC') == 1
                     and content == original.replace(b'OnCalendar=2026-09-29 15:59:10 UTC',
                                                     b'OnCalendar=2026-10-06 15:59:10 UTC'),
                     'installation_deadline_edit_scope_refused')
            replacements[name] = (content, predecessor)
    _require(len(rows) == 4 and set(row['name'] for row in rows) == {
        *TIMERS, 'baci-prefunded-public.service'}, 'installation_unit_set_refused')
    return replacements


def validate_unchanged_units():
    expected = {PREFIX + suffix: value.encode() for suffix, value in units().items()
                if suffix != 'deadline.timer'}
    expected['baci-prefunded-replay-deadline.service'] = REPLAY_STOPPER
    expected['baci-prefunded-public-deadline.service'] = public_units()[
        'baci-prefunded-public-deadline.service'].encode()
    for name in (*expected, *TIMERS, 'baci-prefunded-public.service'):
        metadata, content = unit_fingerprint(SYSTEMD / name)
        if name in expected:
            _require(content == expected[name], 'installation_stopper_or_worker_unit_drift')
        observed = properties(name, ('FragmentPath', 'DropInPaths', 'NeedDaemonReload'))
        _require(observed == {'FragmentPath': str(SYSTEMD / name),
            'DropInPaths': '', 'NeedDaemonReload': 'no'}, 'installation_effective_unit_drift')


def install_deadlines(candidate, audit, candidate_sha):
    validate_unchanged_units()
    plan = verified_plan(candidate, candidate_sha)
    for name, (content, predecessor) in plan.items():
        retained_replace(SYSTEMD / name, content, predecessor, audit)
    command(['/usr/bin/systemd-analyze', 'verify',
             *[str(SYSTEMD / name) for name in TIMERS]])
    command(['/usr/bin/systemctl', 'daemon-reload'])
    validate_unchanged_units()
    command(['/usr/bin/systemctl', 'restart', *TIMERS])
    return verify_deadlines()


def verify_deadlines():
    validate_unchanged_units()
    result = {}
    for name in TIMERS:
        row = properties(name, ('ActiveState', 'NextElapseUSecRealtime', 'TimersCalendar'))
        _require(row['ActiveState'] == 'active'
                 and '2026-10-06 15:59:10 UTC' in row['TimersCalendar']
                 and '2026-10-06 15:59:10 UTC' in row['NextElapseUSecRealtime'],
                 'installation_effective_deadline_unproved')
        result[name] = {'active': True, 'effectiveDeadline': DEADLINE, 'dropIns': [],
                        'needDaemonReload': False, 'stopTargetsVerified': True}
    return result

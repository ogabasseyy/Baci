import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

PROJECT = 'baci-isolated-savings'
IMAGE = 'sha256:f371b5f3f2ac0a05703f33d6e6134515fb2498cab708fb948a0aeb7481467c00'
SOURCES = [f'{PROJECT}_checkpoint-{kind}-replay2' for kind in ('data', 'config')]
TARGETS = [f'{PROJECT}_db-{kind}-replay3' for kind in ('data', 'config')]


class CloneFailure(ValueError, RuntimeError):
    def __init__(self, stage):
        self.stage = stage
        super().__init__('Clone failed at ' + stage)


def failure_receipt(error):
    return {'status': 'failed-or-indeterminate',
            'stage': error.stage if isinstance(error, CloneFailure) else 'unexpected-failure',
            'retainAllVolumes': True, 'automaticRetryAllowed': False}


def validate(receipt):
    if (receipt.get('databaseStoppedCleanly') is not True
            or receipt.get('checkpointVolumes') != SOURCES
            or receipt.get('sourceVolumes') != [f'{PROJECT}_db-{kind}-replay2' for kind in ('data', 'config')]
            or not re.fullmatch('[a-f0-9]{64}', receipt.get('sourceContainerId', ''))
            or receipt.get('systemIdentifier') != '7685292944002592802'
            or not isinstance(receipt.get('copiedAt'), str)
            or not isinstance(receipt.get('purpose'), str)):
        raise ValueError('Checkpoint receipt rejected')


def docker(args):
    result = subprocess.run(
        ['docker', '--host', 'unix:///var/run/docker.sock', *args],
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL,
        env={'PATH': '/usr/local/bin:/usr/bin:/bin', 'LANG': 'C'},
        timeout=300, check=True,
    )
    return result.stdout.decode().strip()


def unused(run, names):
    for name in names:
        if run(['container', 'ls', '--quiet', '--filter', f'volume={name}']):
            raise ValueError('Running or paused volume mount rejected')


def clone(receipt, run=docker):
    state = {'stage': 'checkpoint-validation'}
    try:
        return clone_steps(receipt, run, state)
    except Exception:
        raise CloneFailure(state['stage']) from None


def clone_steps(receipt, run, state):
    validate(receipt)
    state['stage'] = 'image-inspection'
    image = json.loads(run(['image', 'inspect', IMAGE, '--format', '{{json .}}']))
    state['stage'] = 'image-validation'
    if image['Id'] != IMAGE or 'supabase/postgres:17.6.1.136' not in (image.get('RepoTags') or []):
        raise ValueError('Reviewed cached official image required')
    state['stage'] = 'daemon-inspection'
    daemon = run(['info', '--format', '{{.ID}}'])
    if not daemon:
        raise ValueError('Docker daemon identity missing')
    state['stage'] = 'destination-preflight'
    existing = run(['volume', 'ls', '--format', '{{.Name}}']).splitlines()
    if any(target in existing for target in TARGETS):
        raise ValueError('Destination already exists; never adopt or erase')
    identities = []
    for index, source in enumerate(SOURCES):
        state['stage'] = ('checkpoint-data-inspection', 'checkpoint-config-inspection')[index]
        volume = json.loads(run(['volume', 'inspect', source]))[0]
        if (volume.get('Name') != source or volume.get('Driver') != 'local'
                or volume.get('Options') or volume.get('Scope') != 'local'):
            raise ValueError('Checkpoint must be an ordinary local named volume')
        identities.append({key: volume.get(key) for key in ('Name', 'Driver', 'CreatedAt', 'Labels', 'Options', 'Scope')})
    state['stage'] = 'mount-preflight'
    unused(run, SOURCES + receipt['sourceVolumes'] + TARGETS)
    base = ['run', '--rm', '--pull=never', '--network=none', '--read-only',
            '--restart=no', '--user=0:0', '--cap-drop=ALL', '--cap-add=DAC_OVERRIDE',
            '--cap-add=CHOWN', '--cap-add=FOWNER', '--security-opt=no-new-privileges',
            '--pids-limit=32', '--memory=256m', '--cpus=1', '--log-driver=none']
    state['stage'] = 'control-data-command'
    control = run(base + ['--mount', f'type=volume,source={SOURCES[0]},target=/source,readonly,volume-nocopy',
                          '--entrypoint=/usr/lib/postgresql/bin/pg_controldata', IMAGE, '/source'])
    state['stage'] = 'control-data-validation'
    if (not re.search(r'Database cluster state:\s+shut down\s*$', control, re.M)
            or not re.search(r'Database system identifier:\s+' + receipt['systemIdentifier'] + r'\s*$', control, re.M)):
        raise ValueError('Checkpoint control data is not the reviewed clean cluster')
    for index, target in enumerate(TARGETS):
        kind = ('data', 'config')[index]
        state['stage'] = kind + '-mount-recheck'
        unused(run, SOURCES + receipt['sourceVolumes'] + TARGETS)
        state['stage'] = kind + '-destination-recheck'
        if target in run(['volume', 'ls', '--format', '{{.Name}}']).splitlines():
            raise ValueError('Destination appeared during clone')
        labels = [f'com.docker.compose.project={PROJECT}',
                  f'com.docker.compose.volume=db-{("data", "config")[index]}',
                  'baci.checkpoint.clone=replay3']
        args = ['volume', 'create', '--driver=local']
        for label in labels:
            args += ['--label', label]
        state['stage'] = kind + '-volume-create'
        run(args + [target])
        state['stage'] = kind + '-copy'
        run(base + ['--mount', f'type=volume,source={SOURCES[index]},target=/source,readonly,volume-nocopy',
                    '--mount', f'type=volume,source={target},target=/destination,volume-nocopy',
                    '--entrypoint=/bin/sh', IMAGE, '-ec',
                    'test -z "$(ls -A /destination)"; cp -a /source/. /destination/; sync'])
    state['stage'] = 'final-mount-recheck'
    unused(run, SOURCES + TARGETS)
    state['stage'] = 'success-receipt-build'
    return {'status': 'cloned-not-started', 'daemonId': daemon, 'imageId': IMAGE,
            'systemIdentifier': receipt['systemIdentifier'], 'checkpointVolumes': identities,
            'destinationVolumes': TARGETS, 'sourceReceiptSha256': hashlib.sha256(
                json.dumps(receipt, sort_keys=True).encode()).hexdigest()}


def main():
    state = {'stage': 'arguments'}
    try:
        main_steps(state)
    except CloneFailure:
        raise
    except Exception:
        raise CloneFailure(state['stage']) from None


def main_steps(state):
    parser = argparse.ArgumentParser(description='Reviewed cold replay2 checkpoint to NEW replay3 volumes only')
    parser.add_argument('--execute-reviewed-local', action='store_true', required=True)
    parser.add_argument('--checkpoint-receipt', type=Path, required=True)
    parser.add_argument('--output-receipt', type=Path, required=True)
    args = parser.parse_args()
    state['stage'] = 'checkpoint-receipt-read'
    receipt = json.loads(args.checkpoint_receipt.read_text())
    state['stage'] = 'checkpoint-validation'
    validate(receipt)
    state['stage'] = 'output-receipt-create'
    descriptor = os.open(args.output_receipt, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w') as output:
        try:
            result = clone(receipt)
        except Exception as error:
            state['stage'] = 'failure-receipt-write'
            json.dump(failure_receipt(error), output)
            raise
        state['stage'] = 'success-receipt-write'
        json.dump(result, output)


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps(failure_receipt(error)), file=sys.stderr)
        sys.exit(1)

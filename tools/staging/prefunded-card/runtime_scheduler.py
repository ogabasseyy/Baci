from pathlib import Path
import re
from treasury_owner_contract import Refused


ROOT = '/opt/baci-prefunded-workers'
STATE = '/var/lib/baci-staging/prefunded-first-card'
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
NETWORKS = ('baci-isolated-savings_database', 'pvb-staging-intake-ingress')
HOST = 'piggyvest-db.staging.baci.internal:172.23.0.2'
PREFIX = 'baci-prefunded-'
LABEL = 'com.baci.prefunded.worker-manifest'
KINDS = ('background', 'snapshot', 'readiness')


def container_contract(kind, digest):
    if kind not in KINDS or not re.fullmatch('[a-f0-9]{64}', digest):
        raise Refused('Worker container scope refused')
    user = '65531:65531' if kind == 'snapshot' else '65532:65532'
    mounts = [dict(Type='bind', Source=ROOT + '/code', Destination='/opt/pvb-worker', RW=False)]
    if kind == 'snapshot':
        mounts.append(dict(Type='bind', Source=ROOT + '/config/snapshot.json',
                           Destination='/run/pvb-worker/snapshot.json', RW=False))
        invocation = ['/usr/local/bin/node', '/opt/pvb-worker/snapshot.cjs', '/run/pvb-worker/snapshot.json']
    else:
        mounts.append(dict(Type='bind', Source=ROOT + '/config/background.json',
                           Destination='/etc/baci-staging/prefunded-first-card.json', RW=False))
        invocation = ['/usr/local/bin/node', '/opt/pvb-worker/readiness.cjs', '--connect',
                      '/etc/baci-staging/prefunded-first-card.json']
        if kind == 'background':
            mounts.append(dict(Type='bind', Source=STATE, Destination=STATE, RW=True))
            invocation = ['/usr/bin/bash', '/opt/pvb-worker/background.sh']
    command = ['/usr/bin/timeout', '--kill-after=5s', '470s' if kind == 'background' else '35s', *invocation]
    return dict(Image=IMAGE,
        Config=dict(User=user, Cmd=command, Entrypoint=['docker-entrypoint.sh'], Labels={LABEL: digest}),
        HostConfig=dict(ReadonlyRootfs=True, Privileged=False, CapDrop=['ALL'], CapAdd=None,
                        Binds=None, Devices=[], DeviceRequests=None, NetworkMode=NETWORKS[0],
                        PidMode='', IpcMode='private', SecurityOpt=['no-new-privileges'],
                        PortBindings={}, PublishAllPorts=False, RestartPolicy={'Name': 'no', 'MaximumRetryCount': 0},
                        ExtraHosts=[HOST], Tmpfs={'/tmp': 'rw,noexec,nosuid,size=16m,mode=1777'},
                        Memory=402653184, NanoCpus=500000000, PidsLimit=64,
                        LogConfig={'Type': 'json-file', 'Config': {'max-file': '3', 'max-size': '1m'}}),
        Mounts=mounts, NetworkSettings={'Networks': {network: {} for network in NETWORKS}})


def create_arguments(kind, digest):
    expected = container_contract(kind, digest)
    arguments = ['create', '--name=' + PREFIX + kind, '--label=' + LABEL + '=' + digest,
                 '--user=' + expected['Config']['User'], '--read-only', '--cap-drop=ALL',
                 '--security-opt=no-new-privileges', '--restart=no', '--memory=384m', '--cpus=0.5',
                 '--pids-limit=64', '--log-driver=json-file', '--log-opt=max-size=1m', '--log-opt=max-file=3',
                 '--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777', '--network=' + NETWORKS[0], '--add-host=' + HOST]
    for mount in expected['Mounts']:
        arguments.append('--mount=type=bind,src=' + mount['Source'] + ',dst=' + mount['Destination']
                         + (',readonly' if not mount['RW'] else ''))
    return [*arguments, IMAGE, *expected['Config']['Cmd']]


def validate_container(observed, kind, digest):
    expected = container_contract(kind, digest)
    try:
        if observed['Image'] != IMAGE:
            raise ValueError()
        for section in ('Config', 'HostConfig'):
            for key, value in expected[section].items():
                actual = observed[section][key]
                if key == 'Labels':
                    actual = {LABEL: actual.get(LABEL)}
                if actual != value:
                    raise ValueError()
        mounts = [{key: mount[key] for key in ('Type', 'Source', 'Destination', 'RW')} for mount in observed['Mounts']]
        if (sorted(mounts, key=lambda mount: mount['Destination']) !=
                sorted(expected['Mounts'], key=lambda mount: mount['Destination'])
                or set(observed['NetworkSettings']['Networks']) != set(NETWORKS)):
            raise ValueError()
    except (KeyError, TypeError, ValueError):
        raise Refused('Worker isolation contract differs') from None


def units():
    result = {}
    for kind, timeout, interval in [('snapshot', 45, 300), ('background', 480, 30)]:
        result[kind + '.service'] = f'''[Unit]
Description=Bounded staging prefunded {kind}
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock start --attach {PREFIX}{kind}
ExecStopPost=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 5 {PREFIX}{kind}
TimeoutStartSec={timeout}
TimeoutStopSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_UNIX
UMask=0077
'''
        result[kind + '.timer'] = f'''[Unit]
Description=Bounded staging prefunded {kind} schedule
[Timer]
OnActiveSec=30s
OnUnitInactiveSec={interval}s
AccuracySec=1s
Unit={PREFIX}{kind}.service
'''
    result['deadline.service'] = f'''[Unit]
Description=Stop staging prefunded workers at the approved deadline
[Service]
Type=oneshot
ExecStart=/usr/bin/systemctl stop {PREFIX}snapshot.timer {PREFIX}background.timer
ExecStart=/usr/bin/systemctl stop {PREFIX}snapshot.service {PREFIX}background.service
TimeoutStartSec=30
'''
    result['deadline.timer'] = '''[Unit]
Description=Fixed staging prefunded worker deadline
[Timer]
OnCalendar=2026-09-29 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit=baci-prefunded-deadline.service
'''
    return result


def background_wrapper():
    source = Path(__file__).with_name('background-runner.sh').read_text()
    original = 'worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"'
    entry = 'cd "$worktree"\nexec pnpm --dir apps/web exec tsx src/scripts/run-prefunded-card-background.ts'
    if source.count(original) != 1 or source.count(entry) != 1:
        raise Refused('Reviewed background wrapper changed')
    compiled = '''report="$(/usr/local/bin/node /opt/pvb-worker/background.cjs)"
if [[ "$report" == '{"status":"completed"}' ]]; then
  printf '%s\\n' "$report"
else
  printf '{"status":"failed"}\\n'
  exit 1
fi'''
    return source.replace(original, '').replace(entry, compiled).replace('  exit 0\n', '  exit 1\n')

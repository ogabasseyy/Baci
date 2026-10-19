import re

from treasury_owner_contract import DEADLINE, DEADLINE_EPOCH, Refused


ROOT = '/opt/baci-prefunded-public'
NAME = 'baci-prefunded-public'
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
NETWORKS = ('baci-isolated-savings_database', 'pvb-staging-intake-ingress')
HOST = 'piggyvest-db.staging.baci.internal:172.23.0.2'
LABEL = 'com.baci.prefunded.public-manifest'
APPROVED_BUDGET_KOBO = 10000
PRESERVED_PRINCIPAL_KOBO = 10000
DOCKER = ['/usr/bin/docker', '--host=unix:///var/run/docker.sock']
PROBE_HEADERS = (('Host', 'staging.ogabassey.com'), ('Connection', 'close'))


def container_contract(digest):
    if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
        raise Refused('Public service manifest refused')
    mounts = [dict(Type='bind', Source=ROOT + '/app', Destination='/app', RW=False)]
    for name in ('checkout', 'anon'):
        mounts.append(dict(Type='bind', Source=ROOT + '/config/' + name + '.json',
                           Destination='/run/pvb-public/' + name + '.json', RW=False))
    return dict(Name='/' + NAME, Image=IMAGE,
        Config=dict(User='65530:65530', WorkingDir='/app/apps/web',
                    Cmd=['/usr/local/bin/node', '/app/launch-public.cjs'],
                    Entrypoint=['docker-entrypoint.sh'], Labels={LABEL: digest},
                    ExposedPorts={'3000/tcp': {}}),
        HostConfig=dict(ReadonlyRootfs=True, Privileged=False, CapDrop=['ALL'], CapAdd=None,
                        Binds=None, Devices=[], DeviceRequests=None, NetworkMode=NETWORKS[0],
                        PidMode='', IpcMode='private', SecurityOpt=['no-new-privileges'],
                        PortBindings={'3000/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '4800'}]},
                        PublishAllPorts=False, RestartPolicy={'Name': 'no', 'MaximumRetryCount': 0},
                        ExtraHosts=[HOST], Tmpfs={'/tmp': 'rw,noexec,nosuid,size=16m,mode=1777'},
                        Memory=536870912, NanoCpus=1000000000, PidsLimit=128,
                        Ulimits=[{'Name': 'core', 'Soft': 0, 'Hard': 0}],
                        LogConfig={'Type': 'json-file', 'Config': {'max-file': '3', 'max-size': '1m'}}),
        Mounts=mounts, NetworkSettings={'Networks': {network: {} for network in NETWORKS}})


def create_arguments(digest):
    expected = container_contract(digest)
    arguments = ['create', '--name=' + NAME, '--label=' + LABEL + '=' + digest,
                 '--user=65530:65530', '--workdir=/app/apps/web', '--read-only', '--cap-drop=ALL',
                 '--security-opt=no-new-privileges', '--restart=no', '--memory=512m', '--cpus=1',
                 '--pids-limit=128', '--ulimit=core=0:0', '--log-driver=json-file',
                 '--log-opt=max-size=1m', '--log-opt=max-file=3',
                 '--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777',
                 '--publish=127.0.0.1:4800:3000/tcp', '--network=' + NETWORKS[0], '--add-host=' + HOST]
    for mount in expected['Mounts']:
        arguments.append('--mount=type=bind,src=' + mount['Source'] + ',dst=' + mount['Destination'] + ',readonly')
    return [*arguments, IMAGE, *expected['Config']['Cmd']]


def validate_container(observed, digest, image_environment):
    expected = container_contract(digest)
    try:
        if (not isinstance(image_environment, list) or not image_environment
                or any(not isinstance(value, str) or '=' not in value for value in image_environment)
                or observed['Name'] != '/' + NAME or observed['Image'] != IMAGE
                or observed['Config']['Env'] != image_environment):
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
    except (KeyError, TypeError, ValueError, AttributeError):
        raise Refused('Public service isolation contract differs') from None


def rollback_commands():
    return [
        ['/usr/bin/systemctl', 'stop', NAME + '.service'],
        [*DOCKER, 'stop', '--time', '5', NAME],
    ]


def units():
    stop_service, stop_container = (' '.join(command) for command in rollback_commands())
    return {
        NAME + '.service': f'''[Unit]
Description=Restricted first-card staging public service
After=docker.service {NAME}-deadline.timer
Requires=docker.service {NAME}-deadline.timer
[Service]
Type=simple
ExecCondition=/bin/sh -c 'test "$(/bin/date -u +%%s)" -lt "{DEADLINE_EPOCH}"'
ExecStart={' '.join(DOCKER)} start --attach {NAME}
ExecStopPost={stop_container}
Restart=no
KillMode=control-group
TimeoutStartSec=30
TimeoutStopSec=15
LimitCORE=0
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_UNIX
UMask=0077
''',
        NAME + '-deadline.service': f'''[Unit]
Description=Stop first-card public access at the fixed staging deadline
[Service]
Type=oneshot
ExecStart={stop_service}
ExecStart={stop_container}
TimeoutStartSec=30
''',
        NAME + '-deadline.timer': f'''[Unit]
Description=Fixed first-card public deadline
[Timer]
OnCalendar=2026-09-29 15:59:10 UTC
AccuracySec=1s
Persistent=true
Unit={NAME}-deadline.service
''',
    }


def probe_contract():
    checkout = '/api/storefront/customer/savings/card-checkout'
    saved = '/api/storefront/customer/savings/card-contributions'
    return (
        ('GET', checkout + '?goalId=430314fd-cd8b-4579-98d4-e9f345713dd6', 401),
        ('POST', checkout, 401), ('PATCH', checkout, 401), ('PUT', checkout, 405),
        ('GET', '/savings/card-return', 200), ('HEAD', '/savings/card-return', 200),
        ('GET', '/api/csrf', 200), ('POST', '/api/csrf', 405),
        ('GET', saved, 404), ('POST', saved, 404),
    )

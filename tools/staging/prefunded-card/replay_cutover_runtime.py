import base64
import hashlib
import json
import re
from treasury_owner_contract import DEADLINE_EPOCH, SYSTEM, Refused


IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
CONTAINER = 'pvb-staging-replay-prefunded'
NETWORKS = ('pvb-staging-receipts', 'baci-isolated-savings_database', 'pvb-staging-intake-ingress')
HOST_BINDING = 'piggyvest-db.staging.baci.internal:172.23.0.2'
LABEL = 'com.baci.prefunded-replay.sha256'


def serialized(value):
    return json.dumps(value, sort_keys=True, separators=(',', ':')).encode()


def runtime_files(activation, base, activation_digest, factory_digest):
    try:
        if (hashlib.sha256(activation).hexdigest() != activation_digest
                or not re.fullmatch('[a-f0-9]{64}', factory_digest)):
            raise ValueError()
        receiver = json.loads(activation)['receiverReplayRuntime']
        if (set(receiver) != {'expectedAppSystemId', 'configuration'}
                or receiver['expectedAppSystemId'] != SYSTEM):
            raise ValueError()
        configuration = receiver['configuration']
        if set(configuration) != {'scope', 'evidence', 'database'}:
            raise ValueError()
        replay = json.loads(base)
        if (set(replay) != {'environment', 'receiptSystemId', 'appSystemId', 'receiptKey', 'receiptToken', 'appToken'}
                or replay['environment'] != 'staging' or replay['appSystemId'] != SYSTEM
                or replay['receiptSystemId'] != '7686901100561231906'
                or len(base64.b64decode(replay['receiptKey'], validate=True)) != 32):
            raise ValueError()
        for name, role, audience in [('receiptToken', 'pvb_staging_worker', 'pvb-staging-receipts'),
                                     ('appToken', 'pvb_staging_app_worker', 'authenticated')]:
            parts = replay[name].split('.')
            if len(parts) != 3:
                raise ValueError()
            claims = json.loads(base64.urlsafe_b64decode(parts[1] + '==='))
            if (set(claims) != {'role', 'aud', 'iat', 'exp'} or claims['role'] != role or claims['aud'] != audience
                    or type(claims['exp']) is not int or claims['exp'] != DEADLINE_EPOCH
                    or type(claims['iat']) is not int or not 0 < claims['exp'] - claims['iat'] <= 604800):
                raise ValueError()
        private = serialized(configuration)
        replay['prefundedReplay'] = dict(bundleSha256=factory_digest,
                                        configurationSha256=hashlib.sha256(private).hexdigest())
        return {'config.json': serialized(replay), 'prefunded.json': private}
    except (ValueError, TypeError, KeyError, AttributeError):
        raise Refused('Prepared replay configuration refused') from None


def expected_container(directory, digest, check):
    return dict(Image=IMAGE,
        Config=dict(User='65532:65532', Cmd=['node', '/opt/pvb-replay/replay-daemon.mjs'] + (['--check'] if check else []),
                    Entrypoint=['docker-entrypoint.sh'], Labels={LABEL: digest}),
        HostConfig=dict(ReadonlyRootfs=True, Privileged=False, CapDrop=['ALL'], CapAdd=None,
                        SecurityOpt=['no-new-privileges'], PortBindings={}, PublishAllPorts=False,
                        RestartPolicy={'Name': 'no', 'MaximumRetryCount': 0}, ExtraHosts=[HOST_BINDING],
                        Tmpfs={'/tmp': 'rw,noexec,nosuid,size=16m,mode=1777'},
                        Memory=201326592, NanoCpus=250000000, PidsLimit=64,
                        LogConfig={'Type': 'json-file', 'Config': {'max-file': '3', 'max-size': '1m'}}),
        Mounts=[dict(Type='bind', Source=directory + '/code', Destination='/opt/pvb-replay', RW=False),
                dict(Type='bind', Source=directory + '/config', Destination='/run/pvb-replay', RW=False)],
        NetworkSettings={'Networks': {name: {} for name in NETWORKS}})


def create_arguments(directory, digest, check=False):
    name = CONTAINER + ('-check' if check else '')
    return ['create', '--name=' + name, '--label=' + LABEL + '=' + digest,
            '--user=65532:65532', '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--restart=no', '--memory=192m', '--cpus=0.25', '--pids-limit=64',
            '--log-driver=json-file', '--log-opt=max-size=1m', '--log-opt=max-file=3',
            '--tmpfs=/tmp:rw,noexec,nosuid,size=16m,mode=1777', '--network=' + NETWORKS[0],
            '--add-host=' + HOST_BINDING,
            '--mount=type=bind,src=' + directory + '/code,dst=/opt/pvb-replay,readonly',
            '--mount=type=bind,src=' + directory + '/config,dst=/run/pvb-replay,readonly',
            IMAGE, 'node', '/opt/pvb-replay/replay-daemon.mjs'] + (['--check'] if check else [])


def validate_container(value, directory, digest, check=False):
    expected = expected_container(directory, digest, check)
    try:
        if value['Image'] != expected['Image']:
            raise ValueError()
        for section in ('Config', 'HostConfig'):
            for field, content in expected[section].items():
                observed = value[section][field]
                if section == 'Config' and field == 'Labels':
                    observed = {LABEL: observed.get(LABEL)}
                if observed != content:
                    raise ValueError()
        mounts = [{name: mount[name] for name in ('Type', 'Source', 'Destination', 'RW')}
                  for mount in value['Mounts']]
        if (sorted(mounts, key=lambda item: item['Destination']) !=
                sorted(expected['Mounts'], key=lambda item: item['Destination'])
                or set(value['NetworkSettings']['Networks']) != set(NETWORKS)):
            raise ValueError()
    except (ValueError, TypeError, KeyError):
        raise Refused('Replay container differs from reviewed isolation contract') from None

"""Pure binding of parent-collected facts, never permission to start a worker.

Container ID is previously reviewed expected identity, not live attestation.
Private config authority derives from original bytes and exactly seven approved
expiry changes, never the candidate checksum alone. Parent authenticates fresh
stopped-state/profile collection provenance and quiescence separately.
"""

from datetime import datetime, timezone
import hashlib
import json
import re


MANIFEST_SHA256 = 'c78ef2d125ad8019508cfced9e19d730848184c528b7a33c68d42c782418b086'
CONFIGURATION_SHA256 = '9a03772008dcd0fb5b220c70f9e66418037474e317ff8881935634727b8d825c'
SCHEDULER_SHA256 = 'a30f2422b100bbf61fd356bc61819a78fedc4c5163cb7fd1a73f52037e864adc'
ORIGINAL_CONFIGURATION_SHA256 = 'cfb35ec18c79d1d700948ca493692d54efc7c53c4e22ca38a1ffe0fa138108e3'
CANDIDATE_SHA256 = '439ad73d68de11c3387a754772cf2446303dadf85200bcbae6001fce35c0f3e6'
BACKGROUND_CONTAINER_ID = '3cc104ba3b8b92abc4c6344928d7356d4e3081c0bfbb799b22dc62a31fba82c4'
ROOT = '/opt/baci-prefunded-workers'
CONFIGURATION = ROOT + '/config/background.json'
UNIT = '/etc/systemd/system/baci-prefunded-background.service'
DEADLINE = '2026-10-06T15:59:10Z'
OLD_DEADLINE = '2026-09-29T15:59:10Z'
EXPIRY_PATHS = ('expected.expiresAt', 'publicCheckout.checkout.provider.expiresAt',
    'publicCheckout.checkout.scope.expiresAt', 'publicCheckout.expiresAt', 'recovery.provider.expiresAt',
    'recovery.scope.expiresAt', 'savedCardPublicRuntime.expiresAt')
SYSTEM = '7685292944002592802'
RETIRED = 'd8bcf921-61b3-4647-90e2-5648e4d6967d'
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
NETWORKS = ('baci-isolated-savings_database', 'pvb-staging-intake-ingress')
STATE = '/var/lib/baci-staging/prefunded-first-card'
LABEL = 'com.baci.prefunded.worker-manifest'
SCOPE = dict(environment='staging', integrationId='d91d9e87-8e0d-44de-9b84-1e1d709633d2',
    merchantId='10000000-0000-4000-8000-000000000001', treasuryBindingId='ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
    businessId='01M2381RG34HQJMHQKE7DWDACR', expectedSystemId=SYSTEM)
BACKGROUND_UNIT = b'''[Unit]
Description=Bounded staging prefunded background
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/bin/docker --host=unix:///var/run/docker.sock start --attach baci-prefunded-background
ExecStopPost=/usr/bin/docker --host=unix:///var/run/docker.sock stop --time 5 baci-prefunded-background
TimeoutStartSec=480
TimeoutStopSec=10
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
RestrictAddressFamilies=AF_UNIX
UMask=0077
'''


def _require(condition):
    if not condition:
        raise ValueError('worker_source_authority_refused')


def _pin(value):
    return type(value) is str and re.fullmatch('[a-f0-9]{64}', value) is not None


def _sha(value):
    return hashlib.sha256(value).hexdigest()


def _json(raw, pin, limit=2_000_000):
    _require(type(raw) is bytes and 0 < len(raw) <= limit and _pin(pin) and _sha(raw) == pin)
    def unique(pairs):
        result = {}
        for name, value in pairs:
            _require(name not in result)
            result[name] = value
        return result
    value = json.loads(raw.decode('utf8'), object_pairs_hook=unique,
                       parse_constant=lambda value: _require(False))
    _require(type(value) is dict)
    return value


def _matches(actual, expected, exact=False):
    if type(expected) is dict:
        return type(actual) is dict and (not exact or set(actual) == set(expected)) and all(
            name in actual and _matches(actual[name], value, exact)
            for name, value in expected.items())
    if type(expected) is list:
        return type(actual) is list and len(actual) == len(expected) and all(
            _matches(actual_item, expected_item, exact) for actual_item, expected_item in zip(actual, expected))
    return type(actual) is type(expected) and actual == expected


def _wrapper(raw):
    _require(type(raw) is bytes and 0 < len(raw) <= 100_000)
    source = raw.decode('utf8')
    original = 'worktree="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"'
    entry = 'cd "$worktree"\nexec pnpm --dir apps/web exec tsx src/scripts/run-prefunded-card-background.ts'
    _require(source.count(original) == source.count(entry) == 1)
    compiled = '''report="$(/usr/local/bin/node /opt/pvb-worker/background.cjs)"
if [[ "$report" == '{"status":"completed"}' ]]; then
  printf '%s\\n' "$report"
else
  printf '{"status":"failed"}\\n'
  exit 1
fi'''
    return source.replace(original, '').replace(entry, compiled).replace('  exit 0\n', '  exit 1\n').encode()


def _source_pins(manifest_bytes, scheduler_bytes, wrapper_bytes):
    seal = _json(manifest_bytes, MANIFEST_SHA256)
    _require(_matches(seal, dict(version=1, status='source-verified-prepared-inactive', deadline=DEADLINE,
        approvedCompanyBudgetKobo=10000, preservedPrincipalKobo=10000, retiredIntentId=RETIRED,
        mutationsEnabled=False, changesApplied=False, financialStarted=False, newPaymentStarted=False)))
    outputs = seal['workers']['outputs']
    _require(seal['workers']['sourceVerified'] is True and type(outputs) is dict
        and set(outputs) == {'background.cjs','readiness.cjs','snapshot.cjs'}
        and all(_pin(pin) and seal['files']['workers/' + name] == pin for name, pin in outputs.items()))
    _require(type(scheduler_bytes) is bytes and 0 < len(scheduler_bytes) <= 1_000_000
        and _sha(scheduler_bytes) == seal['files']['tooling/runtime_scheduler.py'] == SCHEDULER_SHA256)
    _require(type(wrapper_bytes) is bytes and _sha(wrapper_bytes) == seal['files']['tooling/background-runner.sh'])
    pins = {ROOT + '/code/' + name: pin for name, pin in outputs.items()}
    pins[ROOT + '/code/background.sh'] = _sha(_wrapper(wrapper_bytes))
    pins[CONFIGURATION] = CONFIGURATION_SHA256
    return pins


def _candidate(candidate_bytes, original_configuration_bytes, configuration_bytes):
    proof = _json(candidate_bytes, CANDIDATE_SHA256)
    _require(_matches(proof, dict(status='expiry_rebuild_prepared', deadline=DEADLINE,
        changesApplied=False, servicesRestarted=False, newPaymentStarted=False)))
    artifacts = proof['artifacts']
    _require(_matches(artifacts, dict(deadline=DEADLINE, changesApplied=False))
        and type(artifacts['artifacts']) is list and all(type(row) is dict for row in artifacts['artifacts']))
    rows = [row for row in artifacts['artifacts'] if row.get('sourcePath') == CONFIGURATION]
    _require(len(rows) == 1 and _matches(rows[0], dict(candidateSha256=CONFIGURATION_SHA256,
        candidatePath='workers/background.json', sourceSha256=ORIGINAL_CONFIGURATION_SHA256)))
    original = _json(original_configuration_bytes, ORIGINAL_CONFIGURATION_SHA256, 131072)
    configuration = _json(configuration_bytes, CONFIGURATION_SHA256, 131072)
    for path in EXPIRY_PATHS:
        record = original
        for name in path.split('.')[:-1]:
            record = record[name]
        _require(type(record) is dict and type(record['expiresAt']) is str and record['expiresAt'] == OLD_DEADLINE)
        record['expiresAt'] = DEADLINE
    _require(_matches(configuration, original, exact=True))
    _require(_matches(configuration, dict(expected=dict(systemIdentifier=SYSTEM, database='postgres',expiresAt=DEADLINE),
        background=dict(worker=SCOPE), publicCheckout=dict(maximumAmountKobo=10000), recovery=dict(scope=dict(
            deployment='staging',integrationId=SCOPE['integrationId'],merchantId=SCOPE['merchantId'],
            treasuryBindingId=SCOPE['treasuryBindingId'],businessId=SCOPE['businessId'],
            systemIdentifier=SYSTEM,expiresAt=DEADLINE)))))


def _profile(container, image):
    expected = dict(Image=IMAGE, Config=dict(User='65532:65532',
        Cmd=['/usr/bin/timeout','--kill-after=5s','470s','/usr/bin/bash','/opt/pvb-worker/background.sh'],
        Entrypoint=['docker-entrypoint.sh'],Labels={LABEL:MANIFEST_SHA256}), HostConfig=dict(
        ReadonlyRootfs=True,Privileged=False,CapDrop=['ALL'],CapAdd=None,Binds=None,Devices=[],DeviceRequests=None,
        NetworkMode=NETWORKS[0],PidMode='',IpcMode='private',SecurityOpt=['no-new-privileges'],
        PortBindings={},PublishAllPorts=False,RestartPolicy=dict(Name='no',MaximumRetryCount=0),
        ExtraHosts=['piggyvest-db.staging.baci.internal:172.23.0.2'],
        Tmpfs={'/tmp':'rw,noexec,nosuid,size=16m,mode=1777'},Memory=402653184,NanoCpus=500000000,PidsLimit=64,
        LogConfig={'Type':'json-file','Config':{'max-file':'3','max-size':'1m'}}),
        Id=BACKGROUND_CONTAINER_ID,Name='/baci-prefunded-background',
        State=dict(Running=False,Paused=False,Restarting=False,Dead=False))
    _require(_matches(container,expected) and container['State']['Status'] in ('created','exited'))
    mounts = [dict(Type='bind',Source=ROOT + '/code',Destination='/opt/pvb-worker',RW=False),
        dict(Type='bind',Source=CONFIGURATION,Destination='/etc/baci-staging/prefunded-first-card.json',RW=False),
        dict(Type='bind',Source=STATE,Destination=STATE,RW=True)]
    observed = [{name:row[name] for name in ('Type','Source','Destination','RW')} for row in container['Mounts']]
    _require(_matches(sorted(observed,key=lambda row:row['Destination']),sorted(mounts,key=lambda row:row['Destination']))
        and set(container['NetworkSettings']['Networks']) == set(NETWORKS) and image['Id'] == IMAGE)
    environment = image['Config']['Env']
    _require(type(environment) is list and all(type(entry) is str and '=' in entry for entry in environment))
    names = [entry.split('=',1)[0] for entry in environment]
    _require(len(names) == len(set(names)) and 'PREFUNDED_CARD_CHECKOUT_MUTATIONS_ENABLED' not in names
        and _matches(container['Config']['Env'],environment))


def validate_worker_source_authority(*, manifest_bytes, candidate_bytes, original_configuration_bytes, configuration_bytes,
                                     scheduler_bytes, wrapper_bytes, facts):
    if not (_pin(CANDIDATE_SHA256) and _pin(BACKGROUND_CONTAINER_ID)):
        raise ValueError('worker_original_authority_missing')
    try:
        pins = _source_pins(manifest_bytes,scheduler_bytes,wrapper_bytes)
        _candidate(candidate_bytes,original_configuration_bytes,configuration_bytes)
        _require(type(facts) is dict and set(facts) == {'observedAt','files','container','image','unit'})
        observed = facts['observedAt']
        _require(type(observed) is str and re.fullmatch(r'\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z',observed))
        instant = datetime.fromisoformat(observed.replace('Z','+00:00'))
        now = datetime.now(timezone.utc)
        _require(0 <= (now-instant).total_seconds() <= 60 and now < datetime.fromisoformat(DEADLINE.replace('Z','+00:00')))
        files = facts['files']
        expected_files = pins | {UNIT:_sha(BACKGROUND_UNIT)}
        _require(type(files) is dict and set(files) == set(expected_files))
        for path, pin in expected_files.items():
            owner, mode = (65532,0o600) if path == CONFIGURATION else (0,0o644 if path == UNIT else 0o444)
            expected = dict(sha256=pin,uid=owner,gid=owner,mode=mode,nlink=1,regularFile=True)
            _require(type(files[path]) is dict and set(files[path]) == set(expected) and _matches(files[path],expected))
        _require(_matches(facts['unit'],dict(FragmentPath=UNIT,DropInPaths='',NeedDaemonReload='no',
            LoadState='loaded',ActiveState='inactive',SubState='dead')))
        _profile(facts['container'],facts['image'])
        return dict(status='worker-source-inputs-bound',manifestSha256=MANIFEST_SHA256,
            originalConfigurationSha256=ORIGINAL_CONFIGURATION_SHA256,
            candidateSha256=CANDIDATE_SHA256,configurationSha256=CONFIGURATION_SHA256,
            schedulerSha256=SCHEDULER_SHA256,containerId=BACKGROUND_CONTAINER_ID,
            fileHashes=pins,unitSha256=_sha(BACKGROUND_UNIT),deadline=DEADLINE,
            approvedCompanyBudgetKobo=10000,approvedPreservedPrincipalKobo=10000,observedAt=observed)
    except Exception:
        raise ValueError('worker_source_authority_refused') from None

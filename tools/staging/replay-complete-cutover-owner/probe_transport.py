import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import uuid

from cutover_probes import probe_claim_fence
from cutover_runtime import DOCKER, require


IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'


def validate_probe_container(value, identifier, name, directory, script_sha, environment):
    host, config = value['HostConfig'], value['Config']
    require(value['Id'] == identifier and value['Name'] == '/' + name
            and value['Image'] == IMAGE and config['User'] == '65532:65532'
            and config['Entrypoint'] == ['/usr/local/bin/node']
            and config['Cmd'] == ['/probe/probe.cjs'] and config['Env'] == environment
            and config['Labels']['com.baci.claim-fence.probe-sha256'] == script_sha
            and host['ReadonlyRootfs'] is True and host['Privileged'] is False
            and host['RestartPolicy']['Name'] == 'no'
            and host['CapDrop'] == ['ALL'] and host['CapAdd'] is None
            and host['SecurityOpt'] == ['no-new-privileges']
            and host['Memory'] == 134217728 and host['NanoCpus'] == 125000000
            and host['PidsLimit'] == 32 and not host['PortBindings']
            and host['NetworkMode'] == 'pvb-staging-receipts'
            and set(value['NetworkSettings']['Networks']) == {'pvb-staging-receipts'}
            and len(value['Mounts']) == 1 and value['Mounts'][0]['Type'] == 'bind'
            and value['Mounts'][0]['Source'] == str(directory)
            and value['Mounts'][0]['Destination'] == '/probe'
            and value['Mounts'][0]['RW'] is False,
            'bounded_probe_container_refused')


def collect_http(context, tokens, script_sha):
    script = context.owner.read(Path(__file__).with_name('claim_probe.cjs'), script_sha)
    directory = Path(tempfile.mkdtemp(prefix='baci-claim-probe.', dir='/root'))
    name = 'pvb-claim-fence-probe-' + uuid.uuid4().hex
    run = context.finance['command']
    identifier, creation_attempted = None, False
    try:
        os.chown(directory, 0, 65532)
        os.chmod(directory, 0o750)
        context.owner.write(directory / 'probe.cjs', script, mode=0o444, group=65532)
        context.owner.write(directory / 'tokens.json', context.contract.serialize(tokens), mode=0o440, group=65532)
        image = json.loads(run([*DOCKER, 'image', 'inspect', IMAGE]))
        require(len(image) == 1 and image[0]['Id'] == IMAGE, 'probe_image_refused')
        environment = image[0]['Config']['Env']

        def inspect(reference):
            values = json.loads(run([*DOCKER, 'inspect', reference]))
            require(type(values) is list and len(values) == 1 and type(values[0]) is dict,
                    'probe_identity_refused')
            observed = values[0]
            observed_id = observed['Id']
            require(type(observed_id) is str and re.fullmatch('[a-f0-9]{64}', observed_id)
                    and (reference == name or observed_id == reference), 'probe_identity_refused')
            validate_probe_container(observed, observed_id, name, directory, script_sha, environment)
            return observed

        arguments = ['create', '--name=' + name, '--restart=no', '--user=65532:65532',
            '--read-only', '--cap-drop=ALL', '--security-opt=no-new-privileges',
            '--memory=128m', '--cpus=.125', '--pids-limit=32', '--network=pvb-staging-receipts',
            '--tmpfs=/tmp:rw,noexec,nosuid,size=4m',
            '--mount=type=bind,src=' + str(directory) + ',dst=/probe,readonly',
            '--label=com.baci.claim-fence.probe-sha256=' + script_sha,
            '--entrypoint=/usr/local/bin/node', IMAGE, '/probe/probe.cjs']
        creation_attempted = True
        identifier = run([*DOCKER, *arguments]).strip()
        require(re.fullmatch('[a-f0-9]{64}', identifier), 'probe_id_refused')
        inspect(identifier)
        context.deadline()
        run([*DOCKER, 'start', identifier])
        require(run([*DOCKER, 'wait', identifier], timeout=30).strip() == '0', 'probe_exit_refused')
        observed = inspect(identifier)
        require(observed['State']['Running'] is False and observed['State']['ExitCode'] == 0
                and observed['State']['OOMKilled'] is False, 'probe_exit_refused')
        result = json.loads(run([*DOCKER, 'logs', '--tail=1', identifier]))
        require(set(result) == {'oldNative', 'oldInterest', 'new'}, 'probe_report_refused')
        context.deadline()
        return result
    finally:
        try:
            if creation_attempted:
                reference = identifier if type(identifier) is str and re.fullmatch('[a-f0-9]{64}', identifier) else name
                observed = inspect(reference)
                cleanup_id = observed['Id']
                require(type(observed['State']['Running']) is bool, 'probe_cleanup_state_refused')
                if observed['State']['Running']:
                    run([*DOCKER, 'stop', '--time=10', cleanup_id], timeout=20)
                    observed = inspect(cleanup_id)
                require(observed['State']['Running'] is False, 'probe_cleanup_state_refused')
                run([*DOCKER, 'rm', cleanup_id])
        except Exception:
            raise ValueError('probe_cleanup_refused') from None
        finally:
            try:
                (directory / 'tokens.json').unlink(missing_ok=True)
            finally:
                try:
                    (directory / 'probe.cjs').unlink(missing_ok=True)
                finally:
                    directory.rmdir()


def run_probes(context, snapshot, script_sha):
    tokens, proofs = context.credentials()
    before = json.loads(json.dumps(snapshot(), sort_keys=True, allow_nan=False))
    responses = collect_http(context, tokens, script_sha)
    after = json.loads(json.dumps(snapshot(), sort_keys=True, allow_nan=False))
    require(all(value['identity'] == '7686901100561231906' for value in responses.values()),
            'http_physical_identity_refused')
    snapshots = iter((before, after))
    profiles = {token: profile for profile, token in tokens.items()}

    def request(*, token, method, path, payload):
        require(token in profiles and method == 'POST'
                and path == '/rpc/claim_piggyvest_staging_receipts'
                and payload == {'p_limit': None, 'p_lease_seconds': None}, 'probe_call_refused')
        response = responses[profiles[token]]
        return dict(status=response['status'], body=response['body'])

    report = probe_claim_fence(tokens=tokens, token_proofs=proofs,
        physical_identity=dict(verified=True, systemIdentifier='7686901100561231906'),
        request=request, snapshot=lambda: next(snapshots))
    report['tokenSha256'] = proofs['new']['tokenSha256']
    report['requestBatchSha256'] = hashlib.sha256(context.contract.serialize(responses)).hexdigest()
    return report

import argparse
from datetime import datetime, timezone
import grp
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import time

from activation_credentials import funding_environment, public_jwt, unit_anon_key
from activation_evidence import container_identity, financial_fences, funding_role
from activation_preparation import OWNER_RECEIPT_SHA256, validate_preparation
from renewal_contract import (BINDING, FUNDING_ENV, PINS, RECEIPT_SYSTEM, SYSTEM,
                              TARGET, TARGET_EPOCH, UNIT_DIRECTORY, Refused,
                              canonical, digest, inventory_summary, parse_json)
from renewal_io import private_directory, read_verified, trusted_parents, unchanged, write_private
from renewal_owner import ENVIRONMENT, INVENTORY, boundary_states, source_policy
from renewal_diagnostic import DISPLAY_CODES
from renewal_inventory import DOCKER, database_inventory


HERE = Path(__file__).resolve().parent
PREPARATION = Path('/root/baci-week-renewal-a.8fbbHHlB/lane-a-preparation')
SOURCES = (
    'activation_owner.py', 'activation_preparation.py', 'activation_credentials.py',
    'activation_evidence.py', 'activation-funding-role.sql', 'renewal_contract.py',
    'renewal_io.py', 'renewal_owner.py', 'renewal_diagnostic.py', 'renewal_inventory.py',
    'renewal-inventory.sql', 'renewal-receipt-inventory.sql', 'README-evidence.md',
)
CANDIDATES = ('binding.preview.json', 'baci-savings-drafts.service', 'baci-savings-funding.service',
              'funding-service.env', 'baci-savings-drafts-deadline.timer', 'baci-savings-funding-deadline.timer')
GRAPH = ('managed-gateway-cli.mjs', 'managed-gateway.mjs', 'managed-files.mjs',
         'managed-inventory-helper.mjs', 'private-routing.mjs', 'private-routing-inventory.mjs',
         'private-routing-supervisor-inventory.mjs', 'private-routing-supervisor-child.py', 'compose.mjs')


def verified_bundle(directory, expected):
    if os.geteuid() != 0 or directory != HERE or directory.parent != Path('/root'):
        raise Refused('root-private-owner-bundle-required')
    trusted_parents(directory)
    private_directory(directory)
    content, _ = read_verified(directory / 'ACTIVATION_SHA256SUMS', (0o400,), (0,), expected, limit=4096)
    records = {}
    for line in content.decode().splitlines():
        match = re.fullmatch(r'([a-f0-9]{64})  ([a-zA-Z_.-]+)', line)
        if not match or match[2] not in SOURCES or match[2] in records:
            raise Refused('activation-source-closure')
        records[match[2]] = match[1]
    if set(records) != set(SOURCES):
        raise Refused('activation-source-closure')
    for name, expected_hash in records.items():
        read_verified(directory / name, (0o400,), (0,), expected_hash)


def preparation_inputs():
    for directory in (PREPARATION.parent, PREPARATION, PREPARATION / 'original', PREPARATION / 'candidate'):
        private_directory(directory)
    approved = {
        PREPARATION: {'receipt.json', 'original', 'candidate'},
        PREPARATION / 'original': {f'{index:02d}-{Path(path).name}' for index, path in enumerate(PINS)},
        PREPARATION / 'candidate': set(CANDIDATES),
    }
    if any({entry.name for entry in directory.iterdir()} != names for directory, names in approved.items()):
        raise Refused('preparation-directory-closure')
    receipt, _ = read_verified(PREPARATION / 'receipt.json', (0o600,), (0,), OWNER_RECEIPT_SHA256)
    originals = {f'{index:02d}-{Path(path).name}': read_verified(
        PREPARATION / 'original' / f'{index:02d}-{Path(path).name}', (0o600,), (0,), expected)[0]
        for index, (path, expected) in enumerate(PINS.items())}
    candidates = {name: read_verified(PREPARATION / 'candidate' / name, (0o600,), (0,))[0] for name in CANDIDATES}
    proof = validate_preparation(receipt, originals, candidates)
    original_inventory, _ = read_verified(INVENTORY, (0o400, 0o600), (0,), limit=3000000)
    record = parse_json(receipt)
    if digest(original_inventory) != record['inventorySha256']:
        raise Refused('preparation-inventory-correlation')
    if inventory_summary(original_inventory) != record['invariants']:
        raise Refused('preparation-inventory-correlation')
    return proof


def readonly_probe(arguments):
    curl_prefix = ['/usr/bin/curl', '-q', '--silent', '--show-error', '--max-time', '5',
                   '--output', '/dev/null', '--write-out', '%{http_code}']
    allowed = (arguments[:len(curl_prefix)] == curl_prefix and len(arguments) == len(curl_prefix) + 1
               and re.fullmatch(r'http://172\.23\.0\.[34]:(9999/health|3000/)', arguments[-1]))
    allowed = allowed or (arguments[:4] == ['/usr/sbin/iptables', '-w', '5', '-C']
                          and arguments[4:] in [
                              ['INPUT', '-i', bridge, '-m', 'conntrack', '--ctstate', 'NEW',
                               '-m', 'comment', '--comment', 'baci-isolated-savings', '-j', 'DROP']
                              for bridge in ('baci-stg-db', 'baci-stg-mail')])
    if not allowed:
        raise Refused('non-readonly-command')
    result = subprocess.run(arguments, capture_output=True, timeout=10, env=ENVIRONMENT)
    accepted = (0, 1) if arguments[0] == '/usr/sbin/iptables' else (0,)
    if result.returncode not in accepted or len(result.stdout) > 256:
        raise Refused('activation-readonly-command')
    return result.returncode, result.stdout.decode().strip()


def upstream_inputs(identity):
    values, facts = {}, {}
    for service in ('auth', 'rest'):
        arguments = [*DOCKER, 'inspect', f'baci-isolated-savings-{service}-1']
        result = subprocess.run(arguments, capture_output=True, timeout=10, env=ENVIRONMENT)
        if result.returncode or len(result.stdout) > 262144:
            raise Refused('gateway-upstream-inspect')
        inspected = parse_json(result.stdout)
        if not isinstance(inspected, list) or len(inspected) != 1:
            raise Refused('gateway-upstream-inspect')
        values[service] = inspected[0]
        facts[service] = container_identity(inspected[0], identity, service)
        suffix = ':9999/health' if service == 'auth' else ':3000/'
        _, code = readonly_probe(['/usr/bin/curl', '-q', '--silent', '--show-error', '--max-time', '5',
                                  '--output', '/dev/null', '--write-out', '%{http_code}',
                                  'http://' + facts[service]['ip'] + suffix])
        facts[service]['healthHttp'] = int(code)
    entries = values['rest']['Config'].get('Env', [])
    secrets = [entry.removeprefix('PGRST_JWT_SECRET=') for entry in entries
               if isinstance(entry, str) and entry.startswith('PGRST_JWT_SECRET=')]
    if len(secrets) != 1:
        raise Refused('application-signing-configuration')
    return secrets[0], facts


def physical_snapshot():
    database = database_inventory('baci-isolated-savings-db-1', '/nix/var/nix/profiles/default/bin/psql',
                                  'postgres', 'renewal-inventory.sql', SYSTEM)
    receipts = database_inventory('pvb-staging-receipts-db', 'psql', 'supabase_admin',
                                  'renewal-receipt-inventory.sql', RECEIPT_SYSTEM)
    role = database_inventory('baci-isolated-savings-db-1', '/nix/var/nix/profiles/default/bin/psql',
                              'postgres', 'activation-funding-role.sql', SYSTEM)
    financial_fences(database)
    return database, receipts, role


def collect(directory, bundle_sha256):
    verified_bundle(directory, bundle_sha256)
    proof = preparation_inputs()
    now = int(time.time())
    if now >= TARGET_EPOCH:
        raise Refused('requested-deadline-expired')
    before = boundary_states()
    ingress, funding = [grp.getgrnam(name).gr_gid for name in ('baci-savings-ingress', 'baci-savings-funding')]
    contents, metadata = {}, {}
    for path, expected in PINS.items():
        modes, groups = source_policy(path, ingress, funding)
        contents[path], metadata[path] = read_verified(path, modes, groups, expected)
    identity = parse_json(contents[BINDING])['identity']
    signing_secret, upstream = upstream_inputs(identity)
    environment, environment_proof = funding_environment(contents[FUNDING_ENV])
    jwt_proofs = {
        'drafts': public_jwt(unit_anon_key(contents[UNIT_DIRECTORY + 'baci-savings-drafts.service']), signing_secret, now),
        'funding': public_jwt(environment['NEXT_PUBLIC_SUPABASE_ANON_KEY'], signing_secret, now),
    }
    database, receipts, role = physical_snapshot()
    role_proof = funding_role(role)
    firewall = []
    for bridge in ('baci-stg-db', 'baci-stg-mail'):
        status, _ = readonly_probe(['/usr/sbin/iptables', '-w', '5', '-C', 'INPUT', '-i', bridge,
                                    '-m', 'conntrack', '--ctstate', 'NEW', '-m', 'comment',
                                    '--comment', 'baci-isolated-savings', '-j', 'DROP'])
        firewall.append({'bridge': bridge, 'reviewedDropRulePresent': status == 0})
    graph = []
    for name in GRAPH:
        path = '/opt/baci-savings-gateway/' + name
        modes = (0o550,) if name == 'managed-inventory-helper.mjs' else (0o440, 0o444)
        content, info = read_verified(path, modes, (0, ingress), PINS.get(path))
        metadata[path] = info
        graph.append({'name': name, 'sha256': digest(content), 'uid': info.st_uid,
                      'gid': info.st_gid, 'mode': f'{stat.S_IMODE(info.st_mode):04o}', 'nlink': info.st_nlink})
    for path, info in metadata.items():
        unchanged(path, info)
    after_secret, after_upstream = upstream_inputs(identity)
    if (after_secret != signing_secret or after_upstream != upstream or boundary_states() != before
            or physical_snapshot() != (database, receipts, role) or int(time.time()) >= TARGET_EPOCH):
        raise Refused('activation-evidence-changed-during-read')
    return {'stage': 'lane-a-activation-evidence', 'status': 'review-required', 'readOnly': True,
            'observedAt': datetime.now(timezone.utc).isoformat(), 'requestedServiceDeadline': TARGET,
            'renewalApplied': False, 'liveChangesMade': False, 'databaseApplied': False,
            'newPaymentStarted': False, 'activationReady': False, 'preparation': proof,
            'currentFinancialFences': financial_fences(database), 'publicJwtProofs': jwt_proofs,
            'fundingEnvironment': environment_proof, 'fundingDatabaseRole': role_proof,
            'upstreams': upstream, 'firewall': firewall, 'gatewayGraph': graph,
            'serviceStates': before, 'databaseDeadlineFunctions': database.get('deadlineFunctions'),
            'interestBridge': database.get('interestBridge'), 'receiptDatabase': receipts,
            'financialReplayEnabled': False, 'authenticatedCustomerVerified': False}


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--bundle-sha256', required=True)
    arguments = parser.parse_args()
    try:
        report = collect(HERE, arguments.bundle_sha256)
        content = canonical(report)
        output = HERE / 'activation-evidence.json'
        write_private(output, content)
    except Exception as error:
        codes = {'preparation-inventory-correlation', 'preparation-directory-closure',
                 'funding-sandbox-scope', 'funding-required-credential',
                 'funding-role-unsafe-authority', 'public-jwt-signature', 'public-jwt-authority',
                 'gateway-upstream-identity', 'fresh-financial-fences', 'fresh-retirement-fences',
                 'activation-evidence-changed-during-read', 'source-metadata', 'source-pin'}
        codes.update(DISPLAY_CODES)
        codes.update({'preparation-record-invalid', 'funding-environment-duplicate-or-format',
                      'funding-environment-quoting', 'funding-unapproved-credential',
                      'application-signing-configuration', 'gateway-upstream-inspect',
                      'activation-source-closure', 'requested-deadline-expired'})
        code = error.args[0] if isinstance(error, Refused) and error.args and error.args[0] in codes else 'redacted-check'
        location = {'sourceModule': None, 'sourceLine': None}
        traceback = error.__traceback__
        while traceback is not None:
            filename = Path(traceback.tb_frame.f_code.co_filename).absolute()
            if filename.parent == HERE and filename.name in SOURCES:
                location.update(sourceModule=filename.name, sourceLine=traceback.tb_lineno)
            traceback = traceback.tb_next
        print(canonical({'stage': 'lane-a-activation-evidence', 'status': 'refused', 'reasonCode': code,
                         **location,
                         'readOnly': True, 'redacted': True, 'renewalApplied': False,
                         'databaseApplied': False, 'newPaymentStarted': False}).decode(), flush=True)
        return 1
    print(canonical({**report, 'reportPath': str(output), 'reportSha256': digest(content)}).decode(), flush=True)
    print('STAGING_ACTIVATION_EVIDENCE_READY', flush=True)
    return 0


if __name__ == '__main__':
    sys.exit(main())

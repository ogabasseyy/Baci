import argparse
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import time
import urllib.request
import uuid

spec = importlib.util.spec_from_file_location('provision', Path(__file__).with_name('provision.py'))
provision = importlib.util.module_from_spec(spec)
spec.loader.exec_module(provision)
ORIGIN = 'https://staging.piggyvest.business'


def sql(statement):
    result = subprocess.run([
        'docker', 'exec', '-i', 'baci-isolated-savings-db-1', 'psql', '-U', 'postgres',
        '-d', 'postgres', '-X', '-At', '-v', 'ON_ERROR_STOP=1',
    ], input=statement, text=True, capture_output=True, timeout=20)
    if result.returncode:
        raise RuntimeError('Isolated database operation refused')
    return result.stdout.strip()


def private_read(path):
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_nlink != 1 or metadata.st_mode & 0o077 or metadata.st_uid != os.getuid():
            raise RuntimeError('Unsafe private input')
        return json.loads(handle.read(65537))


def intake_config():
    path = Path('/home/bassey/pvb-staging-receipts/intake-config.json')
    directory = path.parent.lstat()
    if not stat.S_ISDIR(directory.st_mode) or directory.st_uid != os.getuid() or stat.S_IMODE(directory.st_mode) != 0o700:
        raise RuntimeError('Unsafe intake config directory')
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    with os.fdopen(descriptor) as handle:
        metadata = os.fstat(handle.fileno())
        if not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o444:
            raise RuntimeError('Intake credential mount contract changed')
        return json.loads(handle.read(65537))


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        raise RuntimeError('Provider redirect refused')


def parse_arguments(arguments=None):
    parser = argparse.ArgumentParser()
    parser.add_argument('--goal', required=True)
    parser.add_argument('--provision', action='store_true')
    parser.add_argument('--enable-interest-accrual', action='store_true')
    return parser.parse_args(arguments)


def main():
    args = parse_arguments()
    goal = str(uuid.UUID(args.goal))
    if time.time() >= provision.EXPIRY or sql('SELECT system_identifier::text FROM pg_control_system();') != provision.CLUSTER:
        raise RuntimeError('Staging identity or lease refused')
    scope_sql = f"""
    SELECT json_build_object('walletId', mapping.wallet_id,
      'providerCustomerId', mapping.piggyvest_customer_id,
      'existing', (SELECT provider_wallet_id FROM piggyvest_staging.wallet_goal_mappings
        WHERE integration_id='{provision.INTEGRATION}' AND merchant_id='{provision.MERCHANT}'
          AND customer_id='{provision.CUSTOMER}' AND goal_id='{goal}'))
    FROM public.piggyvest_plan_wallets mapping
    JOIN public.customer_savings_goals goal ON goal.customer_id=mapping.customer_id AND goal.merchant_id=mapping.merchant_id
    WHERE mapping.merchant_id='{provision.MERCHANT}' AND mapping.customer_id='{provision.CUSTOMER}'
      AND mapping.status='ready' AND goal.id='{goal}' AND goal.status='active' AND goal.source_mode='manual'
      AND EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits credit
        WHERE credit.wallet_id=mapping.wallet_id AND credit.customer_id=mapping.piggyvest_customer_id)
      AND EXISTS (SELECT 1 FROM piggyvest_staging.provisioning_integrations binding
        WHERE binding.integration_id='{provision.INTEGRATION}' AND binding.merchant_id=mapping.merchant_id
          AND binding.enabled AND binding.expected_provider_account_id='{provision.BUSINESS}');
    """
    source = json.loads(sql(scope_sql))
    secret = intake_config()['providerSecret']
    opener = urllib.request.build_opener(NoRedirect())

    def api(method, path, body=None):
        if time.time() >= provision.EXPIRY:
            raise RuntimeError('Staging lease expired')
        if method == 'POST' and json.loads(sql(scope_sql)) != source:
            raise RuntimeError('Scope changed before provider dispatch')
        request = urllib.request.Request(ORIGIN + path, method=method,
            data=None if body is None else json.dumps(body).encode(),
            headers={'Authorization': 'Bearer ' + secret, 'Content-Type': 'application/json',
                     'User-Agent': 'baci-staging-connection/1.0'})
        with opener.open(request, timeout=25) as response:
            raw = response.read(262145)
            if len(raw) > 262144:
                raise RuntimeError('Provider response too large')
            return json.loads(raw)

    old_wallet = api('GET', '/api/v1/wallet/' + provision.identifier(source['walletId']))['data']
    scope = {'apiCustomerId': provision.verify_source_wallet(old_wallet, source['walletId']),
             'businessId': provision.BUSINESS, 'name': provision.wallet_name(provision.INTEGRATION, goal)}
    if args.enable_interest_accrual:
        scope['enableInterestAccrual'] = True
        if source['existing']:
            existing_wallet = api('GET', '/api/v1/wallet/' + provision.identifier(source['existing']))['data']
            if provision.verify_wallet(existing_wallet, scope) != source['existing']:
                raise RuntimeError('Existing wallet identity changed')
    if not args.provision:
        print(json.dumps({'stage': 'read-only-preflight', 'goalId': goal, 'mapped': bool(source['existing'])}))
        return
    directory = Path('/home/bassey/.piggyvest-goal-provisioning')
    directory.mkdir(mode=0o700, exist_ok=True)
    metadata = directory.lstat()
    if not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != os.getuid() or metadata.st_mode & 0o077:
        raise RuntimeError('Unsafe journal directory')
    import fcntl
    lock = os.open(directory / f'{goal}.lock', os.O_WRONLY | os.O_CREAT | os.O_NOFOLLOW, 0o600)
    fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    path = directory / f'{goal}.json'

    def save(value):
        temporary = directory / f'{goal}.{uuid.uuid4()}.tmp'
        descriptor = os.open(temporary, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(descriptor, 'w') as handle:
            json.dump(value, handle)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
        descriptor = os.open(directory, os.O_RDONLY | os.O_DIRECTORY)
        try:
            os.fsync(descriptor)
        finally:
            os.close(descriptor)

    journal = private_read(path) if path.exists() else {'phase': 'prepared', 'goalId': goal, 'scope': scope}
    if journal.get('goalId') != goal or journal.get('scope') != scope:
        raise RuntimeError('Journal identity mismatch')
    wallet_id = source['existing'] or provision.ensure_wallet(api, scope, journal, save)
    verified_wallet = api('GET', '/api/v1/wallet/' + provision.identifier(wallet_id))['data']
    wallet_id = provision.verify_wallet(verified_wallet, scope)
    provider_customer = provision.identifier(source['providerCustomerId'])
    if json.loads(sql(scope_sql)) != source:
        raise RuntimeError('Mapping changed during provider request')
    statement = f"""BEGIN;
    DO $$ BEGIN IF (SELECT system_identifier::text FROM pg_control_system()) <> '{provision.CLUSTER}'
      OR extract(epoch FROM clock_timestamp()) >= {provision.EXPIRY} THEN RAISE EXCEPTION 'Staging refused'; END IF; END $$;
    SELECT id FROM public.customer_savings_goals WHERE id='{goal}' FOR UPDATE;
    DO $$ BEGIN
      PERFORM mapping.id FROM public.piggyvest_plan_wallets mapping
        JOIN piggyvest_staging.provisioning_integrations binding ON binding.merchant_id=mapping.merchant_id
        WHERE mapping.merchant_id='{provision.MERCHANT}' AND mapping.customer_id='{provision.CUSTOMER}'
          AND mapping.wallet_id='{provision.identifier(source['walletId'])}' AND mapping.piggyvest_customer_id='{provider_customer}'
          AND mapping.status='ready' AND binding.integration_id='{provision.INTEGRATION}' AND binding.enabled
          AND binding.expected_provider_account_id='{provision.BUSINESS}'
          AND EXISTS (SELECT 1 FROM public.piggyvest_inflow_credits credit
            WHERE credit.wallet_id=mapping.wallet_id AND credit.customer_id=mapping.piggyvest_customer_id)
        FOR SHARE OF mapping, binding;
      IF NOT FOUND THEN RAISE EXCEPTION 'Verified source binding changed'; END IF;
    END $$;
    INSERT INTO piggyvest_staging.wallet_goal_mappings
      (integration_id,provider_wallet_id,provider_customer_id,merchant_id,customer_id,goal_id)
    SELECT '{provision.INTEGRATION}','{wallet_id}','{provider_customer}','{provision.MERCHANT}','{provision.CUSTOMER}','{goal}'
    FROM public.customer_savings_goals WHERE id='{goal}' AND merchant_id='{provision.MERCHANT}'
      AND customer_id='{provision.CUSTOMER}' AND status='active' AND source_mode='manual'
    ON CONFLICT DO NOTHING;
    COMMIT;"""
    sql(statement)
    if json.loads(sql(scope_sql))['existing'] != wallet_id:
        raise RuntimeError('Goal mapping not established')
    save({**journal, 'phase': 'verified', 'providerWalletId': wallet_id, 'providerCustomerId': provider_customer,
          'enableInterestAccrual': args.enable_interest_accrual})
    print(json.dumps({'stage': 'goal-wallet-linked', 'goalId': goal, 'providerWalletId': wallet_id,
                      'balanceKobo': verified_wallet.get('balance'), 'fundingNotPerformed': True}))


if __name__ == '__main__':
    try:
        main()
    except Exception as error:
        print(json.dumps({'stage': 'provision-refused', 'errorType': type(error).__name__}))
        raise SystemExit(1) from None

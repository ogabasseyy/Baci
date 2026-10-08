import hashlib
import importlib.util
import json
import os
from pathlib import Path
import stat
import subprocess
import tempfile


PROVIDER_SOURCE = Path('/home/bassey/baci-interest-confirm-20261001.o5wK6hku/provider_interest_check.py')
PROVIDER_PIN = '900b18bc7b25823a8ea36a663ee856a64eb8d37511502b45a3d5d9659ba365b1'
ENVIRONMENT = dict(HOME='/root', PATH='/usr/sbin:/usr/bin:/sbin:/bin', LANG='C', LC_ALL='C')
SQL = """BEGIN READ ONLY;
SET LOCAL statement_timeout='15s';
SELECT jsonb_build_object(
 'systemIdentifier',(SELECT system_identifier::text FROM pg_control_system()),
 'readOnly',current_setting('transaction_read_only')='on',
 'goals',(SELECT jsonb_agg(to_jsonb(goal)) FROM (
   SELECT id,merchant_id,customer_id,status,current_amount,target_amount,source_mode,metadata
   FROM public.customer_savings_goals WHERE customer_id='10000000-0000-4000-8000-000000000002'
   ORDER BY id) goal),
 'bindings',(SELECT jsonb_agg(to_jsonb(binding)) FROM (
   SELECT integration_id,merchant_id,customer_id,goal_id,authorized_login,enabled
   FROM piggyvest_savings_ledger.bindings ORDER BY goal_id) binding),
 'columns',(SELECT jsonb_agg(jsonb_build_object('schema',table_schema,'table',table_name,
   'column',column_name,'type',data_type) ORDER BY table_schema,table_name,ordinal_position)
   FROM information_schema.columns WHERE table_schema='piggyvest_staging'
   AND table_name IN ('wallet_mappings','customer_mappings','provisioning_intents','integrations')),
 'routines',(SELECT jsonb_agg(jsonb_build_object('signature',routine.oid::regprocedure::text,
   'owner',pg_get_userbyid(proowner),'definer',prosecdef,'bodyMd5',md5(prosrc),
   'configuration',proconfig,'acl',proacl::text) ORDER BY routine.oid)
   FROM pg_proc routine JOIN pg_namespace namespace ON namespace.oid=pronamespace
   WHERE namespace.nspname IN ('savings_notifications','piggyvest_savings_ledger','prefunded_card')),
 'roles',(SELECT jsonb_agg(jsonb_build_object('name',rolname,'login',rolcanlogin,'inherit',rolinherit,
   'unsafe',rolsuper OR rolbypassrls OR rolcreaterole OR rolcreatedb OR rolreplication,
   'expiresAt',rolvaliduntil,'memberships',(SELECT count(*) FROM pg_auth_members WHERE member=role.oid)))
   FROM pg_roles role WHERE rolname IN ('baci_savings_notifications_worker','prefunded_treasury_operator')),
 'principalKobo',(SELECT current_amount*100 FROM public.customer_savings_goals
   WHERE id='430314fd-cd8b-4579-98d4-e9f345713dd6'),
 'policies',(SELECT count(*) FROM piggyvest_savings_ledger.interest_policies),
 'paidReceipts',(SELECT count(*) FROM piggyvest_savings_ledger.interest_receipts),
 'treasury',(SELECT jsonb_build_object('available',verified_available_kobo,'reserved',reserved_kobo,
   'consumed',consumed_kobo) FROM prefunded_card.treasury_bindings
   WHERE id='ffffcb16-2e95-5cff-a591-e9cc81cf5f57'),
 'retired',(SELECT phase FROM prefunded_card.checkout_intents
   WHERE id='d8bcf921-61b3-4647-90e2-5648e4d6967d'));
ROLLBACK;
"""
FILES = (
 '/etc/baci/prefunded-card/activation.prepared.json',
 '/opt/baci-prefunded-public/config/checkout.json',
 '/opt/baci-prefunded-public/receipt.json',
 '/opt/baci-prefunded-public/app/launch-public.cjs',
 '/opt/baci-prefunded-workers/config/background.json',
 '/opt/baci-prefunded-workers/config/snapshot.json',
 '/opt/baci-prefunded-workers/code/background.cjs',
 '/opt/baci-prefunded-workers/code/snapshot.cjs',
 '/root/baci-interest-readiness.e4yrt2wn/interest-config.json',
 '/root/baci-interest-proof.dski7oy5/replay-daemon.mjs',
)


def execute(arguments, source=None):
    return subprocess.run(arguments, input=source, text=True, capture_output=True,
                          check=True, timeout=30, env=ENVIRONMENT).stdout.strip()


def wallet_summary(helper, data):
    summary = helper.summarize_wallet(data, data['id'])
    if data.get('type') != 'api':
        raise ValueError('wallet-type')
    for key in ('api_customer_id', 'customer_id', 'wallet_id', 'type'):
        value = data.get(key)
        if value is not None and not isinstance(value, str):
            raise ValueError('wallet-identifier-shape')
        summary[key] = value
    return summary


def inspect_file(name):
    path = Path(name)
    descriptor = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    with os.fdopen(descriptor, 'rb') as stream:
        info = os.fstat(stream.fileno())
        if not stat.S_ISREG(info.st_mode) or info.st_nlink != 1 or info.st_size > 2000000:
            raise ValueError('file-metadata')
        data = stream.read(2000001)
    return dict(path=name, owner=info.st_uid, mode=oct(stat.S_IMODE(info.st_mode)),
                sha256=hashlib.sha256(data).hexdigest(), size=len(data),
                oldDeadlineMentions=data.count(b'2026-09-29T15:59:10'))


def run():
    if os.geteuid() != 0:
        raise ValueError('root-required')
    os.umask(0o077)
    audit = Path(tempfile.mkdtemp(prefix='baci-activation-inventory.', dir='/root'))
    data = PROVIDER_SOURCE.read_bytes()
    if hashlib.sha256(data).hexdigest() != PROVIDER_PIN:
        raise ValueError('provider-helper-pin')
    helper_path = audit / 'provider-check.py'
    helper_path.write_bytes(data)
    specification = importlib.util.spec_from_file_location('provider_check', helper_path)
    helper = importlib.util.module_from_spec(specification)
    specification.loader.exec_module(helper)
    provider = helper.read_configuration()
    listed, cursor = helper.page_rows(helper.request(provider, '/api/v1/wallet/api/wallet-type?limit=100'), True)
    if cursor is not None or len(listed) > 20:
        raise ValueError('wallet-list-incomplete')
    wallets = [wallet_summary(helper, helper.request(provider, '/api/v1/wallet/'+row['id']))
               for row in listed]
    database = json.loads(execute(['/usr/bin/docker', 'exec', '-i', 'baci-isolated-savings-db-1',
        'psql', '-XqAt', '-U', 'supabase_admin', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], SQL))
    if database['systemIdentifier'] != '7685292944002592802' or not database['readOnly']:
        raise ValueError('physical-database')
    report = dict(readOnly=True, changesMade=False, database=database, wallets=wallets,
                  files=[inspect_file(name) for name in FILES])
    encoded = json.dumps(report, sort_keys=True, default=str)+'\n'
    (audit / 'result.json').write_text(encoded)
    output_dir = Path(tempfile.mkdtemp(prefix='baci-activation-inventory.', dir='/home/bassey'))
    output = output_dir / 'result.json'
    output.write_text(encoded)
    os.chmod(output, 0o600)
    os.chown(output, 1001, 1001)
    os.chown(output_dir, 1001, 1001)
    print(json.dumps(dict(status='activation-inventory-ready', readOnly=True, changesMade=False,
                         output=str(output), wallets=len(wallets))))


if __name__ == '__main__':
    try:
        run()
    except Exception as error:
        print(json.dumps(dict(status='refused', readOnly=True, changesMade=False,
                             errorType=type(error).__name__, redacted=True)))
        raise SystemExit(1)

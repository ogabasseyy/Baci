import hashlib
import json
import re
from treasury_owner_contract import Refused


SYSTEM = '7686901100561231906'
BASELINE = '65e8f310f1fd71d3eca1e89d6f0b9da8b4800e26deb6ba626e5845a31c51fb0a'
IMAGE = 'sha256:2fe369e969550cde8e867afc3fe370b260140cab4a23d467074295b42163d553'
DIRECTORY = '/home/bassey/pvb-staging-receipts'
SERVER = DIRECTORY + '/intake-server.mjs'
FILES = ('receipt-provenance-owner.py', 'receipt_provenance_contract.py', 'receipt_provenance_artifact.py', 'treasury_owner_contract.py',
         'treasury_owner_io.py', 'receipt-signature-storage.sql', 'intake-server.mjs')


def validate_container(value):
    mounts = {entry['Destination']: (entry['Source'], entry['RW'], entry['Type'])
              for entry in value.get('Mounts', [])}
    expected = {'/app/intake-server.mjs': (SERVER, False, 'bind'),
                '/run/pvb-intake/config.json': (DIRECTORY + '/intake-config.json', False, 'bind')}
    host = value.get('HostConfig', {})
    config = value.get('Config', {})
    if (value.get('Image') != IMAGE or value.get('State', {}).get('Running') is not True
            or config.get('User') != '65532:65532' or config.get('Cmd') != ['node', '/app/intake-server.mjs']
            or mounts != expected or len(value.get('Mounts', [])) != 2
            or host.get('ReadonlyRootfs') is not True or host.get('Privileged') is not False
            or host.get('CapDrop') != ['ALL'] or host.get('SecurityOpt') != ['no-new-privileges:true']
            or host.get('PortBindings') != {'4791/tcp': [{'HostIp': '127.0.0.1', 'HostPort': '4791'}]}
            or set(value.get('NetworkSettings', {}).get('Networks', {})) !=
            {'pvb-staging-intake-ingress', 'pvb-staging-receipts'}):
        raise Refused('Intake container differs from reviewed baseline')


def validate_manifest(value, read):
    if not isinstance(value, dict) or set(value) != set(FILES):
        raise Refused('Unexpected receipt owner bundle')
    contents = {}
    for name in FILES:
        content = read(name)
        if not re.fullmatch(r'[a-f0-9]{64}', value[name]) or hashlib.sha256(content).hexdigest() != value[name]:
            raise Refused('Receipt owner bundle hash mismatch')
        contents[name] = content
    return contents


def schema_query():
    return """SELECT json_build_object('system',(SELECT system_identifier::text FROM pg_control_system()),
      'table',to_regclass('public.piggyvest_staging_receipt_signatures') IS NOT NULL,
      'functions',(SELECT coalesce(json_agg(json_build_object('name',proname,'body',prosrc,
        'owner',pg_get_userbyid(proowner),'definer',prosecdef,'config',proconfig)),'[]'::json)
        FROM pg_proc WHERE pronamespace='public'::regnamespace
        AND proname IN ('accept_signed_piggyvest_staging_receipt','read_piggyvest_staging_receipt_signature')),
      'safeTable',coalesce((SELECT relrowsecurity AND relforcerowsecurity AND relowner='supabase_admin'::regrole
        FROM pg_class WHERE oid=to_regclass('public.piggyvest_staging_receipt_signatures')),false),
      'columns',(SELECT json_agg(attname ORDER BY attnum) FROM pg_attribute
        WHERE attrelid=to_regclass('public.piggyvest_staging_receipt_signatures') AND attnum>0 AND NOT attisdropped),
      'safeRoles',(SELECT count(*)=3 AND bool_and(NOT (rolcanlogin OR rolinherit OR rolsuper
        OR rolcreatedb OR rolcreaterole OR rolreplication OR rolbypassrls)) FROM pg_roles
        WHERE rolname IN ('pvb_staging_ingest','pvb_staging_worker','pvb_staging_replay_executor')),
      'safeGrants',CASE WHEN to_regclass('public.piggyvest_staging_receipt_signatures') IS NULL THEN false ELSE
        NOT has_any_column_privilege('pvb_staging_worker','public.piggyvest_staging_receipt_signatures','SELECT,INSERT,UPDATE,REFERENCES')
        AND NOT has_table_privilege('pvb_staging_ingest','public.piggyvest_staging_receipt_signatures','UPDATE,DELETE,TRUNCATE,TRIGGER')
        AND NOT has_any_column_privilege('pvb_staging_ingest','public.piggyvest_staging_receipt_signatures','UPDATE')
        AND NOT EXISTS(SELECT FROM pg_proc proc,LATERAL aclexplode(coalesce(proc.proacl,acldefault('f',proc.proowner))) permission
          WHERE proc.pronamespace='public'::regnamespace AND (
            (proc.proname='accept_signed_piggyvest_staging_receipt'
              AND permission.grantee NOT IN ('supabase_admin'::regrole,'pvb_staging_ingest'::regrole))
            OR (proc.proname='read_piggyvest_staging_receipt_signature'
              AND permission.grantee NOT IN ('pvb_staging_replay_executor'::regrole,'pvb_staging_worker'::regrole))))
        AND has_function_privilege('pvb_staging_ingest','public.accept_signed_piggyvest_staging_receipt(text,text,text,text,text,text)','EXECUTE')
        AND has_function_privilege('pvb_staging_worker','public.read_piggyvest_staging_receipt_signature(uuid,text,uuid)','EXECUTE') END);"""


def validate_schema(value, source):
    expected = dict(re.findall(r'CREATE FUNCTION public\.(\w+)\([\s\S]*?AS \$\$([\s\S]*?)\$\$;', source))
    if (value.get('system') != SYSTEM or value.get('table') is not True or value.get('safeTable') is not True
            or value.get('safeRoles') is not True or value.get('safeGrants') is not True
            or value.get('columns') != ['receipt_id', 'payload_sha256', 'provider_signature', 'received_at']
            or len(expected) != 2 or len(value.get('functions', [])) != 2):
        raise Refused('Receipt signature schema differs')
    observed = {entry.get('name') for entry in value['functions']}
    if observed != set(expected):
        raise Refused('Receipt signature function identities differ')
    for entry in value['functions']:
        reader = entry['name'] == 'read_piggyvest_staging_receipt_signature'
        if (entry['body'] != expected[entry['name']] or entry['definer'] is not reader
                or entry['owner'] != ('pvb_staging_replay_executor' if reader else 'supabase_admin')
                or entry['config'] != ['search_path=pg_catalog']):
            raise Refused('Receipt signature function attributes differ')
    return True


def parse_json(content):
    try:
        return json.loads(content)
    except (ValueError, TypeError):
        raise Refused('Invalid private receipt owner input') from None

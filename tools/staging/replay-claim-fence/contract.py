import hashlib
from datetime import datetime, timezone


SYSTEM_IDENTIFIER = '7686901100561231906'
DATABASE = 'postgres'
INSTALLER_LOGIN = 'supabase_admin'
SIGNATURE = 'public.claim_piggyvest_staging_receipts(integer,integer)'
ROUTINE_OID = 16487
OWNER = 'pvb_staging_replay_executor'
ACL = ['pvb_staging_replay_executor=X/pvb_staging_replay_executor',
       'pvb_staging_worker=X/pvb_staging_replay_executor']
BODY_SHA256 = '3e60a019e83ae140dd6d35fc6f378292e8f672d8b2d209fee18b22c8be671cdc'
DEFINITION_SHA256 = '650e050f359e295abc9bcb306f33a05afa3ffa14bc128f4a7b3b93faaaa5b824'
GENERATION = '1a420a7b-0c17-4312-84dc-d276a32f19f4'
CLAIM_KEY = 'replay_claimant_generation'
ROLE = 'pvb_staging_worker'
AUDIENCE = 'pvb-staging-receipts'
DEADLINE = '2026-10-06T15:59:10Z'
EXPIRY = 1791302350
POSTGREST_CONFIGURATION_SHA256 = '09d635769e8f79ec5f2051fe58584e35bf086cfad579741ef4cccf44b366e149'


def sha256(source):
    return hashlib.sha256(source.encode('utf-8')).hexdigest()


def require(condition, code):
    if not condition:
        raise ValueError(code)


def validate(original_definition, mode):
    require(mode in ('rollback', 'commit'), 'transaction_mode_refused')
    require(datetime.now(timezone.utc).timestamp() < EXPIRY, 'deadline_expired')
    require(isinstance(original_definition, str)
            and sha256(original_definition) == DEFINITION_SHA256, 'definition_pin_refused')
    require(original_definition.count('$function$') == 2, 'definition_framing_refused')
    body = original_definition.split('$function$')[1]
    require(sha256(body) == BODY_SHA256 and body.startswith('\nBEGIN\n')
            and body.count('\nBEGIN\n') == 1, 'body_pin_refused')
    return body

import hashlib
import json
import shlex

from treasury_owner_contract import DEADLINE_EPOCH, MERCHANT, SYSTEM, Refused


EMAIL = 'baci-staging@example.com'
OLD_EMAIL_SHA = '67601cb2e06312a03c13c0b318f7d7e5431a1d4695748a708f314f13cd4954c1'
ACTOR = 'baeb4f5a-54c7-4d46-8b07-9e69ab2907b3'
CUSTOMER = '10000000-0000-4000-8000-000000000002'
GOAL = '430314fd-cd8b-4579-98d4-e9f345713dd6'
PUBLIC_KEY_SHA = '1065d3a5c300f1d3ba3d6c42cbe0524128c57cc2032a4345bff4100cb6f7a3f2'
ORIGIN = 'https://staging-auth.ogabassey.com'


def digest(value):
    return hashlib.sha256(value).hexdigest()


def fixture(content):
    values = {}
    lines = content.decode().splitlines(keepends=True)
    for line in lines:
        if line.startswith(('STAGING_PHONE_EMAIL=', 'STAGING_PHONE_PASSWORD=')):
            name, raw = line.rstrip('\r\n').split('=', 1)
            parsed = shlex.split(raw)
            if name in values or len(parsed) != 1 or not parsed[0]:
                raise Refused('Phone fixture shape refused')
            values[name] = parsed[0]
    email = values.get('STAGING_PHONE_EMAIL', '')
    if (not values.get('STAGING_PHONE_PASSWORD') or
            email != EMAIL and digest(email.encode()) != OLD_EMAIL_SHA):
        raise Refused('Phone fixture identity refused')
    updated = ''.join('STAGING_PHONE_EMAIL=' + EMAIL + ('\r\n' if line.endswith('\r\n') else '\n')
                      if line.startswith('STAGING_PHONE_EMAIL=') else line for line in lines).encode()
    return values, updated


def profile(content):
    value = json.loads(content)
    expected = dict(mode='hosted-staging', apiOrigin='https://staging.ogabassey.com',
                    supabaseOrigin=ORIGIN, expectedAuthIssuer=ORIGIN + '/auth/v1', merchantId=MERCHANT)
    if (any(value.get(key) != item for key, item in expected.items()) or
            digest(value.get('publicKey', '').encode()) != PUBLIC_KEY_SHA):
        raise Refused('Staging public profile refused')
    return value['publicKey']


def validate(report, baseline=None, final=False):
    if (report.get('scope') is not True or report.get('collision') is not False or
            report.get('authId') != ACTOR or report.get('identityCount') != 1 or
            report.get('identityMatches') is not True or report.get('principalKobo') != 10000):
        raise Refused('Synthetic account scope refused')
    allowed = {digest(EMAIL.encode())} if final else {OLD_EMAIL_SHA, digest(EMAIL.encode())}
    if report.get('authEmailSha') not in allowed or report.get('customerEmailSha') not in allowed:
        raise Refused('Synthetic account email drift refused')
    if baseline is not None and report.get('protected') != baseline:
        raise Refused('Password or financial state changed; no payment recovery performed')


def snapshot_sql():
    return f"""SELECT jsonb_build_object(
      'scope', current_database()='postgres' AND clock_timestamp()<to_timestamp({DEADLINE_EPOCH})
        AND (SELECT system_identifier::text FROM pg_control_system())='{SYSTEM}'
        AND (SELECT count(*) FROM public.customers WHERE user_id='{ACTOR}')=1,
      'authId', account.id, 'authEmailSha', encode(sha256(convert_to(account.email,'UTF8')),'hex'),
      'customerEmailSha', encode(sha256(convert_to(customer.email,'UTF8')),'hex'),
      'identityCount', (SELECT count(*) FROM auth.identities WHERE user_id=account.id),
      'identityMatches', EXISTS(SELECT 1 FROM auth.identities WHERE user_id=account.id
        AND provider='email' AND identity_data->>'email'=account.email),
      'collision', EXISTS(SELECT 1 FROM auth.users WHERE lower(email)='{EMAIL}' AND id<>account.id)
        OR EXISTS(SELECT 1 FROM public.customers WHERE lower(email)='{EMAIL}' AND id<>customer.id)
        OR EXISTS(SELECT 1 FROM auth.identities WHERE lower(identity_data->>'email')='{EMAIL}' AND user_id<>account.id),
      'principalKobo', goal.current_amount*100,
      'protected', encode(sha256(convert_to(jsonb_build_object(
        'password', encode(sha256(convert_to(account.encrypted_password,'UTF8')),'hex'),
        'goal', jsonb_build_array(goal.id,goal.merchant_id,goal.customer_id,goal.current_amount,goal.target_amount,goal.status),
        'intent', (SELECT jsonb_agg(jsonb_build_array(id,operation_id,email,phase,amount_kobo,reference,
          session_authorization_url,verified_collection) ORDER BY id) FROM prefunded_card.checkout_intents
          WHERE customer_id=customer.id AND merchant_id=customer.merchant_id),
        'treasury', (SELECT jsonb_agg(jsonb_build_array(id,reserved_kobo,consumed_kobo) ORDER BY id)
          FROM prefunded_card.treasury_bindings WHERE merchant_id=customer.merchant_id),
        'operations', (SELECT jsonb_agg(jsonb_build_array(id,collection_status,collection_provider_transaction_id,
          transfer_status,projection_status,amount_kobo) ORDER BY id) FROM prefunded_card.operations
          WHERE customer_id=customer.id AND merchant_id=customer.merchant_id))::text,'UTF8')),'hex'))
      FROM public.customers customer JOIN auth.users account ON account.id=customer.user_id
      JOIN public.customer_savings_goals goal ON goal.customer_id=customer.id AND goal.merchant_id=customer.merchant_id
      WHERE customer.id='{CUSTOMER}' AND customer.merchant_id='{MERCHANT}' AND account.id='{ACTOR}'
        AND goal.id='{GOAL}';"""


def customer_update_sql():
    return f"""BEGIN;
    SET LOCAL statement_timeout='5s'; SET LOCAL lock_timeout='3s';
    DO $email$ DECLARE affected integer; BEGIN
      IF (SELECT system_identifier::text FROM pg_control_system())<>'{SYSTEM}'
        OR current_database()<>'postgres' OR clock_timestamp()>=to_timestamp({DEADLINE_EPOCH})
        OR NOT EXISTS(SELECT 1 FROM auth.users WHERE id='{ACTOR}' AND email='{EMAIL}')
        OR EXISTS(SELECT 1 FROM public.customers WHERE lower(email)='{EMAIL}' AND id<>'{CUSTOMER}')
      THEN RAISE EXCEPTION 'email scope refused'; END IF;
      UPDATE public.customers SET email='{EMAIL}'
        WHERE id='{CUSTOMER}' AND merchant_id='{MERCHANT}' AND user_id='{ACTOR}'
          AND (email='{EMAIL}' OR encode(sha256(convert_to(email,'UTF8')),'hex')='{OLD_EMAIL_SHA}');
      GET DIAGNOSTICS affected = ROW_COUNT;
      IF affected<>1 THEN RAISE EXCEPTION 'email identity drift'; END IF;
    END $email$;
    COMMIT;"""

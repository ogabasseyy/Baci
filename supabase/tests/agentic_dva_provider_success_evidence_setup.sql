-- Runs after the dispatch-fence disposable fixture. No checkout_sessions row
-- is created for this hold: evidence ownership must come from the signed
-- attestation and the immutable private hold, not session metadata.
BEGIN;
CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
$$;
CREATE OR REPLACE FUNCTION auth.role() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT coalesce(auth.jwt() ->> 'role', current_setting('role', true))
$$;

DO $$
BEGIN
  IF NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_roles role
       WHERE role.rolname = 'agentic_dva_provider_evidence_writer'
         AND NOT role.rolcanlogin AND NOT role.rolinherit
         AND NOT role.rolsuper AND NOT role.rolcreatedb
         AND NOT role.rolcreaterole AND NOT role.rolreplication
         AND NOT role.rolbypassrls
     ) OR EXISTS (
       SELECT 1 FROM pg_catalog.pg_auth_members membership
       JOIN pg_catalog.pg_roles role
         ON role.oid = membership.roleid OR role.oid = membership.member
       WHERE role.rolname = 'agentic_dva_provider_evidence_writer'
     ) THEN
    RAISE EXCEPTION 'provider evidence writer must be a fresh dormant role without memberships';
  END IF;
  IF has_function_privilege(
       'anon',
       'public.commerce_cart_persist_agentic_dva_provider_success(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticated',
       'public.commerce_cart_persist_agentic_dva_provider_success(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'authenticator',
       'public.commerce_cart_persist_agentic_dva_provider_success(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     OR has_function_privilege(
       'service_role',
       'public.commerce_cart_persist_agentic_dva_provider_success(uuid,text,text,text,text,text,text)',
       'EXECUTE'
     )
     OR pg_catalog.pg_has_role('authenticated', 'agentic_dva_provider_evidence_writer', 'MEMBER')
     OR pg_catalog.pg_has_role('service_role', 'agentic_dva_provider_evidence_writer', 'MEMBER')
     OR pg_catalog.pg_has_role('authenticator', 'agentic_dva_provider_evidence_writer', 'MEMBER')
     OR has_table_privilege(
       'agentic_dva_provider_evidence_writer',
       'private.agentic_cart_dispatch_provider_evidence',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION 'provider evidence role privileges are not narrowly scoped';
  END IF;
  IF NOT (SELECT relrowsecurity
          FROM pg_catalog.pg_class
          WHERE oid='private.agentic_cart_dispatch_provider_evidence'::regclass) THEN
    RAISE EXCEPTION 'provider evidence table must enable RLS';
  END IF;
END $$;

-- Until gateway role issuance is deployed and verified, PostgREST's
-- authenticator must not be able to assume the dormant evidence writer role.
DO $$
BEGIN
  IF pg_catalog.pg_has_role('authenticator', 'agentic_dva_provider_evidence_writer', 'MEMBER') THEN
    RAISE EXCEPTION 'authenticator can assume dormant DVA evidence role';
  END IF;
END $$;

INSERT INTO public.commerce_carts(id,merchant_id,version,state,expires_at)
VALUES ('f5f5f5f5-5555-4555-8555-000000000031','11111111-1111-4111-8111-111111111111',1,'active',now()+interval '1 day');
INSERT INTO public.commerce_cart_grants(id,merchant_id,cart_id,principal_id,principal_type,expires_at)
VALUES ('f5f5f5f5-5555-4555-8555-000000000032','11111111-1111-4111-8111-111111111111','f5f5f5f5-5555-4555-8555-000000000031','evidence-principal','guest',now()+interval '1 day');
INSERT INTO public.commerce_cart_checkout_sessions(id,merchant_id,cart_id,checkout_generation,cart_version_reviewed,principal_id,status,expires_at,preparing_grant_id)
VALUES ('f5f5f5f5-5555-4555-8555-000000000033','11111111-1111-4111-8111-111111111111','f5f5f5f5-5555-4555-8555-000000000031',9,1,'evidence-principal','active',now()+interval '1 day','f5f5f5f5-5555-4555-8555-000000000032');
INSERT INTO private.agentic_cart_dispatch_holds(
  id,merchant_id,cart_id,checkout_session_id,checkout_generation,
  cart_version,principal_id,claim_reference
) VALUES (
  'f5f5f5f5-5555-4555-8555-000000000034',
  '11111111-1111-4111-8111-111111111111',
  'f5f5f5f5-5555-4555-8555-000000000031',
  'f5f5f5f5-5555-4555-8555-000000000033',
  9,1,'evidence-principal','provider-evidence-claim-1'
);

-- A mutable authenticated checkout row, even if it claims this reference and
-- a different account, cannot authorize evidence persistence.
INSERT INTO public.checkout_sessions(
  id,session_id,merchant_id,status,metadata,payment_reference,
  order_id,virtual_account_number
) VALUES (
  'f5f5f5f5-5555-4555-8555-000000000035',
  'mutable-evidence-session','11111111-1111-4111-8111-111111111111',
  'processing','{"agentic":{"payment_state":"claiming_payment"}}',
  'provider-evidence-claim-1',NULL,'9999999999'
);

-- Disabled rollout rejects even an otherwise valid-looking attestation.
UPDATE private.agentic_cart_dispatch_rollout SET enabled=false WHERE singleton;
SET ROLE agentic_dva_provider_evidence_writer;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','agentic_dva_provider_evidence_writer','aud','authenticated',
  'iat',extract(epoch FROM clock_timestamp())::bigint,
  'exp',extract(epoch FROM clock_timestamp())::bigint+30,
  'jti','f5f5f5f5-5555-4555-8555-000000000036',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000036',
    'hold_id','f5f5f5f5-5555-4555-8555-000000000034',
    'claim_reference','provider-evidence-claim-1',
    'account_number','0123456789','account_name','Trusted Provider Account',
    'bank_name','Provider Bank','currency','NGN',
    'subaccount_code','ACCT_123456789012345',
    'provider_status','success','assigned','true'
  ))::text,true);
DO $$ DECLARE r jsonb;
BEGIN
  r:=public.commerce_cart_persist_agentic_dva_provider_success(
    'f5f5f5f5-5555-4555-8555-000000000034','provider-evidence-claim-1',
    '0123456789','Trusted Provider Account','Provider Bank','NGN','ACCT_123456789012345');
  IF r->>'status' IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'disabled evidence rollout persisted provider success: %',r;
  END IF;
END $$;
RESET ROLE;
UPDATE private.agentic_cart_dispatch_rollout SET enabled=true WHERE singleton;

-- Ordinary authenticated callers cannot use the writer RPC, even with a
-- forged mutable checkout row and a caller-supplied attestation-shaped claim.
RESET ROLE;
SET ROLE authenticated;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','authenticated','aud','authenticated',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000036',
    'hold_id','f5f5f5f5-5555-4555-8555-000000000034',
    'claim_reference','provider-evidence-claim-1',
    'account_number','9999999999','account_name','Forged Account',
    'bank_name','Forged Bank','currency','NGN',
    'subaccount_code','ACCT_123456789012345',
    'provider_status','success','assigned','true'
  ))::text,true);
DO $$
BEGIN
  BEGIN
    PERFORM public.commerce_cart_persist_agentic_dva_provider_success(
      'f5f5f5f5-5555-4555-8555-000000000034','provider-evidence-claim-1',
      '9999999999','Forged Account','Forged Bank','NGN','ACCT_123456789012345');
    RAISE EXCEPTION 'authenticated caller executed evidence writer';
  EXCEPTION WHEN insufficient_privilege THEN
    NULL;
  END;
END $$;
RESET ROLE;

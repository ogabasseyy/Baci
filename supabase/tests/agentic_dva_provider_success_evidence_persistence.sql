-- Valid server-signed claims persist once. Evidence copies its scope from the
-- locked hold, not checkout_sessions. The mutable row's fake account is not
-- consulted and cannot replace the attested provider account.
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
  IF r->>'status' IS DISTINCT FROM 'persisted' THEN
    RAISE EXCEPTION 'valid provider evidence did not persist: %',r;
  END IF;
  r:=public.commerce_cart_persist_agentic_dva_provider_success(
    'f5f5f5f5-5555-4555-8555-000000000034','provider-evidence-claim-1',
    '0123456789','Trusted Provider Account','Provider Bank','NGN','ACCT_123456789012345');
  IF r->>'status' IS DISTINCT FROM 'existing' THEN
    RAISE EXCEPTION 'exact evidence replay was not idempotent: %',r;
  END IF;
END $$;

-- A new provider result/attestation cannot replace a persisted account on the
-- same hold, even if it is well-formed and uses a different jti.
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','agentic_dva_provider_evidence_writer','aud','authenticated',
  'iat',extract(epoch FROM clock_timestamp())::bigint,
  'exp',extract(epoch FROM clock_timestamp())::bigint+30,
  'jti','f5f5f5f5-5555-4555-8555-000000000038',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000038',
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
    RAISE EXCEPTION 'different attestation replaced persisted evidence: %',r;
  END IF;
END $$;
RESET ROLE;
DO $$
BEGIN
  IF (SELECT count(*) FROM private.agentic_cart_dispatch_provider_evidence
      WHERE hold_id='f5f5f5f5-5555-4555-8555-000000000034') <> 1
     OR NOT EXISTS (
       SELECT 1 FROM private.agentic_cart_dispatch_provider_evidence evidence
       JOIN private.agentic_cart_dispatch_holds hold ON hold.id=evidence.hold_id
       WHERE evidence.hold_id='f5f5f5f5-5555-4555-8555-000000000034'
         AND evidence.account_number='0123456789'
         AND evidence.merchant_id=hold.merchant_id
         AND evidence.cart_id=hold.cart_id
         AND evidence.checkout_session_id=hold.checkout_session_id
         AND evidence.checkout_generation=hold.checkout_generation
         AND evidence.claim_reference=hold.claim_reference
     )
     OR NOT EXISTS (
       SELECT 1 FROM private.agentic_cart_dispatch_holds
       WHERE id='f5f5f5f5-5555-4555-8555-000000000034'
         AND state='account_ready'
         AND evidence_reference='f5f5f5f5-5555-4555-8555-000000000036'
     )
     OR (SELECT virtual_account_number FROM public.checkout_sessions
         WHERE session_id='mutable-evidence-session') <> '9999999999' THEN
    RAISE EXCEPTION 'evidence did not bind exact hold/account without trusting session row';
  END IF;
END $$;
ROLLBACK;

-- A signed role claim with a forged argument tuple, stale token, wrong hold,
-- or wrong claim reference cannot persist. The signed claim fields must match
-- the exact RPC arguments and an extant unresolved private hold.
SET ROLE agentic_dva_provider_evidence_writer;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','agentic_dva_provider_evidence_writer','aud','authenticated',
  'iat',extract(epoch FROM clock_timestamp())::bigint,
  'exp',extract(epoch FROM clock_timestamp())::bigint+30,
  'jti','f5f5f5f5-5555-4555-8555-000000000037',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000037',
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
    '9999999999','Forged Account','Forged Bank','NGN','ACCT_123456789012345');
  IF r->>'status' IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'signed attestation accepted changed provider tuple: %',r;
  END IF;
  r:=public.commerce_cart_persist_agentic_dva_provider_success(
    'f5f5f5f5-5555-4555-8555-000000000099','provider-evidence-claim-1',
    '0123456789','Trusted Provider Account','Provider Bank','NGN','ACCT_123456789012345');
  IF r->>'status' IS DISTINCT FROM 'blocked' THEN
    RAISE EXCEPTION 'signed attestation accepted a different hold: %',r;
  END IF;
END $$;

-- Expired JWTs and signed claims bound to a different claim reference fail
-- closed before any evidence row can be written.
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','agentic_dva_provider_evidence_writer','aud','authenticated',
  'iat',extract(epoch FROM clock_timestamp())::bigint-90,
  'exp',extract(epoch FROM clock_timestamp())::bigint-30,
  'jti','f5f5f5f5-5555-4555-8555-000000000037',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000037',
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
    RAISE EXCEPTION 'expired signed JWT persisted provider evidence: %',r;
  END IF;
END $$;
SELECT set_config('request.jwt.claims',jsonb_build_object(
  'role','agentic_dva_provider_evidence_writer','aud','authenticated',
  'iat',extract(epoch FROM clock_timestamp())::bigint,
  'exp',extract(epoch FROM clock_timestamp())::bigint+30,
  'jti','f5f5f5f5-5555-4555-8555-000000000037',
  'agentic_dva_provider_success',jsonb_build_object(
    'version','1','scope','paystack_dva_assignment',
    'jti','f5f5f5f5-5555-4555-8555-000000000037',
    'hold_id','f5f5f5f5-5555-4555-8555-000000000034',
    'claim_reference','different-claim-reference',
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
    RAISE EXCEPTION 'mismatched signed claim reference persisted provider evidence: %',r;
  END IF;
END $$;

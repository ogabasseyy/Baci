BEGIN;

-- Reclaiming an initializing lease does not prove that the earlier provider
-- request was absent or that its checkout URL is retired. Keep it parked.
DO $$
DECLARE definition text; needle text := E'  IF attempt.state = ''initializing''\n    AND (attempt.initialization_claimed_at IS NULL';
BEGIN
 definition:=pg_get_functiondef('public.claim_storefront_redvault_payment_attempt_initialization_v2(uuid)'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'Unexpected REDVAULT stale claim definition';
 END IF;
 definition:=replace(definition,needle,E'  IF false AND attempt.state = ''initializing''\n    AND (attempt.initialization_claimed_at IS NULL');
 EXECUTE definition;
END $$;

-- A distinct RPC means an application deployed before this migration fails
-- closed instead of trusting the old ambiguous claimed flag. The underlying
-- serialized v2 claim returns true only for a created-to-initializing change.
CREATE FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v4(p_attempt_id uuid)
RETURNS TABLE (
 attempt_id uuid, reference text, amount_kobo bigint, currency text,
 quote_payload_hash text, state text, bank_code text, authorization_url text,
 initialization_claimed boolean, paystack_subaccount_code text, platform_fee_kobo bigint,
 split_retained_shipping_kobo bigint, initialization_fresh boolean
)
LANGUAGE sql SECURITY DEFINER SET search_path='' AS $$
 SELECT r.attempt_id,r.reference,r.amount_kobo,r.currency,r.quote_payload_hash,r.state,
  r.bank_code,r.authorization_url,r.initialization_claimed,r.paystack_subaccount_code,
  r.platform_fee_kobo,r.split_retained_shipping_kobo,r.initialization_claimed
 FROM public.claim_storefront_redvault_payment_attempt_initialization_v3(p_attempt_id) r;
$$;
ALTER FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.claim_storefront_redvault_payment_attempt_initialization_v4(uuid) TO authenticated;

-- A lookup miss or unpaid status does not retire a hosted checkout. Keep
-- uncertain attempts fenced until an authoritative retirement contract exists.
-- Preserve authentication and customer checks before disclosing the guard.
DO $$
DECLARE definition text; needle text := E'  UPDATE private.uba_redvault_payment_attempts\n  SET state = p_state,';
BEGIN
 definition:=pg_get_functiondef('public.reconcile_storefront_redvault_payment_attempt_initialization(uuid,text,text)'::regprocedure);
 IF (length(definition)-length(replace(definition,needle,'')))/length(needle) <> 1 THEN
  RAISE EXCEPTION 'Unexpected REDVAULT recovery definition';
 END IF;
 definition:=replace(definition,needle,E'  IF p_state = ''void'' THEN\n    RAISE EXCEPTION ''redvault_retirement_unconfirmed'' USING ERRCODE = ''P0001'';\n  END IF;\n  UPDATE private.uba_redvault_payment_attempts\n  SET state = p_state,');
 EXECUTE definition;
END $$;

NOTIFY pgrst,'reload schema';
COMMIT;

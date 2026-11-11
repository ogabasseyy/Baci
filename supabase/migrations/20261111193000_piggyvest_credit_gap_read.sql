BEGIN;
-- Credit-gap read (PiggyVest contract register §8 follow-up). Read-only: it
-- changes no row. PiggyVest has no webhook resend endpoint, so a credit whose
-- webhook retries ran out (for example 503s while a wallet mapping was
-- missing) is never recorded and, since a wallet holding more than recorded
-- is normal while interest accrues, the balance check cannot see it. The
-- daily job lists each mapped plan wallet's credits at PiggyVest and compares
-- their PVB credit ids (`PVB01…`) with what this read returns: the
-- `pvb_reference` values both credit ledgers recorded for the same wallets.
--
-- Wallets: the plan wallets of the integration's merchant that are ready or
-- restricted, sorted by wallet id, 100 per run. rotationSlot (the day count)
-- moves the window one page per slot, wrapping, so every wallet is returned
-- within ceil(total/100) runs. The look-back window is sized from that, plus
-- two days, so consecutive visits of the same wallet always overlap.
--
-- Ledger rows: per wallet and ledger, rows recorded (created_at) or credited
-- at PiggyVest (credited_at / paid_at) since one day before the window start,
-- at most 1000 each; more sets `truncated` so the job reports the wallet as
-- unchecked instead of reading a short list as complete. `at` is the
-- PiggyVest credit time. Rows written before pvb_reference existed carry no
-- key; they are counted in `unkeyed` and never matched.
--
-- The caller must be the evidence login bound to the integration; any other
-- caller, or a disabled binding, gets 42501. Options must be exactly
-- {"rotationSlot": <whole number below 10^9>}; anything else gets 22023.
CREATE INDEX IF NOT EXISTS piggyvest_inflow_credits_wallet_created_idx
  ON public.piggyvest_inflow_credits(wallet_id,created_at);
CREATE INDEX IF NOT EXISTS piggyvest_interest_payouts_wallet_created_idx
  ON public.piggyvest_interest_payouts(wallet_id,created_at);

CREATE OR REPLACE FUNCTION piggyvest_primary.read_credit_gap_ledger(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  slot bigint;
  business text;
  merchant uuid;
  as_of timestamptz;
  window_start timestamptz;
  wallets jsonb;
  wallets_total integer;
BEGIN
  IF options IS NULL OR jsonb_typeof(options)<>'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(options) option_key WHERE option_key<>'rotationSlot')
    OR COALESCE(jsonb_typeof(options->'rotationSlot')='number',false) IS NOT TRUE
    OR COALESCE((options->>'rotationSlot') ~ '^[0-9]{1,9}$',false) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid credit gap options' USING ERRCODE='22023';
  END IF;
  slot:=(options->>'rotationSlot')::bigint;
  SELECT binding.business_id,binding.merchant_id INTO business,merchant
    FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_credit_gap_ledger.integration_id AND binding.environment=read_credit_gap_ledger.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'credit gap authority unavailable' USING ERRCODE='42501'; END IF;
  as_of:=pg_catalog.clock_timestamp();
  SELECT count(*)::integer INTO wallets_total FROM public.piggyvest_plan_wallets plan
    WHERE plan.merchant_id=merchant AND plan.status IN ('ready','restricted');
  window_start:=as_of-pg_catalog.make_interval(days=>(((wallets_total+99)/100)+2)::integer);
  IF wallets_total=0 THEN
    RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'windowStart',window_start,'businessId',business,
      'wallets','[]'::jsonb,'walletsTotal',0,'walletsDeferred',0);
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'walletId',item.wallet_id,
      'inflow',item.inflow->'rows','inflowTruncated',(item.inflow->>'more')::boolean,
      'interest',item.interest->'rows','interestTruncated',(item.interest->>'more')::boolean,
      'unkeyed',(item.inflow->>'unkeyed')::integer+(item.interest->>'unkeyed')::integer
    ) ORDER BY item.wallet_id),'[]'::jsonb) INTO wallets FROM (
    SELECT ranked.wallet_id,
      (SELECT pg_catalog.jsonb_build_object(
          'rows',COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reference',row_.pvb_reference,'at',row_.credited_at)
            ORDER BY row_.credited_at,row_.pvb_reference) FILTER (WHERE row_.pvb_reference IS NOT NULL AND row_.n<=1000),'[]'::jsonb),
          'more',COALESCE(max(row_.n) FILTER (WHERE row_.pvb_reference IS NOT NULL),0)>1000,
          'unkeyed',count(*) FILTER (WHERE row_.pvb_reference IS NULL))
        FROM (SELECT credit.pvb_reference,credit.credited_at,
            pg_catalog.row_number() OVER (PARTITION BY credit.pvb_reference IS NULL ORDER BY credit.credited_at,credit.pvb_reference) AS n
          FROM public.piggyvest_inflow_credits credit
          WHERE credit.wallet_id=ranked.wallet_id
            AND (credit.created_at>=window_start-interval '1 day' OR credit.credited_at>=window_start-interval '1 day')) row_
      ) AS inflow,
      (SELECT pg_catalog.jsonb_build_object(
          'rows',COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object('reference',row_.pvb_reference,'at',row_.paid_at)
            ORDER BY row_.paid_at,row_.pvb_reference) FILTER (WHERE row_.pvb_reference IS NOT NULL AND row_.n<=1000),'[]'::jsonb),
          'more',COALESCE(max(row_.n) FILTER (WHERE row_.pvb_reference IS NOT NULL),0)>1000,
          'unkeyed',count(*) FILTER (WHERE row_.pvb_reference IS NULL))
        FROM (SELECT payout.pvb_reference,payout.paid_at,
            pg_catalog.row_number() OVER (PARTITION BY payout.pvb_reference IS NULL ORDER BY payout.paid_at,payout.pvb_reference) AS n
          FROM public.piggyvest_interest_payouts payout
          WHERE payout.wallet_id=ranked.wallet_id
            AND (payout.created_at>=window_start-interval '1 day' OR payout.paid_at>=window_start-interval '1 day')) row_
      ) AS interest
    FROM (
      SELECT plan.wallet_id,pg_catalog.row_number() OVER (ORDER BY plan.wallet_id)-1 AS position
      FROM public.piggyvest_plan_wallets plan
      WHERE plan.merchant_id=merchant AND plan.status IN ('ready','restricted')) ranked
    WHERE ((ranked.position-((slot*100)%wallets_total)+wallets_total)%wallets_total)<100) item;
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'windowStart',window_start,'businessId',business,
    'wallets',wallets,'walletsTotal',wallets_total,
    'walletsDeferred',wallets_total-pg_catalog.jsonb_array_length(wallets));
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_credit_gap_ledger(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_credit_gap_ledger(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;

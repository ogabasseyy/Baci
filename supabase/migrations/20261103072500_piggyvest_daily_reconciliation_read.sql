BEGIN;
-- Daily reconciliation read (PiggyVest slim plan, task S9). Read-only: it
-- changes no row. It returns, for one enabled integration, (1) every savings
-- transfer still reserved or dispatched past a stale cutoff, and (2) for each
-- goal wallet the principal our records say was moved into it (confirmed
-- transfers only), so the daily job can compare that with PiggyVest and with
-- PiggyVest's own transfer status. The caller must be the evidence login
-- bound to the integration; any other caller, or a disabled binding, gets
-- 42501. The options object must carry staleAfterSeconds as an integer
-- between 60 and 604800; anything else is refused, never defaulted.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_daily_reconciliation(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  stale_seconds integer;
  business text;
  as_of timestamptz;
  stuck jsonb;
  stuck_total integer;
  wallets jsonb;
  wallets_total integer;
BEGIN
  IF options IS NULL OR jsonb_typeof(options)<>'object'
    OR (SELECT count(*) FROM jsonb_object_keys(options))<>1
    OR COALESCE(jsonb_typeof(options->'staleAfterSeconds')='number',false) IS NOT TRUE
    OR COALESCE((options->>'staleAfterSeconds') ~ '^[0-9]{2,6}$',false) IS NOT TRUE THEN
    RAISE EXCEPTION 'invalid reconciliation options' USING ERRCODE='22023';
  END IF;
  stale_seconds:=(options->>'staleAfterSeconds')::integer;
  IF stale_seconds NOT BETWEEN 60 AND 604800 THEN
    RAISE EXCEPTION 'invalid reconciliation options' USING ERRCODE='22023';
  END IF;
  SELECT binding.business_id INTO business FROM piggyvest_primary.integrations binding
    JOIN piggyvest_primary.inflow_authorities authority ON authority.integration_id=binding.id
    WHERE binding.id=read_daily_reconciliation.integration_id AND binding.environment=read_daily_reconciliation.environment
      AND binding.enabled AND authority.enabled AND authority.executor_login=SESSION_USER
    FOR SHARE OF binding,authority;
  IF NOT FOUND THEN RAISE EXCEPTION 'reconciliation authority unavailable' USING ERRCODE='42501'; END IF;
  -- The clock is read only after the lock above is held, so a wait for it
  -- cannot make a fresh transfer look stale or a stale one look fresh.
  as_of:=pg_catalog.clock_timestamp();
  -- Age counts from created_at (when the money was reserved), never from
  -- dispatched_at: the reclaim path refreshes that on every re-drive, which
  -- would keep a long-stuck transfer looking young.
  -- Each list and its total come from one statement, so they share a snapshot.
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'operationId',item.id,'goalId',item.goal_id,'state',item.state,'amountKobo',item.amount_kobo,
      'sourceWalletId',item.source_wallet_id,'destinationWalletId',item.destination_wallet_id,
      'reference',item.reference,'ageSeconds',item.age) ORDER BY item.age DESC,item.id),'[]'::jsonb)
    INTO stuck_total,stuck FROM (
    SELECT operation.id,operation.goal_id,operation.state,operation.amount_kobo,operation.source_wallet_id,
      operation.destination_wallet_id,operation.reference,
      pg_catalog.floor(pg_catalog.date_part('epoch',as_of-operation.created_at))::bigint AS age,
      count(*) OVER () AS total
    FROM piggyvest_primary.savings_operations operation
    WHERE operation.integration_id=read_daily_reconciliation.integration_id
      AND operation.state IN ('reserved','dispatched')
      AND operation.created_at<=as_of-pg_catalog.make_interval(secs=>stale_seconds)
    ORDER BY age DESC,operation.id LIMIT 200) item;
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'walletId',item.wallet_id,'expectedKobo',item.expected_kobo) ORDER BY item.wallet_id),'[]'::jsonb)
    INTO wallets_total,wallets FROM (
    SELECT operation.destination_wallet_id AS wallet_id,sum(operation.amount_kobo)::bigint AS expected_kobo,
      count(*) OVER () AS total
    FROM piggyvest_primary.savings_operations operation
    WHERE operation.integration_id=read_daily_reconciliation.integration_id AND operation.state='confirmed'
    GROUP BY operation.destination_wallet_id ORDER BY operation.destination_wallet_id LIMIT 500) item;
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'staleAfterSeconds',stale_seconds,'businessId',business,
    'stuck',stuck,'stuckTotal',stuck_total,'wallets',wallets,'walletsTotal',wallets_total);
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;

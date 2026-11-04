BEGIN;
-- Daily reconciliation: supporting indexes and rotation (PiggyVest slim plan,
-- task PE3). Both are needed before PIGGYVEST_RECONCILIATION_ENABLED=true.
--
-- (1) Indexes. The stuck read filters savings_operations on integration_id,
-- state and created_at; the balance read groups confirmed rows by
-- destination_wallet_id and sums amount_kobo. Neither had a matching index
-- (only integration_id alone), so both scanned every row the integration ever
-- wrote against a 2.5 second statement timeout. The wallet read also nets
-- settled goal cancels and completions off the funding, so those two tables
-- get a matching partial index each (their per-integration index alone would
-- scan every row the integration ever wrote).
-- These are plain CREATE INDEX, not CONCURRENTLY: Supabase applies each
-- migration file in one transaction and CONCURRENTLY cannot run inside one.
-- The tables are tiny today (PiggyVest is still dark with no live customers),
-- so the build is near-instant. Once they hold real volume, an index change
-- would need a separate concurrent step outside the migration transaction.
CREATE INDEX IF NOT EXISTS primary_savings_operation_recon_stuck_idx
  ON piggyvest_primary.savings_operations(integration_id,state,created_at);
CREATE INDEX IF NOT EXISTS primary_savings_operation_recon_wallet_idx
  ON piggyvest_primary.savings_operations(integration_id,destination_wallet_id)
  INCLUDE (amount_kobo) WHERE state='confirmed';
CREATE INDEX IF NOT EXISTS primary_goal_cancel_recon_wallet_idx
  ON piggyvest_primary.goal_cancel_operations(integration_id,source_wallet_id)
  INCLUDE (amount_kobo) WHERE state IN ('confirmed','needs_review','reviewed');
CREATE INDEX IF NOT EXISTS primary_goal_complete_recon_wallet_idx
  ON piggyvest_primary.goal_complete_operations(integration_id,source_wallet_id)
  INCLUDE (amount_kobo) WHERE state IN ('confirmed','needs_review','reviewed');

-- (2) Rotation instead of a silent cap. The read still returns at most 200
-- stuck transfers and 500 wallets, but which ones is no longer fixed: the
-- caller passes rotationSlot (a whole number, the day count) and the window
-- moves by one page per slot, wrapping round. Wallets are a stable sorted
-- list, so consecutive slots tile it and every wallet is returned within
-- ceil(total/page) runs. Stuck transfers are best effort: the stale set gains
-- and loses rows between runs, so a window can shift against it; every stuck
-- row is still counted in stuckTotal and any stuck row pages the operator.
-- The slot only chooses a window; the database trusts nothing else from it.
-- Rows left out are counted: stuckDeferred and walletsDeferred.
-- staleAfterSeconds is required; rotationSlot is optional (absent means slot
-- 0, so earlier callers keep working). A malformed value of either, or any
-- other key, is refused with 22023.
CREATE OR REPLACE FUNCTION piggyvest_primary.read_daily_reconciliation(integration_id uuid,environment text,options jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog AS $$
DECLARE
  stale_seconds integer;
  slot bigint;
  business text;
  as_of timestamptz;
  stuck jsonb;
  stuck_total integer;
  wallets jsonb;
  wallets_total integer;
BEGIN
  IF options IS NULL OR jsonb_typeof(options)<>'object'
    OR EXISTS (SELECT 1 FROM jsonb_object_keys(options) option_key
      WHERE option_key NOT IN ('staleAfterSeconds','rotationSlot'))
    OR COALESCE(jsonb_typeof(options->'staleAfterSeconds')='number',false) IS NOT TRUE
    OR COALESCE((options->>'staleAfterSeconds') ~ '^[0-9]{2,6}$',false) IS NOT TRUE
    OR ((options ? 'rotationSlot') AND (
      COALESCE(jsonb_typeof(options->'rotationSlot')='number',false) IS NOT TRUE
      OR COALESCE((options->>'rotationSlot') ~ '^[0-9]{1,9}$',false) IS NOT TRUE)) THEN
    RAISE EXCEPTION 'invalid reconciliation options' USING ERRCODE='22023';
  END IF;
  stale_seconds:=(options->>'staleAfterSeconds')::integer;
  slot:=COALESCE((options->>'rotationSlot')::bigint,0);
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
  -- dispatched_at: the reclaim path refreshes that on every re-drive.
  -- The window is chosen by creation order, which never changes, so it does
  -- not shift as rows age; the list shown is then oldest first.
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'operationId',item.id,'goalId',item.goal_id,'state',item.state,'amountKobo',item.amount_kobo,
      'sourceWalletId',item.source_wallet_id,'destinationWalletId',item.destination_wallet_id,
      'reference',item.reference,'ageSeconds',item.age) ORDER BY item.age DESC,item.id),'[]'::jsonb)
    INTO stuck_total,stuck FROM (
    SELECT ranked.* FROM (
      SELECT operation.id,operation.goal_id,operation.state,operation.amount_kobo,operation.source_wallet_id,
        operation.destination_wallet_id,operation.reference,
        pg_catalog.floor(pg_catalog.date_part('epoch',as_of-operation.created_at))::bigint AS age,
        count(*) OVER () AS total,
        pg_catalog.row_number() OVER (ORDER BY operation.created_at,operation.id)-1 AS position
      FROM piggyvest_primary.savings_operations operation
      WHERE operation.integration_id=read_daily_reconciliation.integration_id
        AND operation.state IN ('reserved','dispatched')
        AND operation.created_at<=as_of-pg_catalog.make_interval(secs=>stale_seconds)) ranked
    WHERE ((ranked.position-((slot*200)%ranked.total)+ranked.total)%ranked.total)<200) item;
  -- Expected balance is confirmed funding minus settled goal cancels and
  -- completions, floored at zero (the same netting as the previous definition).
  SELECT COALESCE(max(item.total),0)::integer,COALESCE(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
      'walletId',item.wallet_id,'expectedKobo',item.expected_kobo) ORDER BY item.wallet_id),'[]'::jsonb)
    INTO wallets_total,wallets FROM (
    SELECT ranked.* FROM (
      SELECT movement.wallet_id,GREATEST(0,sum(movement.delta_kobo))::bigint AS expected_kobo,
        count(*) OVER () AS total,
        pg_catalog.row_number() OVER (ORDER BY movement.wallet_id)-1 AS position
      FROM (
        SELECT operation.destination_wallet_id AS wallet_id,operation.amount_kobo AS delta_kobo
          FROM piggyvest_primary.savings_operations operation
         WHERE operation.integration_id=read_daily_reconciliation.integration_id AND operation.state='confirmed'
        UNION ALL
        SELECT cancel.source_wallet_id,-cancel.amount_kobo
          FROM piggyvest_primary.goal_cancel_operations cancel
         WHERE cancel.integration_id=read_daily_reconciliation.integration_id
           AND cancel.state IN ('confirmed','needs_review','reviewed')
        UNION ALL
        SELECT done.source_wallet_id,-done.amount_kobo
          FROM piggyvest_primary.goal_complete_operations done
         WHERE done.integration_id=read_daily_reconciliation.integration_id
           AND done.state IN ('confirmed','needs_review','reviewed')
      ) movement
      GROUP BY movement.wallet_id) ranked
    WHERE ((ranked.position-((slot*500)%ranked.total)+ranked.total)%ranked.total)<500) item;
  RETURN pg_catalog.jsonb_build_object('generatedAt',as_of,'staleAfterSeconds',stale_seconds,'businessId',business,
    'stuck',stuck,'stuckTotal',stuck_total,
    'stuckDeferred',stuck_total-pg_catalog.jsonb_array_length(stuck),
    'wallets',wallets,'walletsTotal',wallets_total,
    'walletsDeferred',wallets_total-pg_catalog.jsonb_array_length(wallets));
END $$;
REVOKE ALL ON FUNCTION piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb) FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION piggyvest_primary.read_daily_reconciliation(uuid,text,jsonb) TO piggyvest_primary_evidence;
COMMIT;

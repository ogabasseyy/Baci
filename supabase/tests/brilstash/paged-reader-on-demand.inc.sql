SET LOCAL ROLE anon;
DO $$
DECLARE result jsonb := fixture.read_brilstash_page(repeat('p', 43), 1, 100, 250000);
BEGIN
  IF result->>'status' IS DISTINCT FROM 'ok' OR result->>'totalCount' IS DISTINCT FROM '7'
    OR result->>'totalPages' IS DISTINCT FROM '1'
    OR result->'products' IS DISTINCT FROM current_setting('fixture.paged_input')::jsonb->'payload'
    OR EXISTS (SELECT 1 FROM jsonb_array_elements(result->'products') item
      WHERE item->>'stock_quantity' IS DISTINCT FROM '100' OR (item->>'price_naira')::numeric < 250000)
  THEN RAISE EXCEPTION 'on-demand partner pull did not return seven complete 100-unit listings: %', result; END IF;
END $$;
RESET ROLE;
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid := '30000000-0000-4000-8000-000000000003';
DECLARE state jsonb := public.inspect_brilstash_probe_state(target);
DECLARE feed_url text := 'https://feed.example.invalid/partners/yield/brilpay/products?page=1&limit=100&min_price=';
BEGIN
  IF public.inspect_brilstash_installation(target)->>'handoffMinPrice' IS DISTINCT FROM '250000'
  THEN RAISE EXCEPTION 'operator did not receive the required on-demand handoff price'; END IF;
  BEGIN
    PERFORM public.record_brilstash_handoff_probe(target, state, gen_random_uuid(), feed_url || '0');
    RAISE EXCEPTION 'on-demand handoff accepted a probe with the wrong price filter';
  EXCEPTION WHEN check_violation THEN NULL;
  END;
  PERFORM public.record_brilstash_handoff_probe(target, state, gen_random_uuid(), feed_url || '250000');
END $$;
RESET ROLE;

UPDATE public.products SET price = 249999 WHERE slug = 'paged-1';
SET LOCAL ROLE authenticated;
DO $$
DECLARE target uuid := '30000000-0000-4000-8000-000000000003';
BEGIN
  PERFORM public.approve_brilstash_stock_withdrawal(
    target, (public.inspect_brilstash_installation(target)->>'catalogueRevision')::bigint,
    'paged-1', 'No longer qualifies for financing'
  );
  RAISE EXCEPTION 'operator could approve an undeliverable below-floor stock withdrawal';
EXCEPTION WHEN check_violation THEN
  IF SQLERRM <> 'Below-floor BrilStash listings require retirement' THEN RAISE; END IF;
END $$;
RESET ROLE;

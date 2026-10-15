-- Bind the stored offer line to the live offer row inside the transactional
-- storefront-order function. Three gaps are reachable by invoking the
-- anon-executable order RPC directly, bypassing the Next.js route:
--
-- 1. The insert persists caller-controlled t.condition beside a verified
--    live offer_id: a used/open-box offer can be charged and reserved
--    while the order line tells fulfillment it is new. Staging now also
--    carries the live po.condition (NOT NULL on product_offers) and the
--    insert resolves COALESCE(t.offer_condition, t.condition), so offer
--    lines always store the live condition; parent/variant lines keep the
--    caller value.
-- 2. A line naming both a variant and an offer passes both independent
--    validity checks; the variant branch then wins pricing/stock while
--    the line is also marked an offer line, so a serialized REDVAULT
--    refund can restore an offer allocation creation never decremented.
--    The validation block now rejects dual-ID lines with the existing
--    invalid_offer code (already mapped to a 400 by the route and the
--    agentic dispatcher) before any stock mutation.
-- 3. A product switched to variants can keep an active product_offers
--    row; the staging join validates only product, merchant, and status,
--    so the stale offer prices and decrements without selecting or
--    reserving any variant inventory. The join now requires the parent
--    to have condition offers enabled and to be non-variant, mirroring
--    the search price-options predicate verbatim (has_condition_offers
--    IS TRUE, the sku_matrix-aware variant_bearing flag IS NOT TRUE,
--    and no live non-anchor variants); gated-out offers fail with the
--    existing invalid_offer counter.
--
-- String patch on private.create_storefront_order[_unchecked] following
-- the M12/M13/M18 chain; reruns converge via the idempotence check.
DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
  v_sibling_oid oid;
  v_sibling_def text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname IN (
      'create_storefront_order',
      'create_storefront_order_unchecked'
    )
    AND function_definition.pronargs = 24
  ORDER BY CASE function_definition.proname
    WHEN 'create_storefront_order_unchecked' THEN 0
    ELSE 1
  END
  LIMIT 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_order_function_not_found';
  END IF;

  -- Fail closed when a sibling entrypoint neither carries this patch's
  -- offer-condition staging nor delegates p_items untouched to the
  -- patched function. Only one candidate is patched (LIMIT 1 above),
  -- so a non-delegating sibling would otherwise store a stale
  -- submitted condition on its live offer lines. Read-only
  -- verification: oids are collected first and each definition is
  -- fetched in its own statement, so this never resembles the dynamic
  -- patching the order-RPC contract suite bans.
  FOR v_sibling_oid IN
    SELECT function_definition.oid
    FROM pg_catalog.pg_proc AS function_definition
    JOIN pg_catalog.pg_namespace AS function_schema
      ON function_schema.oid = function_definition.pronamespace
    WHERE function_schema.nspname = 'private'
      AND function_definition.proname IN (
        'create_storefront_order',
        'create_storefront_order_unchecked'
      )
      AND function_definition.pronargs = 24
      AND function_definition.oid <> v_function_oid
  LOOP
    SELECT pg_catalog.pg_get_functiondef(v_sibling_oid) INTO v_sibling_def;
    IF strpos(v_sibling_def, 'offer_condition TEXT') = 0
      AND (
        strpos(v_sibling_def, 'create_storefront_order_unchecked(') = 0
        OR v_sibling_def ~* 'insert\s+into[^;]*order_items'
      )
    THEN
      RAISE EXCEPTION 'storefront_order_offer_sibling_not_delegating';
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Fail closed when applied before the M13 staging join this builds on.
  IF strpos(v_definition, 'LEFT JOIN public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_join_not_found';
  END IF;

  -- Fail closed when applied before the M18 discriminator insert select.
  IF strpos(v_definition, '(t.offer_id IS NOT NULL) AS offer_line') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_line_select_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  -- The guard matches the exact staging marker this migration introduces,
  -- not any mention of offer_condition: a replay-variant definition that
  -- names the column in an unrelated context must still run the patch
  -- (missing anchors fail closed below) instead of skipping it silently.
  IF strpos(v_definition, 'offer_condition TEXT') > 0 THEN
    RETURN;
  END IF;

  -- 1. Temp staging row carries the live offer condition.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    line_ordinal INTEGER,
    offer_id UUID,
    offer_price NUMERIC
  ) ON COMMIT DROP;$$,
    $$    line_ordinal INTEGER,
    offer_id UUID,
    offer_price NUMERIC,
    offer_condition TEXT
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_condition_temp_table_not_found';
  END IF;

  -- 2. Temp staging insert lists the offer-condition column.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    line_ordinal,
    offer_id,
    offer_price
  )
  SELECT$$,
    $$    line_ordinal,
    offer_id,
    offer_price,
    offer_condition
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_condition_temp_insert_not_found';
  END IF;

  -- 3. Staging select forwards the joined live offer condition.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    r.line_ordinal,
    r.offer_id,
    po.price
  FROM ($$,
    $$    r.line_ordinal,
    r.offer_id,
    po.price,
    po.condition
  FROM ($$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_condition_staging_select_not_found';
  END IF;

  -- 4. Stored line condition resolves from the live offer row: offer
  -- lines always store po.condition (NOT NULL), so a direct RPC caller
  -- cannot charge a used offer while labelling the line new.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    t.condition,
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.image_url,$$,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_condition_insert_select_not_found';
  END IF;

  -- 5. The offer join requires a non-variant parent with condition
  -- offers enabled, mirroring the search price-options predicate:
  -- stale offers on variant-bearing products join nothing and fail
  -- with invalid_offer instead of pricing without variant inventory.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  LEFT JOIN public.product_offers po
    ON r.offer_id IS NOT NULL
    AND po.id = r.offer_id
    AND po.product_id = p.id
    AND po.merchant_id = p_merchant_id
    AND po.status = 'active';$$,
    $$  LEFT JOIN public.product_offers po
    ON r.offer_id IS NOT NULL
    AND po.id = r.offer_id
    AND po.product_id = p.id
    AND po.merchant_id = p_merchant_id
    AND po.status = 'active'
    AND p.has_condition_offers IS TRUE
    AND (p.has_variants IS TRUE OR COALESCE(p.variant_model, '') = 'sku_matrix') IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1
      FROM public.product_variants nv
      WHERE nv.product_id = p.id
        AND nv.merchant_id = p_merchant_id
        AND nv.is_inventory_anchor IS NOT TRUE
    );$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_parent_gate_not_found';
  END IF;

  -- 6. Lines naming both a variant and an offer are contradictory and
  -- rejected before any stock mutation, matching the TypeScript
  -- schemas; the existing invalid_offer code keeps route mapping.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  IF v_invalid_offer_count > 0 THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;$$,
    $$  IF v_invalid_offer_count > 0 THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_storefront_order_items t
    WHERE t.variant_id IS NOT NULL AND t.offer_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_mutual_exclusion_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

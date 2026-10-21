-- Enforce the finite offer allocation on serialized_strict products at
-- creation and restore it on cancellation. Strict offer lines currently
-- bypass the scalar branch entirely (units only), but search, the PDP,
-- and the native cart all bind strict offers by the effective minimum
-- of scalar and units — so an offer scalar smaller than the available
-- unit count oversells: the first order claims a unit while the scalar
-- stays put and the offer keeps advertising. Strict offer lines now
-- take the scalar check/decrement alongside the unit claim, and the
-- three restock helpers restore strict offer scalars the same way M21
-- restored unlimited ones. Non-offer strict lines still bypass (units
-- only); the parent restock branch is untouched. Reruns converge via
-- the idempotence check in each block.
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
  -- strict-offer scalar arm nor delegates p_items untouched to the
  -- patched function. Only one candidate is patched (LIMIT 1 above),
  -- so a non-delegating sibling would otherwise bypass the strict
  -- offer scalar on its path. Read-only verification: oids are
  -- collected first and each definition is fetched in its own
  -- statement, so this never resembles the dynamic patching the
  -- order-RPC contract suite bans.
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
    IF strpos(v_sibling_def, '(v_effective_policy = ''serialized_strict'' AND stock_rec.offer_id IS NULL)') = 0
      AND (
        strpos(v_sibling_def, 'create_storefront_order_unchecked(') = 0
        OR v_sibling_def ~* 'insert\s+into[^;]*order_items'
      )
    THEN
      RAISE EXCEPTION 'storefront_order_offer_sibling_not_delegating';
    END IF;
  END LOOP;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- The #3693 rewrite replaced this M18-era body with the
  -- condition-keyed product_offer_id lineage, so the anchors below no
  -- longer match; the net semantics live in
  -- 20261019090000_storefront_order_offer_final_state.sql. Converge
  -- without patching so incremental deploys (rewrite recorded, these
  -- files pending) skip instead of failing on absent anchors.
  IF strpos(v_definition, 'product_offer_id') > 0 THEN
    RETURN;
  END IF;

  -- Reruns and already-patched bypasses converge without duplicating
  -- edits. Checked first: the patch consumes the unqualified arm below.
  IF strpos(v_definition, '(v_effective_policy = ''serialized_strict'' AND stock_rec.offer_id IS NULL)') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M20 bypass this qualifies.
  IF strpos(v_definition, 'stock_rec.offer_id IS NULL') = 0 THEN
    RAISE EXCEPTION 'storefront_order_serialized_bypass_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$        IF v_effective_policy = 'serialized_strict'
          OR (v_effective_policy = 'serialized_then_unlimited' AND stock_rec.offer_id IS NULL)
        THEN
          -- Bypassed legacy stock decrement for serialized inventory tracking.
          -- Offer lines on serialized-then-unlimited products still take the
          -- scalar branch below: the finite offer allocation binds the order
          -- the same way search and the PDP bind availability.
          CONTINUE;
        END IF;$$,
    $$        IF (v_effective_policy = 'serialized_strict' AND stock_rec.offer_id IS NULL)
          OR (v_effective_policy = 'serialized_then_unlimited' AND stock_rec.offer_id IS NULL)
        THEN
          -- Bypassed legacy stock decrement for serialized inventory tracking.
          -- Offer lines still take the scalar branch below: the finite offer
          -- allocation binds the order the same way search and the PDP bind
          -- availability (effective minimum of scalar and units).
          CONTINUE;
        END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_strict_offer_bypass_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname = 'restock_order_items'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- The #3693 rewrite replaced this M18-era body with the
  -- condition-keyed product_offer_id lineage, so the anchors below no
  -- longer match; the net semantics live in
  -- 20261019090000_storefront_order_offer_final_state.sql. Converge
  -- without patching so incremental deploys (rewrite recorded, these
  -- files pending) skip instead of failing on absent anchors.
  IF strpos(v_definition, 'product_offer_id') > 0 THEN
    RETURN;
  END IF;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the exclusion below.
  IF strpos(v_definition, 'Strict and unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M21 strict filter this refines.
  IF strpos(v_definition, 'Unlimited offer scalars restock here') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$,
    $$      -- Strict and unlimited offer scalars restock here: creation
      -- decrements them alongside any unit claim.$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_strict_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname =
      'restock_order_items_excluding_redvault_releases'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_redvault_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- The #3693 rewrite replaced this M18-era body with the
  -- condition-keyed product_offer_id lineage, so the anchors below no
  -- longer match; the net semantics live in
  -- 20261019090000_storefront_order_offer_final_state.sql. Converge
  -- without patching so incremental deploys (rewrite recorded, these
  -- files pending) skip instead of failing on absent anchors.
  IF strpos(v_definition, 'product_offer_id') > 0 THEN
    RETURN;
  END IF;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the exclusion below.
  IF strpos(v_definition, 'Strict and unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M21 strict filter this refines.
  IF strpos(v_definition, 'Unlimited offer scalars restock here') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$,
    $$      -- Strict and unlimited offer scalars restock here: creation
      -- decrements them alongside any unit claim.$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_strict_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

DO $migration$
DECLARE
  v_function_oid oid;
  v_definition text;
  v_updated text;
  v_before text;
BEGIN
  SELECT function_definition.oid
  INTO v_function_oid
  FROM pg_catalog.pg_proc AS function_definition
  JOIN pg_catalog.pg_namespace AS function_schema
    ON function_schema.oid = function_definition.pronamespace
  WHERE function_schema.nspname = 'private'
    AND function_definition.proname =
      'restock_order_items_excluding_serialized'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_serialized_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- The #3693 rewrite replaced this M18-era body with the
  -- condition-keyed product_offer_id lineage, so the anchors below no
  -- longer match; the net semantics live in
  -- 20261019090000_storefront_order_offer_final_state.sql. Converge
  -- without patching so incremental deploys (rewrite recorded, these
  -- files pending) skip instead of failing on absent anchors.
  IF strpos(v_definition, 'product_offer_id') > 0 THEN
    RETURN;
  END IF;

  -- Reruns and already-patched branches converge without duplicating
  -- edits. Checked first: the patch consumes the exclusion below.
  IF strpos(v_definition, 'Strict and unlimited offer scalars restock here') > 0 THEN
    RETURN;
  END IF;

  -- Fail closed when applied before the M21 strict filter this refines.
  IF strpos(v_definition, 'Unlimited offer scalars restock here') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_unlimited_offer_not_found';
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      -- Strict offers restock via units, never scalar: creation skips
      -- their decrement, so restoring here would inflate phantom stock.
      -- Unlimited offer scalars restock here: creation decrements them.
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'$$,
    $$      -- Strict and unlimited offer scalars restock here: creation
      -- decrements them alongside any unit claim.$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_strict_offer_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

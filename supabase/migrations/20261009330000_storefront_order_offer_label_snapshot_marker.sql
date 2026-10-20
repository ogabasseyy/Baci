-- Distinguish snapshotted-but-empty offer labels from pre-snapshot rows.
-- M29 freezes po.grade/po.condition_notes on the order line, but an offer
-- with neither label stores (NULL, NULL) — identical to a pre-snapshot
-- legacy row. Admin order details fall back to the live catalog row when
-- both snapshot columns are NULL, so a post-migration order would begin
-- displaying labels the merchant added AFTER purchase. This discriminator
-- marks every line created against a condition offer (following the M18
-- offer_line precedent, derived from the staged offer id rather than
-- caller input), letting readers trust stored NULLs as creation-time
-- truth. No backfill: legacy rows keep false, which is exactly right —
-- their labels were never snapshotted.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_labels_snapshotted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.offer_labels_snapshotted IS
  'True when the line was created against a condition offer after the label snapshot; stored NULL labels are then creation-time truth, not missing data.';

-- String patch on private.create_storefront_order[_unchecked] following
-- the M12/M13/M18/M28/M29 chain; reruns converge via the idempotence check.
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
  -- snapshot marker nor delegates p_items untouched to the patched
  -- function. Only one candidate is patched (LIMIT 1 above), so a
  -- non-delegating sibling would otherwise leave the marker unset on
  -- its lines while the patched path sets it. Read-only verification:
  -- oids are collected first and each definition is fetched in its own
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
    IF strpos(lower(v_sibling_def), 'offer_labels_snapshotted') = 0
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

  -- Fail closed when applied before the M29 label snapshot this builds on.
  IF strpos(v_definition, 'offer_condition_notes TEXT') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_staging_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'offer_labels_snapshotted') > 0 THEN
    RETURN;
  END IF;

  -- 1. Order items insert stores the marker beside the snapshot.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    offer_line,
    offer_grade,
    offer_condition_notes,
    image_url,$$,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    offer_line,
    offer_grade,
    offer_condition_notes,
    offer_labels_snapshotted,
    image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_marker_insert_columns_not_found';
  END IF;

  -- 2. Insert select derives it from the staged offer id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.offer_grade,
    t.offer_condition_notes,
    t.image_url,$$,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.offer_grade,
    t.offer_condition_notes,
    (t.offer_id IS NOT NULL) AS offer_labels_snapshotted,
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_marker_insert_select_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

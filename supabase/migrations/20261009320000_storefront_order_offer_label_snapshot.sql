-- Snapshot the purchased condition offer's fulfillment labels on the order
-- line at creation. Admin order details currently resolve grade and
-- condition notes from the LIVE product_offers row via get_product_offers,
-- which returns only active rows: after the merchant edits the grade/notes
-- or marks the offer inactive or sold out, historical orders show revised
-- labels or lose them entirely even though the customer bought the earlier
-- grade. These columns freeze the joined po.grade/po.condition_notes beside
-- offer_id, following the variant_name/condition display-snapshot precedent.
-- Server-derived from the same staging join that prices the line (M13, as
-- gated by M28), never caller-supplied: a direct RPC caller cannot relabel
-- another offer's line. No backfill: legacy lines keep the live lookup via
-- the admin fallback, which is honest about pre-snapshot rows; backfilling
-- from live rows would stamp today's labels as creation-time truth.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_grade text;

ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_condition_notes text;

COMMENT ON COLUMN public.order_items.offer_grade IS
  'Display snapshot of the purchased condition offer grade at order time; NULL for non-offer lines and pre-snapshot rows.';

COMMENT ON COLUMN public.order_items.offer_condition_notes IS
  'Display snapshot of the purchased condition offer notes at order time; NULL for non-offer lines and pre-snapshot rows.';

-- String patch on private.create_storefront_order[_unchecked] following
-- the M12/M13/M18/M28 chain; reruns converge via the idempotence check.
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

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  -- Fail closed when applied before the M28 offer-condition staging join
  -- this builds on.
  IF strpos(v_definition, 'offer_condition TEXT') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_condition_staging_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'offer_grade') > 0 THEN
    RETURN;
  END IF;

  -- 1. Temp staging row carries the live offer labels.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    line_ordinal INTEGER,
    offer_id UUID,
    offer_price NUMERIC,
    offer_condition TEXT
  ) ON COMMIT DROP;$$,
    $$    line_ordinal INTEGER,
    offer_id UUID,
    offer_price NUMERIC,
    offer_condition TEXT,
    offer_grade TEXT,
    offer_condition_notes TEXT
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_temp_table_not_found';
  END IF;

  -- 2. Temp staging insert lists the label columns.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    line_ordinal,
    offer_id,
    offer_price,
    offer_condition
  )
  SELECT$$,
    $$    line_ordinal,
    offer_id,
    offer_price,
    offer_condition,
    offer_grade,
    offer_condition_notes
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_temp_insert_not_found';
  END IF;

  -- 3. Staging select forwards the joined live offer labels.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    r.line_ordinal,
    r.offer_id,
    po.price,
    po.condition
  FROM ($$,
    $$    r.line_ordinal,
    r.offer_id,
    po.price,
    po.condition,
    po.grade,
    po.condition_notes
  FROM ($$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_staging_select_not_found';
  END IF;

  -- 4. Order items insert stores the snapshot beside the discriminator.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    offer_line,
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
    image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_insert_columns_not_found';
  END IF;

  -- 5. Insert select reads the staged labels.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.image_url,$$,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    COALESCE(t.offer_condition, t.condition),
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.offer_grade,
    t.offer_condition_notes,
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_labels_insert_select_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

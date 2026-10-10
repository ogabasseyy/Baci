-- Persist the exact condition offer on storefront order lines. Two offers can
-- canonicalize to the same condition (used vs uk_used), so the condition
-- alone cannot tell the merchant which advertised item to fulfill. The
-- checkout payload carries offer_id; this stores it with a foreign key to
-- the live offer and threads it through the private order RPC the same way
-- the line-ordinal patch threads ordinals (quiz/savings wrappers delegate
-- p_items untouched, so they inherit the column).
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_id uuid
  REFERENCES public.product_offers(id);

CREATE INDEX IF NOT EXISTS order_items_offer_id_idx
  ON public.order_items(offer_id);

COMMENT ON COLUMN public.order_items.offer_id IS
  'Exact condition offer purchased; NULL for parent-priced and variant lines.';

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

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'offer_id') > 0 THEN
    RETURN;
  END IF;

  -- 1. Temp staging row carries the parsed offer id.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    line_ordinal INTEGER
  ) ON COMMIT DROP;$$,
    $$    line_ordinal INTEGER,
    offer_id UUID
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_temp_table_not_found';
  END IF;

  -- 2. Temp staging insert lists the offer column.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    line_ordinal
  )
  SELECT$$,
    $$    line_ordinal,
    offer_id
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_temp_insert_not_found';
  END IF;

  -- 3. Staging select forwards the parsed offer id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    r.line_ordinal
  FROM ($$,
    $$    r.line_ordinal,
    r.offer_id
  FROM ($$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_staging_select_not_found';
  END IF;

  -- 4. Item input parses the offer id beside the variant id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      NULLIF(item->>'variant_id','')::uuid AS variant_id,
$$,
    $$      NULLIF(item->>'variant_id','')::uuid AS variant_id,
      NULLIF(item->>'offer_id','')::uuid AS offer_id,
$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_item_input_not_found';
  END IF;

  -- 5. Order items insert stores the offer beside the condition.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    image_url,$$,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_insert_columns_not_found';
  END IF;

  -- 6. Insert select reads the staged offer id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    t.condition,
    t.image_url,$$,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    t.condition,
    t.offer_id,
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_insert_select_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

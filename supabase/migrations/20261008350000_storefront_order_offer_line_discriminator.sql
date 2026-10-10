-- Append-only: keep offer-line restock routing after the offer row is gone.
--
-- M14 recreated the order_items.offer_id FK as ON DELETE SET NULL (matching
-- the product/variant siblings) so deleting a product with ordered offers
-- preserves history. But the M13 restock branches route on
-- oi.offer_id IS [NOT] NULL: deleting a single offer NULLs its historical
-- lines, and a later cancel routes those lines to the PARENT restock
-- branch — incrementing parent stock that creation never decremented
-- (creation decremented the offer). Persist an offer_line discriminator at
-- creation and route restock on it instead. A deleted offer's lines then
-- stay in the offer branch, where the po.id = agg.offer_id join matches
-- nothing and restores nothing (the row is gone; the parent is untouched).
-- Backfill from offer_id IS NOT NULL is exact: prod still carries M12's
-- NO ACTION FK, so no historical line has lost its offer id yet.
ALTER TABLE public.order_items
  ADD COLUMN IF NOT EXISTS offer_line boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.order_items.offer_line IS
  'True when the line was created against a condition offer; survives the M14 ON DELETE SET NULL so restock still routes to the offer branch after the offer row is deleted.';

UPDATE public.order_items
SET offer_line = true
WHERE offer_id IS NOT NULL AND NOT offer_line;

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

  -- Fail closed when applied before the M12 offer staging this builds on.
  IF strpos(lower(v_definition), 'offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_staging_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'offer_line') > 0 THEN
    RETURN;
  END IF;

  -- 1. Order items insert stores the discriminator beside the offer.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    image_url,$$,
    $$  INSERT INTO public.order_items (
    order_id,
    line_id,
    product_id,
    condition,
    offer_id,
    offer_line,
    image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_line_insert_not_found';
  END IF;

  -- 2. Insert select derives it from the staged offer id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    t.condition,
    t.offer_id,
    t.image_url,$$,
    $$    v_order_id,
    t.line_ordinal,
    t.product_id,
    t.condition,
    t.offer_id,
    (t.offer_id IS NOT NULL) AS offer_line,
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_line_select_not_found';
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

  -- Fail closed when applied before the M13 offer branch this refines.
  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  -- Parent branch skips persisted offer lines even when their offer id
  -- was nulled by the M14 delete rule.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NULL$$,
    $$      AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_parent_not_found';
  END IF;

  -- Offer branch keeps routing deleted offers (null id, flag set) into
  -- the offer update, where the po.id join matches nothing.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      AND oi.offer_id IS NOT NULL$$,
    $$      AND oi.offer_line IS TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_branch_not_found';
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

  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NULL$$,
    $$      AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_parent_not_found';
  END IF;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      AND oi.offer_id IS NOT NULL$$,
    $$      AND oi.offer_line IS TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_branch_not_found';
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

  IF strpos(lower(v_definition), 'update public.product_offers po') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
  END IF;

  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$      AND oi.offer_id IS NULL$$,
    $$      AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_parent_not_found';
  END IF;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      AND oi.offer_id IS NOT NULL$$,
    $$      AND oi.offer_line IS TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_line_branch_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

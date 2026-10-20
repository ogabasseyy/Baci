-- Append-only: restore exact condition-offer identity after the #3693
-- order-function rewrite.
--
-- The 20261008/20261009 offer chain string-patched the M18-era
-- create_storefront_order_unchecked (exact offer_id staging, live
-- condition binding, grade/notes snapshots, managed-guard and
-- restock routing). Main's 20261015130500 wholesale-replaced that
-- function (plus the three restock helpers and the REDVAULT quantity
-- release) with a condition-keyed product_offer_id lineage, silently
-- dropping every offer patch: the backdated migrations still apply
-- cleanly in chronological replay (their anchors predate the rewrite)
-- and then the rewrite wipes them, so offer_id persists NULL and the
-- offer sql-checks fail. On incremental deploys that already recorded
-- the rewrite, the backdated patches fail closed on their missing
-- anchors instead (each now returns early when it detects the
-- product_offer_id lineage; see those files).
--
-- This migration re-applies the net offer semantics onto the
-- rewritten definitions. product_offers enforces
-- UNIQUE(product_id, condition), so the resolved condition offer IS
-- the exact offer whenever the caller-supplied id agrees with it:
-- the port therefore validates agreement (invalid_offer on mismatch,
-- dual variant+offer lines, or unknown ids) and persists the exact
-- identity beside main's product_offer_id lineage. Deliberate
-- non-ports: the M18 parent gating (has_condition_offers) stays out
-- because main's condition resolution is intentionally ungated and
-- its fixtures pin that shape; serialized-strict offer units keep
-- main's scalar behavior (unpinned either way).
--
-- Restock/REDVAULT routing extends to the offer_line discriminator so
-- deleted-offer rows (both ids nulled by the SET NULL rules below)
-- are excluded from parent credit; the product_offer_id FK moves to
-- ON DELETE SET NULL to match the offer_id lifecycle.
-- Reruns converge via the idempotence checks in each block.

-- The ordered-offer FK must preserve history like its siblings: with
-- the default NO ACTION, deleting a previously ordered offer fails
-- while order_items rows point at it.
ALTER TABLE public.order_items
  DROP CONSTRAINT IF EXISTS order_items_product_offer_id_fkey;

ALTER TABLE public.order_items
  ADD CONSTRAINT order_items_product_offer_id_fkey
  FOREIGN KEY (product_offer_id) REFERENCES public.product_offers (id)
  ON DELETE SET NULL;

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
  -- offer staging nor delegates p_items untouched to the patched
  -- function. Only one candidate is patched (LIMIT 1 above), so a
  -- non-delegating sibling would otherwise persist its lines without
  -- the exact offer identity. Read-only verification: oids are
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

  -- This port targets the rewritten (#3693) lineage only.
  IF strpos(v_definition, 'product_offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_rewrite_not_found';
  END IF;

  -- Reruns and already-patched branches converge without duplicating edits.
  IF strpos(lower(v_definition), 'offer_labels_snapshotted') > 0 THEN
    RETURN;
  END IF;

  -- 1. Temp staging row carries the exact offer identity and snapshots.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    voucher_award_id text
  ) ON COMMIT DROP;$$,
    $$    voucher_award_id text,
    offer_id UUID,
    offer_condition TEXT,
    offer_grade TEXT,
    offer_condition_notes TEXT,
    offer_labels_snapshotted BOOLEAN
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_temp_not_found';
  END IF;

  -- 2. Inner item projection reads the caller-supplied exact offer id.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      nullif(item->>'voucher_award_id','') AS voucher_award_id,$$,
    $$      nullif(item->>'voucher_award_id','') AS voucher_award_id,
      NULLIF(item->>'offer_id','')::uuid AS offer_id,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_item_key_not_found';
  END IF;

  -- 3. Temp staging insert lists the offer columns.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    variant_stock, condition_offer_id, condition_valid, submitted_price, voucher_award_id
  )
  SELECT$$,
    $$    variant_stock, condition_offer_id, condition_valid, submitted_price, voucher_award_id,
    offer_id, offer_condition, offer_grade, offer_condition_notes,
    offer_labels_snapshotted
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_insert_list_not_found';
  END IF;

  -- 4. Staging select forwards the exact id and the live offer row.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    r.submitted_price,r.voucher_award_id
  FROM ($$,
    $$    r.submitted_price,r.voucher_award_id,
    r.offer_id,
    offer.condition,
    offer.grade,
    offer.condition_notes,
    offer.id IS NOT NULL
  FROM ($$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_staging_select_not_found';
  END IF;

  -- 5. An id-only line (no submitted condition) still resolves its
  -- exact active offer; variant lines stay excluded and keep the
  -- mutual-exclusion rejection below.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  LEFT JOIN public.product_offers offer ON r.variant_id IS NULL AND r.condition IS NOT NULL
    AND offer.product_id=p.id AND offer.merchant_id=p_merchant_id AND offer.condition=r.condition;$$,
    $$  LEFT JOIN public.product_offers offer ON offer.product_id=p.id AND offer.merchant_id=p_merchant_id
    AND ((r.variant_id IS NULL AND r.condition IS NOT NULL AND offer.condition=r.condition)
      OR (r.variant_id IS NULL AND r.condition IS NULL AND r.offer_id IS NOT NULL AND offer.id=r.offer_id AND offer.status='active'));$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_join_not_found';
  END IF;

  -- 6. Exact ids must agree with the resolved condition offer, and
  -- dual variant+offer lines stay contradictory: both fail before any
  -- side effect with the existing invalid_offer code.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;$$,
    $$  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM tmp_storefront_order_items t
    WHERE t.offer_id IS NOT NULL
      AND (
        t.variant_id IS NOT NULL
        OR t.offer_id IS DISTINCT FROM t.condition_offer_id
      )
  ) THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_validation_not_found';
  END IF;

  -- 7. Offer lines decrement the offer allocation even when the parent
  -- product is unmanaged (or NULL): creation parity with the managed
  -- guard, mirroring the pre-rewrite behavior.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    IF stock_rec.condition_offer_id IS NOT NULL THEN
      IF stock_rec.manage_stock THEN
        UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity-stock_rec.total_quantity
        WHERE offer.id=stock_rec.condition_offer_id AND offer.merchant_id=p_merchant_id AND offer.product_id=stock_rec.product_id
          AND offer.status='active' AND offer.stock_quantity>=stock_rec.total_quantity;
        IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_condition_offer_stock'; END IF;
      END IF;
      CONTINUE;
    END IF;$$,
    $$    IF stock_rec.condition_offer_id IS NOT NULL THEN
      UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity-stock_rec.total_quantity
      WHERE offer.id=stock_rec.condition_offer_id AND offer.merchant_id=p_merchant_id AND offer.product_id=stock_rec.product_id
        AND offer.status='active' AND offer.stock_quantity>=stock_rec.total_quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'insufficient_condition_offer_stock'; END IF;
      CONTINUE;
    END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_stock_not_found';
  END IF;

  -- 8. Order items insert stores the exact identity, the live
  -- condition binding, and the label snapshot beside main's lineage.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    variant_attributes,
    product_offer_id
  )
  SELECT$$,
    $$    variant_attributes,
    product_offer_id,
    offer_id,
    offer_line,
    offer_grade,
    offer_condition_notes,
    offer_labels_snapshotted
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_item_insert_not_found';
  END IF;

  -- 9. Offer lines store the live offer condition, never the caller
  -- value, so fulfillment cannot disagree with the charged offer.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    t.condition,
    t.image_url,$$,
    $$    COALESCE(t.offer_condition, t.condition),
    t.image_url,$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_condition_bind_not_found';
  END IF;

  -- 10. Insert select derives the identity columns from staging. The
  -- discriminator covers any condition-resolved line (exact id or
  -- condition match) so deleted-offer rows keep restock routing after
  -- both ids null out.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    COALESCE(t.variant_attributes, '{}'::jsonb),
    t.condition_offer_id
  FROM tmp_storefront_order_items t;$$,
    $$    COALESCE(t.variant_attributes, '{}'::jsonb),
    t.condition_offer_id,
    t.offer_id,
    (t.offer_id IS NOT NULL OR t.condition_offer_id IS NOT NULL) AS offer_line,
    t.offer_grade,
    t.offer_condition_notes,
    t.offer_labels_snapshotted
  FROM tmp_storefront_order_items t;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_final_item_select_not_found';
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

  IF strpos(v_definition, 'product_offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_rewrite_not_found';
  END IF;

  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  -- Offer branch keeps routing deleted offers (null id, flag set)
  -- into the offer update, where the offer join matches nothing, and
  -- no longer requires the parent managed flag (creation parity).
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY$$,
    $$WHERE oi.order_id=p_order_id AND (oi.product_offer_id IS NOT NULL OR oi.offer_line IS TRUE) GROUP BY$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_branch_not_found';
  END IF;

  -- Variant and parent branches skip persisted offer lines even when
  -- their offer ids were nulled by the delete rules.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL$$,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_not_found';
  END IF;
  -- replace() is global, so any surviving anchor (still followed by
  -- a newline instead of the new predicate) means a variant spelling.
  IF strpos(
    v_updated,
    'oi.product_offer_id IS NULL' || chr(10)
  ) > 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_partial';
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
    AND function_definition.proname = 'restock_order_items_excluding_serialized'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  IF strpos(v_definition, 'product_offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_rewrite_not_found';
  END IF;

  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY$$,
    $$WHERE oi.order_id=p_order_id AND (oi.product_offer_id IS NOT NULL OR oi.offer_line IS TRUE) GROUP BY$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_branch_not_found';
  END IF;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL$$,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_not_found';
  END IF;
  -- replace() is global, so any surviving anchor (still followed by
  -- a newline instead of the new predicate) means a variant spelling.
  IF strpos(
    v_updated,
    'oi.product_offer_id IS NULL' || chr(10)
  ) > 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_partial';
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
    AND function_definition.proname = 'restock_order_items_excluding_redvault_releases'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_restock_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  IF strpos(v_definition, 'product_offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_restock_rewrite_not_found';
  END IF;

  IF strpos(lower(v_definition), 'oi.offer_line') > 0 THEN
    RETURN;
  END IF;

  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$WHERE oi.order_id=p_order_id AND oi.product_offer_id IS NOT NULL AND product.manage_stock=true GROUP BY$$,
    $$WHERE oi.order_id=p_order_id AND (oi.product_offer_id IS NOT NULL OR oi.offer_line IS TRUE) GROUP BY$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_branch_not_found';
  END IF;

  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL$$,
    $$WHERE oi.order_id = p_order_id AND oi.product_offer_id IS NULL AND oi.offer_line IS NOT TRUE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_not_found';
  END IF;
  -- replace() is global, so any surviving anchor (still followed by
  -- a newline instead of the new predicate) means a variant spelling.
  IF strpos(
    v_updated,
    'oi.product_offer_id IS NULL' || chr(10)
  ) > 0 THEN
    RAISE EXCEPTION 'storefront_restock_offer_final_parent_partial';
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
    AND function_definition.proname = 'release_redvault_refund_quantity_units'
    AND function_definition.pronargs = 1;

  IF v_function_oid IS NULL THEN
    RAISE EXCEPTION 'storefront_redvault_function_not_found';
  END IF;

  SELECT pg_catalog.pg_get_functiondef(v_function_oid) INTO v_definition;

  IF strpos(v_definition, 'product_offer_id') = 0 THEN
    RAISE EXCEPTION 'storefront_redvault_rewrite_not_found';
  END IF;

  IF strpos(v_definition, 'v_item.offer_line') > 0 THEN
    RETURN;
  END IF;

  -- Deleted-offer lines (null id, flag set) enter the offer branch,
  -- where the offer join matches nothing, instead of wrongly
  -- crediting variant/parent pools; the branch no longer requires
  -- the parent managed flag (creation parity).
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    IF v_item.product_offer_id IS NOT NULL THEN
      UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+v_request.requested_count
      FROM public.products product WHERE offer.id=v_item.product_offer_id AND offer.product_id=v_item.product_id
        AND offer.merchant_id=v_order.merchant_id AND offer.condition IS NOT DISTINCT FROM v_item.condition AND product.id=offer.product_id AND product.manage_stock=true;$$,
    $$    IF v_item.product_offer_id IS NOT NULL OR v_item.offer_line IS TRUE THEN
      UPDATE public.product_offers offer SET stock_quantity=offer.stock_quantity+v_request.requested_count
      FROM public.products product WHERE offer.id=v_item.product_offer_id AND offer.product_id=v_item.product_id
        AND offer.merchant_id=v_order.merchant_id AND offer.condition IS NOT DISTINCT FROM v_item.condition AND product.id=offer.product_id;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_redvault_offer_final_branch_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

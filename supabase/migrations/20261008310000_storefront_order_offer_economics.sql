-- Resolve the selected condition offer's live price and inventory inside the
-- transactional storefront-order function. M12 stages and persists offer_id,
-- but the RPC still prices every non-variant line from product.price and
-- decrements the parent product's stock — so an offer-priced expected_total
-- fails with order_total_mismatch (or the shopper is charged the parent
-- price), an in-stock offer on a zero-stock parent fails with
-- insufficient_stock, and the offer's own stock is never decremented.
-- This patch joins the live offer row at staging time (same product and
-- merchant, status active — matching public.get_product_offers), prices
-- offer lines from the offer, decrements offer stock, and rejects unknown
-- or inactive offers with invalid_offer. Variant lines keep variant
-- economics; parent-priced lines are untouched. The three restock helpers
-- mirror the change so cancelling an offer order restores the offer's
-- stock instead of inflating the parent's.
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
  IF strpos(lower(v_definition), 'offer_price') > 0 THEN
    RETURN;
  END IF;

  -- 1. Temp staging row carries the resolved live offer price.
  v_before := v_definition;
  v_updated := replace(
    v_definition,
    $$    line_ordinal INTEGER,
    offer_id UUID
  ) ON COMMIT DROP;$$,
    $$    line_ordinal INTEGER,
    offer_id UUID,
    offer_price NUMERIC
  ) ON COMMIT DROP;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_price_temp_table_not_found';
  END IF;

  -- 2. Temp staging insert lists the offer-price column.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    line_ordinal,
    offer_id
  )
  SELECT$$,
    $$    line_ordinal,
    offer_id,
    offer_price
  )
  SELECT$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_price_temp_insert_not_found';
  END IF;

  -- 3. Staging select forwards the joined live offer price.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    r.line_ordinal,
    r.offer_id
  FROM ($$,
    $$    r.line_ordinal,
    r.offer_id,
    po.price
  FROM ($$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_price_staging_select_not_found';
  END IF;

  -- 4. Staging joins the live offer row (same product and merchant, active).
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  LEFT JOIN public.product_variants v
    ON r.variant_id IS NOT NULL
    AND v.id = r.variant_id
    AND v.product_id = p.id;$$,
    $$  LEFT JOIN public.product_variants v
    ON r.variant_id IS NOT NULL
    AND v.id = r.variant_id
    AND v.product_id = p.id
  LEFT JOIN public.product_offers po
    ON r.offer_id IS NOT NULL
    AND po.id = r.offer_id
    AND po.product_id = p.id
    AND po.merchant_id = p_merchant_id
    AND po.status = 'active';$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_join_not_found';
  END IF;

  -- 5. Subtotal, VAT, and stored line price resolve variant, then offer,
  -- then parent pricing. All three sites share one expression.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    'COALESCE(t.price_override, t.base_price)',
    'COALESCE(t.price_override, t.offer_price, t.base_price)'
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_price_formula_not_found';
  END IF;
  IF strpos(v_updated, 'COALESCE(t.price_override, t.base_price)') > 0 THEN
    RAISE EXCEPTION 'storefront_order_offer_price_formula_partial';
  END IF;

  -- 6. Declare the invalid-offer counter beside the variant one.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  v_invalid_variant_count INTEGER;
  v_retry_attempt INT := 0;$$,
    $$  v_invalid_variant_count INTEGER;
  v_invalid_offer_count INTEGER;
  v_retry_attempt INT := 0;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_counter_declare_not_found';
  END IF;

  -- 7. Validation counts offer lines that joined no live offer row.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    COUNT(*) FILTER (
      WHERE t.variant_id IS NOT NULL AND t.variant_stock IS NULL
    ) AS invalid_variant_count
  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count$$,
    $$    COUNT(*) FILTER (
      WHERE t.variant_id IS NOT NULL AND t.variant_stock IS NULL
    ) AS invalid_variant_count,
    COUNT(*) FILTER (
      WHERE t.offer_id IS NOT NULL AND t.offer_price IS NULL
    ) AS invalid_offer_count
  INTO v_invalid_item_count, v_invalid_quantity_count, v_invalid_variant_count, v_invalid_offer_count$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_validation_not_found';
  END IF;

  -- 8. Unknown, foreign, or inactive offers fail before any side effect.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;$$,
    $$  IF v_invalid_variant_count > 0 THEN
    RAISE EXCEPTION 'invalid_variant';
  END IF;

  IF v_invalid_offer_count > 0 THEN
    RAISE EXCEPTION 'invalid_offer';
  END IF;$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_reject_not_found';
  END IF;

  -- 9. Stock loop aggregates and orders by offer so offer rows lock in a
  -- stable order alongside product and variant rows.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$    SELECT
      t.product_id,
      t.variant_id,
      SUM(t.quantity)::INTEGER AS total_quantity,
      BOOL_OR(t.manage_stock) AS manage_stock
    FROM tmp_storefront_order_items t
    GROUP BY t.product_id, t.variant_id
    ORDER BY t.product_id, t.variant_id$$,
    $$    SELECT
      t.product_id,
      t.variant_id,
      t.offer_id,
      SUM(t.quantity)::INTEGER AS total_quantity,
      BOOL_OR(t.manage_stock) AS manage_stock
    FROM tmp_storefront_order_items t
    GROUP BY t.product_id, t.variant_id, t.offer_id
    ORDER BY t.product_id, t.variant_id, t.offer_id$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_stock_loop_not_found';
  END IF;

  -- 10. Offer lines decrement offer stock; variant lines keep variant
  -- economics and parent-priced lines keep parent economics.
  v_before := v_updated;
  v_updated := replace(
    v_updated,
    $$      IF stock_rec.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock_quantity = stock_quantity - stock_rec.total_quantity
        WHERE product_variants.id = stock_rec.variant_id
          AND stock_quantity >= stock_rec.total_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient_variant_stock';
        END IF;
      ELSE$$,
    $$      IF stock_rec.variant_id IS NOT NULL THEN
        UPDATE public.product_variants
        SET stock_quantity = stock_quantity - stock_rec.total_quantity
        WHERE product_variants.id = stock_rec.variant_id
          AND stock_quantity >= stock_rec.total_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient_variant_stock';
        END IF;
      ELSIF stock_rec.offer_id IS NOT NULL THEN
        UPDATE public.product_offers
        SET stock_quantity = stock_quantity - stock_rec.total_quantity
        WHERE product_offers.id = stock_rec.offer_id
          AND stock_quantity >= stock_rec.total_quantity;

        IF NOT FOUND THEN
          RAISE EXCEPTION 'insufficient_offer_stock';
        END IF;
      ELSE$$
  );
  IF v_updated = v_before THEN
    RAISE EXCEPTION 'storefront_order_offer_stock_branch_not_found';
  END IF;

  EXECUTE v_updated;
END;
$migration$;

-- Cancelling an offer order must restore the offer's stock: the create path
-- above no longer decrements the parent for offer lines, so the restock
-- helpers exclude offer lines from the product branch and restock the
-- offer row instead. All three helpers share the product-branch shape; the
-- redvault and serialized variants mirror their own release/policy filters.
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

  IF strpos(lower(v_definition), 'oi.offer_id') = 0 THEN
    v_before := v_definition;
    v_updated := replace(
      v_definition,
      $$      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL$$,
      $$      AND oi.variant_id IS NULL
      AND oi.offer_id IS NULL
      AND oi.product_id IS NOT NULL$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_product_branch_not_found';
    END IF;

    v_before := v_updated;
    v_updated := replace(
      v_updated,
      $$  WHERE p.id = agg.product_id;
END;$$,
      $$  WHERE p.id = agg.product_id;

  UPDATE public.product_offers po
  SET stock_quantity = po.stock_quantity + agg.qty
  FROM (
    SELECT oi.offer_id AS offer_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NULL
      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.offer_id
  ) agg
  WHERE po.id = agg.offer_id;
END;$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_offer_branch_not_found';
    END IF;

    EXECUTE v_updated;
  END IF;

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

  IF strpos(lower(v_definition), 'oi.offer_id') = 0 THEN
    v_before := v_definition;
    v_updated := replace(
      v_definition,
      $$      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL$$,
      $$      AND oi.variant_id IS NULL
      AND oi.offer_id IS NULL
      AND oi.product_id IS NOT NULL$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_redvault_product_branch_not_found';
    END IF;

    v_before := v_updated;
    v_updated := replace(
      v_updated,
      $$  WHERE p.id = agg.product_id;
END;$$,
      $$  WHERE p.id = agg.product_id;

  UPDATE public.product_offers po
  SET stock_quantity = po.stock_quantity + agg.qty
  FROM (
    SELECT oi.offer_id AS offer_id,
      SUM(CASE
        WHEN pp.inventory_tracking_policy = 'serialized_strict'
        THEN oi.quantity
        ELSE GREATEST(oi.quantity - COALESCE(rel.released, 0), 0)
      END)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    LEFT JOIN (
      SELECT link.order_item_id, count(*)::int AS released
      FROM private.uba_redvault_refund_line_allocations AS link
      JOIN private.uba_redvault_refunds AS refund ON refund.id = link.refund_id
      JOIN private.uba_redvault_refund_lifecycle AS lifecycle ON lifecycle.refund_id = refund.id
      JOIN private.uba_redvault_payment_attempts AS attempt ON attempt.id = refund.attempt_id
      WHERE attempt.order_id = p_order_id
        AND refund.state = 'processed'
        AND lifecycle.inventory_state = 'released'
      GROUP BY link.order_item_id
    ) rel ON rel.order_item_id = oi.id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NULL
      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
    GROUP BY oi.offer_id
  ) agg
  WHERE po.id = agg.offer_id;
END;$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_redvault_offer_branch_not_found';
    END IF;

    EXECUTE v_updated;
  END IF;

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

  IF strpos(lower(v_definition), 'oi.offer_id') = 0 THEN
    v_before := v_definition;
    v_updated := replace(
      v_definition,
      $$      AND oi.variant_id IS NULL
      AND oi.product_id IS NOT NULL$$,
      $$      AND oi.variant_id IS NULL
      AND oi.offer_id IS NULL
      AND oi.product_id IS NOT NULL$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_serialized_product_branch_not_found';
    END IF;

    v_before := v_updated;
    v_updated := replace(
      v_updated,
      $$  WHERE p.id = agg.product_id;
END;$$,
      $$  WHERE p.id = agg.product_id;

  UPDATE public.product_offers po
  SET stock_quantity = po.stock_quantity + agg.qty
  FROM (
    SELECT oi.offer_id AS offer_id, SUM(oi.quantity)::int AS qty
    FROM public.order_items oi
    JOIN public.products pp ON pp.id = oi.product_id
    WHERE oi.order_id = p_order_id
      AND oi.variant_id IS NULL
      AND oi.offer_id IS NOT NULL
      AND COALESCE(pp.manage_stock, false) = true
      AND pp.inventory_tracking_policy IS DISTINCT FROM 'serialized_strict'
    GROUP BY oi.offer_id
  ) agg
  WHERE po.id = agg.offer_id;
END;$$
    );
    IF v_updated = v_before THEN
      RAISE EXCEPTION 'storefront_restock_serialized_offer_branch_not_found';
    END IF;

    EXECUTE v_updated;
  END IF;
END;
$migration$;

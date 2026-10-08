-- Bounded server-side search for the mobile-admin Transactions screen.
--
-- Replaces the unbounded client-side full-history scan previously used while
-- searching: the client sends normalized terms and hydrates only the matching
-- order ids through the existing transaction-review fallback chain. The
-- predicate set is intentionally a superset of the client multi-term filter
-- (order scalars, fulfillment JSONB, item rows, product/variant rows), so the
-- client-side refinement over hydrated rows stays exact while only matching
-- records transfer.

CREATE OR REPLACE FUNCTION public.search_mobile_admin_transaction_review_orders(
  p_merchant_id uuid,
  p_terms text[],
  p_limit integer DEFAULT 100
)
RETURNS TABLE (order_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_caller_role text := COALESCE((SELECT auth.role()), '');
  v_terms text[];
  v_limit integer := LEAST(GREATEST(COALESCE(p_limit, 100), 1), 200);
  v_has_cancelled_at boolean := false;
  v_has_transaction_date boolean := false;
  v_has_item_variant_id boolean := false;
  v_has_item_supplier_name boolean := false;
  v_has_product_metadata boolean := false;
  v_has_product_variants boolean := false;
  v_has_unit_costs boolean := false;
  v_sql text;
BEGIN
  IF p_merchant_id IS NULL THEN
    RAISE EXCEPTION 'merchant_id_required' USING ERRCODE = '22023';
  END IF;

  -- Same authorization boundary as get_mobile_admin_order_counts: active
  -- merchant membership is sufficient for this read-only search; row access
  -- is safe to bypass only after this check passes.
  IF v_caller_role <> 'service_role'
    AND public.has_merchant_access(p_merchant_id) IS NOT TRUE THEN
    RAISE EXCEPTION 'insufficient_privilege' USING ERRCODE = '42501';
  END IF;

  -- Normalize defensively: blank terms would match every row under ILIKE, so
  -- drop them; cap term count and length to bound planning cost.
  SELECT COALESCE(array_agg(term ORDER BY term), '{}')
  INTO v_terms
  FROM (
    SELECT DISTINCT left(btrim(term), 60) AS term
    FROM unnest(p_terms) AS term
    WHERE btrim(term) <> ''
    LIMIT 10
  ) AS distinct_terms;

  IF v_terms = '{}' THEN
    RETURN;
  END IF;

  -- Older merchant databases may predate newer transaction-review columns;
  -- probe the catalog so one function serves every schema the client
  -- fallback chain supports.
  SELECT
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name = 'cancelled_at'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'orders'
        AND column_name = 'transaction_date'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items'
        AND column_name = 'variant_id'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'order_items'
        AND column_name = 'supplier_name'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'products'
        AND column_name = 'metadata'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'product_variants'
    ),
    EXISTS (
      SELECT 1 FROM information_schema.tables
      WHERE table_schema = 'public' AND table_name = 'order_item_unit_costs'
    )
  INTO
    v_has_cancelled_at,
    v_has_transaction_date,
    v_has_item_variant_id,
    v_has_item_supplier_name,
    v_has_product_metadata,
    v_has_product_variants,
    v_has_unit_costs;

  v_sql := $query$
    WITH search_patterns AS (
      SELECT '%' || REPLACE(REPLACE(REPLACE(term, '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pattern
      FROM unnest($2) AS term
    )
    SELECT o.id AS order_id
    FROM public.orders AS o
    WHERE o.merchant_id = $1
      AND o.payment_status = 'paid'
      AND (
        o.shipping_status IS NULL
        OR o.shipping_status NOT IN ('cancelled', 'canceled', 'returned')
      )
  $query$;

  IF v_has_cancelled_at THEN
    v_sql := v_sql || $query$
      AND o.cancelled_at IS NULL
    $query$;
  END IF;

  v_sql := v_sql || $query$
      AND NOT EXISTS (
        SELECT 1
        FROM search_patterns
        WHERE (
          o.id::text ILIKE search_patterns.pattern ESCAPE '\'
          OR o.order_number ILIKE search_patterns.pattern ESCAPE '\'
          OR o.customer_name ILIKE search_patterns.pattern ESCAPE '\'
          OR o.customer_email ILIKE search_patterns.pattern ESCAPE '\'
          OR o.customer_phone ILIKE search_patterns.pattern ESCAPE '\'
          OR o.payment_method ILIKE search_patterns.pattern ESCAPE '\'
          OR o.total::text ILIKE search_patterns.pattern ESCAPE '\'
          OR o.fulfillment_details::text ILIKE search_patterns.pattern ESCAPE '\'
          OR o.created_at::text ILIKE search_patterns.pattern ESCAPE '\'
          OR to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE search_patterns.pattern ESCAPE '\'
  $query$;

  IF v_has_transaction_date THEN
    v_sql := v_sql || $query$
          OR o.transaction_date::text ILIKE search_patterns.pattern ESCAPE '\'
          OR to_char(o.transaction_date AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE search_patterns.pattern ESCAPE '\'
    $query$;
  END IF;

  v_sql := v_sql || $query$
          OR EXISTS (
            SELECT 1
            FROM public.order_items AS oi
            WHERE oi.order_id = o.id
              AND (
                oi.id::text ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.name ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.price::text ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.quantity::text ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.product_id::text ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.fulfillment_data::text ILIKE search_patterns.pattern ESCAPE '\'
  $query$;

  IF v_has_item_variant_id THEN
    v_sql := v_sql || $query$
                OR oi.variant_id::text ILIKE search_patterns.pattern ESCAPE '\'
    $query$;
  END IF;

  IF v_has_item_supplier_name THEN
    v_sql := v_sql || $query$
                OR oi.supplier_name ILIKE search_patterns.pattern ESCAPE '\'
    $query$;
  END IF;

  v_sql := v_sql || $query$
                OR EXISTS (
                  SELECT 1
                  FROM public.products AS p
                  WHERE p.id = oi.product_id
                    AND (
                      p.sku ILIKE search_patterns.pattern ESCAPE '\'
  $query$;

  IF v_has_product_metadata THEN
    v_sql := v_sql || $query$
                      OR p.metadata::text ILIKE search_patterns.pattern ESCAPE '\'
    $query$;
  END IF;

  v_sql := v_sql || $query$
                    )
                )
  $query$;

  IF v_has_product_variants AND v_has_item_variant_id THEN
    v_sql := v_sql || $query$
                OR EXISTS (
                  SELECT 1
                  FROM public.product_variants AS v
                  WHERE v.id = oi.variant_id
                    AND (
                      v.sku ILIKE search_patterns.pattern ESCAPE '\'
                      OR v.condition ILIKE search_patterns.pattern ESCAPE '\'
                      OR v.attributes::text ILIKE search_patterns.pattern ESCAPE '\'
                    )
                )
    $query$;
  END IF;

  IF v_has_unit_costs THEN
    v_sql := v_sql || $query$
                OR EXISTS (
                  SELECT 1
                  FROM public.order_item_unit_costs AS u
                  WHERE u.order_item_id = oi.id
                    AND u.merchant_id = $1
                    AND (
                      u.identifier_value ILIKE search_patterns.pattern ESCAPE '\'
                      OR u.supplier_name ILIKE search_patterns.pattern ESCAPE '\'
                    )
                )
    $query$;
  END IF;

  v_sql := v_sql || $query$
              )
          )
        ) IS NOT TRUE
      )
    ORDER BY o.created_at DESC, o.id DESC
    LIMIT $3
  $query$;

  RETURN QUERY EXECUTE v_sql USING p_merchant_id, v_terms, v_limit;
END;
$$;

ALTER FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer)
  OWNER TO postgres;

COMMENT ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer) IS
  'Returns paid, visible transaction-review order ids matching every search term after one merchant-access check.';

REVOKE ALL ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer)
  TO authenticated, service_role;

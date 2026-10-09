-- Bounded server-side search for the mobile-admin Transactions screen.
--
-- Replaces the unbounded client-side full-history scan previously used while
-- searching: the client sends normalized terms and hydrates only the matching
-- order ids through the existing transaction-review fallback chain. Predicates
-- match the client multi-term filter exactly (order scalars, fulfillment
-- JSONB values, item rows, product/variant rows, unit-cost ledger), so only
-- matching records transfer.
--
-- Performance note: leading-wildcard ILIKE scans the merchant's paid history,
-- so cost grows linearly. Measured ~200ms for selective single-term searches
-- over 10k paid orders with production-like indexes (Oct 2026, PostgreSQL 16);
-- broad terms short-circuit faster. Revisit with pg_trgm expression indexes
-- if p95 search latency exceeds 1s.

-- All scalar string/number leaves of a JSONB document, mirroring the
-- client collectStrings matcher (object keys and structure never match).
CREATE OR REPLACE FUNCTION public.transaction_review_jsonb_search_values(
  data jsonb
)
RETURNS SETOF text
LANGUAGE sql
IMMUTABLE
SET search_path = ''
AS $$
  WITH RECURSIVE walk(value) AS (
    SELECT data AS value
    UNION ALL
    SELECT elem.value
    FROM walk
    CROSS JOIN LATERAL (
      SELECT value FROM pg_catalog.jsonb_each(walk.value)
      WHERE pg_catalog.jsonb_typeof(walk.value) = 'object'
      UNION ALL
      SELECT value FROM pg_catalog.jsonb_array_elements(walk.value)
      WHERE pg_catalog.jsonb_typeof(walk.value) = 'array'
    ) AS elem
    WHERE pg_catalog.jsonb_typeof(walk.value) IN ('object', 'array')
  )
  SELECT
    CASE
      WHEN pg_catalog.jsonb_typeof(walk.value) = 'string'
        THEN walk.value #>> '{}'
      ELSE walk.value::text
    END
  FROM walk
  WHERE pg_catalog.jsonb_typeof(walk.value) IN ('string', 'number');
$$;

ALTER FUNCTION public.transaction_review_jsonb_search_values(jsonb)
  OWNER TO postgres;

COMMENT ON FUNCTION public.transaction_review_jsonb_search_values(jsonb) IS
  'Returns JSONB scalar leaves for transaction-review search; keys never match.';

REVOKE ALL ON FUNCTION public.transaction_review_jsonb_search_values(jsonb)
  FROM PUBLIC, anon, authenticated;

-- Dropped first (both the pre-offset signature and this one) so the file
-- stays re-runnable while the signature evolves pre-merge.
DROP FUNCTION IF EXISTS public.search_mobile_admin_transaction_review_orders(
  uuid, text[], integer
);
DROP FUNCTION IF EXISTS public.search_mobile_admin_transaction_review_orders(
  uuid, text[], integer, integer
);

CREATE FUNCTION public.search_mobile_admin_transaction_review_orders(
  p_merchant_id uuid,
  p_terms text[],
  p_limit integer DEFAULT 100,
  p_offset integer DEFAULT 0
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
  -- Paging support for post-filter backfill (e.g. the missing-costs tab):
  -- the client pages while its post-filter set is short. Clamped so a deep
  -- offset cannot force an unbounded sort-and-skip.
  v_offset integer := LEAST(GREATEST(COALESCE(p_offset, 0), 0), 1000);
  v_has_cancelled_at boolean := false;
  v_has_transaction_date boolean := false;
  v_has_item_variant_id boolean := false;
  v_has_item_supplier_name boolean := false;
  v_has_product_metadata boolean := false;
  v_has_product_variants boolean := false;
  v_has_unit_costs boolean := false;
  v_can_read_unit_costs boolean := false;
  v_order_by text := 'o.created_at DESC, o.id DESC';
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

  -- The unit-cost ledger restricts reads to the owner and staff with
  -- orders:edit or analytics:view (owners_and_order_staff_read_unit_costs),
  -- narrower than merchant membership. This function is SECURITY DEFINER,
  -- so the ledger branch applies the same predicate explicitly instead of
  -- relying on RLS; other callers search everything except the ledger.
  -- check_staff_permission returns true for the owner and has existed
  -- since the baseline, so no catalog probe is needed.
  v_can_read_unit_costs :=
    v_caller_role = 'service_role'
    OR public.check_staff_permission(
      (SELECT auth.uid()),
      p_merchant_id,
      'orders',
      'edit'
    )
    OR public.check_staff_permission(
      (SELECT auth.uid()),
      p_merchant_id,
      'analytics',
      'view'
    );

  -- Normalize defensively: blank terms would match every row under ILIKE, so
  -- drop them; cap term count and length to bound planning cost. Terms are
  -- lowercased before DISTINCT to match the client's case-folded splitter
  -- exactly, so case-duplicate raw terms never consume cap slots. Accepted
  -- edge: past the cap, the client's JS sort and this ORDER BY (database
  -- collation) can still select different subsets for non-ASCII terms;
  -- ASCII parity is exact.
  SELECT COALESCE(array_agg(term ORDER BY term), '{}')
  INTO v_terms
  FROM (
    SELECT DISTINCT lower(left(btrim(term), 60)) AS term
    FROM unnest(p_terms) AS term
    WHERE btrim(term) <> ''
    ORDER BY term
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
          OR (
            CASE
              WHEN o.total::text LIKE '%.%'
                THEN rtrim(rtrim(o.total::text, '0'), '.')
              ELSE o.total::text
            END
          ) ILIKE search_patterns.pattern ESCAPE '\'
          OR (
            o.fulfillment_details::text ILIKE search_patterns.pattern ESCAPE '\'
            AND EXISTS (
              SELECT 1
              FROM public.transaction_review_jsonb_search_values(o.fulfillment_details) AS search_value
              WHERE search_value ILIKE search_patterns.pattern ESCAPE '\'
            )
          )
  $query$;

  -- The client search text carries only the effective date
  -- (transaction_date ?? created_at): matching created_at as a separate
  -- alternative would fill the cap with orders whose displayed date
  -- differs, only for client refinement to drop them. Schemas with the
  -- column match the same effective date instead.
  IF v_has_transaction_date THEN
    v_sql := v_sql || $query$
          OR to_char(COALESCE(o.transaction_date, o.created_at) AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE search_patterns.pattern ESCAPE '\'
    $query$;
  ELSE
    v_sql := v_sql || $query$
          OR to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') ILIKE search_patterns.pattern ESCAPE '\'
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
                OR (
                  CASE
                    WHEN oi.price::text LIKE '%.%'
                      THEN rtrim(rtrim(oi.price::text, '0'), '.')
                    ELSE oi.price::text
                  END
                ) ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.quantity::text ILIKE search_patterns.pattern ESCAPE '\'
                OR oi.product_id::text ILIKE search_patterns.pattern ESCAPE '\'
                OR (
                  oi.fulfillment_data::text ILIKE search_patterns.pattern ESCAPE '\'
                  AND EXISTS (
                    SELECT 1
                    FROM public.transaction_review_jsonb_search_values(oi.fulfillment_data) AS search_value
                    WHERE search_value ILIKE search_patterns.pattern ESCAPE '\'
                  )
                )
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
                    -- Same-merchant catalog text only: without this, another
                    -- merchant's SKU/metadata would satisfy the match for
                    -- this merchant's order through a cross-merchant
                    -- product_id reference. Both columns are NOT NULL since
                    -- the baseline, so no catalog probe is needed.
                    AND p.merchant_id = $1
                    AND (
                      p.sku ILIKE search_patterns.pattern ESCAPE '\'
  $query$;

  IF v_has_product_metadata THEN
    v_sql := v_sql || $query$
                      OR (
                        p.metadata::text ILIKE search_patterns.pattern ESCAPE '\'
                        AND EXISTS (
                          SELECT 1
                          FROM public.transaction_review_jsonb_search_values(p.metadata) AS search_value
                          WHERE search_value ILIKE search_patterns.pattern ESCAPE '\'
                        )
                      )
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
                    AND v.merchant_id = $1
                    AND (
                      v.sku ILIKE search_patterns.pattern ESCAPE '\'
                      OR v.condition ILIKE search_patterns.pattern ESCAPE '\'
                      OR (
                        v.attributes::text ILIKE search_patterns.pattern ESCAPE '\'
                        AND EXISTS (
                          SELECT 1
                          FROM public.transaction_review_jsonb_search_values(v.attributes) AS search_value
                          WHERE search_value ILIKE search_patterns.pattern ESCAPE '\'
                        )
                      )
                    )
                )
    $query$;
  END IF;

  IF v_has_unit_costs AND v_can_read_unit_costs THEN
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

  -- Rank candidates by effective transaction date so a recent null-date
  -- order is not buried behind every dated row when the cap applies. Equal
  -- effective dates break by creation time (matching browse order) before
  -- the id tie-break, so the capped set keeps the newest rows rather than
  -- an arbitrary UUID slice.
  IF v_has_transaction_date THEN
    v_order_by :=
      'COALESCE(o.transaction_date, o.created_at) DESC, o.created_at DESC, o.id DESC';
  END IF;

  v_sql := v_sql || $query$
              )
          )
        ) IS NOT TRUE
      )
    ORDER BY
  $query$ || v_order_by || $query$
    LIMIT $3 OFFSET $4
  $query$;

  RETURN QUERY EXECUTE v_sql USING p_merchant_id, v_terms, v_limit, v_offset;
END;
$$;

ALTER FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer, integer)
  OWNER TO postgres;

COMMENT ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer, integer) IS
  'Returns paid, visible transaction-review order ids matching every search term after one merchant-access check.';

REVOKE ALL ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer, integer)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.search_mobile_admin_transaction_review_orders(uuid, text[], integer, integer)
  TO authenticated, service_role;

-- Include completed wallet/savings/store-credit GIGL funding in settled
-- retention gates. Fully internal-credit checkouts never create
-- merchant_settlements rows, so settlement-only sums treated them as
-- unretained and allowed quote/economics rebinds.

CREATE OR REPLACE FUNCTION private.order_settled_gigl_retained_amount(
  p_order_id uuid,
  p_merchant_id uuid
)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH settlement_retained AS (
    SELECT COALESCE(SUM(
      GREATEST(
        COALESCE((settlement.metadata ->> 'retained_shipping_amount')::numeric, 0),
        0
      )
    ), 0) AS amount
    FROM public.merchant_settlements AS settlement
    WHERE settlement.source_type = 'order'
      AND settlement.source_id = p_order_id
      AND settlement.merchant_id = p_merchant_id
      AND settlement.status IS DISTINCT FROM 'cancelled'
  ),
  order_retention AS (
    SELECT
      o.shipping_funding_source,
      GREATEST(COALESCE(o.shipping_platform_retained_amount, 0), 0) AS stamped_retained
    FROM public.orders AS o
    WHERE o.id = p_order_id
      AND o.merchant_id = p_merchant_id
  ),
  internal_credit AS (
    SELECT GREATEST(
      COALESCE((
        SELECT SUM(GREATEST(COALESCE(t.amount, 0), 0))
        FROM public.transactions AS t
        WHERE t.merchant_id = p_merchant_id
          AND t.order_id = p_order_id
          AND t.status = 'completed'
          AND lower(btrim(COALESCE(t.gateway, ''))) = ANY (
            ARRAY['wallet', 'savings', 'store_credit']::text[]
          )
      ), 0),
      COALESCE((
        SELECT SUM(GREATEST(COALESCE(w.amount, 0), 0))
        FROM public.customer_wallet_transactions AS w
        WHERE w.merchant_id = p_merchant_id
          AND w.source_type = 'order_redemption'
          AND w.source_id = p_order_id
          AND w.status = 'completed'
      ), 0)
      + COALESCE((
        SELECT SUM(GREATEST(COALESCE(s.amount, 0), 0))
        FROM public.customer_savings_redemptions AS s
        WHERE s.merchant_id = p_merchant_id
          AND s.order_id = p_order_id
          AND s.metadata->>'reversed_at' IS NULL
      ), 0)
    ) AS amount
  )
  SELECT GREATEST(
    (SELECT amount FROM settlement_retained),
    CASE
      WHEN (SELECT shipping_funding_source FROM order_retention)
           IS NOT DISTINCT FROM 'customer_checkout'
        THEN LEAST(
          (SELECT stamped_retained FROM order_retention),
          (SELECT amount FROM internal_credit)
        )
      ELSE 0
    END
  );
$$;

REVOKE ALL ON FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid)
  FROM PUBLIC;

COMMENT ON FUNCTION private.order_settled_gigl_retained_amount(uuid, uuid) IS
  'Settled GIGL retention from merchant_settlements plus capped internal-credit funding for customer_checkout orders; quiz vouchers with no completed credits stay at zero.';

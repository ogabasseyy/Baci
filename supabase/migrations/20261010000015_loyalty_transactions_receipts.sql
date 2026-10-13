-- Customer loyalty transactions with uncapped redemption receipts
-- (issue #3165).
--
-- Extracted from get_loyalty_status (repository 300-line limit): recent
-- activity (10) UNION the redemption rows of still-unused, unexpired
-- codes, so a lost redeem response stays recoverable no matter how many
-- newer transactions land. The NOT EXISTS keeps receipts already inside
-- the window from doubling.
CREATE OR REPLACE FUNCTION public.get_loyalty_transactions(
  p_merchant_id uuid,
  p_customer_id uuid
) RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  WITH recent AS (
    SELECT pt.id, pt.points, pt.type, pt.description, pt.created_at,
      pt.source, pt.source_id
    FROM public.points_transactions AS pt
    WHERE pt.merchant_id = p_merchant_id
      AND pt.customer_id = p_customer_id
      -- Same source exclusion as the FIFO ledger: VTU/wallet rows
      -- update customers.loyalty_points, not the loyalty balance.
      AND (
        pt.source IS NULL
        OR pt.source NOT IN ('vtu_airtime_purchase', 'wallet_redemption')
      )
    ORDER BY pt.created_at DESC
    LIMIT 10
  )
  SELECT COALESCE(jsonb_agg(txn ORDER BY txn->>'created_at' DESC), '[]'::jsonb)
  FROM (
    SELECT jsonb_build_object(
      'id', pt.id,
      'points', pt.points,
      'type', pt.type,
      'description', pt.description,
      'created_at', pt.created_at,
      -- Recovery receipt: a capped reward leaves the catalog once its
      -- response is lost, so history carries the issued code.
      -- Store credit is fulfilled into the wallet at redeem, so its
      -- minted code is never presentable and stays hidden.
      'redemption_code', CASE WHEN rr.reward_type = 'store_credit'
        THEN NULL ELSE rr.discount_code END
    ) AS txn
    FROM recent AS pt
    LEFT JOIN public.reward_redemptions AS rr
      ON pt.source = 'redemption' AND pt.source_id = rr.id::text
    UNION ALL
    SELECT jsonb_build_object(
      'id', pt.id,
      'points', pt.points,
      'type', pt.type,
      'description', pt.description,
      'created_at', pt.created_at,
      'redemption_code', CASE WHEN rr.reward_type = 'store_credit'
        THEN NULL ELSE rr.discount_code END
    ) AS txn
    FROM public.points_transactions AS pt
    JOIN public.reward_redemptions AS rr
      ON pt.source = 'redemption' AND pt.source_id = rr.id::text
    WHERE pt.merchant_id = p_merchant_id
      AND pt.customer_id = p_customer_id
      -- Effective-used mirrors the checkout resolver: a claim whose
      -- order was cancelled (release skipped under lock) is reusable
      -- and its receipt must stay recoverable here.
      AND (COALESCE(rr.used, false) = false
        OR EXISTS (
          SELECT 1 FROM public.orders AS o
          WHERE o.id = rr.used_on_order_id
            AND (o.shipping_status = 'cancelled'
              OR o.payment_status = 'cancelled')
        ))
      AND (rr.expires_at IS NULL OR rr.expires_at > pg_catalog.now())
      AND NOT EXISTS (
        SELECT 1 FROM recent WHERE recent.id = pt.id
      )
  ) AS txns;
$$;

-- Helper with no ownership check: only the SECURITY DEFINER loyalty RPCs
-- may call it (definer's rights), never direct session callers.
REVOKE ALL ON FUNCTION public.get_loyalty_transactions(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_loyalty_transactions(uuid, uuid)
  TO service_role;

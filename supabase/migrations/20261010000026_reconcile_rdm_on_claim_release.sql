-- Reconcile RDM namespace collisions when a claim is released (issue
-- #3165, follow-up to 20261010000025): migration 25 deactivates a
-- merchant code only while the colliding redemption is unused and
-- unclaimed. A redemption claimed by an order that later cancels
-- becomes reusable again (migration 14 releases the claim), but
-- nothing revisited the merchant code, so it kept shadowing the
-- customer's paid code forever. Two changes close the gap:
--
-- 1. The reconciliation predicate also treats a redemption stamped
--    to a terminally cancelled order as reconcilable (rows the
--    release trigger skipped under lock contention stay stamped,
--    and the checkout resolver already reports them as reusable).
-- 2. The release trigger deactivates a colliding active merchant
--    code for every claim it releases, in the same update that
--    frees the redemption.
CREATE OR REPLACE FUNCTION public.reconcile_rdm_namespace_collisions()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_count integer;
BEGIN
  UPDATE public.discount_codes AS dc
  SET is_active = false
  WHERE dc.is_active IS TRUE
    AND pg_catalog.upper(dc.code) LIKE 'RDM-%'
    AND EXISTS (
      SELECT 1
      FROM public.reward_redemptions AS rr
      WHERE rr.merchant_id = dc.merchant_id
        AND pg_catalog.upper(rr.discount_code) = pg_catalog.upper(dc.code)
        AND (rr.expires_at IS NULL OR rr.expires_at > pg_catalog.now())
        AND (
          (rr.used IS NOT TRUE AND rr.used_on_order_id IS NULL)
          OR EXISTS (
            SELECT 1
            FROM public.orders AS o
            WHERE o.id = rr.used_on_order_id
              AND (
                public.loyalty_status_is_cancelled(o.shipping_status)
                OR public.loyalty_status_is_cancelled(o.payment_status)
              )
          )
        )
    );
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.reconcile_rdm_namespace_collisions()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reconcile_rdm_namespace_collisions()
  TO service_role;

CREATE OR REPLACE FUNCTION public.release_loyalty_claims_on_order_cancel()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  -- Both terminal spellings count: the order update schema accepts
  -- 'cancelled' and 'canceled', and the routes treat both as terminal.
  IF (public.loyalty_status_is_cancelled(NEW.shipping_status)
      AND NOT public.loyalty_status_is_cancelled(OLD.shipping_status))
     OR (public.loyalty_status_is_cancelled(NEW.payment_status)
      AND NOT public.loyalty_status_is_cancelled(OLD.payment_status)) THEN
    -- SKIP LOCKED: a checkout retry can hold a claim row while waiting
    -- on this order (redemption->order); waiting here would invert to
    -- order->redemption and deadlock. Skipped rows stay stamped to a
    -- terminally cancelled order, which the wrapper treats as released.
    WITH released AS (
      UPDATE public.reward_redemptions AS rr
      SET used = false, used_on_order_id = NULL, used_at = NULL
      WHERE rr.used_on_order_id = NEW.id
        AND rr.id IN (
          SELECT locked.id
          FROM public.reward_redemptions AS locked
          WHERE locked.used_on_order_id = NEW.id
          FOR UPDATE SKIP LOCKED
        )
      RETURNING rr.merchant_id, rr.discount_code
    )
    -- The freed code is spendable again; stop any legacy merchant
    -- code from shadowing it (migration 25 reconciled only codes
    -- whose redemptions were unclaimed at deploy time).
    UPDATE public.discount_codes AS dc
    SET is_active = false
    WHERE dc.is_active IS TRUE
      AND pg_catalog.upper(dc.code) LIKE 'RDM-%'
      AND EXISTS (
        SELECT 1
        FROM released AS r
        WHERE r.merchant_id = dc.merchant_id
          AND pg_catalog.upper(r.discount_code) = pg_catalog.upper(dc.code)
      );
  END IF;
  RETURN NEW;
END;
$$;

DO $$
DECLARE
  v_reconciled integer;
BEGIN
  v_reconciled := public.reconcile_rdm_namespace_collisions();
  IF v_reconciled > 0 THEN
    RAISE NOTICE 'deactivated % merchant discount code(s) shadowing loyalty redemptions', v_reconciled;
  END IF;
END;
$$;

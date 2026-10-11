-- Per-leg refund coverage helper (2/5): caps terminal coverage at
-- each payment leg so an overfunded leg cannot zero the remainder.
-- Shared by the manager RPC (part 4) and the status trigger (part 5).

-- Terminal refund coverage capped per payment leg, shared by the
-- manager aggregate and the status trigger below. An overfunded
-- leg's excess is an anomaly for review, never coverage of sibling
-- legs: without the cap, one over-linked refund zeroes the remainder
-- and flips the order refunded while legs sit uncovered and the
-- worker initiates them again (double refund). Attribution mirrors
-- the pre-cap aggregates exactly (linked gateway-matched rows plus
-- sole-external-leg unlinked rows, provider-verified Paystack only);
-- only the per-leg LEAST is new.
CREATE OR REPLACE FUNCTION private.capped_refund_coverage_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_actor uuid;
  v_sole_id uuid;
  v_sole_gateway text;
  v_total numeric;
BEGIN
  -- Null or blank order currencies (legacy rows) price in the
  -- established NGN default, mirroring the manager and dashboard, so
  -- the status trigger and any future caller compare matching money.
  p_currency := COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN');
  -- Defense in depth: EXECUTE stays granted below so denial lands on
  -- the clean schema-USAGE check (revoking crashes, see note there).
  -- This membership gate keeps the helper from becoming a
  -- cross-tenant probing oracle even if a future grant ever opened
  -- private-schema USAGE, mirroring the manager's read rule (owner or
  -- orders refund/view staff). Uid-less contexts (service_role
  -- triggers and claims) carry no end-user identity to confine and
  -- bypass, like everywhere else.
  v_actor := (SELECT auth.uid());
  IF v_actor IS NOT NULL
     AND NOT EXISTS (
       SELECT 1 FROM public.merchants
        WHERE id = p_merchant_id AND user_id = v_actor
     )
     AND NOT public.check_staff_permission(
       v_actor, p_merchant_id, 'orders', 'refund'
     )
     AND NOT public.check_staff_permission(
       v_actor, p_merchant_id, 'orders', 'view'
     ) THEN
    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE = '42501';
  END IF;
  -- No max(uuid) aggregate exists: with exactly one candidate row,
  -- its id is the sole leg's.
  SELECT CASE WHEN count(*) = 1 THEN (array_agg(leg.id))[1] END,
         CASE WHEN count(*) = 1
           THEN max(public.normalized_gateway_name_v1(leg.gateway)) END
    INTO v_sole_id, v_sole_gateway
    FROM public.transactions leg
   WHERE leg.order_id = p_order_id
     AND leg.merchant_id = p_merchant_id
     AND leg.transaction_type = 'payment'
     AND leg.status = 'completed'
     AND leg.amount > 0
     AND UPPER(BTRIM(leg.currency)) = UPPER(BTRIM(p_currency))
     AND COALESCE(public.normalized_gateway_name_v1(leg.gateway), '') NOT IN (
       'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
       'PAY_ON_DELIVERY');
  SELECT COALESCE(SUM(LEAST(per_leg.total, GREATEST(per_leg.leg_amount, 0))), 0)
    INTO v_total
    FROM (
      SELECT leg.amount AS leg_amount, SUM(refund.amount) AS total
        FROM public.transactions leg
        JOIN public.transactions refund
          ON refund.order_id = p_order_id
         AND refund.merchant_id = p_merchant_id
         AND refund.transaction_type = 'refund'
         AND refund.status IN ('completed', 'refunded')
         AND refund.amount > 0
         AND UPPER(BTRIM(refund.currency)) = UPPER(BTRIM(p_currency))
         AND (public.normalized_gateway_name_v1(refund.gateway) <> 'PAYSTACK'
              OR refund.metadata->>'provider_refund_status' = 'processed')
         AND (
           (refund.metadata->>'payment_transaction_id' = leg.id::text
            AND (
              (
                public.normalized_gateway_name_v1(refund.gateway) = 'MANUAL'
                -- Manual rows never cover wallet/savings legs: those
                -- reverse through their own ledgers, mirroring the
                -- claim gate and the executor matcher. Counting one
                -- here would zero the remainder and flip the label
                -- while the reversal never runs.
                AND COALESCE(public.normalized_gateway_name_v1(leg.gateway), '')
                  NOT IN ('WALLET', 'SAVINGS')
                -- A manual row positively declared as Paystack is only
                -- a merchant claim about provider money: it needs
                -- provider confirmation before it can count, mirroring
                -- the claim gate's method/provider rule verbatim.
                -- Counting it here would flip the label to refunded
                -- while the claim still sees the leg uncovered and
                -- never finalizes (UI-refunded / DB-paid strand).
                AND (
                  refund.metadata->>'method' IS DISTINCT FROM 'paystack'
                  OR refund.metadata->>'provider_refund_status' = 'processed'
                )
              )
              OR public.normalized_gateway_name_v1(refund.gateway)
                = public.normalized_gateway_name_v1(leg.gateway)
            ))
           OR (refund.metadata->>'payment_transaction_id' IS NULL
               AND v_sole_id IS NOT NULL
               AND leg.id = v_sole_id
               AND public.normalized_gateway_name_v1(refund.gateway) = v_sole_gateway)
         )
       WHERE leg.order_id = p_order_id
         AND leg.merchant_id = p_merchant_id
         AND leg.transaction_type = 'payment'
         -- The leg itself must price in the order currency: a legacy
         -- foreign-currency leg never absorbs order-currency refunds,
         -- mirroring the claim gate (otherwise the remainder zeroes
         -- and the label flips while the claim keeps the leg open).
         AND UPPER(BTRIM(leg.currency)) = UPPER(BTRIM(p_currency))
       GROUP BY leg.id, leg.amount
    ) per_leg;
  RETURN v_total;
END; $$;
REVOKE ALL ON FUNCTION private.capped_refund_coverage_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
-- service_role fires the sync trigger, so it needs EXECUTE; without
-- it, Postgres 18 segfaults on the denial path instead of raising
-- 42501 (pre-existing backend bug, reproducible on any revoked private
-- function). authenticated gets EXECUTE too so any hypothetical
-- invocation fails at the schema-USAGE check (clean 42501) rather
-- than the crashing function-ACL check; the private-schema boundary
-- itself stays USAGE-denied, as the suite asserts.
GRANT EXECUTE ON FUNCTION private.capped_refund_coverage_v1(uuid,uuid,text)
  TO service_role, authenticated;

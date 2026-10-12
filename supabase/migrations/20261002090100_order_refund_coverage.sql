-- Per-leg refund coverage helper (2/5): caps terminal coverage at
-- each payment leg so an overfunded leg cannot zero the remainder.
-- Shared by the manager RPC (part 4) and the status trigger (part 5).

-- Per-leg attributed refund rows, shared by the capped coverage
-- scalar below and the manager's uncovered-obligation aggregate.
-- One definition so the two can never disagree on attribution
-- (linked gateway-matched rows plus sole-external-leg unlinked
-- rows, provider-verified Paystack only). LEFT JOINED: legs with
-- no attributed rows still report (covered = 0) for the
-- uncovered aggregate; the capped scalar folds them to zero.
CREATE OR REPLACE FUNCTION private.refund_coverage_per_leg_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS TABLE (
  leg_id uuid, leg_amount numeric, covered numeric,
  is_refunded boolean, is_internal boolean, is_funded boolean
) LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_actor uuid;
  v_sole_id uuid;
  v_sole_gateway text;
BEGIN
  -- Null or blank order currencies (legacy rows) price in the
  -- established NGN default, mirroring the manager and dashboard, so
  -- every caller compares matching money.
  p_currency := COALESCE(NULLIF(BTRIM(p_currency), ''), 'NGN');
  -- Same membership gate as the capped scalar: without it this
  -- per-leg listing would be a cross-tenant probing oracle even if
  -- a future grant ever opened private-schema USAGE. Uid-less
  -- contexts (service_role triggers and claims) bypass, like
  -- everywhere else.
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
  RETURN QUERY
    SELECT leg.id, leg.amount, COALESCE(SUM(refund.amount), 0),
      leg.status IS NOT DISTINCT FROM 'refunded',
      COALESCE(public.normalized_gateway_name_v1(leg.gateway), '')
        IN ('WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL',
          'PAY_ON_DELIVERY'),
      COALESCE(leg.status IN ('completed', 'refunded', 'refund_pending'), false)
      FROM public.transactions leg
      LEFT JOIN public.transactions refund
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
     GROUP BY leg.id, leg.amount, leg.status, leg.gateway;
END; $$;
-- Terminal refund coverage capped per payment leg, shared by the
-- manager aggregate and the status trigger below. An overfunded
-- leg's excess is an anomaly for review, never coverage of sibling
-- legs: without the cap, one over-linked refund zeroes the remainder
-- and flips the order refunded while legs sit uncovered and the
-- worker initiates them again (double refund). Attribution comes
-- from the shared per-leg listing; only the per-leg LEAST is new.
-- Self-terminal refunded legs are excluded here (they count once
-- via the payment-side sum): a linked terminal refund row on such
-- a leg must not ALSO count, or the double count zeroes the
-- remainder while sibling legs sit uncovered.
CREATE OR REPLACE FUNCTION private.capped_refund_coverage_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_total numeric;
BEGIN
  -- Membership gate runs inside the per-leg listing (same invoker,
  -- same merchant); no separate gate needed here.
  SELECT COALESCE(SUM(LEAST(per_leg.covered, GREATEST(per_leg.leg_amount, 0))), 0)
    INTO v_total
    FROM private.refund_coverage_per_leg_v1(
      p_order_id, p_merchant_id, p_currency) per_leg
   WHERE NOT per_leg.is_refunded;
  RETURN v_total;
END; $$;
-- Uncovered per-leg obligation: floors the manager's remainder so a
-- superseded capture (a refunded obsolete leg matching amount_paid
-- beside an outstanding one) cannot zero it while the executor
-- still owes the uncovered leg. Only funded legs count (failed
-- legs never held money); self-terminal refunded legs pair their
-- own amount (returned by definition). External gaps sum directly;
-- internal gaps net order-wide against the passed wallet/savings
-- reversals, whose ledgers carry no per-leg link. Held money past
-- amount_paid is an overfunded anomaly for review, not obligation,
-- but the shed is per leg, never order-wide: a leg exceeding the
-- whole order's paid amount is unambiguously over-captured, while
-- aggregate excess across several smaller captures cannot name
-- which capture was superseded, so subtracting it would erase an
-- identified gap on a live leg. Each leg's obligable base is
-- therefore capped at the recorded paid amount, and the recorded
-- paid amount ceilings the total on multi-capture ledgers.
CREATE OR REPLACE FUNCTION private.uncovered_refund_obligation_v1(
  p_order_id uuid, p_merchant_id uuid, p_currency text,
  p_reversed_internal numeric, p_amount_paid numeric
) RETURNS numeric LANGUAGE plpgsql SECURITY INVOKER SET search_path='' AS $$
DECLARE
  v_paid numeric := GREATEST(COALESCE(p_amount_paid, 0), 0);
  v_total numeric;
BEGIN
  -- Membership gate runs inside the per-leg listing (same invoker,
  -- same merchant); no separate gate needed here.
  SELECT COALESCE(SUM(CASE WHEN per_leg.is_funded AND NOT per_leg.is_internal
      THEN GREATEST(LEAST(per_leg.leg_amount, v_paid) - per_leg.covered
        - CASE WHEN per_leg.is_refunded THEN per_leg.leg_amount ELSE 0 END, 0)
      ELSE 0 END), 0)
    + GREATEST(COALESCE(SUM(CASE WHEN per_leg.is_funded AND per_leg.is_internal
      THEN GREATEST(LEAST(per_leg.leg_amount, v_paid) - per_leg.covered
        - CASE WHEN per_leg.is_refunded THEN per_leg.leg_amount ELSE 0 END, 0)
      ELSE 0 END), 0) - COALESCE(p_reversed_internal, 0), 0)
    INTO v_total
    FROM private.refund_coverage_per_leg_v1(
      p_order_id, p_merchant_id, p_currency) per_leg;
  RETURN LEAST(v_total, v_paid);
END; $$;
REVOKE ALL ON FUNCTION private.capped_refund_coverage_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.refund_coverage_per_leg_v1(uuid,uuid,text)
  FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION private.uncovered_refund_obligation_v1(uuid,uuid,text,numeric,numeric)
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
GRANT EXECUTE ON FUNCTION private.refund_coverage_per_leg_v1(uuid,uuid,text)
  TO service_role, authenticated;
GRANT EXECUTE ON FUNCTION private.uncovered_refund_obligation_v1(uuid,uuid,text,numeric,numeric)
  TO service_role, authenticated;

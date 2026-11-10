-- Merchant cancellation: let the merchant choose whether a paid order's
-- refund is queued automatically (Paystack worker, the existing behavior)
-- or handled outside Baci ("cancel only"). Adds an optional third argument
-- p_refund_mode ('automatic' default | 'manual'); NULL means 'automatic', so
-- every existing caller (old mobile-admin builds, the pre-change route) keeps
-- the current behavior.
--
-- 'manual' skips seeding the 'refund' side-effect step, exactly like the
-- cash-only / legacy shape the manual refund recorder already supports (its
-- upsert creates the row when the merchant later records the refund). The
-- order stays paid, cancelled, with the full amount remaining, so the Refund
-- card reports it as not yet refunded and offers "Record manual refund".
-- The customer email is still queued; the mode is stored on the order so the
-- email worker does not promise an automatic refund.
--
-- CREATE OR REPLACE with an added parameter would leave the old
-- (uuid, text) overload beside the new one and make two-argument PostgREST
-- calls ambiguous, so the old signature is dropped and re-created with the
-- same grants (authenticated only). 'manual' needs the owner or the
-- orders.refund permission. The column, the in-flight payment gate and the
-- verified-capture transition live in the preceding helper migration
-- (20261111090000); everything else is unchanged from
-- 20260928185300_fail_closed_on_unknown_abandoned_stamps.sql.
DROP FUNCTION IF EXISTS public.cancel_order_as_merchant(uuid, text);

CREATE OR REPLACE FUNCTION public.cancel_order_as_merchant(
  p_order_id uuid,
  p_reason text DEFAULT NULL,
  p_refund_mode text DEFAULT 'automatic'
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := (SELECT auth.uid());
  v_order record;
  v_reason text := NULLIF(btrim(p_reason), '');
  v_refund_mode text := COALESCE(NULLIF(btrim(p_refund_mode), ''), 'automatic');
  v_wallet_reversed numeric := 0;
  v_savings_reversed numeric := 0;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF v_reason IS NOT NULL AND char_length(v_reason) > 500 THEN
    RAISE EXCEPTION 'reason_too_long' USING ERRCODE = '22001';
  END IF;
  IF v_refund_mode NOT IN ('automatic', 'manual') THEN
    RAISE EXCEPTION 'invalid_refund_mode' USING ERRCODE = '22023';
  END IF;

  SELECT o.merchant_id, o.shipping_status, o.cancelled_at,
         o.payment_status, o.amount_paid, o.total,
         o.cancellation_reason, o.cancelled_by, o.cancellation_refund_mode
    INTO v_order
    FROM public.orders o
   WHERE o.id = p_order_id
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0002';
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = v_actor
    )
    OR public.check_staff_permission(
      v_actor, v_order.merchant_id, 'orders', 'edit'
    )
  ) THEN
    RAISE EXCEPTION 'order_cancel_forbidden' USING ERRCODE = '42501';
  END IF;
  -- Skipping the automatic refund leaves the customer charged, so it needs
  -- the same authority as recording a refund: the owner or orders.refund.
  IF v_refund_mode = 'manual' AND NOT (
    EXISTS (
      SELECT 1 FROM public.merchants m
       WHERE m.id = v_order.merchant_id AND m.user_id = v_actor
    )
    OR public.check_staff_permission(
      v_actor, v_order.merchant_id, 'orders', 'refund'
    )
  ) THEN
    RAISE EXCEPTION 'order_cancel_refund_forbidden' USING ERRCODE = '42501';
  END IF;
  IF v_order.shipping_status IN ('cancelled', 'canceled')
     OR v_order.cancelled_at IS NOT NULL THEN
    RETURN false;
  END IF;
  IF v_order.shipping_status IN (
    'shipped', 'out_for_delivery', 'delivered', 'completed', 'returned'
  ) THEN
    RAISE EXCEPTION 'order_not_cancellable' USING ERRCODE = 'P0001';
  END IF;
  IF private.merchant_cancel_payment_in_flight(p_order_id, v_order.merchant_id) THEN
    RAISE EXCEPTION 'payment_capture_in_flight' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.payment_status = 'paid'
     AND v_order.amount_paid IS DISTINCT FROM v_order.total THEN
    RAISE EXCEPTION 'paid_order_ledger_inconsistent' USING ERRCODE = 'P0001';
  END IF;

  PERFORM private.transition_verified_abandoned_captures_for_cancel(
    p_order_id, v_order.merchant_id
  );

  UPDATE public.orders
     SET shipping_status = 'cancelled', cancelled_at = now(),
         cancellation_reason = v_reason, cancelled_by = 'merchant',
         cancellation_refund_mode = v_refund_mode,
         updated_at = now()
   WHERE id = p_order_id;

  UPDATE public.order_payment_accounts SET expires_at = now()
   WHERE order_id = p_order_id
     AND (expires_at IS NULL OR expires_at > now());
  UPDATE public.order_wallet_funding_intents
     SET status = 'cancelled', updated_at = now()
   WHERE order_id = p_order_id
     AND status NOT IN ('completed', 'cancelled', 'expired', 'failed');

  SELECT COALESCE(sum(reversed_amount), 0)
    INTO v_wallet_reversed
    FROM public.reverse_wallet_redemption(
      p_order_id, COALESCE(v_reason, 'Order cancelled'), v_order.merchant_id
    );
  v_savings_reversed := public.reverse_savings_redemption_for_order(
    p_order_id, v_order.merchant_id, v_actor,
    COALESCE(v_reason, 'Order cancelled')
  );

  PERFORM private.restock_order_items(p_order_id);
  PERFORM private.release_order_inventory_units(
    v_order.merchant_id, p_order_id, 'available'
  );

  INSERT INTO public.order_audit_events (
    merchant_id, order_id, actor_user_id, action, change_category,
    changed_fields, before_snapshot, after_snapshot, metadata
  ) VALUES (
    v_order.merchant_id, p_order_id, v_actor, 'order.update',
    'customer_visible',
    ARRAY[
      'shipping_status', 'cancelled_at', 'cancellation_reason', 'cancelled_by',
      'cancellation_refund_mode'
    ],
    jsonb_build_object(
      'shipping_status', v_order.shipping_status,
      'cancelled_at', v_order.cancelled_at,
      'cancellation_reason', v_order.cancellation_reason,
      'cancelled_by', v_order.cancelled_by,
      'cancellation_refund_mode', v_order.cancellation_refund_mode
    ),
    jsonb_build_object(
      'shipping_status', 'cancelled', 'cancelled_at', now(),
      'cancellation_reason', v_reason, 'cancelled_by', 'merchant',
      'cancellation_refund_mode', v_refund_mode
    ),
    jsonb_build_object(
      'operation', 'merchant_order_cancellation',
      'wallet_reversed', v_wallet_reversed,
      'savings_reversed', v_savings_reversed,
      'refund_mode', v_refund_mode
    )
  );

  INSERT INTO public.order_cancellation_side_effects (
    order_id, merchant_id, step, status, claim_token, attempts
  ) VALUES (
    p_order_id, v_order.merchant_id, 'customer_email', 'failed',
    extensions.gen_random_uuid(), 0
  ) ON CONFLICT (order_id, step) DO NOTHING;

  -- 'manual' leaves the order without a refund step on purpose: the
  -- merchant refunds outside Baci and records it from the Refund card.
  -- The exception is a leg whose provider refund is already pending or
  -- terminal (e.g. PayPal flips the payment row itself), or has its own
  -- refund rows (the usual Paystack shape: the payment stays completed,
  -- whether the refund is in flight or already verified): those still need the row so the drain waits for the
  -- provider and runs aggregate finalization, while the worker never
  -- initiates a refund in manual mode (the persisted mode suppresses
  -- initiation).
  IF EXISTS (
    SELECT 1 FROM public.transactions t
     WHERE t.order_id = p_order_id
       AND t.merchant_id = v_order.merchant_id
       AND t.transaction_type = 'payment'
       -- Mirror the claim gate's funded-leg statuses: refund-state legs
       -- (e.g. PayPal flips the payment row itself while its provider
       -- refund is pending or terminal) need the row so the drain
       -- resumes them and runs aggregate finalization.
       AND t.status IN ('completed', 'refund_pending', 'refunded')
       AND (
         v_refund_mode = 'automatic'
         OR t.status IN ('refund_pending', 'refunded')
       )
       AND t.amount > 0
       AND COALESCE(public.normalized_gateway_name_v1(t.gateway), '') NOT IN (
         'WALLET', 'SAVINGS', 'STORE_CREDIT', 'CASH', 'MANUAL', 'PAY_ON_DELIVERY'
       )
  ) OR (
    v_refund_mode = 'manual' AND EXISTS (
      -- ANY refund evidence on the order, terminal included: a payment can
      -- stay 'completed' while its own refund rows (in flight, or already
      -- fully verified) exist, and only the refund step lets the drain wait
      -- for the provider and run aggregate finalization. The persisted
      -- manual mode still blocks every new initiation, so seeding only
      -- enables verification and finalization. The one exclusion mirrors the
      -- worker (collectAwaitingCancellationRefundLegs): a definitive
      -- provider rejection (explicit failed stamp) with no provider
      -- identity can never recover.
      SELECT 1 FROM public.transactions r
       WHERE r.order_id = p_order_id
         AND r.merchant_id = v_order.merchant_id
         AND r.transaction_type = 'refund'
         AND NOT (
           r.status = 'failed'
           -- NULL-safe: only an EXPLICIT provider 'failed' stamp is a
           -- definitive rejection; a missing verdict must still seed the step.
           AND COALESCE(r.metadata->>'provider_refund_status', '') = 'failed'
           AND COALESCE(r.gateway_reference, '') !~ '^[1-9][0-9]*$'
           AND COALESCE(r.metadata->>'provider_refund_id', '') !~ '^[1-9][0-9]*$'
         )
    )
  ) THEN
    INSERT INTO public.order_cancellation_side_effects (
      order_id, merchant_id, step, status, claim_token, attempts
    ) VALUES (
      p_order_id, v_order.merchant_id, 'refund', 'failed',
      extensions.gen_random_uuid(), 0
    ) ON CONFLICT (order_id, step) DO NOTHING;
  END IF;

  RETURN true;
END;
$$;

REVOKE ALL ON FUNCTION public.cancel_order_as_merchant(uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.cancel_order_as_merchant(uuid, text, text)
  TO authenticated;

-- Merchant-safe read of the refund manager's movement-evidence gate. The
-- review table is service_role-only under RLS, so the dashboard and mobile
-- cancel flows cannot read it; this definer wrapper exposes only the boolean
-- (the private helper asserts the caller is the merchant owner or staff).
-- Unresolved provider-refund evidence means money may already have moved, so
-- clients must not offer or confirm a manual repayment while it is open.
CREATE OR REPLACE FUNCTION public.order_has_unresolved_refund_evidence(
  p_order_id uuid
) RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant_id uuid;
BEGIN
  IF (SELECT auth.uid()) IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  SELECT o.merchant_id INTO v_merchant_id
    FROM public.orders o WHERE o.id = p_order_id;
  -- A missing order must be indistinguishable from another merchant's order
  -- (the membership gate raises refund_forbidden / 42501), or this wrapper
  -- becomes an order-existence oracle.
  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'refund_forbidden' USING ERRCODE = '42501';
  END IF;
  RETURN private.unresolved_order_movement_evidence_v1(
    p_order_id, v_merchant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.order_has_unresolved_refund_evidence(uuid)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.order_has_unresolved_refund_evidence(uuid)
  TO authenticated;

-- PostgREST caches the schema: the new orders column and the replaced RPC
-- signature must be visible to API callers without a restart.
NOTIFY pgrst, 'reload schema';

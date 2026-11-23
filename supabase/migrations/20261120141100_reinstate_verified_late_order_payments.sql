-- Narrow the cancellation fence only for the atomic recovery RPC. The marker
-- must be written by that definer in the same transaction as the paid flip.
CREATE OR REPLACE FUNCTION public.prevent_cancelled_order_reopen()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  IF OLD.shipping_status = 'cancelled' OR OLD.cancelled_at IS NOT NULL THEN
    IF current_user = 'postgres'
      AND current_setting('baci.reinstating_order_id', true) = OLD.id::text
      AND OLD.payment_status = 'cancelled'
      AND NEW.payment_status = 'paid'
      AND NEW.shipping_status = 'processing'
      AND NEW.cancelled_at IS NULL
      AND NEW.paid_transaction_id IS NOT NULL THEN
      RETURN NEW;
    END IF;

    IF NEW.shipping_status IS DISTINCT FROM OLD.shipping_status
      AND NEW.shipping_status IS DISTINCT FROM 'cancelled' THEN
      NEW.shipping_status := OLD.shipping_status;
    END IF;

    IF NEW.payment_status IN (
      'paid', 'partially_paid', 'bnpl_approved', 'bnpl_pending'
    ) AND NEW.payment_status IS DISTINCT FROM OLD.payment_status THEN
      NEW.payment_status := OLD.payment_status;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

-- Storefront creation already takes these identity locks before inserting an
-- order. Add the same fence to direct order inserts and late-payment recovery
-- so a replacement cannot appear between recovery's scan and paid transition.
CREATE OR REPLACE FUNCTION private.lock_order_replacement_identity(
  p_merchant_id uuid,
  p_customer_id uuid,
  p_customer_email text,
  p_customer_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid;
  v_email text := nullif(lower(btrim(p_customer_email)), '');
  v_phone text := nullif(btrim(p_customer_phone), '');
BEGIN
  IF v_phone IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(p_merchant_id::text),
      pg_catalog.hashtext(v_phone)
    );
  END IF;

  IF p_customer_id IS NOT NULL THEN
    SELECT c.user_id INTO v_user_id
    FROM public.customers c
    WHERE c.id = p_customer_id AND c.merchant_id = p_merchant_id;
  END IF;
  IF v_user_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_merchant_id::text || ':' || v_user_id::text, 0)
    );
  END IF;

  IF v_email IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended(p_merchant_id::text || ':' || v_email, 1)
    );
  END IF;
END;
$$;

ALTER FUNCTION private.lock_order_replacement_identity(uuid, uuid, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_order_replacement_identity(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.lock_order_replacement_identity_before_insert()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  PERFORM private.lock_order_replacement_identity(
    NEW.merchant_id, NEW.customer_id, NEW.customer_email, NEW.customer_phone
  );
  RETURN NEW;
END;
$$;

ALTER FUNCTION private.lock_order_replacement_identity_before_insert()
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_order_replacement_identity_before_insert()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS lock_order_replacement_identity_before_insert ON public.orders;
CREATE TRIGGER lock_order_replacement_identity_before_insert
  BEFORE INSERT ON public.orders
  FOR EACH ROW
  EXECUTE FUNCTION private.lock_order_replacement_identity_before_insert();

CREATE FUNCTION public.reinstate_timeout_order_payment(
  p_order_id uuid,
  p_transaction_id uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_order_identity record;
  v_payment public.transactions%ROWTYPE;
  v_timeout_at timestamptz;
  v_replacement_ids uuid[];
  v_inventory jsonb;
  v_paid_order record;
  v_credit_direct_notes jsonb;
  v_credit_direct_session text;
  v_credit_direct_reference text;
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RAISE EXCEPTION 'Only the verified payment handlers may reinstate an order'
      USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('baci_order_payment:' || p_order_id::text, 0)
  );

  SELECT o.merchant_id, o.customer_id, o.customer_email, o.customer_phone
  INTO v_order_identity
  FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN
    RETURN 'blocked';
  END IF;

  PERFORM private.lock_order_replacement_identity(
    v_order_identity.merchant_id,
    v_order_identity.customer_id,
    v_order_identity.customer_email,
    v_order_identity.customer_phone
  );

  SELECT * INTO v_payment FROM public.transactions WHERE id = p_transaction_id FOR UPDATE;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;

  IF v_order.id IS NULL OR v_payment.id IS NULL
    OR v_payment.order_id IS DISTINCT FROM v_order.id
    OR v_payment.merchant_id IS DISTINCT FROM v_order.merchant_id
    OR v_payment.transaction_type IS DISTINCT FROM 'payment'
    OR v_payment.status IS DISTINCT FROM 'completed'
    OR NOT coalesce(v_payment.gateway IN ('credit_direct', 'klump', 'paystack', 'korapay', 'juicyway'), false)
    OR nullif(v_payment.gateway_reference, '') IS NULL
    OR jsonb_typeof(v_payment.gateway_response::jsonb) IS DISTINCT FROM 'object'
    OR (v_payment.gateway = 'credit_direct' AND (
      v_payment.gateway_response ->> 'eventType' IS DISTINCT FROM 'Checkout_Merchant_Payment_Completed'
      OR v_payment.gateway_response ->> 'checkoutTransactionId' IS DISTINCT FROM v_payment.gateway_reference
      OR v_order.payment_method IS DISTINCT FROM 'credit_direct'
    ))
    OR (v_payment.gateway = 'klump' AND v_order.payment_method IS DISTINCT FROM 'klump')
    OR v_payment.currency IS DISTINCT FROM v_order.currency
    -- The recovery RPC requires an exact ledger match. Provider-specific
    -- webhook tolerances validate capture authenticity but do not authorize
    -- reopening an order for a short or rounded amount; those captures stay
    -- in reconciliation for review.
    OR v_payment.amount IS DISTINCT FROM v_order.total
    OR NOT coalesce(v_payment.amount > 0, false)
    THEN
    RETURN 'blocked';
  END IF;

  IF v_order.payment_status = 'paid' AND v_order.cancelled_at IS NULL
    AND v_order.paid_transaction_id = p_transaction_id
    AND EXISTS (SELECT 1 FROM private.order_payment_timeouts t
      WHERE t.order_id = p_order_id AND t.reinstated_transaction_id = p_transaction_id
        AND t.reinstated_at IS NOT NULL) THEN
    RETURN 'already_reinstated';
  END IF;

  IF NOT coalesce(v_order.payment_status IN ('cancelled', 'canceled'), false)
    OR NOT coalesce(v_order.shipping_status IN ('pending', 'cancelled'), false)
    OR v_order.cancelled_by IS NOT NULL OR v_order.cancellation_reason IS NOT NULL
    OR v_order.cancellation_refund_mode IS NOT NULL
    OR v_order.paid_transaction_id IS NOT NULL OR v_order.paid_at IS NOT NULL
    OR coalesce(v_order.amount_paid, 0) <> 0 OR coalesce(v_order.wallet_amount_used, 0) <> 0
    OR coalesce(v_order.is_credit_order, false)
    OR v_order.payment_method IS NOT DISTINCT FROM 'uba_redvault'
    OR NOT coalesce(v_order.source IN ('online_store', 'mobile_app'), false)
    OR v_order.recorded_by_user_id IS NOT NULL
    OR (v_order.customer_id IS NULL AND nullif(btrim(v_order.customer_email), '') IS NULL) THEN
    RETURN 'blocked';
  END IF;

  IF v_payment.gateway = 'credit_direct' THEN
    BEGIN
      v_credit_direct_notes := nullif(v_order.notes, '')::jsonb;
      v_credit_direct_session := nullif(v_credit_direct_notes ->> 'creditDirectSessionId', '');
      v_credit_direct_reference := coalesce(
        nullif(v_credit_direct_notes ->> 'creditDirectTransactionId', ''),
        nullif(v_credit_direct_notes ->> 'credit_directTransactionId', ''),
        v_credit_direct_session
      );
      IF v_credit_direct_reference IS DISTINCT FROM v_payment.gateway_reference AND NOT coalesce(
        v_credit_direct_reference = v_credit_direct_session
        AND v_payment.gateway_response ->> 'metaData' = p_order_id::text
        AND NOT coalesce(v_credit_direct_notes -> 'creditDirectSupersededReferences' ? v_payment.gateway_reference, false)
        AND (v_payment.gateway_response ->> 'timeStamp')::timestamptz >=
          (v_credit_direct_notes ->> 'creditDirectSignedAt')::timestamptz - interval '5 minutes',
        false
      ) THEN
        RETURN 'blocked';
      END IF;
    EXCEPTION WHEN invalid_text_representation OR invalid_datetime_format OR datetime_field_overflow THEN
      RETURN 'blocked';
    END;
  END IF;

  SELECT t.timed_out_at INTO v_timeout_at FROM private.order_payment_timeouts t
  WHERE t.order_id = p_order_id AND t.reinstated_at IS NULL;

  IF v_timeout_at IS NULL THEN
    -- Before this migration only Credit Direct has a durable cleanup audit
    -- that positively identifies how and when a given order was cancelled.
    IF v_payment.gateway <> 'credit_direct' OR v_order.cancelled_at IS NULL
      OR coalesce(v_order.discount_amount, 0) <> 0
      OR NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review r
        WHERE r.order_id = p_order_id AND r.issue_type = 'credit_direct_confirmation_missing'
          AND r.resolution_notes = 'Provider confirmation deadline expired; order was cancelled as abandoned.'
          AND r.resolved_at >= v_order.cancelled_at
          AND r.resolved_at < v_order.cancelled_at + interval '1 minute'
      ) THEN
      RETURN 'blocked';
    END IF;
    v_timeout_at := v_order.cancelled_at;
  END IF;

  IF v_order.cancelled_at IS NOT NULL AND v_order.cancelled_at <> v_timeout_at THEN
    RETURN 'blocked';
  END IF;

  -- Lock against the concurrent Paystack refund-watch opener before reading
  -- its evidence. Other cancellations and local refunds take the order row lock.
  IF v_payment.gateway = 'paystack' THEN
    PERFORM public.claim_paystack_refund_recovery_watches_v1(p_transaction_id, p_order_id);
  END IF;
  IF EXISTS (
      SELECT 1 FROM public.transactions t WHERE t.order_id = p_order_id
        AND t.id <> p_transaction_id
        AND (t.transaction_type = 'refund' OR t.status = 'completed')
    ) OR EXISTS (
      SELECT 1 FROM public.order_refund_events r WHERE r.order_id = p_order_id
    ) OR EXISTS (
      SELECT 1 FROM public.order_cancellation_side_effects s WHERE s.order_id = p_order_id
    ) OR EXISTS (
      SELECT 1 FROM public.paystack_refund_recovery_watch w
      WHERE v_payment.gateway = 'paystack' AND w.paystack_ref = v_payment.gateway_reference
        AND w.status <> 'retired'
    ) OR EXISTS (
      SELECT 1 FROM public.order_items i
      LEFT JOIN public.products p ON p.id = i.product_id AND p.merchant_id = v_order.merchant_id
      LEFT JOIN public.product_variants v ON v.id = i.variant_id AND v.product_id = p.id
      WHERE i.order_id = p_order_id AND (
        p.id IS NULL OR (i.variant_id IS NOT NULL AND v.id IS NULL)
      )
    ) OR NOT EXISTS (
      SELECT 1 FROM public.order_items i WHERE i.order_id = p_order_id
    ) THEN
    RETURN 'blocked';
  END IF;

  -- Ordinary payments update these same order rows. Lock all matching
  -- newer orders in creation order to avoid reversing lock order across
  -- concurrent reinstatements.
  SELECT ARRAY(
    SELECT later.id
    FROM public.orders later
    WHERE later.merchant_id = v_order.merchant_id
      AND (later.created_at, later.id) > (v_order.created_at, v_order.id)
      AND (later.customer_id = v_order.customer_id
        OR nullif(lower(btrim(later.customer_email)), '') = nullif(lower(btrim(v_order.customer_email)), '')
        OR nullif(btrim(later.customer_phone), '') = nullif(btrim(v_order.customer_phone), ''))
      AND EXISTS (
        SELECT 1 FROM public.order_items newer_item
        JOIN public.order_items original_item ON original_item.order_id = p_order_id
          AND original_item.product_id = newer_item.product_id
          AND original_item.variant_id IS NOT DISTINCT FROM newer_item.variant_id
        WHERE newer_item.order_id = later.id
      )
    ORDER BY later.created_at, later.id
    FOR UPDATE OF later
  ) INTO v_replacement_ids;

  -- Use a fresh snapshot after the lock wait. The replacement's payment
  -- status and its timeout record must both reflect any concurrent commit.
  IF EXISTS (
    SELECT 1 FROM public.orders r
    WHERE r.id = ANY(v_replacement_ids)
      AND (
        (r.payment_status NOT IN ('cancelled', 'canceled', 'refunded')
          AND r.shipping_status NOT IN ('cancelled', 'canceled')
          AND r.cancelled_at IS NULL)
        OR (r.payment_status IN ('cancelled', 'canceled') AND EXISTS (
          SELECT 1 FROM private.order_payment_timeouts t WHERE t.order_id = r.id
        ))
      )
  ) THEN
    RETURN 'blocked';
  END IF;

  BEGIN
    PERFORM pg_catalog.set_config('baci.reinstating_order_id', p_order_id::text, true);
    UPDATE public.orders
    SET payment_status = 'paid', shipping_status = 'processing', cancelled_at = NULL,
        paid_at = now(), amount_paid = v_payment.amount, paid_transaction_id = p_transaction_id,
        updated_at = now(),
        notes = CASE WHEN v_payment.gateway = 'credit_direct' THEN (
          v_credit_direct_notes || jsonb_build_object(
            'creditDirectVerifiedWebhookWrite', true,
            'creditDirectClientCompletionStatus', 'provider_confirmed',
            'creditDirectProviderConfirmedAt', v_payment.gateway_response ->> 'timeStamp',
            'creditDirectTransactionId', v_payment.gateway_reference,
            'creditDirectNotificationsQueued', true,
            'merchantAmount', v_payment.merchant_amount,
            'merchantPaidAt', v_payment.gateway_response ->> 'timeStamp',
            'platformFee', v_payment.platform_fee
          )
        )::text ELSE v_order.notes END
    WHERE id = p_order_id
    RETURNING payment_status, shipping_status, cancelled_at, paid_transaction_id, amount_paid
    INTO v_paid_order;
    IF NOT FOUND
      OR v_paid_order.payment_status IS DISTINCT FROM 'paid'
      OR v_paid_order.shipping_status IS DISTINCT FROM 'processing'
      OR v_paid_order.cancelled_at IS NOT NULL
      OR v_paid_order.paid_transaction_id IS DISTINCT FROM p_transaction_id
      OR v_paid_order.amount_paid IS DISTINCT FROM v_payment.amount THEN
      RAISE EXCEPTION USING ERRCODE = 'BX001', MESSAGE = 'Late payment order update was blocked';
    END IF;
    PERFORM pg_catalog.set_config('baci.reinstating_order_id', '', true);

    -- Quantity-based stock was debited at checkout and is retained by this
    -- cleanup path. Reacquire any serialized units whose timed holds expired.
    v_inventory := private.confirm_order_inventory_reservations(v_order.merchant_id, p_order_id);
    -- The inventory RPC emits exceptions for strict policies. Its
    -- serialized-then-unlimited policy may legitimately report a shortfall.
    IF jsonb_typeof(v_inventory -> 'exceptionCodes') IS DISTINCT FROM 'array'
      OR jsonb_array_length(v_inventory -> 'exceptionCodes') <> 0 THEN
      RAISE EXCEPTION USING ERRCODE = 'BX001', MESSAGE = 'Late payment inventory unavailable';
    END IF;

    -- These providers share the paid-order outbox. Keep the original
    -- completion path's crash recovery if the webhook dies after the RPC.
    IF v_payment.gateway IN ('paystack', 'korapay', 'juicyway') THEN
      INSERT INTO public.payment_side_effects (
        order_id, transaction_id, step, status, claimed_by, error, result
      ) VALUES (
        p_order_id, p_transaction_id, 'merchant_settlement', 'failed',
        'late_payment_reinstatement', 'rpc_seed_pending_drain',
        jsonb_build_object('reason', 'seeded_at_completion')
      ) ON CONFLICT (order_id, step) DO NOTHING;
    END IF;

    INSERT INTO private.order_payment_timeouts (
      order_id, timed_out_at, reinstated_transaction_id, reinstated_at
    ) VALUES (p_order_id, v_timeout_at, p_transaction_id, now())
    ON CONFLICT (order_id) DO UPDATE SET
      reinstated_transaction_id = EXCLUDED.reinstated_transaction_id,
      reinstated_at = EXCLUDED.reinstated_at;

    UPDATE public.reconciliation_review
    SET resolved_at = clock_timestamp(),
        resolution_notes = 'Reinstated automatically after verified payment and inventory confirmation.'
    WHERE order_id = p_order_id AND txn_id = p_transaction_id AND resolved_at IS NULL
      AND issue_type IN ('payment_received_after_cancellation', 'gateway_payment_wedge_requires_review');
  EXCEPTION WHEN SQLSTATE 'BX001' THEN
    RETURN 'blocked';
  END;

  IF coalesce((v_inventory ->> 'reclaimedUnitCount')::integer, 0) > 0 THEN
    RETURN 'reinstated_inventory_reclaimed';
  END IF;
  RETURN 'reinstated';
END;
$$;

ALTER FUNCTION public.reinstate_timeout_order_payment(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.reinstate_timeout_order_payment(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.reinstate_timeout_order_payment(uuid, uuid) TO service_role;

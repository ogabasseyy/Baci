-- Keep cleanup candidate locks limited to orders that may actually be
-- cancelled, and preserve loyalty-claim evidence before cancellation triggers
-- release those claims.
CREATE OR REPLACE FUNCTION public.mark_abandoned_orders(hours_threshold int DEFAULT 72)
RETURNS void
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $$
DECLARE
  v_order_id uuid;
  v_candidate_ids uuid[];
  v_loyalty_order_ids uuid[];
BEGIN
  IF hours_threshold IS NULL OR hours_threshold < 1 OR hours_threshold > 720 THEN
    RAISE EXCEPTION 'invalid_hours_threshold: % (expected 1-720)', hours_threshold
      USING ERRCODE = '22023';
  END IF;

  SELECT coalesce(array_agg(o.id ORDER BY o.id), '{}'::uuid[])
  INTO v_candidate_ids
  FROM public.orders o
  WHERE ((o.payment_status = 'unpaid'
      AND o.created_at < (now() - (hours_threshold * interval '1 hour')))
    OR (o.payment_status IN ('pending', 'bnpl_pending')
      AND o.payment_method IN ('credit_direct', 'klump')
      AND o.updated_at < (now() - (hours_threshold * interval '1 hour'))))
    AND NOT EXISTS (
      SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id = o.id
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.reconciliation_review rr
      WHERE o.payment_method = 'credit_direct'
        AND rr.order_id = o.id
        AND rr.issue_type = 'credit_direct_confirmation_missing'
        AND rr.resolved_at IS NULL
        AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
        AND (rr.metadata->>'client_completed_at')::timestamptz
          > (clock_timestamp() - interval '14 days')
    );

  FOR v_order_id IN
    SELECT candidate_id FROM unnest(v_candidate_ids) AS candidates(candidate_id)
    ORDER BY candidate_id
  LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtextextended('baci_order_payment:' || v_order_id::text, 0)
    );
  END LOOP;

  -- Cancellation can release reward_redemptions claims. Snapshot the affected
  -- candidate IDs before the UPDATE so released claims remain ineligible for
  -- late-payment reinstatement.
  SELECT coalesce(array_agg(DISTINCT r.used_on_order_id), '{}'::uuid[])
  INTO v_loyalty_order_ids
  FROM public.reward_redemptions r
  WHERE r.used_on_order_id = ANY(v_candidate_ids);

  WITH eligible_orders AS MATERIALIZED (
    SELECT o.id, o.payment_method, o.source, o.shipping_status,
      o.cancelled_at, o.cancelled_by, o.cancellation_reason
    FROM public.orders o
    WHERE o.id = ANY(v_candidate_ids)
      AND (((o.payment_status = 'unpaid'
          AND o.created_at < (now() - (hours_threshold * interval '1 hour')))
        OR (o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
          AND o.updated_at < (now() - (hours_threshold * interval '1 hour')))))
      AND NOT EXISTS (SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review rr
        WHERE o.payment_method = 'credit_direct' AND rr.order_id = o.id
          AND rr.issue_type = 'credit_direct_confirmation_missing'
          AND rr.resolved_at IS NULL
          AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
          AND (rr.metadata->>'client_completed_at')::timestamptz
            > (clock_timestamp() - interval '14 days')
      )
  ), cancelled_orders AS (
    UPDATE public.orders o
    SET payment_status = 'cancelled',
      shipping_status = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump') THEN 'cancelled'
        ELSE o.shipping_status END,
      cancelled_at = CASE
        WHEN o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump') THEN COALESCE(o.cancelled_at, now())
        ELSE o.cancelled_at END,
      updated_at = now()
    FROM eligible_orders eligible
    WHERE o.id = eligible.id
      AND (((o.payment_status = 'unpaid'
          AND o.created_at < (now() - (hours_threshold * interval '1 hour')))
        OR (o.payment_status IN ('pending', 'bnpl_pending')
          AND o.payment_method IN ('credit_direct', 'klump')
          AND o.updated_at < (now() - (hours_threshold * interval '1 hour')))))
      AND NOT EXISTS (SELECT 1 FROM public.oxygen_workflows ow WHERE ow.order_id = o.id)
      AND NOT EXISTS (
        SELECT 1 FROM public.reconciliation_review rr
        WHERE o.payment_method = 'credit_direct' AND rr.order_id = o.id
          AND rr.issue_type = 'credit_direct_confirmation_missing'
          AND rr.resolved_at IS NULL
          AND rr.metadata->>'source' = 'credit_direct_sdk_on_success'
          AND (rr.metadata->>'client_completed_at')::timestamptz
            > (clock_timestamp() - interval '14 days')
      )
    RETURNING o.id, o.payment_method, o.updated_at, o.cancelled_at,
      o.cancelled_by, o.cancellation_reason, o.shipping_status
  ), recorded_timeouts AS (
    INSERT INTO private.order_payment_timeouts (order_id, timed_out_at)
    SELECT c.id, c.updated_at FROM cancelled_orders c
    JOIN eligible_orders before_cleanup ON before_cleanup.id = c.id
    WHERE c.payment_method IS DISTINCT FROM 'uba_redvault'
      AND before_cleanup.cancelled_by IS NULL
      AND before_cleanup.cancellation_reason IS NULL
      AND before_cleanup.source IN ('online_store', 'mobile_app')
      AND before_cleanup.shipping_status = 'pending'
      AND before_cleanup.cancelled_at IS NULL
      AND NOT (c.id = ANY(v_loyalty_order_ids))
    ON CONFLICT (order_id) DO NOTHING
  )
  UPDATE public.reconciliation_review rr
  SET resolved_at = clock_timestamp(),
    resolution_notes = COALESCE(rr.resolution_notes,
      'Provider confirmation deadline expired; order was cancelled as abandoned.')
  FROM cancelled_orders c
  WHERE c.payment_method = 'credit_direct' AND rr.order_id = c.id
    AND rr.issue_type = 'credit_direct_confirmation_missing' AND rr.resolved_at IS NULL;
END;
$$;

COMMENT ON FUNCTION public.mark_abandoned_orders(integer) IS
  'Cancels stale unpaid/BNPL attempts while giving explicit Credit Direct SDK-success cases a bounded reconciliation window.';
REVOKE ALL ON FUNCTION public.mark_abandoned_orders(integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.mark_abandoned_orders(integer) TO service_role;

-- A guest customer row is an identity in its own right even when it has no
-- auth user. Lock phone, sorted customer IDs, user, then email everywhere.
CREATE OR REPLACE FUNCTION private.lock_order_replacement_identity(
  p_merchant_id uuid, p_customer_id uuid, p_customer_email text, p_customer_phone text
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
      pg_catalog.hashtext(p_merchant_id::text), pg_catalog.hashtext(v_phone)
    );
  END IF;
  IF p_customer_id IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_merchant_id::text || ':customer:' || p_customer_id::text, 2
    ));
    SELECT c.user_id INTO v_user_id FROM public.customers c
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
ALTER FUNCTION private.lock_order_replacement_identity(uuid, uuid, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_order_replacement_identity(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.lock_storefront_order_entrypoint_identity(
  p_merchant_id uuid, p_user_id uuid, p_customer_email text, p_customer_phone text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := CASE WHEN public.is_agentic_checkout_context() THEN NULL
    ELSE coalesce(auth.uid(), p_user_id) END;
  v_customer_id uuid;
  v_customer_ids uuid[] := '{}'::uuid[];
  v_confirmed_customer_id uuid;
  v_confirmed_user_id uuid;
  v_email text := nullif(lower(btrim(p_customer_email)), '');
  v_phone text := nullif(btrim(p_customer_phone), '');
  v_lock_customer_id uuid;
BEGIN
  IF v_phone IS NOT NULL THEN
    PERFORM pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext(p_merchant_id::text), pg_catalog.hashtext(v_phone)
    );
  END IF;
  IF v_user_id IS NULL AND v_phone IS NOT NULL THEN
    SELECT c.id, c.user_id INTO v_customer_id, v_user_id FROM public.customers c
    WHERE c.merchant_id = p_merchant_id AND c.phone = v_phone AND c.user_id IS NULL
    ORDER BY c.id LIMIT 1;
  END IF;
  IF v_user_id IS NULL AND v_customer_id IS NULL AND v_email IS NOT NULL THEN
    SELECT c.id, c.user_id INTO v_customer_id, v_user_id FROM public.customers c
    WHERE c.merchant_id = p_merchant_id AND lower(c.email) = v_email
    ORDER BY c.id LIMIT 1;
  END IF;
  IF v_customer_id IS NOT NULL THEN
    v_customer_ids := ARRAY[v_customer_id];
  ELSIF v_user_id IS NOT NULL THEN
    SELECT coalesce(array_agg(c.id ORDER BY c.id), '{}'::uuid[])
    INTO v_customer_ids FROM public.customers c
    WHERE c.merchant_id = p_merchant_id AND c.user_id = v_user_id;
  END IF;
  FOREACH v_lock_customer_id IN ARRAY v_customer_ids LOOP
    PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
      p_merchant_id::text || ':customer:' || v_lock_customer_id::text, 2
    ));
  END LOOP;
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
  IF public.is_agentic_checkout_context()
    OR (auth.uid() IS NULL AND p_user_id IS NULL) THEN
    IF v_phone IS NOT NULL THEN
      SELECT c.id, c.user_id INTO v_confirmed_customer_id, v_confirmed_user_id
      FROM public.customers c WHERE c.merchant_id = p_merchant_id
        AND c.phone = v_phone AND c.user_id IS NULL ORDER BY c.id LIMIT 1;
    END IF;
    IF v_confirmed_customer_id IS NULL AND v_email IS NOT NULL THEN
      SELECT c.id, c.user_id INTO v_confirmed_customer_id, v_confirmed_user_id
      FROM public.customers c WHERE c.merchant_id = p_merchant_id
        AND lower(c.email) = v_email ORDER BY c.id LIMIT 1;
    END IF;
    IF v_confirmed_customer_id IS DISTINCT FROM v_customer_id
      OR v_confirmed_user_id IS DISTINCT FROM v_user_id THEN
      RAISE EXCEPTION 'customer_identity_changed_retry';
    END IF;
  END IF;
END;
$$;
ALTER FUNCTION private.lock_storefront_order_entrypoint_identity(uuid, uuid, text, text)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.lock_storefront_order_entrypoint_identity(uuid, uuid, text, text)
  FROM PUBLIC, anon, authenticated, service_role;

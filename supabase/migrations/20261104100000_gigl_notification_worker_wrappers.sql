-- Retire the service-role GIGL tracking-notification worker.
--
-- The notification cron route runs on Vercel, which already holds the
-- gigl_tracking_worker JWT (the manual tracking fallback and the webhook
-- expedite use it). Rather than mint a second PostgREST role and a second
-- secret, this extends that confined capability with lease-bound wrappers,
-- the same shape as 20261102120000_gigl_webhook_expedite_tracking_monitor:
-- no authenticator membership change, no hook reload window, no new env var.
--
-- Every data wrapper is keyed on an outbox row the caller currently leases
-- (status 'processing' and locked_by = the caller's worker id). Tenant,
-- order, customer and audience are derived from that row inside the
-- function, never taken from the caller, so a leaked token can only touch
-- rows it has itself claimed. Twelve wrappers, nothing else is granted.

CREATE OR REPLACE FUNCTION private.gigl_worker_leased_notification(
  p_id uuid,
  p_worker_id text
)
RETURNS TABLE (
  id uuid,
  merchant_id uuid,
  order_id uuid,
  audience text,
  notification_kind text,
  tracking_event_id uuid
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY
  SELECT outbox.id, outbox.merchant_id, outbox.order_id, outbox.audience,
    outbox.notification_kind, outbox.tracking_event_id
  FROM public.shipment_tracking_notification_outbox AS outbox
  WHERE outbox.id = p_id
    AND outbox.status = 'processing'
    AND outbox.locked_by = btrim(p_worker_id);
END;
$$;

-- The customer that receives a customer-audience notification, derived from
-- the leased row's order. Unscoped by merchant exactly like the previous
-- orders -> customers reads, because the order id itself comes from the lease.
CREATE OR REPLACE FUNCTION private.gigl_worker_notification_customer_user(
  p_order_id uuid
)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT customer.user_id
  FROM public.orders AS o
  JOIN public.customers AS customer ON customer.id = o.customer_id
  WHERE o.id = p_order_id;
$$;

-- The users whose devices a leased notification may touch: the order's
-- customer for customer rows; the owner plus active orders.fulfill staff for
-- merchant rows. check_staff_permission only answers for the service role or
-- the staff member, and SECURITY DEFINER keeps the caller's JWT claims, so
-- the claim is elevated for exactly this recompute and restored right after.
CREATE OR REPLACE FUNCTION private.gigl_worker_notification_recipient_users(
  p_merchant_id uuid,
  p_audience text,
  p_order_id uuid
)
RETURNS uuid[]
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  previous_role text;
  users uuid[];
BEGIN
  IF p_audience = 'customer' THEN
    RETURN array_remove(
      ARRAY[private.gigl_worker_notification_customer_user(p_order_id)],
      NULL
    );
  END IF;
  previous_role := current_setting('request.jwt.claim.role', true);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT coalesce(array_agg(member.user_id), '{}'::uuid[])
  INTO users
  FROM (
    SELECT merchant.user_id FROM public.merchants AS merchant
    WHERE merchant.id = p_merchant_id
    UNION
    SELECT staff.user_id FROM public.staff_members AS staff
    WHERE staff.merchant_id = p_merchant_id
      AND staff.status = 'active'
      AND public.check_staff_permission(
        staff.user_id, staff.merchant_id, 'orders', 'fulfill'
      )
  ) AS member
  WHERE member.user_id IS NOT NULL;
  PERFORM set_config(
    'request.jwt.claim.role', coalesce(previous_role, ''), true
  );
  RETURN users;
END;
$$;

ALTER FUNCTION private.gigl_worker_leased_notification(uuid, text)
  OWNER TO postgres;
ALTER FUNCTION private.gigl_worker_notification_recipient_users(uuid, text, uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_worker_notification_recipient_users(uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.gigl_worker_notification_customer_user(uuid)
  OWNER TO postgres;
REVOKE ALL ON FUNCTION private.gigl_worker_leased_notification(uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION private.gigl_worker_notification_customer_user(uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- 1-3. Claim / begin dispatch / complete: thin elevating delegates, matching
-- the five existing tracking wrappers.
CREATE OR REPLACE FUNCTION public.gigl_worker_claim_notifications(
  p_limit integer,
  p_worker_id text
)
RETURNS TABLE (
  id uuid, shipment_id uuid, tracking_epoch_id uuid, order_id uuid,
  merchant_id uuid, tracking_event_id uuid, audience text,
  notification_kind text, attempt_count integer, max_attempts integer,
  repair_id uuid, recipient_user_ids uuid[]
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'GIGL worker claim limit must be between 1 and 100'
      USING ERRCODE = '22023';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN QUERY SELECT *
  FROM public.claim_shipment_tracking_notifications(p_limit, p_worker_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_begin_notification_dispatch(
  p_id uuid,
  p_worker_id text
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.begin_shipment_tracking_notification_dispatch(
    p_id, p_worker_id
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_complete_notification(
  p_id uuid,
  p_worker_id text,
  p_outcome text,
  p_error text DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF auth.role() IS DISTINCT FROM 'gigl_tracking_worker' THEN
    RAISE EXCEPTION 'GIGL worker capability required' USING ERRCODE = '42501';
  END IF;
  IF nullif(btrim(p_worker_id), '') IS NULL
    OR char_length(btrim(p_worker_id)) > 128 THEN
    RAISE EXCEPTION 'GIGL worker id is invalid' USING ERRCODE = '22023';
  END IF;
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  RETURN public.complete_shipment_tracking_notification(
    p_id, p_worker_id, p_outcome, p_error
  );
END;
$$;

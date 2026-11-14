-- Notification worker wrappers (2/4): lease-bound reads and attempt recording.

-- 4. The tracking event description (zero rows when the lease or event is gone).
CREATE OR REPLACE FUNCTION public.gigl_worker_notification_event(
  p_id uuid,
  p_worker_id text
)
RETURNS TABLE (description text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT event.description
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id) AS lease
  JOIN public.shipment_tracking_events AS event
    ON event.id = lease.tracking_event_id;
END;
$$;

-- 5. The customer-audience recipient (zero rows: order or customer missing;
-- a row with a NULL user: customer without an app account).
CREATE OR REPLACE FUNCTION public.gigl_worker_notification_customer(
  p_id uuid,
  p_worker_id text
)
RETURNS TABLE (customer_user_id uuid)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  RETURN QUERY
  SELECT private.gigl_worker_notification_customer_user(lease.order_id)
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id) AS lease
  JOIN public.orders AS o ON o.id = lease.order_id
  WHERE lease.audience = 'customer'
    AND o.customer_id IS NOT NULL;
END;
$$;

-- 6. Active push tokens for the leased notification. Merchant rows: the
-- tenant's admin tokens for the caller's recipient ids INTERSECTED with the
-- owner plus active orders.fulfill staff recomputed here. Customer rows:
-- the order customer's storefront tokens for the tenant. The caller can
-- never widen either set.
CREATE OR REPLACE FUNCTION public.gigl_worker_notification_push_tokens(
  p_id uuid,
  p_worker_id text,
  p_recipient_user_ids uuid[] DEFAULT NULL,
  p_required_capability integer DEFAULT NULL
)
RETURNS TABLE (token text, platform text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  customer_user uuid;
  eligible_users uuid[];
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN;
  END IF;
  IF lease.audience = 'merchant' THEN
    eligible_users := private.gigl_worker_notification_recipient_users(
      lease.merchant_id, lease.audience, lease.order_id
    );
    RETURN QUERY
    SELECT pt.token, pt.platform
    FROM public.push_tokens AS pt
    WHERE pt.merchant_id = lease.merchant_id
      AND pt.is_active = true
      AND pt.app_type = 'admin'
      AND pt.user_id = ANY (coalesce(p_recipient_user_ids, '{}'::uuid[]))
      AND pt.user_id = ANY (eligible_users)
      AND (
        p_required_capability IS NULL
        OR pt.shipment_update_capability >= p_required_capability
      );
  ELSE
    customer_user := private.gigl_worker_notification_customer_user(
      lease.order_id
    );
    IF customer_user IS NULL THEN
      RETURN;
    END IF;
    RETURN QUERY
    SELECT pt.token, pt.platform
    FROM public.push_tokens AS pt
    WHERE pt.user_id = customer_user
      AND pt.merchant_id = lease.merchant_id
      AND pt.is_active = true
      AND pt.app_type = 'storefront'
      AND (
        p_required_capability IS NULL
        OR pt.shipment_update_capability >= p_required_capability
      );
  END IF;
END;
$$;

-- 7. Record a push attempt. Tenant, user and app type come from the lease.
CREATE OR REPLACE FUNCTION public.gigl_worker_record_notification_push_attempt(
  p_id uuid,
  p_worker_id text,
  p_attempt jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN false;
  END IF;
  IF p_attempt IS NULL OR jsonb_typeof(p_attempt) IS DISTINCT FROM 'object' THEN
    RAISE EXCEPTION 'GIGL push attempt is invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_notification_attempts (
    merchant_id, user_id, app_type, channel, notification_type, title, body,
    payload, token_count, sent_count, failed_count, status, errors
  ) VALUES (
    lease.merchant_id,
    CASE WHEN lease.audience = 'customer'
      THEN private.gigl_worker_notification_customer_user(lease.order_id)
      ELSE NULL END,
    CASE WHEN lease.audience = 'merchant' THEN 'admin' ELSE 'storefront' END,
    left(p_attempt ->> 'channel', 64),
    left(p_attempt ->> 'notification_type', 128),
    left(p_attempt ->> 'title', 512),
    left(p_attempt ->> 'body', 2048),
    CASE WHEN jsonb_typeof(p_attempt -> 'payload') = 'object'
      THEN p_attempt -> 'payload' ELSE '{}'::jsonb END,
    coalesce((p_attempt ->> 'token_count')::integer, 0),
    coalesce((p_attempt ->> 'sent_count')::integer, 0),
    coalesce((p_attempt ->> 'failed_count')::integer, 0),
    p_attempt ->> 'status',
    CASE WHEN jsonb_typeof(p_attempt -> 'errors') = 'array'
      THEN p_attempt -> 'errors' ELSE '[]'::jsonb END
  );
  RETURN true;
END;
$$;

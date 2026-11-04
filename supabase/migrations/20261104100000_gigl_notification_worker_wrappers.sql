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

ALTER FUNCTION private.gigl_worker_leased_notification(uuid, text)
  OWNER TO postgres;
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
  previous_role text;
  eligible_users uuid[];
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN;
  END IF;
  IF lease.audience = 'merchant' THEN
    -- check_staff_permission only answers for the service role or the staff
    -- member themselves, and SECURITY DEFINER keeps the caller's JWT claims.
    -- Elevate the claim for exactly the recipient recompute (as the claim
    -- delegate does) and restore it before anything else runs.
    previous_role := current_setting('request.jwt.claim.role', true);
    PERFORM set_config('request.jwt.claim.role', 'service_role', true);
    SELECT coalesce(array_agg(member.user_id), '{}'::uuid[])
    INTO eligible_users
    FROM (
      SELECT merchant.user_id FROM public.merchants AS merchant
      WHERE merchant.id = lease.merchant_id
      UNION
      SELECT staff.user_id FROM public.staff_members AS staff
      WHERE staff.merchant_id = lease.merchant_id
        AND staff.status = 'active'
        AND public.check_staff_permission(
          staff.user_id, staff.merchant_id, 'orders', 'fulfill'
        )
    ) AS member
    WHERE member.user_id IS NOT NULL;
    PERFORM set_config(
      'request.jwt.claim.role', coalesce(previous_role, ''), true
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

-- 8. Store accepted tickets for receipt polling. Only tokens that belong to
-- the leased tenant and audience are accepted.
CREATE OR REPLACE FUNCTION public.gigl_worker_store_notification_push_tickets(
  p_id uuid,
  p_worker_id text,
  p_tickets jsonb
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  stored integer;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN 0;
  END IF;
  IF p_tickets IS NULL OR jsonb_typeof(p_tickets) IS DISTINCT FROM 'array'
    OR jsonb_array_length(p_tickets) > 1000 THEN
    RAISE EXCEPTION 'GIGL push tickets are invalid' USING ERRCODE = '22023';
  END IF;
  INSERT INTO public.push_notification_tickets (
    ticket_id, push_token, merchant_id, user_id, app_type, channel,
    notification_type, status
  )
  SELECT left(ticket ->> 'ticket_id', 256), ticket ->> 'push_token',
    lease.merchant_id,
    CASE WHEN lease.audience = 'customer'
      THEN private.gigl_worker_notification_customer_user(lease.order_id)
      ELSE NULL END,
    CASE WHEN lease.audience = 'merchant' THEN 'admin' ELSE 'storefront' END,
    left(ticket ->> 'channel', 64),
    left(ticket ->> 'notification_type', 128),
    'pending'
  FROM jsonb_array_elements(p_tickets) AS ticket
  WHERE nullif(ticket ->> 'ticket_id', '') IS NOT NULL
    AND EXISTS (
      SELECT 1 FROM public.push_tokens AS pt
      WHERE pt.token = ticket ->> 'push_token'
        AND pt.merchant_id = lease.merchant_id
        AND pt.app_type = CASE WHEN lease.audience = 'merchant'
          THEN 'admin' ELSE 'storefront' END
    );
  GET DIAGNOSTICS stored = ROW_COUNT;
  RETURN stored;
END;
$$;

-- 9. Deactivate undeliverable tokens, only the leased tenant's tokens of the
-- leased audience's app.
CREATE OR REPLACE FUNCTION public.gigl_worker_deactivate_notification_push_tokens(
  p_id uuid,
  p_worker_id text,
  p_reason text,
  p_tokens text[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  deactivated integer;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN 0;
  END IF;
  IF nullif(btrim(p_reason), '') IS NULL OR char_length(p_reason) > 64
    OR p_tokens IS NULL OR cardinality(p_tokens) > 1000 THEN
    RAISE EXCEPTION 'GIGL push token deactivation is invalid'
      USING ERRCODE = '22023';
  END IF;
  UPDATE public.push_tokens AS pt
  SET is_active = false, deactivation_reason = p_reason,
    deactivated_at = now()
  WHERE pt.token = ANY (p_tokens)
    AND pt.merchant_id = lease.merchant_id
    AND pt.app_type = CASE WHEN lease.audience = 'merchant'
      THEN 'admin' ELSE 'storefront' END;
  GET DIAGNOSTICS deactivated = ROW_COUNT;
  RETURN deactivated;
END;
$$;

-- 10. Activate-protection candidates for a delivered customer notification.
-- Returns NULL unless the lease is a customer 'delivered' row with an order.
CREATE OR REPLACE FUNCTION public.gigl_worker_notification_activation_candidates(
  p_id uuid,
  p_worker_id text
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  result jsonb;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL OR lease.audience IS DISTINCT FROM 'customer'
    OR lease.notification_kind IS DISTINCT FROM 'delivered'
    OR lease.order_id IS NULL THEN
    RETURN NULL;
  END IF;
  SELECT jsonb_build_object(
    'order_number', o.order_number,
    'customer_id', o.customer_id,
    'shipping_status', o.shipping_status,
    'customer_user_id',
      private.gigl_worker_notification_customer_user(o.id),
    'policies', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', policy.id,
        'status', policy.status,
        'claim_status', policy.claim_status
      ))
      FROM public.order_insurance_policies AS policy
      WHERE policy.order_id = o.id
        AND policy.inspection_status = 'pending'
        AND policy.inspection_link IS NOT NULL
        AND policy.activation_reminder_sent_at IS NULL
    ), '[]'::jsonb)
  ) INTO result
  FROM public.orders AS o
  WHERE o.id = lease.order_id AND o.merchant_id = lease.merchant_id;
  RETURN result;
END;
$$;

-- 11-12. Claim and release the one-time activation reminder markers, only
-- for the leased order's own policies.
CREATE OR REPLACE FUNCTION public.gigl_worker_claim_activation_reminder(
  p_id uuid,
  p_worker_id text,
  p_policy_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  claimed boolean;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL OR lease.audience IS DISTINCT FROM 'customer'
    OR lease.notification_kind IS DISTINCT FROM 'delivered'
    OR lease.order_id IS NULL THEN
    RETURN false;
  END IF;
  UPDATE public.order_insurance_policies AS policy
  SET activation_reminder_sent_at = now()
  WHERE policy.id = p_policy_id
    AND policy.order_id = lease.order_id
    AND policy.activation_reminder_sent_at IS NULL
  RETURNING true INTO claimed;
  RETURN coalesce(claimed, false);
END;
$$;

CREATE OR REPLACE FUNCTION public.gigl_worker_release_activation_reminders(
  p_id uuid,
  p_worker_id text,
  p_policy_ids uuid[]
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  lease record;
  released integer;
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL OR lease.audience IS DISTINCT FROM 'customer'
    OR lease.notification_kind IS DISTINCT FROM 'delivered'
    OR lease.order_id IS NULL OR p_policy_ids IS NULL
    OR cardinality(p_policy_ids) > 100 THEN
    RETURN 0;
  END IF;
  UPDATE public.order_insurance_policies AS policy
  SET activation_reminder_sent_at = NULL
  WHERE policy.id = ANY (p_policy_ids)
    AND policy.order_id = lease.order_id;
  GET DIAGNOSTICS released = ROW_COUNT;
  RETURN released;
END;
$$;

DO $grants$
DECLARE
  signature regprocedure;
BEGIN
  FOR signature IN
    SELECT p.oid::regprocedure
    FROM pg_proc AS p
    WHERE p.pronamespace = 'public'::regnamespace
      AND p.proname IN (
        'gigl_worker_claim_notifications',
        'gigl_worker_begin_notification_dispatch',
        'gigl_worker_complete_notification',
        'gigl_worker_notification_event',
        'gigl_worker_notification_customer',
        'gigl_worker_notification_push_tokens',
        'gigl_worker_record_notification_push_attempt',
        'gigl_worker_store_notification_push_tickets',
        'gigl_worker_deactivate_notification_push_tokens',
        'gigl_worker_notification_activation_candidates',
        'gigl_worker_claim_activation_reminder',
        'gigl_worker_release_activation_reminders'
      )
  LOOP
    EXECUTE format('ALTER FUNCTION %s OWNER TO postgres', signature);
    EXECUTE format(
      'REVOKE ALL ON FUNCTION %s FROM PUBLIC, anon, authenticated, service_role',
      signature
    );
    EXECUTE format(
      'GRANT EXECUTE ON FUNCTION %s TO gigl_tracking_worker', signature
    );
  END LOOP;
END
$grants$;

-- Extend the worker's PostgREST path allowlist, preserving every other
-- branch of the installed request guard verbatim (same technique as the
-- webhook-expedite migration). Only an existing role's allowlist grows, so
-- the change is live at commit; until the new code deploys nothing calls
-- these paths.
DO $guard$
DECLARE
  definition text := pg_get_functiondef(
    'public.enforce_gigl_tracking_worker_request_scope()'::regprocedure
  );
  anchor text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',';
  insertion text := '''/rpc/gigl_worker_claim_due_tracking_monitors'',
        ''/rpc/gigl_worker_claim_notifications'',
        ''/rpc/gigl_worker_begin_notification_dispatch'',
        ''/rpc/gigl_worker_complete_notification'',
        ''/rpc/gigl_worker_notification_event'',
        ''/rpc/gigl_worker_notification_customer'',
        ''/rpc/gigl_worker_notification_push_tokens'',
        ''/rpc/gigl_worker_record_notification_push_attempt'',
        ''/rpc/gigl_worker_store_notification_push_tickets'',
        ''/rpc/gigl_worker_deactivate_notification_push_tokens'',
        ''/rpc/gigl_worker_notification_activation_candidates'',
        ''/rpc/gigl_worker_claim_activation_reminder'',
        ''/rpc/gigl_worker_release_activation_reminders'',';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_roles AS role_record, unnest(role_record.rolconfig) AS setting
    WHERE role_record.rolname = 'authenticator'
      AND setting = 'pgrst.db_pre_request=public.enforce_gigl_tracking_worker_request_scope'
  ) THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard';
  END IF;
  IF position('''/rpc/gigl_worker_claim_notifications''' IN definition) > 0 THEN
    RETURN;
  END IF;
  IF (length(definition) - length(replace(definition, anchor, ''))) / length(anchor) != 1 THEN
    RAISE EXCEPTION 'Unexpected PostgREST request guard definition';
  END IF;
  EXECUTE replace(definition, anchor, insertion);
END $guard$;

NOTIFY pgrst, 'reload schema';

-- Notification worker wrappers (3/4): tickets, token deactivation, activation reminders.

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
  recipients uuid[];
BEGIN
  SELECT * INTO lease
  FROM private.gigl_worker_leased_notification(p_id, p_worker_id);
  IF lease.id IS NULL THEN
    RETURN 0;
  END IF;
  recipients := private.gigl_worker_notification_recipient_users(
    lease.merchant_id, lease.audience, lease.order_id
  );
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
        AND pt.user_id = ANY (recipients)
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
  recipients uuid[];
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
  recipients := private.gigl_worker_notification_recipient_users(
    lease.merchant_id, lease.audience, lease.order_id
  );
  UPDATE public.push_tokens AS pt
  SET is_active = false, deactivation_reason = p_reason,
    deactivated_at = now()
  WHERE pt.token = ANY (p_tokens)
    AND pt.user_id = ANY (recipients)
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

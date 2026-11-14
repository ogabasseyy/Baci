-- GIG notification map (4/5): dispatch RPC allowlists and the booking-time shipped hold.

-- 4c. Dispatch RPCs accept the new customer email event types ------------------
CREATE OR REPLACE FUNCTION public.begin_order_notification_outbox_dispatch(
  p_outbox_id uuid,
  p_order_id uuid,
  p_merchant_id uuid,
  p_event_type text,
  p_claim_owner text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_auth_role text := coalesce(auth.role(), '');
  v_updated_count integer := 0;
BEGIN
  IF p_event_type NOT IN (
    'order_shipped', 'order_delivered', 'order_delivery_failed', 'order_returned'
  ) THEN
    RAISE EXCEPTION 'invalid order notification event type: %', p_event_type
      USING ERRCODE = '22023';
  END IF;

  IF v_auth_role IS DISTINCT FROM 'service_role' THEN
    IF v_auth_uid IS NULL OR NOT (
      EXISTS (
        SELECT 1
        FROM public.merchants AS merchants
        WHERE merchants.id = p_merchant_id
          AND merchants.user_id = v_auth_uid
      )
      OR EXISTS (
        SELECT 1
        FROM public.staff_members AS staff_members
        WHERE staff_members.merchant_id = p_merchant_id
          AND staff_members.user_id = v_auth_uid
          AND staff_members.status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'not authorized to begin order notification dispatch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.order_notification_outbox AS outbox
  SET
    dispatch_started_at = now(),
    updated_at = now()
  WHERE outbox.id = p_outbox_id
    AND outbox.order_id = p_order_id
    AND outbox.merchant_id = p_merchant_id
    AND outbox.event_type = p_event_type
    AND outbox.status = 'processing'
    AND outbox.locked_by = p_claim_owner
    AND outbox.dispatch_started_at IS NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.reset_order_notification_outbox_dispatch(
  p_outbox_id uuid,
  p_order_id uuid,
  p_merchant_id uuid,
  p_event_type text,
  p_claim_owner text
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_auth_uid uuid := auth.uid();
  v_auth_role text := coalesce(auth.role(), '');
  v_updated_count integer := 0;
BEGIN
  IF p_event_type NOT IN (
    'order_shipped', 'order_delivered', 'order_delivery_failed', 'order_returned'
  ) THEN
    RAISE EXCEPTION 'invalid order notification event type: %', p_event_type
      USING ERRCODE = '22023';
  END IF;

  IF v_auth_role IS DISTINCT FROM 'service_role' THEN
    IF v_auth_uid IS NULL OR NOT (
      EXISTS (
        SELECT 1 FROM public.merchants AS merchants
        WHERE merchants.id = p_merchant_id AND merchants.user_id = v_auth_uid
      )
      OR EXISTS (
        SELECT 1 FROM public.staff_members AS staff_members
        WHERE staff_members.merchant_id = p_merchant_id
          AND staff_members.user_id = v_auth_uid
          AND staff_members.status = 'active'
      )
    ) THEN
      RAISE EXCEPTION 'not authorized to reset order notification dispatch'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  UPDATE public.order_notification_outbox AS outbox
  SET dispatch_started_at = NULL, updated_at = now()
  WHERE outbox.id = p_outbox_id
    AND outbox.order_id = p_order_id
    AND outbox.merchant_id = p_merchant_id
    AND outbox.event_type = p_event_type
    AND outbox.status = 'processing'
    AND outbox.locked_by = p_claim_owner
    AND outbox.dispatch_started_at IS NOT NULL;

  GET DIAGNOSTICS v_updated_count = ROW_COUNT;
  RETURN v_updated_count;
END;
$$;

-- 5. No shipped email at booking for GIG orders -------------------------------------
CREATE OR REPLACE FUNCTION public.enqueue_order_fulfillment_notification()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_event_type text;
BEGIN
  IF TG_OP <> 'UPDATE'
    OR current_setting('baci.order_notification_outbox.suppress_enqueue', true) = 'true'
    OR NEW.shipping_status IS NOT DISTINCT FROM OLD.shipping_status
  THEN
    RETURN NEW;
  END IF;

  IF NEW.shipping_status IN ('shipped', 'out_for_delivery')
    AND OLD.shipping_status NOT IN ('shipped', 'out_for_delivery', 'delivered', 'completed')
  THEN
    v_event_type := 'order_shipped';
  ELSIF NEW.shipping_status IN ('delivered', 'completed')
    AND OLD.shipping_status NOT IN ('delivered', 'completed')
  THEN
    v_event_type := 'order_delivered';
  ELSE
    RETURN NEW;
  END IF;

  -- GIG orders are told "shipped" when GIG picks the parcel up (see
  -- private.enqueue_customer_email_on_gigl_event), not when it is booked.
  IF v_event_type = 'order_shipped' AND EXISTS (
    SELECT 1 FROM public.shipments AS shipment
    WHERE shipment.order_id = NEW.id
      AND shipment.provider = 'GIGL'
      AND shipment.status IN ('pending', 'booked', 'pickup_scheduled')
      -- Only the order's latest live shipment holds the email; an abandoned
      -- older booking must not suppress it forever.
      AND NOT EXISTS (
        SELECT 1 FROM public.shipments AS newer
        WHERE newer.order_id = shipment.order_id
          AND newer.provider = 'GIGL'
          AND newer.id <> shipment.id
          AND newer.status <> 'cancelled'
          AND newer.created_at > shipment.created_at
      )
  ) THEN
    RETURN NEW;
  END IF;

  INSERT INTO public.order_notification_outbox (
    order_id,
    merchant_id,
    event_type,
    fulfillment_cycle_id,
    next_attempt_at,
    metadata
  )
  VALUES (
    NEW.id,
    NEW.merchant_id,
    v_event_type,
    NEW.fulfillment_notification_cycle_id,
    now(),
    jsonb_build_object(
      'previous_shipping_status', OLD.shipping_status,
      'shipping_status', NEW.shipping_status,
      'source', 'orders_shipping_status_trigger',
      'fulfillment_courier_name', NEW.shipping_provider,
      'fulfillment_tracking_number', NEW.tracking_number,
      'fulfillment_tracking_token', NEW.tracking_token
    )
  )
  ON CONFLICT (order_id, event_type, fulfillment_cycle_id) DO UPDATE
  SET
    status = 'pending',
    attempt_count = 0,
    next_attempt_at = now(),
    locked_at = NULL,
    locked_by = NULL,
    last_error = NULL,
    skip_reason = NULL,
    skipped_at = NULL,
    dispatch_started_at = NULL,
    metadata = order_notification_outbox.metadata || EXCLUDED.metadata,
    updated_at = now()
  WHERE order_notification_outbox.status = 'failed'
    OR (
      order_notification_outbox.status = 'skipped'
      AND order_notification_outbox.skip_reason
        IS DISTINCT FROM 'delivery_outcome_unknown'
    );

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_order_fulfillment_notification()
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_order_fulfillment_notification()
  TO service_role;

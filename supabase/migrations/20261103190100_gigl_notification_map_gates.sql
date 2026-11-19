-- GIG notification map (2/5): policy rows, merchant toggle and superseded-shipment gates.

-- 2. Policy rows ------------------------------------------------------------
ALTER TABLE private.gigl_tracking_notification_policy
  DROP CONSTRAINT IF EXISTS gigl_tracking_notification_policy_notification_kind_check;
ALTER TABLE private.gigl_tracking_notification_policy
  ADD CONSTRAINT gigl_tracking_notification_policy_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  )) NOT VALID;
ALTER TABLE public.shipment_tracking_notification_outbox
  DROP CONSTRAINT IF EXISTS shipment_tracking_notification_outbox_notification_kind_check;
ALTER TABLE public.shipment_tracking_notification_outbox
  ADD CONSTRAINT shipment_tracking_notification_outbox_notification_kind_check
  CHECK (notification_kind IN (
    'pickup_assigned', 'pickup_en_route', 'pickup_delayed', 'picked_up',
    'transit_started', 'out_for_delivery', 'delivered',
    'delivery_attempt_failed', 'return_in_progress', 'shipment_exception',
    'failed', 'returned', 'cancelled', 'waybill_changed'
  )) NOT VALID;

INSERT INTO private.gigl_tracking_notification_policy (
  raw_status, normalized_status, audience, notification_kind
) VALUES
  ('DLP', NULL, 'merchant', 'pickup_delayed'),
  (NULL, 'picked_up', 'customer', 'picked_up'),
  (NULL, 'out_for_delivery', 'merchant', 'out_for_delivery'),
  (NULL, 'delivered', 'merchant', 'delivered'),
  (NULL, 'cancelled', 'customer', 'cancelled')
ON CONFLICT DO NOTHING;

-- 3. Merchant toggle + superseded-shipment gate on enqueue ------------------------
CREATE OR REPLACE FUNCTION private.gigl_merchant_event_enabled(
  p_merchant_id uuid, p_notification_kind text
)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  WITH k AS (
    SELECT CASE p_notification_kind
      WHEN 'pickup_assigned' THEN 'pickup_scheduled'
      WHEN 'pickup_en_route' THEN 'pickup_scheduled'
      ELSE p_notification_kind
    END AS key
  )
  SELECT coalesce(
    (SELECT (preferences.shipment_event_preferences ->> k.key)::boolean
     FROM public.notification_preferences AS preferences
     WHERE preferences.merchant_id = p_merchant_id
       AND jsonb_typeof(preferences.shipment_event_preferences -> k.key) = 'boolean'),
    k.key <> 'out_for_delivery'
  )
  FROM k;
$$;
REVOKE ALL ON FUNCTION private.gigl_merchant_event_enabled(uuid, text)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.gigl_cancellation_superseded(p_shipment_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.shipments AS cancelled
    JOIN public.shipments AS newer
      ON newer.order_id = cancelled.order_id
      AND newer.id <> cancelled.id
      AND newer.status NOT IN ('cancelled', 'failed', 'returned', 'delivered')
      AND newer.created_at > cancelled.created_at
    WHERE cancelled.id = p_shipment_id
  );
$$;
REVOKE ALL ON FUNCTION private.gigl_cancellation_superseded(uuid)
  FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION private.gate_gigl_tracking_notification()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF NEW.status <> 'pending' THEN
    RETURN NEW;
  END IF;
  IF NEW.audience = 'merchant'
    AND NOT private.gigl_merchant_event_enabled(NEW.merchant_id, NEW.notification_kind)
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'merchant_preference_off';
  ELSIF NEW.audience = 'customer' AND NEW.notification_kind = 'cancelled'
    AND private.gigl_cancellation_superseded(NEW.shipment_id)
  THEN
    NEW.status := 'skipped';
    NEW.skipped_at := now();
    NEW.skip_reason := 'superseded_by_newer_shipment';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.gate_gigl_tracking_notification()
  FROM PUBLIC, anon, authenticated;

DROP TRIGGER IF EXISTS gate_gigl_tracking_notification
  ON public.shipment_tracking_notification_outbox;
CREATE TRIGGER gate_gigl_tracking_notification
  BEFORE INSERT ON public.shipment_tracking_notification_outbox
  FOR EACH ROW EXECUTE FUNCTION private.gate_gigl_tracking_notification();

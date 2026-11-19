-- GIG event builders and the worker apply entry point for
-- gigl_provider_cancellation_wallet_refund.sql (\ir part).

-- One GIG tracking event as the worker sends it.
CREATE FUNCTION pg_temp.gig_event(
  p_key text,
  p_raw_status text,
  p_status text,
  p_occurred_at timestamptz
)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_object(
    'provider_event_key', p_key,
    'raw_status', p_raw_status,
    'normalized_status', p_status,
    'description', 'GIG reported ' || p_raw_status,
    'occurred_at', p_occurred_at
  )
$$;

-- The tracking worker's mark on a cancellation event: GIG's
-- /get/preshipment record for the waybill names Baci's own GIG account
-- (CustomerCode = the login's UserChannelCode).
CREATE FUNCTION pg_temp.attested(p_event jsonb)
RETURNS jsonb
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT p_event || jsonb_build_object('account_attested', true)
$$;

-- GIG's full history for a waybill this order's submission created (MCRT at
-- the submission time, now() in this transaction) and later cancelled, with
-- the worker's account attestation on the cancellation.
CREATE FUNCTION pg_temp.fresh_cancel_history(p_n integer, p_cancel_raw text)
RETURNS jsonb
LANGUAGE sql
STABLE
AS $$
  SELECT jsonb_build_array(
    pg_temp.gig_event('MCRT:' || p_n, 'MCRT', 'booked', now()),
    pg_temp.attested(pg_temp.gig_event(
      p_cancel_raw || ':' || p_n, p_cancel_raw, 'cancelled',
      now() + interval '2 minutes'
    ))
  )
$$;

-- The worker's real entry point: gigl_worker_apply_tracking_result elevates
-- to service_role and calls apply_gigl_tracking_result with the lease.
CREATE FUNCTION pg_temp.apply_gig_events(
  p_shipment uuid,
  p_status text,
  p_events jsonb
)
RETURNS boolean
LANGUAGE plpgsql
AS $apply$
DECLARE
  v_epoch uuid;
  v_applied boolean;
BEGIN
  SELECT monitor.tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors AS monitor
  WHERE monitor.shipment_id = p_shipment;
  PERFORM pg_catalog.set_config(
    'request.jwt.claim.role', 'gigl_tracking_worker', true
  );
  v_applied := public.gigl_worker_apply_tracking_result(
    p_shipment, v_epoch, 'worker-test', p_status, NULL, NULL, p_events
  );
  PERFORM pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);
  RETURN v_applied;
END;
$apply$;

CREATE FUNCTION pg_temp.apply_gig_status(
  p_shipment uuid,
  p_status text,
  p_raw_status text,
  p_event_key text,
  p_occurred_at timestamptz
)
RETURNS boolean
LANGUAGE sql
AS $$
  SELECT pg_temp.apply_gig_events(
    p_shipment, p_status,
    jsonb_build_array(
      pg_temp.gig_event(p_event_key, p_raw_status, p_status, p_occurred_at)
    )
  )
$$;

-- Leases the shipment's current monitor to 'worker-test' again.
CREATE FUNCTION pg_temp.lease_monitor(p_shipment uuid)
RETURNS void
LANGUAGE plpgsql
AS $lease$
BEGIN
  UPDATE public.shipment_tracking_monitors
  SET locked_by = 'worker-test', locked_at = now()
  WHERE shipment_id = p_shipment;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipment % has no tracking monitor', p_shipment;
  END IF;
END;
$lease$;

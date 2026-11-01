-- Verify that a lost start response can be reconciled only by its owner.
BEGIN;
DO $$
DECLARE
  merchant_id constant uuid := '9f000000-0000-4000-8000-000000003530';
  v_order_id constant uuid := '9f000000-0000-4000-8000-000000003531';
  owner_attempt constant uuid := '9f000000-0000-4000-8000-000000003532';
  other_attempt constant uuid := '9f000000-0000-4000-8000-000000003533';
  lease uuid;
  claimed boolean;
BEGIN
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (merchant_id, 'redrive-attempt@example.com', 'Redrive Attempt', 'redrive-attempt');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_email, tracking_token)
  VALUES (v_order_id, merchant_id, 'REDRIVE-ATTEMPT', 1000, 'redrive@example.com', 'redrive-attempt');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claim_token INTO lease FROM public.claim_immediate_order_notification(v_order_id) c;
  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT public.begin_immediate_notification_dispatch(v_order_id, lease, owner_attempt), 'owner must acquire fence';
  ASSERT NOT public.begin_immediate_notification_dispatch(v_order_id, lease, other_attempt), 'competing begin must fail';
  ASSERT NOT public.release_immediate_notification_dispatch(v_order_id, lease, other_attempt), 'competitor must not release fence';
  ASSERT NOT public.record_immediate_notification_acceptance(v_order_id, lease, other_attempt), 'competitor must not record acceptance';
  ASSERT public.release_immediate_notification_dispatch(v_order_id, lease, owner_attempt), 'owner may release its own pre-send fence';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.immediate_order_notification_claims SET locked_at = now() - interval '10 minutes'
  WHERE immediate_order_notification_claims.order_id = v_order_id;
  SELECT c.claimed INTO claimed FROM public.claim_immediate_order_notification(v_order_id) c;
  ASSERT claimed, 'released pre-send attempt must permit a later retry';
  ASSERT NOT has_function_privilege('anon', 'public.release_immediate_notification_dispatch(uuid,uuid,uuid)', 'EXECUTE'),
    'anonymous caller must not release dispatches';
END $$;
ROLLBACK;

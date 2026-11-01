-- Verify that a lost start response can be reconciled only by its owner.
BEGIN;
DO $$
DECLARE
  merchant_id constant uuid := '9f000000-0000-4000-8000-000000003530';
  v_order_id constant uuid := '9f000000-0000-4000-8000-000000003531';
  owner_attempt constant uuid := '9f000000-0000-4000-8000-000000003532';
  other_attempt constant uuid := '9f000000-0000-4000-8000-000000003533';
  accepted_order constant uuid := '9f000000-0000-4000-8000-000000003534';
  lease uuid;
  accepted_lease uuid;
  claimed boolean;
BEGIN
  -- Merchant identity audit triggers require an attributed service actor.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (merchant_id, 'redrive-attempt@example.com', 'Redrive Attempt', 'redrive-attempt');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_email, tracking_token)
  VALUES (v_order_id, merchant_id, 'REDRIVE-ATTEMPT', 1000, 'redrive@example.com', 'redrive-attempt'),
    (accepted_order, merchant_id, 'REDRIVE-ATTEMPT-ACCEPTED', 1000, 'redrive@example.com', 'redrive-attempt-accepted');
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claim_token INTO lease FROM public.claim_immediate_order_notification(v_order_id) c;
  SELECT c.claim_token INTO accepted_lease FROM public.claim_immediate_order_notification(accepted_order) c;
  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT public.begin_immediate_notification_dispatch(v_order_id, lease, owner_attempt), 'owner must acquire fence';
  ASSERT NOT public.begin_immediate_notification_dispatch(v_order_id, lease, other_attempt), 'competing begin must fail';
  ASSERT NOT public.release_immediate_notification_dispatch(v_order_id, lease, other_attempt), 'competitor must not release fence';
  ASSERT NOT public.record_immediate_notification_acceptance(v_order_id, lease, other_attempt), 'competitor must not record acceptance';
  ASSERT public.release_immediate_notification_dispatch(v_order_id, lease, owner_attempt), 'owner may release its own pre-send fence';
  ASSERT public.begin_immediate_notification_dispatch(accepted_order, accepted_lease, owner_attempt), 'accepted attempt must begin';
  ASSERT public.record_immediate_notification_acceptance(accepted_order, accepted_lease, owner_attempt), 'owner may record acceptance';
  ASSERT public.record_immediate_notification_acceptance(accepted_order, accepted_lease, owner_attempt), 'acceptance must be idempotent';
  ASSERT NOT public.release_immediate_notification_dispatch(accepted_order, accepted_lease, owner_attempt),
    'even the owner must not release a confirmed acceptance';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  UPDATE public.immediate_order_notification_claims SET locked_at = now() - interval '10 minutes'
  WHERE immediate_order_notification_claims.order_id = v_order_id;
  SELECT c.claimed INTO claimed FROM public.claim_immediate_order_notification(v_order_id) c;
  ASSERT claimed, 'released pre-send attempt must permit a later retry';
  ASSERT NOT has_function_privilege('anon', 'public.release_immediate_notification_dispatch(uuid,uuid,uuid)', 'EXECUTE'),
    'anonymous caller must not release dispatches';
END $$;
ROLLBACK;

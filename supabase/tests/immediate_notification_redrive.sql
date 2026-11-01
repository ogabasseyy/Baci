-- Run against a disposable database after all migrations, with ON_ERROR_STOP.
-- A transport with an uncertain outcome must never be sent a second time.
BEGIN;

DO $$
DECLARE
  merchant_id constant uuid := '9f000000-0000-4000-8000-000000003500';
  uncertain_order constant uuid := '9f000000-0000-4000-8000-000000003501';
  accepted_order constant uuid := '9f000000-0000-4000-8000-000000003502';
  rejected_order constant uuid := '9f000000-0000-4000-8000-000000003503';
  wrong_lease constant uuid := '9f000000-0000-4000-8000-000000003599';
  uncertain_lease uuid;
  accepted_lease uuid;
  rejected_lease uuid;
  claimed boolean;
  current_status text;
BEGIN
  -- Merchant identity audit triggers require an attributed service actor.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (merchant_id, 'redrive-regression@example.com', 'Redrive Regression', 'redrive-regression');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_email, tracking_token)
  VALUES
    (uncertain_order, merchant_id, 'REDRIVE-UNCERTAIN', 1000, 'redrive@example.com', 'redrive-uncertain'),
    (accepted_order, merchant_id, 'REDRIVE-ACCEPTED', 1000, 'redrive@example.com', 'redrive-accepted'),
    (rejected_order, merchant_id, 'REDRIVE-REJECTED', 1000, 'redrive@example.com', 'redrive-rejected');

  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claim_token INTO uncertain_lease FROM public.claim_immediate_order_notification(uncertain_order) c;
  SELECT c.claim_token INTO accepted_lease FROM public.claim_immediate_order_notification(accepted_order) c;
  SELECT c.claim_token INTO rejected_lease FROM public.claim_immediate_order_notification(rejected_order) c;
  ASSERT uncertain_lease IS NOT NULL AND accepted_lease IS NOT NULL AND rejected_lease IS NOT NULL,
    'fixtures must acquire their initial claims';

  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT NOT public.begin_immediate_notification_dispatch(uncertain_order, wrong_lease, uncertain_order), 'wrong lease must not dispatch';
  ASSERT public.begin_immediate_notification_dispatch(uncertain_order, uncertain_lease, uncertain_order), 'valid dispatch must begin';
  ASSERT NOT EXISTS (SELECT 1 FROM public.list_immediate_notification_recovery_candidates(100) c
    WHERE c.order_id = uncertain_order), 'fresh dispatch must not appear as unresolved';
  ASSERT NOT public.begin_immediate_notification_dispatch(uncertain_order, uncertain_lease, uncertain_order),
    'a repeated begin must not authorize a second send';
  ASSERT NOT public.recover_immediate_notification_completion(uncertain_order, uncertain_lease),
    'an uncertain dispatch must not be recorded as accepted';
  UPDATE private.immediate_notification_dispatches SET updated_at = now() - interval '10 minutes'
  WHERE order_id = uncertain_order;
  ASSERT EXISTS (SELECT 1 FROM public.list_immediate_notification_recovery_candidates(100) c
    WHERE c.order_id = uncertain_order), 'stale dispatch must become visible for reconciliation';
  ASSERT public.has_immediate_notification_reconciliation_backlog(),
    'stale uncertain dispatches must be visible independent of batch selection';
  ASSERT public.begin_immediate_notification_dispatch(accepted_order, accepted_lease, accepted_order), 'accepted fixture must begin';
  ASSERT NOT public.record_immediate_notification_acceptance(accepted_order, wrong_lease, accepted_order), 'wrong lease must not accept';
  ASSERT public.record_immediate_notification_acceptance(accepted_order, accepted_lease, accepted_order), 'acceptance must be recorded';
  ASSERT public.begin_immediate_notification_dispatch(rejected_order, rejected_lease, rejected_order), 'rejected fixture must begin';
  ASSERT public.release_immediate_notification_dispatch(rejected_order, rejected_lease, rejected_order), 'definite rejection must release';

  UPDATE public.immediate_order_notification_claims
  SET locked_at = now() - interval '10 minutes', started_at = now() - interval '10 minutes'
  WHERE order_id IN (uncertain_order, accepted_order, rejected_order);
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claimed, c.claim_status INTO claimed, current_status FROM public.claim_immediate_order_notification(uncertain_order) c;
  ASSERT NOT claimed AND current_status = 'processing', 'uncertain dispatch must fence stale reclaim';
  SELECT c.claimed, c.claim_status INTO claimed, current_status FROM public.claim_immediate_order_notification(accepted_order) c;
  ASSERT NOT claimed AND current_status = 'processing', 'accepted dispatch must fence stale reclaim';
  SELECT c.claimed INTO claimed FROM public.claim_immediate_order_notification(rejected_order) c;
  ASSERT claimed, 'definitely rejected dispatch may be reclaimed';

  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT public.recover_immediate_notification_completion(accepted_order, accepted_lease), 'accepted delivery must recover';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claimed, c.claim_status INTO claimed, current_status FROM public.claim_immediate_order_notification(accepted_order) c;
  ASSERT NOT claimed AND current_status = 'sent', 'recovered delivery must remain terminal';

  ASSERT NOT has_function_privilege('anon', 'public.begin_immediate_notification_dispatch(uuid,uuid,uuid)', 'EXECUTE'),
    'anonymous clients must not start dispatches';
  ASSERT NOT has_function_privilege('authenticated', 'public.recover_immediate_notification_completion(uuid,uuid)', 'EXECUTE'),
    'authenticated clients must not forge recovered completions';
END;
$$;

-- The shared pre-request hook must constrain the worker independently of
-- function grants, while retaining the existing GIGL worker restriction.
DO $$
DECLARE
  rpc_path text;
  denied boolean;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  PERFORM set_config('request.method', 'POST', true);
  FOREACH rpc_path IN ARRAY ARRAY[
    '/rpc/begin_immediate_notification_dispatch',
    '/rpc/record_immediate_notification_acceptance',
    '/rpc/release_immediate_notification_dispatch',
    '/rpc/recover_immediate_notification_completion',
    '/rpc/list_immediate_notification_recovery_candidates',
    '/rpc/has_immediate_notification_reconciliation_backlog'
  ] LOOP
    PERFORM set_config('request.path', rpc_path, true);
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  END LOOP;
  PERFORM set_config('request.path', '/rpc/unrelated_public_function', true);
  denied := false;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'redrive worker must not call unrelated RPCs';

  PERFORM set_config('request.path', '/rpc/begin_immediate_notification_dispatch', true);
  PERFORM set_config('request.method', 'GET', true);
  denied := false;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'redrive worker must not use GET';

  PERFORM set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);
  PERFORM set_config('request.method', 'POST', true);
  PERFORM set_config('request.path', '/rpc/begin_immediate_notification_dispatch', true);
  denied := false;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'existing GIGL worker must not inherit redrive access';

  PERFORM set_config('request.jwt.claim.role', 'anon', true);
  PERFORM set_config('request.path', '/rpc/__immediate_notification_redrive_hook_reload_canary__', true);
  denied := false;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'the reload canary must be intercepted by the hook';
  PERFORM set_config('request.path', '/rpc/__immediate_notification_redrive_complete_hook_canary__', true);
  denied := false;
  BEGIN
    PERFORM public.enforce_gigl_tracking_worker_request_scope();
  EXCEPTION WHEN insufficient_privilege THEN denied := true;
  END;
  ASSERT denied, 'the complete guard canary must be intercepted by the hook';
END $$;

-- Exact issue #3500: the provider accepted, but the existing HMAC-bound
-- completion cannot be recorded while the provisioning secret is absent.
DO $$
DECLARE
  merchant_id constant uuid := '9f000000-0000-4000-8000-000000003520';
  v_order_id constant uuid := '9f000000-0000-4000-8000-000000003521';
  lease uuid;
  claimed boolean;
  current_status text;
BEGIN
  -- Attribute fixture creation to the service actor for merchant auditing.
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  INSERT INTO public.merchants (id, email, business_name, slug)
  VALUES (merchant_id, 'redrive-hmac@example.com', 'Redrive HMAC', 'redrive-hmac');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_email, tracking_token)
  VALUES (v_order_id, merchant_id, 'REDRIVE-HMAC', 1000, 'redrive@example.com', 'redrive-hmac');

  DELETE FROM private.immediate_notification_completion_secrets WHERE name = 'completion_v1';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claim_token INTO lease FROM public.claim_immediate_order_notification(v_order_id) c;
  ASSERT lease IS NOT NULL, 'the order must acquire a delivery claim';
  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT public.begin_immediate_notification_dispatch(v_order_id, lease, v_order_id), 'provider dispatch must begin';
  ASSERT public.record_immediate_notification_acceptance(v_order_id, lease, v_order_id), 'provider acceptance must be recorded';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  PERFORM public.complete_immediate_order_notification_with_proof(v_order_id, 'redrive-hmac', true, lease, 'no-secret');
  SELECT c.status INTO current_status FROM public.immediate_order_notification_claims c WHERE c.order_id = v_order_id;
  ASSERT current_status = 'processing', 'unprovisioned proof must leave the claim processing';
  UPDATE public.immediate_order_notification_claims SET locked_at = now() - interval '10 minutes',
    started_at = now() - interval '10 minutes' WHERE immediate_order_notification_claims.order_id = v_order_id;
  SELECT c.claimed INTO claimed FROM public.claim_immediate_order_notification(v_order_id) c;
  ASSERT NOT claimed, 'an accepted dispatch must prevent stale-lease replay';
  INSERT INTO private.immediate_notification_completion_secrets (name, secret)
  VALUES ('completion_v1', 'redrive-regression-provisioned-secret-32-plus');
  PERFORM set_config('request.jwt.claim.role', 'immediate_notification_redrive', true);
  ASSERT public.recover_immediate_notification_completion(v_order_id, lease), 'durable recovery must complete without the missing proof';
  ASSERT public.recover_immediate_notification_completion(v_order_id, lease), 'completion recovery must be idempotent';
  PERFORM set_config('request.jwt.claim.role', 'service_role', true);
  SELECT c.claimed, c.claim_status INTO claimed, current_status FROM public.claim_immediate_order_notification(v_order_id) c;
  ASSERT NOT claimed AND current_status = 'sent', 'a recovered claim must be terminal';
END $$;

ROLLBACK;

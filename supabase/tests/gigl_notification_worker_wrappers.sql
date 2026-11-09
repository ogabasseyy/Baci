-- Replay test: the GIGL notification graph runs on the restricted
-- gigl_tracking_worker capability (lease-bound wrappers), not service_role.
-- Grants are asserted through the catalog, never by call-and-catch.
BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap WITH SCHEMA extensions;
\ir pgtap_public_execute.sql
SET search_path = public, extensions;
SELECT plan(21);
GRANT USAGE ON SCHEMA extensions TO gigl_tracking_worker;

CREATE TEMP TABLE gnw_wrappers (signature text PRIMARY KEY) ON COMMIT DROP;
INSERT INTO gnw_wrappers VALUES
  ('public.gigl_worker_claim_notifications(integer,text)'),
  ('public.gigl_worker_begin_notification_dispatch(uuid,text)'),
  ('public.gigl_worker_complete_notification(uuid,text,text,text)'),
  ('public.gigl_worker_notification_event(uuid,text)'),
  ('public.gigl_worker_notification_customer(uuid,text)'),
  ('public.gigl_worker_notification_push_tokens(uuid,text,uuid[],integer)'),
  ('public.gigl_worker_record_notification_push_attempt(uuid,text,jsonb)'),
  ('public.gigl_worker_store_notification_push_tickets(uuid,text,jsonb)'),
  ('public.gigl_worker_deactivate_notification_push_tokens(uuid,text,text,text[])'),
  ('public.gigl_worker_notification_activation_candidates(uuid,text)'),
  ('public.gigl_worker_claim_activation_reminder(uuid,text,uuid)'),
  ('public.gigl_worker_release_activation_reminders(uuid,text,uuid[])');
GRANT SELECT ON gnw_wrappers TO PUBLIC;

-- 1-4. Catalog: the worker, and only the worker, executes every wrapper.
SELECT is(
  (SELECT count(*)::int FROM gnw_wrappers
   WHERE has_function_privilege('gigl_tracking_worker', signature::regprocedure, 'EXECUTE')),
  12, 'gigl_tracking_worker can execute all twelve notification wrappers'
);
SELECT is(
  (SELECT count(*)::int FROM gnw_wrappers
   WHERE has_function_privilege('anon', signature::regprocedure, 'EXECUTE')
      OR has_function_privilege('authenticated', signature::regprocedure, 'EXECUTE')
      OR has_function_privilege('service_role', signature::regprocedure, 'EXECUTE')),
  0, 'anon, authenticated and service_role cannot execute any notification wrapper'
);
SELECT is(
  (SELECT count(*)::int FROM gnw_wrappers AS w
   JOIN pg_proc AS p ON p.oid = w.signature::regprocedure
   CROSS JOIN LATERAL aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) AS acl
   WHERE acl.grantee = 0 AND acl.privilege_type = 'EXECUTE'),
  0, 'PUBLIC (grantee 0) holds no EXECUTE on any notification wrapper'
);
SELECT is(
  (SELECT count(*)::int FROM gnw_wrappers AS w
   JOIN pg_proc AS p ON p.oid = w.signature::regprocedure
   WHERE p.prosecdef AND p.proconfig @> ARRAY['search_path=""'] AND
     pg_get_userbyid(p.proowner) = 'postgres'),
  12, 'every wrapper is SECURITY DEFINER, owned by postgres, with an empty search_path'
);

-- 5-7. The raw service-role RPCs and private helpers stay unreachable.
SELECT ok(
  NOT has_function_privilege('gigl_tracking_worker',
    'public.claim_shipment_tracking_notifications(integer,text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('gigl_tracking_worker',
    'public.begin_shipment_tracking_notification_dispatch(uuid,text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('gigl_tracking_worker',
    'public.complete_shipment_tracking_notification(uuid,text,text,text)'::regprocedure, 'EXECUTE'),
  'the worker cannot call the raw service-role claim, begin or complete RPCs'
);
SELECT ok(
  NOT has_function_privilege('gigl_tracking_worker',
    'private.gigl_worker_leased_notification(uuid,text)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('gigl_tracking_worker',
    'private.gigl_worker_notification_recipient_users(uuid,text,uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_schema_privilege('gigl_tracking_worker', 'private', 'USAGE'),
  'the worker has no access to the private lease helpers or schema'
);
SELECT ok(
  NOT has_function_privilege('anon',
    'private.gigl_worker_notification_customer_user(uuid)'::regprocedure, 'EXECUTE')
  AND NOT has_function_privilege('authenticated',
    'private.gigl_worker_notification_customer_user(uuid)'::regprocedure, 'EXECUTE'),
  'API roles cannot resolve a customer user through the private helper'
);

-- 8. The worker holds no table privileges anywhere in the notification graph.
SELECT is(
  (SELECT count(*)::int
   FROM unnest(ARRAY[
     'public.shipment_tracking_notification_outbox', 'public.shipment_tracking_events',
     'public.orders', 'public.customers', 'public.push_tokens',
     'public.push_notification_attempts', 'public.push_notification_tickets',
     'public.order_insurance_policies'
   ]) AS t(name)
   CROSS JOIN unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE']) AS priv(name)
   WHERE has_table_privilege('gigl_tracking_worker', t.name, priv.name)),
  0, 'the worker holds no direct table privilege on any notification table'
);

-- 9-10. Role posture is unchanged: NOLOGIN, no BYPASSRLS, authenticator-confined.
SELECT ok(
  (SELECT NOT rolcanlogin AND NOT rolbypassrls AND NOT rolsuper
   FROM pg_roles WHERE rolname = 'gigl_tracking_worker'),
  'the worker role stays NOLOGIN, NOBYPASSRLS and non-superuser'
);
SELECT is(
  (SELECT count(*)::int FROM gnw_wrappers
   WHERE position(
     '''/rpc/' || split_part(split_part(signature, '(', 1), '.', 2) || ''''
     IN pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)
   ) > 0),
  12, 'the PostgREST request-scope hook allowlists every notification wrapper path'
);
SELECT ok(
  pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)
    LIKE '%/rpc/gigl_worker_apply_tracking_result%'
  AND pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)
    LIKE '%/rpc/gigl_worker_expedite_tracking_monitor%'
  AND pg_get_functiondef('public.enforce_gigl_tracking_worker_request_scope()'::regprocedure)
    LIKE '%/rpc/blog_media_sweep_worker_claim%',
  'the hook still carries the tracking, expedite and blog-media branches'
);

-- Behaviour fixtures ------------------------------------------------------
ALTER TABLE public.shipments DISABLE TRIGGER stamp_gigl_shipment_economics;
-- Fixtures run as the migration owner with the service-role claim, like the
-- other gigl suites (service_role itself cannot write auth.users).
SELECT set_config('request.jwt.claim.role', 'service_role', true);

CREATE TEMP TABLE gnw_fixture (
  merchant_a uuid, merchant_b uuid, owner_a uuid, owner_b uuid, buyer uuid,
  order_id uuid, shipment_id uuid, epoch_id uuid, event_id uuid,
  customer_id uuid
) ON COMMIT DROP;
GRANT ALL ON gnw_fixture TO PUBLIC;

DO $fixture$
DECLARE
  v_a uuid := '7b2d0000-0000-4000-8000-000000000001';
  v_b uuid := '7b2d0000-0000-4000-8000-000000000002';
  v_owner_a uuid := '7b2d0000-0000-4000-8000-0000000000a1';
  v_owner_b uuid := '7b2d0000-0000-4000-8000-0000000000a2';
  v_buyer uuid := '7b2d0000-0000-4000-8000-0000000000a3';
  v_staff uuid := '7b2d0000-0000-4000-8000-0000000000a4';
  v_order uuid := '7b2d0000-0000-4000-8000-000000000010';
  v_customer uuid := '7b2d0000-0000-4000-8000-000000000020';
  v_shipment uuid;
  v_epoch uuid;
  v_event uuid;
  v_uid uuid;
BEGIN
  FOREACH v_uid IN ARRAY ARRAY[v_owner_a, v_owner_b, v_buyer, v_staff] LOOP
    INSERT INTO auth.users (
      id, instance_id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data
    ) VALUES (
      v_uid, '00000000-0000-0000-0000-000000000000', 'authenticated',
      'authenticated', v_uid::text || '@gigl-worker.example.com', 'test',
      now(), now(), now(), '{}'::jsonb, '{}'::jsonb
    );
  END LOOP;
  INSERT INTO public.merchants (id, user_id, email, business_name, slug) VALUES
    (v_a, v_owner_a, 'gnw-a@example.com', 'GNW A', 'gnw-a'),
    (v_b, v_owner_b, 'gnw-b@example.com', 'GNW B', 'gnw-b');
  INSERT INTO public.staff_members (
    merchant_id, user_id, email, name, role, permissions, status
  ) VALUES (
    v_a, v_staff, 'staff@gnw.example.com', 'Staff', 'sales_rep',
    '{"orders": {"fulfill": true, "view": true}}'::jsonb, 'active'
  );
  INSERT INTO public.customers (id, merchant_id, user_id, email)
  VALUES (v_customer, v_a, v_buyer, 'buyer@gnw.example.com');
  INSERT INTO public.orders (id, merchant_id, order_number, total, customer_id)
  VALUES (v_order, v_a, 'GNW-001', 1000, v_customer);
  INSERT INTO public.shipments (
    order_id, merchant_id, provider, tracking_number,
    sender_address, receiver_address, items, funding_source
  ) VALUES (
    v_order, v_a, 'GIGL', 'GNW-001',
    '{}'::jsonb, '{}'::jsonb, '[]'::jsonb, 'external_manual'
  ) RETURNING id INTO v_shipment;
  SELECT tracking_epoch_id INTO v_epoch
  FROM public.shipment_tracking_monitors WHERE shipment_id = v_shipment;
  INSERT INTO public.shipment_tracking_events (
    shipment_id, tracking_epoch_id, tracking_number, provider,
    provider_event_key, raw_status, normalized_status, description, occurred_at
  ) VALUES (
    v_shipment, v_epoch, 'GNW-001', 'GIGL', 'gnw-event', 'MPIK',
    'picked_up', 'Picked up by rider', now()
  ) RETURNING id INTO v_event;
  INSERT INTO public.push_tokens (token, user_id, merchant_id, platform, app_type, is_active, shipment_update_capability)
  VALUES
    ('ExponentPushToken[gnw-owner-a]', v_owner_a, v_a, 'ios', 'admin', true, 1),
    ('ExponentPushToken[gnw-staff-a]', v_staff, v_a, 'ios', 'admin', true, 1),
    ('ExponentPushToken[gnw-owner-b]', v_owner_b, v_b, 'ios', 'admin', true, 1),
    ('ExponentPushToken[gnw-other-a]', v_owner_b, v_a, 'android', 'storefront', true, 1),
    ('ExponentPushToken[gnw-outsider-a]', v_owner_b, v_a, 'ios', 'admin', true, 1),
    ('ExponentPushToken[gnw-buyer-a]', v_buyer, v_a, 'android', 'storefront', true, 1),
    ('ExponentPushToken[gnw-buyer-b]', v_buyer, v_b, 'android', 'storefront', true, 1);
  INSERT INTO gnw_fixture VALUES (
    v_a, v_b, v_owner_a, v_owner_b, v_buyer, v_order, v_shipment, v_epoch,
    v_event, v_customer
  );
  -- Two outbox rows for the same event: a merchant row and a customer row.
  INSERT INTO public.shipment_tracking_notification_outbox (
    shipment_id, tracking_epoch_id, order_id, merchant_id, tracking_event_id,
    audience, notification_kind
  ) VALUES
    (v_shipment, v_epoch, v_order, v_a, v_event, 'merchant', 'picked_up'),
    (v_shipment, v_epoch, v_order, v_a, v_event, 'customer', 'picked_up');
END;
$fixture$;
RESET ROLE;

-- Act as the worker from here on.
SET LOCAL ROLE gigl_tracking_worker;
SELECT set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);

CREATE TEMP TABLE gnw_claimed ON COMMIT DROP AS
SELECT id, audience, recipient_user_ids
FROM public.gigl_worker_claim_notifications(10, 'gnw-worker');
GRANT SELECT ON gnw_claimed TO PUBLIC;
-- The claim wrapper elevates the claim for its own transaction; PostgREST
-- starts every later call with a fresh worker claim, so model that here.
SELECT set_config('request.jwt.claim.role', 'gigl_tracking_worker', true);

SELECT is(
  (SELECT count(*)::int FROM gnw_claimed), 2,
  'the worker claims both outbox rows through the wrapper'
);
SELECT is(
  (SELECT count(*)::int FROM public.gigl_worker_notification_event(
     (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'gnw-worker')),
  1, 'the leased worker reads the tracking event description'
);
SELECT is(
  (SELECT count(*)::int FROM public.gigl_worker_notification_event(
     (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'someone-else')),
  0, 'a different worker id cannot read through another worker''s lease'
);
SELECT is(
  (SELECT customer_user_id FROM public.gigl_worker_notification_customer(
     (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'gnw-worker')),
  (SELECT buyer FROM gnw_fixture),
  'the customer recipient is derived from the leased order'
);

-- Tokens: merchant rows ignore a smuggled foreign recipient; customer rows
-- never leak another tenant's token.
SELECT is(
  (SELECT array_agg(token ORDER BY token) FROM public.gigl_worker_notification_push_tokens(
     (SELECT id FROM gnw_claimed WHERE audience = 'merchant'), 'gnw-worker',
     ARRAY[(SELECT owner_a FROM gnw_fixture), (SELECT owner_b FROM gnw_fixture),
           (SELECT buyer FROM gnw_fixture),
           '7b2d0000-0000-4000-8000-0000000000a4'::uuid], 1)),
  ARRAY['ExponentPushToken[gnw-owner-a]', 'ExponentPushToken[gnw-staff-a]'],
  'merchant tokens cover the owner and orders.fulfill staff but never foreign or customer users'
);
SELECT is(
  (SELECT array_agg(token) FROM public.gigl_worker_notification_push_tokens(
     (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'gnw-worker',
     ARRAY[(SELECT owner_b FROM gnw_fixture)], 1)),
  ARRAY['ExponentPushToken[gnw-buyer-a]'],
  'customer tokens come from the leased order and tenant only'
);
SELECT is(
  (SELECT count(*)::int FROM public.gigl_worker_notification_push_tokens(
     (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'gnw-worker', NULL, 2)),
  0, 'the shipment-update capability floor filters out older app builds'
);

-- Writes are tenant-pinned by the lease.
SELECT is(
  public.gigl_worker_deactivate_notification_push_tokens(
    (SELECT id FROM gnw_claimed WHERE audience = 'customer'), 'gnw-worker',
    'DeviceNotRegistered',
    ARRAY['ExponentPushToken[gnw-buyer-a]', 'ExponentPushToken[gnw-buyer-b]',
          'ExponentPushToken[gnw-owner-a]', 'ExponentPushToken[gnw-other-a]']),
  1, 'deactivation touches only the leased recipient''s tokens in the leased tenant'
);
SELECT is(
  public.gigl_worker_store_notification_push_tickets(
    (SELECT id FROM gnw_claimed WHERE audience = 'merchant'), 'gnw-worker',
    jsonb_build_array(
      jsonb_build_object('ticket_id', 't-own', 'push_token', 'ExponentPushToken[gnw-owner-a]',
        'channel', 'orders', 'notification_type', 'shipment_tracking'),
      jsonb_build_object('ticket_id', 't-foreign', 'push_token', 'ExponentPushToken[gnw-owner-b]',
        'channel', 'orders', 'notification_type', 'shipment_tracking'),
      jsonb_build_object('ticket_id', 't-other-user', 'push_token', 'ExponentPushToken[gnw-outsider-a]',
        'channel', 'orders', 'notification_type', 'shipment_tracking'))),
  1, 'tickets for another tenant''s or another recipient''s token are dropped'
);
SELECT is(
  public.gigl_worker_record_notification_push_attempt(
    'ffffffff-ffff-4fff-8fff-ffffffffffff', 'gnw-worker',
    '{"title":"t","body":"b","status":"sent"}'::jsonb),
  false, 'an unleased notification id cannot record a push attempt'
);

SELECT * FROM finish();
ROLLBACK;

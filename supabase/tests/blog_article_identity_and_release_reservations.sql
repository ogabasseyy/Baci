-- Comprehensive behavioral, privilege, tenant-isolation, and edge-case tests
-- for 20261114104500_blog_article_identity_and_release_reservations.sql.
-- Runs cleanly against both the standalone disposable fixture and full replay.

BEGIN;

CREATE FUNCTION pg_temp.assert_true(p_cond boolean, p_msg text)
RETURNS void
LANGUAGE plpgsql
AS $$
BEGIN
  IF p_cond IS NOT TRUE THEN
    RAISE EXCEPTION 'ASSERTION FAILED: %', p_msg;
  END IF;
END;
$$;

CREATE FUNCTION pg_temp.assert_error(
  p_sql text,
  p_expected_sqlstate text,
  p_expected_message_substr text,
  p_msg text
)
RETURNS void
LANGUAGE plpgsql
AS $$
DECLARE
  v_threw boolean := false;
  v_state text;
  v_errm text;
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION
    WHEN OTHERS THEN
      v_threw := true;
      GET STACKED DIAGNOSTICS
        v_state = RETURNED_SQLSTATE,
        v_errm = MESSAGE_TEXT;
      IF p_expected_sqlstate IS NOT NULL AND v_state IS DISTINCT FROM p_expected_sqlstate THEN
        RAISE EXCEPTION 'Unexpected SQLSTATE for [%]: got % (%), expected % (%)',
          p_msg, v_state, v_errm, p_expected_sqlstate, p_expected_message_substr;
      END IF;
      IF p_expected_message_substr IS NOT NULL AND position(p_expected_message_substr IN v_errm) = 0 THEN
        RAISE EXCEPTION 'Unexpected error message for [%]: got [%], expected substring [%]',
          p_msg, v_errm, p_expected_message_substr;
      END IF;
  END;

  IF NOT v_threw THEN
    RAISE EXCEPTION 'Expected error (%) did not fire: %', p_expected_message_substr, p_msg;
  END IF;
END;
$$;

-- Self-test: ensure assert_error fails when p_sql succeeds without raising P0001
DO $$
DECLARE
  v_self_test_failed boolean := false;
BEGIN
  BEGIN
    PERFORM pg_temp.assert_error(
      'SELECT 1',
      'P0001',
      'Expected error',
      'assert_error self-test must fail on SELECT 1'
    );
  EXCEPTION
    WHEN OTHERS THEN
      IF position('Expected error (Expected error) did not fire' IN SQLERRM) > 0 THEN
        v_self_test_failed := true;
      END IF;
  END;

  IF NOT v_self_test_failed THEN
    RAISE EXCEPTION 'assert_error helper swallowed a missing-error case';
  END IF;
END $$;

GRANT EXECUTE ON FUNCTION pg_temp.assert_true(boolean, text) TO PUBLIC;
GRANT EXECUTE ON FUNCTION pg_temp.assert_error(text, text, text, text) TO PUBLIC;

-- Seed synthetic test actors and merchants
INSERT INTO auth.users (id, email) VALUES
  ('d1000000-0000-4000-8000-000000000001', 'track1-owner-a@example.invalid'),
  ('d1000000-0000-4000-8000-000000000002', 'track1-editor-a@example.invalid'),
  ('d1000000-0000-4000-8000-000000000003', 'track1-viewer-a@example.invalid'),
  ('d1000000-0000-4000-8000-000000000004', 'track1-owner-b@example.invalid');

SELECT pg_catalog.set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT pg_catalog.set_config('request.jwt.claim.role', 'service_role', true);

INSERT INTO public.merchants (id, email, user_id, business_name, slug) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'track1-owner-a@example.invalid', 'd1000000-0000-4000-8000-000000000001', 'Track1 Merchant A', 'track1-merchant-a'),
  ('d2000000-0000-4000-8000-000000000002', 'track1-owner-b@example.invalid', 'd1000000-0000-4000-8000-000000000004', 'Track1 Merchant B', 'track1-merchant-b');

INSERT INTO public.staff_members (merchant_id, user_id, email, status, permissions) VALUES
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000002', 'track1-editor-a@example.invalid', 'active', '{"marketing":{"view":true,"edit":true}}'::jsonb),
  ('d2000000-0000-4000-8000-000000000001', 'd1000000-0000-4000-8000-000000000003', 'track1-viewer-a@example.invalid', 'active', '{"marketing":{"view":true,"edit":false}}'::jsonb);

-- 1. Privilege & exposure assertions
DO $$
DECLARE
  v_fn text;
  v_fns text[] := ARRAY[
    'public.adopt_merchant_blog_article_identity_v1(uuid,uuid,uuid)',
    'public.reserve_merchant_blog_release_v1(uuid,uuid,uuid,text,text,text,text,timestamptz,text,text,boolean,timestamptz,integer,integer,integer,integer,integer,integer)',
    'public.cancel_merchant_blog_release_v1(uuid,uuid,text,uuid)',
    'public.reschedule_merchant_blog_release_v1(uuid,uuid,timestamptz,text,integer,integer,integer,integer,integer,integer)',
    'public.recover_abandoned_blog_release_reservations_v1(uuid)'
  ];
BEGIN
  FOREACH v_fn IN ARRAY v_fns LOOP
    PERFORM pg_temp.assert_true(
      NOT has_function_privilege('anon', v_fn, 'EXECUTE'),
      'anon must not execute ' || v_fn
    );
    PERFORM pg_temp.assert_true(
      NOT has_function_privilege('public', v_fn, 'EXECUTE'),
      'PUBLIC must not execute ' || v_fn
    );
    PERFORM pg_temp.assert_true(
      has_function_privilege('authenticated', v_fn, 'EXECUTE'),
      'authenticated must execute ' || v_fn
    );
    PERFORM pg_temp.assert_true(
      has_function_privilege('service_role', v_fn, 'EXECUTE'),
      'service_role must execute ' || v_fn
    );
  END LOOP;

  PERFORM pg_temp.assert_true(
    NOT has_table_privilege('anon', 'private.blog_release_reservations', 'SELECT'),
    'anon must not select private.blog_release_reservations'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege('authenticated', 'private.blog_release_reservations', 'SELECT'),
    'authenticated must not select private.blog_release_reservations'
  );
  PERFORM pg_temp.assert_true(
    NOT has_table_privilege('service_role', 'private.blog_release_reservations', 'SELECT'),
    'service_role must not select private.blog_release_reservations directly'
  );
  PERFORM pg_temp.assert_true(
    NOT has_function_privilege(
      'authenticated',
      'private.assert_blog_release_actor_v1(uuid)',
      'EXECUTE'
    ),
    'authenticated must not execute private helper'
  );
END $$;

-- Seed posts across merchants + non-pilot + platform post
INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status, published_at, metadata_status, is_platform_post
) VALUES
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Legacy Published Post', 'legacy-published-post', 'Original content', 'Editor', 'published', '2026-10-01T10:00:00Z', 'verified', false),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 2', 'draft-post-2', 'Draft content 2', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 3', 'draft-post-3', 'Draft content 3', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 4', 'draft-post-4', 'Draft content 4', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 5', 'draft-post-5', 'Draft content 5', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 6', 'draft-post-6', 'Draft content 6', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 7', 'draft-post-7', 'Draft content 7', 'Editor', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000001', 'Archived Post', 'archived-post', 'Archived content', 'Editor', 'archived', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000001', 'Non-Pilot Scheduled', 'non-pilot-scheduled', 'Non-pilot scheduled content', 'Editor', 'scheduled', transaction_timestamp() - interval '5 minutes', 'unverified', false),
  ('d3000000-0000-4000-8000-000000000099', 'd2000000-0000-4000-8000-000000000002', 'Merchant B Draft', 'merchant-b-draft', 'Merchant B content', 'Editor B', 'draft', NULL, 'unverified', false),
  ('d3000000-0000-4000-8000-000000000098', NULL, 'Platform Scheduled', 'platform-scheduled', 'Platform content', 'Platform', 'scheduled', transaction_timestamp() - interval '5 minutes', 'unverified', true);

-- 2. Tenant isolation & staff permission checks as authenticated viewer / cross-tenant owner
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000003', true);

SELECT pg_temp.assert_error(
  $$SELECT public.adopt_merchant_blog_article_identity_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001'
  )$$,
  '42501',
  'blog_release_access_denied',
  'viewer without marketing.edit cannot adopt identity'
);

SELECT pg_temp.assert_error(
  $$SELECT public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-denied',
    repeat('a', 64),
    'v1',
    'standard',
    '2026-12-01T12:00:00Z'
  )$$,
  '42501',
  'blog_release_access_denied',
  'viewer without marketing.edit cannot reserve release'
);

-- Merchant B owner cannot act on Merchant A
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000004', true);
SELECT pg_temp.assert_error(
  $$SELECT public.recover_abandoned_blog_release_reservations_v1('d2000000-0000-4000-8000-000000000001')$$,
  '42501',
  'blog_release_access_denied',
  'Merchant B owner cannot recover Merchant A reservations'
);

-- 3. Staff editor with marketing.edit can adopt legacy published identity & mutate published post in-place
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000002', true);

DO $$
DECLARE
  v_res jsonb;
  v_orig_rev uuid;
  v_new_rev uuid;
  v_mut record;
BEGIN
  v_res := public.adopt_merchant_blog_article_identity_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001'
  );
  PERFORM pg_temp.assert_true((v_res ->> 'adopted')::boolean, 'legacy published post should be adopted');
  PERFORM pg_temp.assert_true(NOT (v_res ->> 'already_adopted')::boolean, 'first adoption is not already_adopted');

  -- Idempotent replay on adopt
  v_res := public.adopt_merchant_blog_article_identity_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001'
  );
  PERFORM pg_temp.assert_true((v_res ->> 'already_adopted')::boolean, 'repeat adoption returns already_adopted');

  -- Conflict with different UUID
  PERFORM pg_temp.assert_error(
    $sql$SELECT public.adopt_merchant_blog_article_identity_v1(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000009999'
    )$sql$,
    '40001',
    'article_identity_conflict',
    'cannot reassign adopted article_identity'
  );

  -- Cannot assign same identity to another post on the same merchant
  PERFORM pg_temp.assert_error(
    $sql$SELECT public.adopt_merchant_blog_article_identity_v1(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001'
    )$sql$,
    '23505',
    'article_identity_already_assigned',
    'cannot reuse article_identity across distinct posts of same merchant'
  );

  SELECT classification_revision INTO v_orig_rev
  FROM public.blog_posts
  WHERE id = 'd3000000-0000-4000-8000-000000000001';

  -- mutate_merchant_blog_post_with_product_links in-place edit preserves original published_at
  SELECT * INTO v_mut
  FROM public.mutate_merchant_blog_post_with_product_links(
    'd3000000-0000-4000-8000-000000000001',
    'd2000000-0000-4000-8000-000000000001',
    jsonb_build_object(
      'title', 'Legacy Published Post Edited',
      'status', 'published',
      'published_at', '2026-11-14T00:00:00Z'
    )
  );
  PERFORM pg_temp.assert_true(
    v_mut.published_at = '2026-10-01T10:00:00Z'::timestamptz,
    'mutate_merchant_blog_post_with_product_links must preserve published_at on published in-place edit'
  );

  SELECT classification_revision INTO v_new_rev
  FROM public.blog_posts
  WHERE id = 'd3000000-0000-4000-8000-000000000001';
  PERFORM pg_temp.assert_true(
    v_new_rev IS DISTINCT FROM v_orig_rev,
    'classification_revision trigger must still rotate on title change'
  );
  PERFORM pg_temp.assert_true(
    (SELECT metadata_status FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000001') = 'stale',
    'blog_posts_stale_on_content_change trigger must mark verified post stale on title change'
  );
END $$;

-- Switch back to postgres + service_role claim for direct table assertions and service_role RPC tests
RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

-- Direct UPDATE immutability & published preservation checks
SELECT pg_temp.assert_error(
  $$UPDATE public.blog_posts
    SET article_identity = 'e1000000-0000-4000-8000-000000009999'
    WHERE id = 'd3000000-0000-4000-8000-000000000001'$$,
  '42501',
  'blog_post_article_identity_immutable',
  'direct UPDATE cannot mutate article_identity once set'
);

UPDATE public.blog_posts
SET published_at = '2026-11-14T11:11:11Z', requested_publish_at = '2026-11-14T11:11:11Z'
WHERE id = 'd3000000-0000-4000-8000-000000000001';

SELECT pg_temp.assert_true(
  (SELECT published_at = '2026-10-01T10:00:00Z'::timestamptz AND requested_publish_at IS NULL
   FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000001'),
  'guard trigger preserves published_at and requested_publish_at on published-to-published edit'
);

-- Same article_identity UUID is permitted on Merchant B
DO $$
DECLARE
  v_b jsonb;
BEGIN
  v_b := public.adopt_merchant_blog_article_identity_v1(
    'd2000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000099',
    'e1000000-0000-4000-8000-000000000001'
  );
  PERFORM pg_temp.assert_true((v_b ->> 'adopted')::boolean, 'same UUID allowed on Merchant B');
END $$;

-- 4. Reserve: idempotency, digest mismatch, caps, evergreen reserve, fast-track news rules, game-software cap, global spacing
DO $$
DECLARE
  v_future_date date := (transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 10;
  v_slot_1 timestamptz := (v_future_date::timestamp + time '09:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_2 timestamptz := (v_future_date::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_3 timestamptz := (v_future_date::timestamp + time '11:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_close timestamptz := (v_future_date::timestamp + time '09:20:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_edge_start timestamptz := (v_future_date::timestamp + time '08:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_edge_end timestamptz := (v_future_date::timestamp + time '20:00:00') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_early timestamptz := (v_future_date::timestamp + time '07:59:59') AT TIME ZONE 'Africa/Lagos';
  v_slot_too_late timestamptz := (v_future_date::timestamp + time '20:00:01') AT TIME ZONE 'Africa/Lagos';
  v_r1 jsonb;
  v_r1_replay jsonb;
  v_r2 jsonb;
  v_r3 jsonb;
BEGIN
  -- 4a. Reserve Draft Post 2 as standard (first slot)
  v_r1 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-post-2-v1',
    repeat('b', 64),
    'policy-2026-11',
    'standard',
    v_slot_1,
    'standard_editorial',
    'Smartphones',
    true, -- low-demand game software #1
    NULL,
    3,
    2,
    1,
    30,
    8,
    20
  );
  PERFORM pg_temp.assert_true(v_r1 ->> 'state' = 'reserved', 'post 2 should be reserved');
  PERFORM pg_temp.assert_true(v_r1 ->> 'post_status' = 'scheduled', 'post 2 should become scheduled');
  PERFORM pg_temp.assert_true(NOT (v_r1 ->> 'idempotent_replay')::boolean, 'initial call is not replay');
  PERFORM pg_temp.assert_true(
    (SELECT status = 'scheduled' AND published_at = v_slot_1 AND requested_publish_at = v_slot_1
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000002'),
    'blog_posts row updated atomically on reserve'
  );

  -- 4b. Idempotent replay with identical request_id + digest
  v_r1_replay := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    'e1000000-0000-4000-8000-000000000002',
    'req-post-2-v1',
    repeat('b', 64),
    'policy-2026-11',
    'standard',
    v_slot_1,
    'standard_editorial',
    'Smartphones',
    true,
    NULL,
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true((v_r1_replay ->> 'idempotent_replay')::boolean, 'identical request_id + digest replays idempotently');
  PERFORM pg_temp.assert_true(v_r1_replay ->> 'reservation_id' = v_r1 ->> 'reservation_id', 'replay returns same reservation_id');

  -- 4c. Same request_id with mismatched digest -> 40001
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000002',
        'req-post-2-v1',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('c', 64),
      v_slot_1::text
    ),
    '40001',
    'reservation_request_payload_mismatch',
    'same request_id with different payload_digest must raise mismatch'
  );

  -- 4d. Different request_id on already-reserved post -> active_reservation_already_exists
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000002',
        'e1000000-0000-4000-8000-000000000002',
        'req-post-2-v2',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('c', 64),
      v_slot_2::text
    ),
    '40001',
    'active_reservation_already_exists',
    'cannot create second active reservation for same post'
  );

  -- 4e. Global min spacing conflict (20m apart < 30m)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-spacing',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_close::text
    ),
    'P0001',
    'min_spacing_conflict',
    'slot within 30m of post 2 must fail spacing check'
  );

  -- 4f. Standalone low-demand game software cap (<= 1/day)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-game-cap',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz,
        NULL,
        'Gaming',
        true
      )$sql$,
      repeat('d', 64),
      v_slot_2::text
    ),
    'P0001',
    'low_demand_game_software_cap_exceeded',
    'second low-demand game software item on same Lagos day must fail'
  );

  -- 4g. Fast-track validation rules (future event, >12h old, outside 08:00-20:00 Lagos, fast_track_cap > 2)
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-cap3',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz,
        3,
        3,
        1
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'invalid_fast_track_cap',
    'fast_track_cap > 2 must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-future',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() + interval '5 minutes')::text
    ),
    '22023',
    'fast_track_event_in_future',
    'future event_published_at must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-stale',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_2::text,
      (transaction_timestamp() - interval '12 hours 1 minute')::text
    ),
    '22023',
    'fast_track_news_expired',
    'event older than 12 hours must be rejected'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-early',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_early::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'fast_track_outside_lagos_window',
    '07:59:59 Lagos must be rejected for fast_track_news'
  );

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003',
        'req-post-3-ft-late',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz
      )$sql$,
      repeat('d', 64),
      v_slot_too_late::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    '22023',
    'fast_track_outside_lagos_window',
    '20:00:01 Lagos must be rejected for fast_track_news'
  );

  -- 4h. Boundary 08:00:00 Lagos succeeds for fast_track_news (slot 2 of 3)
  v_r2 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000003',
    'e1000000-0000-4000-8000-000000000003',
    'req-post-3-ft-ok',
    repeat('d', 64),
    'policy-2026-11',
    'fast_track_news',
    v_slot_edge_start,
    'breaking_news',
    'Tech',
    false,
    transaction_timestamp() - interval '2 hours',
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r2 ->> 'state' = 'reserved', '08:00 Lagos fast_track_news succeeds');

  -- 4i. Slot 3 of 3 with daily_cap=3, evergreen_min_reserve=1 blocks standard/fast_track_news
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000004',
        'e1000000-0000-4000-8000-000000000004',
        'req-post-4-reserve-block',
        %L,
        'policy-2026-11',
        'fast_track_news',
        %L::timestamptz,
        'breaking_news',
        'Tech',
        false,
        %L::timestamptz,
        3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('e', 64),
      v_slot_edge_end::text,
      (transaction_timestamp() - interval '1 hour')::text
    ),
    'P0001',
    'evergreen_reserve_required',
    'last slot must be preserved for evergreen when evergreen_used=0 and evergreen_min_reserve=1'
  );

  -- 4j. Evergreen post CAN take slot 3 of 3
  v_r3 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    'e1000000-0000-4000-8000-000000000004',
    'req-post-4-evergreen',
    repeat('e', 64),
    'policy-2026-11',
    'evergreen',
    v_slot_3,
    'evergreen_guide',
    'Guides',
    false,
    NULL,
    3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r3 ->> 'state' = 'reserved', 'evergreen claims the reserved 3rd slot');

  -- 4k. Slot 4 blocked by daily_cap_exceeded
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000005',
        'e1000000-0000-4000-8000-000000000005',
        'req-post-5-cap',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('f', 64),
      v_slot_2::text
    ),
    'P0001',
    'daily_cap_exceeded',
    '4th post exceeds daily_cap=3'
  );

  -- 4l. Reschedule post 4 in-place on the same full day does NOT double count itself
  v_r3 := public.reschedule_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    v_slot_2,
    'req-post-4-reschedule'
  );
  PERFORM pg_temp.assert_true((v_r3 ->> 'rescheduled')::boolean, 'reschedule updates slot without double counting target post');
  PERFORM pg_temp.assert_true(
    (SELECT published_at = v_slot_2 AND requested_publish_at = v_slot_2
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000004'),
    'blog_posts timestamps updated on reschedule'
  );

  -- Idempotent reschedule replay on unchanged slot
  v_r3 := public.reschedule_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    v_slot_2,
    'req-post-4-reschedule'
  );
  PERFORM pg_temp.assert_true((v_r3 ->> 'idempotent_replay')::boolean, 'unchanged reschedule returns idempotent_replay');

  -- 4m. Cancel frees the slot and reverts post to draft; repeat cancel is idempotent
  v_r1 := public.cancel_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004',
    'operator_cancelled'
  );
  PERFORM pg_temp.assert_true(v_r1 ->> 'state' = 'cancelled' AND v_r1 ->> 'post_status' = 'draft', 'cancel reverts post to draft');
  PERFORM pg_temp.assert_true(
    (SELECT article_identity = 'e1000000-0000-4000-8000-000000000004'::uuid AND published_at IS NULL AND requested_publish_at IS NULL
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000004'),
    'cancel preserves article_identity and clears publish timestamps'
  );
  v_r1_replay := public.cancel_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000004'
  );
  PERFORM pg_temp.assert_true((v_r1_replay ->> 'already_cancelled')::boolean, 'repeat cancel returns already_cancelled');

  -- 4n. Now post 5 can claim the freed slot
  v_r3 := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000005',
    'e1000000-0000-4000-8000-000000000005',
    'req-post-5-after-cancel',
    repeat('f', 64),
    'policy-2026-11',
    'evergreen',
    v_slot_3,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r3 ->> 'state' = 'reserved', 'freed slot after cancel can be reserved');

  -- 4o. Archived post rejection & published post rejection
  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000008',
        'e1000000-0000-4000-8000-000000000008',
        'req-archived',
        %L,
        'policy-2026-11',
        'standard',
        %L::timestamptz
      )$sql$,
      repeat('1', 64),
      (((v_future_date + 1)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos')::text
    ),
    '22023',
    'blog_post_archived',
    'cannot reserve archived post'
  );

  PERFORM pg_temp.assert_error(
    $sql$SELECT public.cancel_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000001',
      'd3000000-0000-4000-8000-000000000001'
    )$sql$,
    '40001',
    'cannot_cancel_published_blog_post',
    'cannot cancel already published post'
  );
END $$;

-- 5. Cross-UTC-midnight spacing check (23:50Z and 00:10Z next UTC day = 20m apart -> blocked; 00:20Z -> allowed)
DO $$
DECLARE
  v_utc_base timestamptz := (date_trunc('day', transaction_timestamp() AT TIME ZONE 'UTC') + interval '20 days 23 hours 50 minutes') AT TIME ZONE 'UTC';
  v_too_close timestamptz := v_utc_base + interval '20 minutes';
  v_ok_next timestamptz := v_utc_base + interval '30 minutes';
  v_r jsonb;
BEGIN
  v_r := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000006',
    'e1000000-0000-4000-8000-000000000006',
    'req-utc-midnight-1',
    repeat('2', 64),
    'policy-2026-11',
    'evergreen',
    v_utc_base,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r ->> 'state' = 'reserved', '23:50Z slot reserved');

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000001',
        'd3000000-0000-4000-8000-000000000007',
        'e1000000-0000-4000-8000-000000000007',
        'req-utc-midnight-2-close',
        %L,
        'policy-2026-11',
        'evergreen',
        %L::timestamptz,
        NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
      )$sql$,
      repeat('3', 64),
      v_too_close::text
    ),
    'P0001',
    'min_spacing_conflict',
    'cross-UTC-midnight slot 20m later must fail global spacing check'
  );

  v_r := public.reserve_merchant_blog_release_v1(
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000007',
    'e1000000-0000-4000-8000-000000000007',
    'req-utc-midnight-2-ok',
    repeat('3', 64),
    'policy-2026-11',
    'evergreen',
    v_ok_next,
    NULL, NULL, false, NULL, 3, 2, 1, 30, 8, 20
  );
  PERFORM pg_temp.assert_true(v_r ->> 'state' = 'reserved', '30m after 23:50Z succeeds');
END $$;

-- 6. Abandoned reservation recovery: draft cancelled, published reconciled, scheduled preserved
DO $$
DECLARE
  v_rec jsonb;
BEGIN
  -- Simulate post 6 abandoned directly back to draft while reservation still active
  UPDATE public.blog_posts
  SET status = 'draft', published_at = NULL
  WHERE id = 'd3000000-0000-4000-8000-000000000006';

  -- Simulate an out-of-band reservation stuck in 'reserved' for an already-published post (post 1)
  -- and post 7 being published through the trigger
  UPDATE public.blog_posts
  SET status = 'published', published_at = '2026-11-01T10:00:00Z'
  WHERE id = 'd3000000-0000-4000-8000-000000000007';

  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000001',
    'e1000000-0000-4000-8000-000000000001',
    'req-orphan-published-post1',
    repeat('9', 64),
    'policy-2026-11',
    'evergreen',
    '2026-10-01T10:00:00Z',
    '2026-10-01'::date,
    3, 2, 1, 30, 'reserved'
  );

  v_rec := public.recover_abandoned_blog_release_reservations_v1(
    'd2000000-0000-4000-8000-000000000001'
  );
  PERFORM pg_temp.assert_true((v_rec ->> 'cancelled_abandoned_count')::integer = 1, 'recover cancels abandoned draft reservation');
  PERFORM pg_temp.assert_true((v_rec ->> 'reconciled_published_count')::integer = 1, 'recover reconciles published reservation');
  PERFORM pg_temp.assert_true((v_rec ->> 'preserved_scheduled_count')::integer = 3, 'recover preserves still-scheduled reservations');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'cancelled' FROM private.blog_release_reservations WHERE post_id = 'd3000000-0000-4000-8000-000000000006' ORDER BY created_at DESC LIMIT 1),
    'abandoned reservation moved to cancelled'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND actual_published_at IS NOT NULL FROM private.blog_release_reservations WHERE request_id = 'req-orphan-published-post1'),
    'orphan published reservation reconciled to published'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND actual_published_at IS NOT NULL FROM private.blog_release_reservations WHERE post_id = 'd3000000-0000-4000-8000-000000000007' ORDER BY created_at DESC LIMIT 1),
    'trigger-finalized reservation marked published'
  );
END $$;

-- 7. Finalization trigger: non-pilot fallback + expired fast-track news + spacing deferral (including 2-row batch) + midnight rollover
DO $$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_today_lagos date := (v_now AT TIME ZONE 'Africa/Lagos')::date;
  v_yesterday_lagos date := v_today_lagos - 1;
  v_non_pilot_row public.blog_posts%ROWTYPE;
  v_platform_row public.blog_posts%ROWTYPE;
  v_expired_row public.blog_posts%ROWTYPE;
  v_batch_row_1 public.blog_posts%ROWTYPE;
  v_batch_row_2 public.blog_posts%ROWTYPE;
  v_rollover_ok public.blog_posts%ROWTYPE;
  v_rollover_full public.blog_posts%ROWTYPE;
BEGIN
  -- 7a. Non-pilot scheduled post & platform post without reservation publish normally
  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000009'
  RETURNING * INTO v_non_pilot_row;

  PERFORM pg_temp.assert_true(v_non_pilot_row.status = 'published', 'non-pilot post publishes without reservation');
  PERFORM pg_temp.assert_true(v_non_pilot_row.published_at = v_now, 'non-pilot published_at becomes transaction_timestamp()');
  PERFORM pg_temp.assert_true(v_non_pilot_row.requested_publish_at = v_now - interval '5 minutes', 'non-pilot preserves original requested_publish_at');

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000098'
  RETURNING * INTO v_platform_row;
  PERFORM pg_temp.assert_true(v_platform_row.status = 'published', 'platform post publishes without reservation');

  -- 7b. Expired fast-track news (>12h at cron time) -> held as draft + held_expired_news
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000010',
    'd2000000-0000-4000-8000-000000000002',
    'Expired News Post', 'expired-news-post', 'News content', 'Editor B', 'scheduled',
    v_now - interval '1 minute',
    v_now - interval '1 minute',
    'e1000000-0000-4000-8000-000000000010'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date, event_published_at,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000002',
    'd3000000-0000-4000-8000-000000000010',
    'e1000000-0000-4000-8000-000000000010',
    'req-expired-news',
    repeat('4', 64),
    'policy-2026-11',
    'fast_track_news',
    v_now - interval '1 minute',
    v_today_lagos,
    v_now - interval '12 hours 5 minutes',
    3, 2, 1, 30, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000010'
  RETURNING * INTO v_expired_row;

  PERFORM pg_temp.assert_true(v_expired_row.status = 'draft', 'expired fast-track news held as draft');
  PERFORM pg_temp.assert_true(v_expired_row.published_at IS NULL, 'expired fast-track news clears published_at');
  PERFORM pg_temp.assert_true(v_expired_row.requested_publish_at = v_now - interval '1 minute', 'expired fast-track news preserves requested_publish_at');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'held_expired_news' FROM private.blog_release_reservations WHERE request_id = 'req-expired-news'),
    'reservation marks state=held_expired_news'
  );

  -- 7c. Batch update of two due scheduled reserved posts on Merchant B:
  --     First publishes at v_now; second sees first within 30m and defers cleanly to v_now + 30m.
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES
    ('d3000000-0000-4000-8000-000000000011', 'd2000000-0000-4000-8000-000000000002', 'Batch 1', 'batch-1', 'Batch content 1', 'Editor B', 'scheduled', v_now - interval '2 minutes', v_now - interval '2 minutes', 'e1000000-0000-4000-8000-000000000011'),
    ('d3000000-0000-4000-8000-000000000012', 'd2000000-0000-4000-8000-000000000002', 'Batch 2', 'batch-2', 'Batch content 2', 'Editor B', 'scheduled', v_now - interval '1 minute', v_now - interval '1 minute', 'e1000000-0000-4000-8000-000000000012');

  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES
    ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000011', 'e1000000-0000-4000-8000-000000000011', 'req-batch-1', repeat('5', 64), 'policy-2026-11', 'standard', v_now - interval '2 minutes', v_today_lagos, 3, 2, 1, 30, 'reserved'),
    ('d2000000-0000-4000-8000-000000000002', 'd3000000-0000-4000-8000-000000000012', 'e1000000-0000-4000-8000-000000000012', 'req-batch-2', repeat('6', 64), 'policy-2026-11', 'evergreen', v_now - interval '1 minute', v_today_lagos, 3, 2, 1, 30, 'reserved');

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id IN ('d3000000-0000-4000-8000-000000000011', 'd3000000-0000-4000-8000-000000000012');

  SELECT * INTO v_batch_row_1 FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000011';
  SELECT * INTO v_batch_row_2 FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000012';

  PERFORM pg_temp.assert_true(
    (v_batch_row_1.status = 'published' AND v_batch_row_2.status = 'scheduled')
    OR (v_batch_row_2.status = 'published' AND v_batch_row_1.status = 'scheduled'),
    'exactly one batch row publishes and the second defers for 30m spacing'
  );
  IF v_batch_row_1.status = 'published' THEN
    PERFORM pg_temp.assert_true(v_batch_row_2.published_at = v_now + interval '30 minutes', 'deferred batch row next_evaluation_at is v_now + 30m');
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'min_spacing_active' FROM private.blog_release_reservations WHERE request_id = 'req-batch-2'),
      'deferred reservation records min_spacing_active'
    );
    -- Re-polling deferred row immediately stays bounded at v_now + 30m
    UPDATE public.blog_posts SET status = 'published' WHERE id = 'd3000000-0000-4000-8000-000000000012' RETURNING * INTO v_batch_row_2;
    PERFORM pg_temp.assert_true(v_batch_row_2.status = 'scheduled' AND v_batch_row_2.published_at = v_now + interval '30 minutes', 'repeated polling keeps bounded next_evaluation_at');
  ELSE
    PERFORM pg_temp.assert_true(v_batch_row_1.published_at = v_now + interval '30 minutes', 'deferred batch row next_evaluation_at is v_now + 30m');
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'min_spacing_active' FROM private.blog_release_reservations WHERE request_id = 'req-batch-1'),
      'deferred reservation records min_spacing_active'
    );
  END IF;

  -- Clear spacing conflict by shifting already-published batch row to 2 hours ago, then test midnight rollover capacity:
  -- Merchant B currently has 1 published today and 1 scheduled today (total_used on v_today_lagos = 2).
  -- Backdate the published row to earlier today UTC/Lagos (at least 40m ago; if near 00:00 Lagos, keep it on v_yesterday_lagos or adjust cap).
  -- To be 100% independent of wall-clock time-of-day, create Merchant C for clean midnight-rollover assertions!
  INSERT INTO public.merchants (id, email, user_id, business_name, slug)
  VALUES ('d2000000-0000-4000-8000-000000000003', 'track1-c@example.invalid', NULL, 'Merchant C', 'merchant-c');

  -- 7d. Midnight rollover with available capacity on v_today_lagos -> publishes & updates reserved_lagos_date
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000013',
    'd2000000-0000-4000-8000-000000000003',
    'Rollover OK', 'rollover-ok', 'Rollover ok content', 'Editor C', 'scheduled',
    v_now - interval '3 hours',
    v_now - interval '3 hours',
    'e1000000-0000-4000-8000-000000000013'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000003',
    'd3000000-0000-4000-8000-000000000013',
    'e1000000-0000-4000-8000-000000000013',
    'req-rollover-ok',
    repeat('7', 64),
    'policy-2026-11',
    'evergreen',
    v_now - interval '3 hours',
    v_yesterday_lagos,
    2, 2, 1, 30, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000013'
  RETURNING * INTO v_rollover_ok;

  PERFORM pg_temp.assert_true(v_rollover_ok.status = 'published', 'rollover with free capacity on today Lagos date publishes');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'published' AND reserved_lagos_date = v_today_lagos FROM private.blog_release_reservations WHERE request_id = 'req-rollover-ok'),
    'rollover updates reserved_lagos_date to today Lagos date'
  );

  -- 7e. Midnight rollover when destination Lagos day is already at cap (daily_cap=1, already 1 published today on Merchant C)
  -- Move v_rollover_ok's published_at outside the 30m spacing window ONLY if still on v_today_lagos, OR set min_spacing_minutes=0 on the next reservation so capacity check runs directly!
  INSERT INTO public.blog_posts (
    id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
  ) VALUES (
    'd3000000-0000-4000-8000-000000000014',
    'd2000000-0000-4000-8000-000000000003',
    'Rollover Over Cap', 'rollover-over-cap', 'Rollover cap content', 'Editor C', 'scheduled',
    v_now - interval '3 hours',
    v_now - interval '3 hours',
    'e1000000-0000-4000-8000-000000000014'
  );
  INSERT INTO private.blog_release_reservations (
    merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
    release_class, requested_publish_at, reserved_lagos_date,
    daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
  ) VALUES (
    'd2000000-0000-4000-8000-000000000003',
    'd3000000-0000-4000-8000-000000000014',
    'e1000000-0000-4000-8000-000000000014',
    'req-rollover-cap',
    repeat('8', 64),
    'policy-2026-11',
    'evergreen',
    v_now - interval '3 hours',
    v_yesterday_lagos,
    1, 2, 1, 0, 'reserved'
  );

  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000014'
  RETURNING * INTO v_rollover_full;

  PERFORM pg_temp.assert_true(v_rollover_full.status = 'scheduled', 'rollover over destination Lagos cap defers to scheduled');
  PERFORM pg_temp.assert_true(
    (SELECT state = 'deferred' AND defer_reason = 'daily_cap_exceeded' AND reserved_lagos_date = v_today_lagos + 1
     FROM private.blog_release_reservations WHERE request_id = 'req-rollover-cap'),
    'rollover over cap marks deferred with daily_cap_exceeded and tomorrow Lagos date'
  );

  -- 8. Regression checks for CodeRabbit findings (#14, #15, #17, #19, #20)
  -- 8a. Direct schedule edit on a reserved scheduled post is rejected; title edit without timestamp change succeeds
  PERFORM pg_temp.assert_error(
    format(
      $sql$UPDATE public.blog_posts SET published_at = %L::timestamptz WHERE id = 'd3000000-0000-4000-8000-000000000014'$sql$,
      (v_now + interval '4 hours')::text
    ),
    '42501',
    'scheduled_reservation_requires_reschedule_rpc',
    'direct schedule edit on reserved post must fail closed'
  );
  UPDATE public.blog_posts
  SET title = 'Rollover Over Cap Title Edit'
  WHERE id = 'd3000000-0000-4000-8000-000000000014';

  -- 8b. Reschedule with same timestamp but different p_min_spacing_minutes applies policy change (not idempotent replay)
  --     and preserving original reserve request_id blocks post-cancel replay of original request_id
  DECLARE
    v_res_orig jsonb;
    v_res_policy jsonb;
    v_res_replay jsonb;
    v_slot_8b timestamptz := ((v_today_lagos + 25)::timestamp + time '11:00:00') AT TIME ZONE 'Africa/Lagos';
    v_ft_row public.blog_posts%ROWTYPE;
    v_now_lagos_hr integer := EXTRACT(HOUR FROM (v_now AT TIME ZONE 'Africa/Lagos'))::integer;
    v_bad_win_start integer := CASE WHEN v_now_lagos_hr < 20 THEN 21 ELSE 8 END;
    v_bad_win_end integer := CASE WHEN v_now_lagos_hr < 20 THEN 22 ELSE 9 END;
  BEGIN
    INSERT INTO public.blog_posts (
      id, merchant_id, title, slug, content, author_name, status
    ) VALUES (
      'd3000000-0000-4000-8000-000000000015',
      'd2000000-0000-4000-8000-000000000003',
      'Policy Replay Test', 'policy-replay-test', 'Body', 'Editor C', 'draft'
    );

    v_res_orig := public.reserve_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'e1000000-0000-4000-8000-000000000015',
      'req-8b-orig',
      repeat('a', 64),
      'policy-2026-11',
      'evergreen',
      v_slot_8b,
      NULL, NULL, false, NULL,
      3, 2, 1, 30, 8, 20
    );
    v_res_policy := public.reschedule_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      v_slot_8b,
      'req-8b-resched',
      NULL, NULL, NULL, 45, NULL, NULL
    );
    PERFORM pg_temp.assert_true(
      NOT (v_res_policy ->> 'idempotent_replay')::boolean AND (v_res_policy ->> 'rescheduled')::boolean,
      'reschedule with changed min_spacing_minutes must update policy instead of replaying'
    );
    PERFORM pg_temp.assert_true(
      (SELECT min_spacing_minutes = 45 AND request_id = 'req-8b-orig'
       FROM private.blog_release_reservations WHERE id = (v_res_orig ->> 'reservation_id')::uuid),
      'reschedule must apply min_spacing_minutes=45 and preserve original request_id'
    );

    PERFORM public.cancel_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'cancel_after_resched'
    );
    v_res_replay := public.reserve_merchant_blog_release_v1(
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000015',
      'e1000000-0000-4000-8000-000000000015',
      'req-8b-orig',
      repeat('a', 64),
      'policy-2026-11',
      'evergreen',
      v_slot_8b
    );
    PERFORM pg_temp.assert_true(
      (v_res_replay ->> 'idempotent_replay')::boolean AND v_res_replay ->> 'state' = 'cancelled' AND v_res_replay ->> 'post_status' = 'draft',
      'retrying original reserve request after reschedule+cancel must replay cancelled reservation without re-scheduling'
    );

    -- 8c. Same-day fast_track_news outside active Lagos window defers even when reserved_lagos_date = v_today_lagos
    INSERT INTO public.blog_posts (
      id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
    ) VALUES (
      'd3000000-0000-4000-8000-000000000016',
      'd2000000-0000-4000-8000-000000000003',
      'Same Day Window Check', 'same-day-window-check', 'News', 'Editor C', 'scheduled',
      v_now - interval '1 minute',
      v_now - interval '1 minute',
      'e1000000-0000-4000-8000-000000000016'
    );
    INSERT INTO private.blog_release_reservations (
      merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
      release_class, requested_publish_at, reserved_lagos_date, event_published_at,
      daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes,
      window_start_hour, window_end_hour, state
    ) VALUES (
      'd2000000-0000-4000-8000-000000000003',
      'd3000000-0000-4000-8000-000000000016',
      'e1000000-0000-4000-8000-000000000016',
      'req-8c-same-day-window',
      repeat('9', 64),
      'policy-2026-11',
      'fast_track_news',
      v_now - interval '1 minute',
      v_today_lagos,
      v_now - interval '1 hour',
      5, 2, 0, 0,
      v_bad_win_start, v_bad_win_end, 'reserved'
    );
    UPDATE public.blog_posts
    SET status = 'published'
    WHERE id = 'd3000000-0000-4000-8000-000000000016'
    RETURNING * INTO v_ft_row;
    PERFORM pg_temp.assert_true(
      v_ft_row.status = 'scheduled',
      'same-day fast_track_news outside active window must defer'
    );
    PERFORM pg_temp.assert_true(
      (SELECT state = 'deferred' AND defer_reason = 'outside_fast_track_window'
       FROM private.blog_release_reservations WHERE request_id = 'req-8c-same-day-window'),
      'same-day fast_track_news deferral records outside_fast_track_window'
    );

    -- 8d. Reschedule retry across different session TimeZones does not raise payload mismatch,
    --     and multi-day rollover checks candidate destination dates before assigning reserved_lagos_date
    DECLARE
      v_tz_slot timestamptz := ((v_today_lagos + 26)::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
      v_tz_res1 jsonb;
      v_tz_res2 jsonb;
      v_multi_row public.blog_posts%ROWTYPE;
    BEGIN
      INSERT INTO public.blog_posts (
        id, merchant_id, title, slug, content, author_name, status
      ) VALUES (
        'd3000000-0000-4000-8000-000000000017',
        'd2000000-0000-4000-8000-000000000003',
        'TZ Reschedule Post', 'tz-reschedule-post', 'TZ content', 'Editor C', 'draft'
      );
      PERFORM public.reserve_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        'e1000000-0000-4000-8000-000000000017',
        'req-8d-reserve',
        repeat('b', 64),
        'policy-2026-11',
        'evergreen',
        v_tz_slot
      );
      PERFORM set_config('TimeZone', 'UTC', true);
      v_tz_res1 := public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        v_tz_slot + interval '2 hours',
        'req-8d-resched'
      );
      PERFORM set_config('TimeZone', 'America/New_York', true);
      v_tz_res2 := public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000017',
        v_tz_slot + interval '2 hours',
        'req-8d-resched'
      );
      PERFORM set_config('TimeZone', 'UTC', true);
      PERFORM pg_temp.assert_true(
        (v_tz_res2 ->> 'idempotent_replay')::boolean
        AND (v_tz_res2 ->> 'reservation_id') = (v_tz_res1 ->> 'reservation_id'),
        'reschedule retry across different session TimeZones must succeed idempotently'
      );

      -- Fill v_today_lagos + 1 as well (v_today_lagos + 1 has 1 scheduled post from Merchant C's tomorrow? No: seed 1 on v_today_lagos + 1 and 1 on v_today_lagos + 2, leave +3 free)
      INSERT INTO public.blog_posts (
        id, merchant_id, title, slug, content, author_name, status, published_at, requested_publish_at, article_identity
      ) VALUES
        (
          'd3000000-0000-4000-8000-000000000018',
          'd2000000-0000-4000-8000-000000000003',
          'Full Tomorrow Blocker', 'full-tomorrow-blocker', 'Blocker 1', 'Editor C', 'scheduled',
          ((v_today_lagos + 1)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          ((v_today_lagos + 1)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          'e1000000-0000-4000-8000-000000000018'
        ),
        (
          'd3000000-0000-4000-8000-000000000019',
          'd2000000-0000-4000-8000-000000000003',
          'Full DayAfter Blocker', 'full-dayafter-blocker', 'Blocker 2', 'Editor C', 'scheduled',
          ((v_today_lagos + 2)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          ((v_today_lagos + 2)::timestamp + time '12:00:00') AT TIME ZONE 'Africa/Lagos',
          'e1000000-0000-4000-8000-000000000019'
        ),
        (
          'd3000000-0000-4000-8000-000000000020',
          'd2000000-0000-4000-8000-000000000003',
          'Multi Day Rollover', 'multi-day-rollover', 'Rollover', 'Editor C', 'scheduled',
          v_now - interval '4 hours',
          v_now - interval '4 hours',
          'e1000000-0000-4000-8000-000000000020'
        );
      INSERT INTO private.blog_release_reservations (
        merchant_id, post_id, article_identity, request_id, payload_digest, policy_version,
        release_class, requested_publish_at, reserved_lagos_date,
        daily_cap, fast_track_cap, evergreen_min_reserve, min_spacing_minutes, state
      ) VALUES (
        'd2000000-0000-4000-8000-000000000003',
        'd3000000-0000-4000-8000-000000000020',
        'e1000000-0000-4000-8000-000000000020',
        'req-8d-multiday',
        repeat('c', 64),
        'policy-2026-11',
        'evergreen',
        v_now - interval '4 hours',
        v_yesterday_lagos,
        1, 2, 1, 0, 'reserved'
      );
      UPDATE public.blog_posts
      SET status = 'published'
      WHERE id = 'd3000000-0000-4000-8000-000000000020'
      RETURNING * INTO v_multi_row;
      PERFORM pg_temp.assert_true(
        v_multi_row.status = 'scheduled',
        'multi-day full rollover remains scheduled'
      );
      PERFORM pg_temp.assert_true(
        (SELECT state = 'deferred' AND reserved_lagos_date = v_today_lagos + 3
         FROM private.blog_release_reservations WHERE request_id = 'req-8d-multiday'),
        'multi-day rollover skips full +1 and +2 days and reserves first available date (+3)'
      );
    END;
  END;
END $$;

-- 8e. Same-day reserved post respects daily_cap when another draft is manually published earlier the same day
INSERT INTO public.merchants (id, email, user_id, business_name, slug)
VALUES ('d2000000-0000-4000-8000-000000000005', 'track1-e@example.invalid', 'd1000000-0000-4000-8000-000000000001', 'Merchant E', 'merchant-e');

INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status
) VALUES
  ('d3000000-0000-4000-8000-000000000021', 'd2000000-0000-4000-8000-000000000005', 'Manual Draft E', 'manual-draft-e', 'Draft E', 'Editor E', 'draft'),
  ('d3000000-0000-4000-8000-000000000022', 'd2000000-0000-4000-8000-000000000005', 'Reserved Today E', 'reserved-today-e', 'Reserved E', 'Editor E', 'draft');

SELECT public.reserve_merchant_blog_release_v1(
  'd2000000-0000-4000-8000-000000000005',
  'd3000000-0000-4000-8000-000000000022',
  'e1000000-0000-4000-8000-000000000022',
  'req-8e-reserve',
  repeat('d', 64),
  'policy-2026-11',
  'evergreen',
  transaction_timestamp() - interval '5 minutes',
  NULL, NULL, false, NULL,
  1, 2, 1, 0, 8, 20
) IS NOT NULL AS reserved_8e;

SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claims', '', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT set_config('request.jwt.claim.sub', 'd1000000-0000-4000-8000-000000000001', true);

SELECT id, status, published_at
FROM public.mutate_merchant_blog_post_with_product_links(
  'd3000000-0000-4000-8000-000000000021',
  'd2000000-0000-4000-8000-000000000005',
  jsonb_build_object('status', 'published', 'published_at', transaction_timestamp())
);

RESET ROLE;
SELECT set_config('request.jwt.claims', '{"role":"service_role"}', true);
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT set_config('request.jwt.claim.sub', '', true);

DO $$
DECLARE
  v_now timestamptz := transaction_timestamp();
  v_today_lagos date := (v_now AT TIME ZONE 'Africa/Lagos')::date;
  v_reserved_today_row public.blog_posts%ROWTYPE;
BEGIN
  UPDATE public.blog_posts
  SET status = 'published'
  WHERE id = 'd3000000-0000-4000-8000-000000000022'
  RETURNING * INTO v_reserved_today_row;

  PERFORM pg_temp.assert_true(
    v_reserved_today_row.status = 'scheduled',
    'same-day reserved post must defer when a manual publish already consumed daily_cap'
  );
  PERFORM pg_temp.assert_true(
    (SELECT state = 'deferred' AND defer_reason = 'daily_cap_exceeded' AND reserved_lagos_date = v_today_lagos + 1
     FROM private.blog_release_reservations WHERE request_id = 'req-8e-reserve'),
    'same-day manual publish collision records daily_cap_exceeded and defers to tomorrow'
  );

  -- 8f. Archiving a reserved post blocks rescheduling
  UPDATE public.blog_posts
  SET status = 'archived'
  WHERE id = 'd3000000-0000-4000-8000-000000000022';

  PERFORM pg_temp.assert_error(
    format(
      $sql$SELECT public.reschedule_merchant_blog_release_v1(
        'd2000000-0000-4000-8000-000000000005',
        'd3000000-0000-4000-8000-000000000022',
        %L::timestamptz,
        'req-8f-archived-resched'
      )$sql$,
      (v_now + interval '2 days')::text
    ),
    '22023',
    'blog_post_archived',
    'archived reserved post cannot be rescheduled'
  );
END $$;

ROLLBACK;

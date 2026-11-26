BEGIN;
\ir blog_release_reservations_setup.inc.sql

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
    transaction_timestamp() + interval '40 days'
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

-- Scheduled insert without requested_publish_at backfills requested_publish_at from published_at
DO $$
DECLARE
  v_day_orig date := (transaction_timestamp() AT TIME ZONE 'Africa/Lagos')::date + 40;
  v_day_next date := v_day_orig + 1;
  v_ts_orig timestamptz := (v_day_orig::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
  v_ts_next timestamptz := (v_day_next::timestamp + time '10:00:00') AT TIME ZONE 'Africa/Lagos';
BEGIN
  INSERT INTO public.blog_posts (id, merchant_id, title, slug, content, author_name, status, published_at)
  VALUES (
    'd3000000-0000-4000-8000-000000000097',
    'd2000000-0000-4000-8000-000000000001',
    'Scheduled Insert Backfill',
    'scheduled-insert-backfill',
    'Scheduled body',
    'Editor',
    'scheduled',
    v_ts_orig
  );

  PERFORM pg_temp.assert_true(
    (SELECT requested_publish_at = v_ts_orig
     FROM public.blog_posts WHERE id = 'd3000000-0000-4000-8000-000000000097'),
    'scheduled INSERT populates requested_publish_at from published_at when omitted'
  );

  -- Unmanaged scheduled post moved to a new published_at charges the new day, not stale requested_publish_at
  UPDATE public.blog_posts
  SET published_at = v_ts_next
  WHERE id = 'd3000000-0000-4000-8000-000000000097';

  PERFORM pg_temp.assert_true(
    (SELECT total_used = 0
     FROM private.compute_blog_release_day_usage_v1('d2000000-0000-4000-8000-000000000001', v_day_orig)),
    'unmanaged scheduled post vacates original requested_publish_at day when published_at moves'
  );

  PERFORM pg_temp.assert_true(
    (SELECT total_used = 1
     FROM private.compute_blog_release_day_usage_v1('d2000000-0000-4000-8000-000000000001', v_day_next)),
    'unmanaged scheduled post counts against its current published_at day'
  );
END $$;

ROLLBACK;

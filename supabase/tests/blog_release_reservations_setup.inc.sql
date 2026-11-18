-- Shared helpers and synthetic fixtures for Track 1 blog release SQL suites.

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


INSERT INTO public.categories (id, merchant_id, name, slug) VALUES
  ('d4000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Smartphones', 'smartphones');

-- Seed posts across merchants + non-pilot + platform post
INSERT INTO public.blog_posts (
  id, merchant_id, title, slug, content, author_name, status, published_at,
  metadata_status, guide_scope, guide_kind, cluster_category_id, metadata_source_revision, is_platform_post
) VALUES
  ('d3000000-0000-4000-8000-000000000001', 'd2000000-0000-4000-8000-000000000001', 'Legacy Published Post', 'legacy-published-post', 'Original content', 'Editor', 'published', '2026-10-01T10:00:00Z', 'verified', 'product_specific', 'buyer-guide', 'd4000000-0000-4000-8000-000000000001', 'rev-1', false),
  ('d3000000-0000-4000-8000-000000000002', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 2', 'draft-post-2', 'Draft content 2', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000003', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 3', 'draft-post-3', 'Draft content 3', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000004', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 4', 'draft-post-4', 'Draft content 4', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000005', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 5', 'draft-post-5', 'Draft content 5', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000006', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 6', 'draft-post-6', 'Draft content 6', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000007', 'd2000000-0000-4000-8000-000000000001', 'Draft Post 7', 'draft-post-7', 'Draft content 7', 'Editor', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000008', 'd2000000-0000-4000-8000-000000000001', 'Archived Post', 'archived-post', 'Archived content', 'Editor', 'archived', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000009', 'd2000000-0000-4000-8000-000000000001', 'Non-Pilot Scheduled', 'non-pilot-scheduled', 'Non-pilot scheduled content', 'Editor', 'scheduled', transaction_timestamp() - interval '5 minutes', 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000099', 'd2000000-0000-4000-8000-000000000002', 'Merchant B Draft', 'merchant-b-draft', 'Merchant B content', 'Editor B', 'draft', NULL, 'unverified', NULL, NULL, NULL, NULL, false),
  ('d3000000-0000-4000-8000-000000000098', NULL, 'Platform Scheduled', 'platform-scheduled', 'Platform content', 'Platform', 'scheduled', transaction_timestamp() - interval '5 minutes', 'unverified', NULL, NULL, NULL, NULL, true);


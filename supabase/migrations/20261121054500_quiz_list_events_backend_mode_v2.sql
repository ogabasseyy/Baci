-- Project `backendMode` (`'postgres' | 'edge_rooms'`) in `public.list_quiz_events_v2`
-- so mobile/web clients know which events use Cloudflare Edge Rooms without guessing.
CREATE OR REPLACE FUNCTION public.list_quiz_events_v2(
  p_merchant_id uuid,
  p_limit integer DEFAULT 20,
  p_offset integer DEFAULT 0
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_now timestamptz := pg_catalog.clock_timestamp();
  v_events jsonb;
  v_returned integer;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;
  IF p_limit IS NULL OR p_offset IS NULL OR p_limit NOT BETWEEN 1 AND 50 OR p_offset < 0 THEN
    RAISE EXCEPTION 'invalid_pagination' USING ERRCODE = '22023';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.customers AS customer
    WHERE customer.merchant_id = p_merchant_id
      AND customer.user_id = auth.uid()
      AND customer.deleted_at IS NULL
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;

  WITH visible AS (
    SELECT event.*
    FROM public.quiz_events AS event
    WHERE event.merchant_id = p_merchant_id
      AND event.contract_version = 2
      AND event.status IN ('scheduled', 'active', 'completed')
      AND event.starts_at IS NOT NULL
      AND event.ends_at IS NOT NULL
      AND event.ends_at > event.starts_at
      AND event.question_count BETWEEN 1 AND 50
      AND event.time_per_question_seconds BETWEEN 5 AND 60
      AND event.maximum_play_seconds = event.question_count * event.time_per_question_seconds
      AND event.live_window_seconds = pg_catalog.floor(
        EXTRACT(EPOCH FROM (event.ends_at - event.starts_at))
      )::integer
      AND event.max_attempts BETWEEN 1 AND 50
      AND (event.mode <> 'live' OR event.max_attempts = 1)
      AND pg_catalog.length(pg_catalog.btrim(event.time_zone)) > 0
      AND pg_catalog.length(pg_catalog.btrim(event.rules_version)) > 0
      AND event.settings->>'prize_product_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      AND pg_catalog.length(pg_catalog.btrim(event.settings->>'prize_product_name')) > 0
      AND pg_catalog.length(pg_catalog.btrim(event.settings->>'prize_name')) > 0
      AND COALESCE(event.settings->>'prize_product_condition', '') IN ('', 'new', 'used', 'open_box', 'refurbished')
      AND (NULLIF(event.settings->>'prize_variant_id', '') IS NULL OR event.settings->>'prize_variant_id' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$')
      AND (
        (event.mode = 'test' AND (
          EXISTS (
            SELECT 1 FROM public.quiz_event_testers AS tester
            WHERE tester.event_id = event.id
              AND tester.user_id = auth.uid()
              AND tester.revoked_at IS NULL
          ) OR public.has_merchant_access(event.merchant_id)
        ))
        OR (event.mode = 'live' AND private.quiz_live_prize_regulatory_ready_v2(event.id))
      )
    ORDER BY event.starts_at DESC, event.id
    LIMIT p_limit OFFSET p_offset
  )
  SELECT COALESCE(
      pg_catalog.jsonb_agg(
        pg_catalog.jsonb_build_object(
          'backendMode', visible.backend_mode,
          'contractVersion', 2,
          'endsAt', visible.ends_at,
          'id', visible.id,
          'liveWindowSeconds', visible.live_window_seconds,
          'maxAttempts', visible.max_attempts,
          'maximumPlaySeconds', visible.maximum_play_seconds,
          'mode', visible.mode,
          'prizeName', visible.settings->>'prize_name',
          'prizeProduct', pg_catalog.jsonb_build_object(
            'condition', NULLIF(visible.settings->>'prize_product_condition', ''),
            'id', visible.settings->>'prize_product_id',
            'imageUrl', NULLIF(visible.settings->>'prize_product_image_url', ''),
            'name', visible.settings->>'prize_product_name',
            'variantId', NULLIF(visible.settings->>'prize_variant_id', '')
          ),
          'questionCount', visible.question_count,
          'resultsPublishedAt', visible.results_published_at,
          'rulesVersion', visible.rules_version,
          'startsAt', visible.starts_at,
          'status', CASE WHEN visible.ends_at <= v_now AND visible.results_published_at IS NULL THEN 'finalizing' ELSE visible.status END,
          'timePerQuestionSeconds', visible.time_per_question_seconds,
          'timeZone', visible.time_zone,
          'title', visible.title
        ) ORDER BY visible.starts_at DESC, visible.id
      ),
      '[]'::jsonb
    ),
    pg_catalog.count(*)::integer
  INTO v_events, v_returned
  FROM visible;

  RETURN pg_catalog.jsonb_build_object(
    'contractVersion', 2,
    'entryMode', 'free',
    'events', v_events,
    'pagination', pg_catalog.jsonb_build_object(
      'hasMore', v_returned = p_limit,
      'limit', p_limit,
      'nextOffset', CASE WHEN v_returned = p_limit THEN p_offset + p_limit ELSE NULL END,
      'offset', p_offset
    ),
    'serverNow', v_now
  );
END;
$$;

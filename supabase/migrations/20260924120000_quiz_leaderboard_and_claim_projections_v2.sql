-- Bounded player projections for quiz participant counts and winner checkout.
-- These stay behind the authenticated quiz customer and event gates so the
-- API never needs a service-role client for player-facing data.

CREATE OR REPLACE FUNCTION public.get_quiz_leaderboard_participant_count_v2(
  p_event_id uuid
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT event.* INTO v_event
  FROM public.quiz_events AS event
  WHERE event.id = p_event_id;

  IF v_event.id IS NULL OR v_event.contract_version <> 2 THEN
    RETURN 0;
  END IF;

  SELECT customer.id INTO v_customer_id
  FROM public.customers AS customer
  WHERE customer.merchant_id = v_event.merchant_id
    AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL
  LIMIT 1;
  IF v_customer_id IS NULL THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;

  IF v_event.mode = 'test' AND NOT (
    public.has_merchant_access(v_event.merchant_id)
    OR EXISTS (
      SELECT 1 FROM public.quiz_event_testers AS tester
      WHERE tester.event_id = v_event.id
        AND tester.user_id = auth.uid()
        AND tester.revoked_at IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;
  IF v_event.mode = 'live'
    AND NOT private.quiz_live_prize_regulatory_ready_v2(v_event.id) THEN
    RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031';
  END IF;

  IF v_event.status = 'cancelled' OR v_event.results_published_at IS NULL THEN
    RETURN 0;
  END IF;

  RETURN (
    SELECT count(*)::integer
    FROM private.quiz_ranked_candidates_v2(v_event.id)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_quiz_prize_claim_v2(
  p_attempt_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_attempt public.quiz_attempts%ROWTYPE;
  v_award public.quiz_awards%ROWTYPE;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000';
  END IF;

  SELECT attempt.* INTO v_attempt
  FROM public.quiz_attempts AS attempt
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id
    AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL;
  IF v_attempt.id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT award.* INTO v_award
  FROM public.quiz_awards AS award
  JOIN public.quiz_events AS event ON event.id = award.event_id
  WHERE award.attempt_id = v_attempt.id
    AND award.event_id = v_attempt.event_id
    AND event.contract_version = 2
    AND event.mode = 'live'
    AND private.quiz_live_prize_regulatory_ready_v2(event.id)
    AND event.results_published_at IS NOT NULL
    AND award.award_source = 'ranked_product_v2'
    AND award.status IN ('pending', 'approved')
    AND award.claim_expires_at > pg_catalog.clock_timestamp()
    AND award.product_id IS NOT NULL;
  IF v_award.id IS NULL THEN
    RETURN NULL;
  END IF;

  RETURN pg_catalog.jsonb_build_object(
    'awardId', v_award.id,
    'condition', v_award.condition,
    'expiresAt', v_award.claim_expires_at,
    'productId', v_award.product_id,
    'variantId', v_award.variant_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_leaderboard_participant_count_v2(uuid),
  public.get_quiz_prize_claim_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_leaderboard_participant_count_v2(uuid),
  public.get_quiz_prize_claim_v2(uuid)
  TO authenticated, service_role;

COMMENT ON FUNCTION public.get_quiz_leaderboard_participant_count_v2(uuid) IS
  'Returns the exact number of ranked v2 participants after the same event and viewer gates as the published leaderboard.';
COMMENT ON FUNCTION public.get_quiz_prize_claim_v2(uuid) IS
  'Returns only the authenticated winner product projection needed to create a signed checkout voucher.';

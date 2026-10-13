-- Preserve the configured claim window when replaying a completed quiz.
-- This append-only replacement extends the bounded projection created by
-- 20260815010000 without changing that migration in place.
CREATE OR REPLACE FUNCTION public.get_quiz_attempt_prize_claim_v2(
  p_attempt_id uuid,
  p_user_id uuid
)
RETURNS jsonb
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT pg_catalog.jsonb_strip_nulls(
    pg_catalog.jsonb_build_object(
      'awardId', award.id,
      'claimExpiresAt', award.claim_expires_at,
      'condition', award.condition,
      'createdAt', award.created_at,
      'productId', award.product_id,
      'variantId', award.variant_id
    )
  )
  FROM public.quiz_awards AS award
  JOIN public.quiz_attempts AS attempt ON attempt.id = award.attempt_id
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id
    AND customer.user_id = p_user_id
    AND auth.uid() = p_user_id
    AND customer.deleted_at IS NULL
    AND award.customer_id = customer.id
    AND award.award_type = 'store_credit'
    AND award.status = 'approved'
    AND award.product_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_attempt_prize_claim_v2(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_prize_claim_v2(uuid, uuid)
  TO authenticated;

COMMENT ON FUNCTION public.get_quiz_attempt_prize_claim_v2(uuid, uuid) IS
  'Owner-checked, bounded product claim projection with persisted expiry for quiz v2 result and replay routes.';

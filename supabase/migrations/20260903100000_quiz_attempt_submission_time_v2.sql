-- Expose only the authenticated player's persisted submission timestamp so
-- terminal attempt responses never substitute a later retry response time.
CREATE OR REPLACE FUNCTION public.get_quiz_attempt_submission_time_v2(
  p_attempt_id uuid
)
RETURNS timestamptz
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT attempt.submitted_at
  FROM public.quiz_attempts AS attempt
  JOIN public.customers AS customer ON customer.id = attempt.customer_id
  WHERE attempt.id = p_attempt_id
    AND customer.user_id = auth.uid()
    AND customer.deleted_at IS NULL;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_attempt_submission_time_v2(uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_attempt_submission_time_v2(uuid)
  TO authenticated, service_role;

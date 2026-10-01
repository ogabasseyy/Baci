CREATE OR REPLACE FUNCTION public.get_quiz_participant_count_public_v2(p_event_id uuid)
RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_customer_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '28000'; END IF;
  SELECT event.* INTO v_event FROM public.quiz_events event WHERE event.id = p_event_id;
  SELECT customer.id INTO v_customer_id FROM public.customers customer
    WHERE customer.merchant_id = v_event.merchant_id AND customer.user_id = auth.uid() AND customer.deleted_at IS NULL LIMIT 1;
  IF v_event.id IS NULL OR v_customer_id IS NULL THEN RAISE EXCEPTION 'not_authorized' USING ERRCODE = 'QZ031'; END IF;
  IF v_event.status = 'cancelled' THEN RETURN 0; END IF;
  IF v_event.results_published_at IS NOT NULL THEN
    RETURN (SELECT count(*)::integer FROM public.quiz_event_results_v2 WHERE event_id = p_event_id);
  END IF;
  RETURN (SELECT count(*)::integer FROM public.quiz_live_standings_v2 WHERE event_id = p_event_id);
END;
$$;

REVOKE ALL ON FUNCTION public.get_quiz_participant_count_public_v2(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_quiz_participant_count_public_v2(uuid) TO authenticated;

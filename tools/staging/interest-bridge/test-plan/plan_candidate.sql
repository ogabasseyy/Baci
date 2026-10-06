CREATE FUNCTION pg_temp.plan_candidate(goal_uuid uuid) RETURNS jsonb
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT jsonb_build_object(
    'goal',(SELECT to_jsonb(goal) FROM public.customer_savings_goals goal WHERE id=goal_uuid),
    'events',(SELECT coalesce(jsonb_agg(to_jsonb(event) ORDER BY to_jsonb(event)::text),'[]'::jsonb)
      FROM public.customer_savings_events event WHERE goal_id=goal_uuid),
    'keys',(SELECT coalesce(jsonb_agg(to_jsonb(entry) ORDER BY to_jsonb(entry)::text),'[]'::jsonb)
      FROM public.customer_savings_goal_idempotency_keys entry WHERE goal_id=goal_uuid))
$$;

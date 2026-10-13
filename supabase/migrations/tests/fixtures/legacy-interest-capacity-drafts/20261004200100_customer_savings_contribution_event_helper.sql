BEGIN;

CREATE FUNCTION piggyvest_savings_ledger.record_contribution_events(
  p_goal uuid, p_merchant uuid, p_customer uuid, p_actor_type text, p_metadata jsonb,
  p_principal numeric, p_previous_status text, p_status text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  INSERT INTO public.customer_savings_events (
    goal_id, merchant_id, customer_id, event_type, actor_type, metadata
  ) VALUES (
    p_goal, p_merchant, p_customer, 'contribution_completed', p_actor_type, p_metadata
  );
  IF p_status = 'completed' AND p_previous_status <> 'completed' THEN
    INSERT INTO public.customer_savings_events (
      goal_id, merchant_id, customer_id, event_type, actor_type, metadata
    ) VALUES (
      p_goal, p_merchant, p_customer, 'goal_completed', 'system',
      jsonb_build_object('current_amount', p_principal)
    );
  END IF;
END $$;
REVOKE ALL ON FUNCTION piggyvest_savings_ledger.record_contribution_events(
  uuid, uuid, uuid, text, jsonb, numeric, text, text
) FROM PUBLIC, anon, authenticated, service_role;

COMMIT;


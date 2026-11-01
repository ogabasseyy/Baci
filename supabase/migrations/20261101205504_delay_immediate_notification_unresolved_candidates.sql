-- Healthy in-flight sends are not operator incidents. Confirmed acceptance
-- remains immediately actionable; uncertain dispatches receive a grace period.
CREATE OR REPLACE FUNCTION public.list_immediate_notification_recovery_candidates(p_limit integer)
RETURNS TABLE (order_id uuid, claim_token uuid, status text)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'invalid_limit' USING ERRCODE = '22023';
  END IF;
  RETURN QUERY SELECT d.order_id, d.claim_token, d.state
  FROM private.immediate_notification_dispatches d
  JOIN public.immediate_order_notification_claims c ON c.order_id = d.order_id
    AND c.merchant_id = d.merchant_id AND c.claim_token = d.claim_token
  WHERE c.status = 'processing'
    AND (d.state = 'accepted' OR (d.state = 'dispatching' AND d.updated_at < now() - interval '5 minutes'))
  ORDER BY CASE d.state WHEN 'accepted' THEN 0 ELSE 1 END, d.updated_at, d.order_id LIMIT p_limit;
END $$;

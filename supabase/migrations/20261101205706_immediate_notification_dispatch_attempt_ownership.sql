-- Upgrade only before activation: existing rows lack an attempt owner and
-- cannot be safely reassigned or released. Operators must reconcile first.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM private.immediate_notification_dispatches) THEN
    RAISE EXCEPTION 'existing notification dispatches require reconciliation before attempt ownership';
  END IF;
END $$;
ALTER TABLE private.immediate_notification_dispatches ADD COLUMN dispatch_token uuid NOT NULL;

DROP FUNCTION public.begin_immediate_notification_dispatch(uuid, uuid);
DROP FUNCTION public.record_immediate_notification_acceptance(uuid, uuid);
DROP FUNCTION public.release_immediate_notification_dispatch(uuid, uuid);

CREATE FUNCTION public.begin_immediate_notification_dispatch(p_order_id uuid, p_claim_token uuid, p_dispatch_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claim_row public.immediate_order_notification_claims%ROWTYPE; changed integer;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  IF p_dispatch_token IS NULL THEN RETURN false; END IF;
  SELECT * INTO claim_row FROM public.immediate_order_notification_claims c WHERE c.order_id = p_order_id FOR UPDATE;
  IF NOT FOUND OR claim_row.status <> 'processing' OR claim_row.claim_token IS DISTINCT FROM p_claim_token THEN RETURN false; END IF;
  INSERT INTO private.immediate_notification_dispatches AS d (order_id, merchant_id, claim_token, dispatch_token, state)
  VALUES (claim_row.order_id, claim_row.merchant_id, p_claim_token, p_dispatch_token, 'dispatching')
  ON CONFLICT (order_id) DO UPDATE SET merchant_id = EXCLUDED.merchant_id, claim_token = EXCLUDED.claim_token,
    dispatch_token = EXCLUDED.dispatch_token, state = 'dispatching', updated_at = now() WHERE d.state = 'rejected';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.record_immediate_notification_acceptance(p_order_id uuid, p_claim_token uuid, p_dispatch_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.immediate_order_notification_claims c WHERE c.order_id = p_order_id
    AND c.claim_token = p_claim_token AND c.status = 'processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE private.immediate_notification_dispatches d SET state = 'accepted', updated_at = now()
  WHERE d.order_id = p_order_id AND d.claim_token = p_claim_token AND d.dispatch_token = p_dispatch_token
    AND d.state IN ('dispatching', 'accepted');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.release_immediate_notification_dispatch(p_order_id uuid, p_claim_token uuid, p_dispatch_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  PERFORM 1 FROM public.immediate_order_notification_claims c WHERE c.order_id = p_order_id
    AND c.claim_token = p_claim_token AND c.status = 'processing' FOR UPDATE;
  IF NOT FOUND THEN RETURN false; END IF;
  UPDATE private.immediate_notification_dispatches d SET state = 'rejected', updated_at = now()
  WHERE d.order_id = p_order_id AND d.claim_token = p_claim_token AND d.dispatch_token = p_dispatch_token
    AND d.state = 'dispatching';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

REVOKE ALL ON FUNCTION public.begin_immediate_notification_dispatch(uuid, uuid, uuid),
  public.record_immediate_notification_acceptance(uuid, uuid, uuid),
  public.release_immediate_notification_dispatch(uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.begin_immediate_notification_dispatch(uuid, uuid, uuid),
  public.record_immediate_notification_acceptance(uuid, uuid, uuid),
  public.release_immediate_notification_dispatch(uuid, uuid, uuid)
  TO immediate_notification_redrive;
NOTIFY pgrst, 'reload schema';

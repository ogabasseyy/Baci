-- Durable delivery fence. This capability is deliberately not granted to
-- authenticator here: request-scope installation and a fleet reload canary
-- must precede any separate activation migration.
CREATE SCHEMA IF NOT EXISTS private;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'immediate_notification_redrive') THEN
    CREATE ROLE immediate_notification_redrive NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

CREATE TABLE private.immediate_notification_dispatches (
  order_id uuid PRIMARY KEY REFERENCES public.immediate_order_notification_claims(order_id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  claim_token uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('dispatching', 'accepted', 'rejected')),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE private.immediate_notification_dispatches ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.immediate_notification_dispatches FROM PUBLIC, anon, authenticated, immediate_notification_redrive;

-- The claim UPDATE already locks this row. Begin locks the same claim row
-- before creating a fence, so the two paths cannot race past one another.
CREATE FUNCTION private.fence_immediate_notification_reclaim()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.claim_token IS DISTINCT FROM OLD.claim_token AND EXISTS (
    SELECT 1 FROM private.immediate_notification_dispatches d
    WHERE d.order_id = OLD.order_id AND d.claim_token = OLD.claim_token
      AND d.state IN ('dispatching', 'accepted')
  ) THEN
    RETURN NULL;
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.fence_immediate_notification_reclaim() FROM PUBLIC, anon, authenticated, immediate_notification_redrive;
CREATE TRIGGER fence_immediate_notification_reclaim
BEFORE UPDATE ON public.immediate_order_notification_claims
FOR EACH ROW EXECUTE FUNCTION private.fence_immediate_notification_reclaim();

CREATE FUNCTION public.begin_immediate_notification_dispatch(p_order_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE claim_row public.immediate_order_notification_claims%ROWTYPE; changed integer;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO claim_row FROM public.immediate_order_notification_claims c WHERE c.order_id = p_order_id FOR UPDATE;
  IF NOT FOUND OR claim_row.status <> 'processing' OR claim_row.claim_token IS DISTINCT FROM p_claim_token THEN RETURN false; END IF;
  INSERT INTO private.immediate_notification_dispatches AS d (order_id, merchant_id, claim_token, state)
  VALUES (claim_row.order_id, claim_row.merchant_id, p_claim_token, 'dispatching')
  ON CONFLICT (order_id) DO UPDATE SET merchant_id = EXCLUDED.merchant_id, claim_token = EXCLUDED.claim_token,
    state = 'dispatching', updated_at = now() WHERE d.state = 'rejected';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.record_immediate_notification_acceptance(p_order_id uuid, p_claim_token uuid)
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
  WHERE d.order_id = p_order_id AND d.claim_token = p_claim_token AND d.state IN ('dispatching', 'accepted');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.release_immediate_notification_dispatch(p_order_id uuid, p_claim_token uuid)
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
  WHERE d.order_id = p_order_id AND d.claim_token = p_claim_token AND d.state = 'dispatching';
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.recover_immediate_notification_completion(p_order_id uuid, p_claim_token uuid)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE changed integer;
BEGIN
  IF coalesce((SELECT auth.role()), '') <> 'immediate_notification_redrive' THEN
    RAISE EXCEPTION 'redrive_role_required' USING ERRCODE = '42501';
  END IF;
  UPDATE public.immediate_order_notification_claims c
  SET status = 'sent', sent_at = coalesce(c.sent_at, now()), last_error = NULL, updated_at = now()
  WHERE c.order_id = p_order_id AND c.claim_token = p_claim_token AND c.status IN ('processing', 'sent')
    AND EXISTS (SELECT 1 FROM private.immediate_notification_dispatches d
      WHERE d.order_id = c.order_id AND d.merchant_id = c.merchant_id
        AND d.claim_token = c.claim_token AND d.state = 'accepted');
  GET DIAGNOSTICS changed = ROW_COUNT;
  RETURN changed = 1;
END $$;

CREATE FUNCTION public.list_immediate_notification_recovery_candidates(p_limit integer)
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
  WHERE c.status = 'processing' AND d.state IN ('accepted', 'dispatching')
  ORDER BY CASE d.state WHEN 'accepted' THEN 0 ELSE 1 END, d.updated_at, d.order_id LIMIT p_limit;
END $$;

REVOKE ALL ON FUNCTION public.begin_immediate_notification_dispatch(uuid, uuid),
  public.record_immediate_notification_acceptance(uuid, uuid),
  public.release_immediate_notification_dispatch(uuid, uuid),
  public.recover_immediate_notification_completion(uuid, uuid),
  public.list_immediate_notification_recovery_candidates(integer)
  FROM PUBLIC, anon, authenticated;
GRANT USAGE ON SCHEMA public TO immediate_notification_redrive;
GRANT EXECUTE ON FUNCTION public.begin_immediate_notification_dispatch(uuid, uuid),
  public.record_immediate_notification_acceptance(uuid, uuid),
  public.release_immediate_notification_dispatch(uuid, uuid),
  public.recover_immediate_notification_completion(uuid, uuid),
  public.list_immediate_notification_recovery_candidates(integer)
  TO immediate_notification_redrive;

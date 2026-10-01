-- Claim/finalize mobile OAuth handoff tickets so retries remain possible when
-- token exchange or integration upsert fails after the initial claim.

ALTER TABLE public.oauth_handoff_tickets
  DROP CONSTRAINT IF EXISTS oauth_handoff_tickets_status_check;

ALTER TABLE public.oauth_handoff_tickets
  ADD CONSTRAINT oauth_handoff_tickets_status_check
  CHECK (
    status = ANY (
      ARRAY[
        'pending'::text,
        'redeemed'::text,
        'exchanging'::text,
        'exchanged'::text,
        'expired'::text
      ]
    )
  );

CREATE OR REPLACE FUNCTION public.exchange_jumia_oauth_handoff_ticket(
  p_ticket_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF v_user_id IS NULL OR p_ticket_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RETURN false;
  END IF;

  -- Atomically claim a redeemed ticket for the exchange attempt. Concurrent
  -- callers lose the race; failures must release back to redeemed.
  UPDATE public.oauth_handoff_tickets AS ticket
  SET status = 'exchanging', exchanged_at = NULL
  WHERE ticket.id = p_ticket_id AND ticket.status = 'redeemed'
    AND ticket.user_id = v_user_id AND ticket.merchant_id = p_merchant_id
    AND ticket.expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.finalize_jumia_oauth_handoff_ticket(
  p_ticket_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF v_user_id IS NULL OR p_ticket_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.oauth_handoff_tickets AS ticket
  SET status = 'exchanged', exchanged_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.status = 'exchanging'
    AND ticket.user_id = v_user_id AND ticket.merchant_id = p_merchant_id
    AND ticket.expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_jumia_oauth_handoff_ticket(
  p_ticket_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF v_user_id IS NULL OR p_ticket_id IS NULL OR p_merchant_id IS NULL THEN
    RETURN false;
  END IF;
  IF NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RETURN false;
  END IF;

  UPDATE public.oauth_handoff_tickets AS ticket
  SET status = 'redeemed', exchanged_at = NULL
  WHERE ticket.id = p_ticket_id AND ticket.status = 'exchanging'
    AND ticket.user_id = v_user_id AND ticket.merchant_id = p_merchant_id
    AND ticket.expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.exchange_jumia_oauth_handoff_ticket(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_jumia_oauth_handoff_ticket(uuid, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.finalize_jumia_oauth_handoff_ticket(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.finalize_jumia_oauth_handoff_ticket(uuid, uuid)
  TO authenticated;
REVOKE ALL ON FUNCTION public.release_jumia_oauth_handoff_ticket(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.release_jumia_oauth_handoff_ticket(uuid, uuid)
  TO authenticated;

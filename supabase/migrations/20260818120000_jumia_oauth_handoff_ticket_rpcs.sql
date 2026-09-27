-- Narrow, atomic Jumia mobile OAuth handoff mutations.
-- Creation and exchange require auth.uid ownership/permission. Redemption is
-- callable by anon because a mobile system browser has no Baci session; the
-- high-entropy UUID is a one-time bearer credential and no merchant data is
-- returned. State and expiry are bound in the same update.

CREATE OR REPLACE FUNCTION public.create_jumia_oauth_handoff_ticket(
  p_merchant_id uuid,
  p_expires_at timestamptz
)
RETURNS TABLE (id uuid, expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
BEGIN
  IF v_user_id IS NULL OR p_merchant_id IS NULL OR p_expires_at IS NULL
    OR p_expires_at <= now()
    OR p_expires_at > now() + interval '2 minutes'
    OR NOT (
      EXISTS (
        SELECT 1 FROM public.merchants AS merchant
        WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
      )
      OR public.check_staff_permission(
        v_user_id, p_merchant_id, 'integrations', 'manage'
      )
    ) THEN
    RAISE EXCEPTION 'Not authorized to create Jumia OAuth handoff ticket'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  INSERT INTO public.oauth_handoff_tickets (merchant_id, user_id, expires_at)
  VALUES (p_merchant_id, v_user_id, p_expires_at)
  RETURNING id, expires_at;
END;
$$;

CREATE OR REPLACE FUNCTION public.redeem_jumia_oauth_handoff_ticket(
  p_ticket_id uuid,
  p_oauth_state text,
  p_redeemed_expires_at timestamptz
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF p_ticket_id IS NULL OR p_oauth_state IS NULL
    OR length(p_oauth_state) < 16 OR length(p_oauth_state) > 128
    OR p_redeemed_expires_at IS NULL OR p_redeemed_expires_at <= now()
    OR p_redeemed_expires_at > now() + interval '10 minutes' THEN
    RETURN false;
  END IF;

  UPDATE public.oauth_handoff_tickets AS ticket
  SET status = 'redeemed', redeemed_at = now(), oauth_state = p_oauth_state,
      expires_at = p_redeemed_expires_at
  WHERE ticket.id = p_ticket_id AND ticket.status = 'pending'
    AND ticket.expires_at > now()
    AND (v_user_id IS NULL OR ticket.user_id = v_user_id);

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

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

  UPDATE public.oauth_handoff_tickets AS ticket
  SET status = 'exchanged', exchanged_at = now()
  WHERE ticket.id = p_ticket_id AND ticket.status = 'redeemed'
    AND ticket.user_id = v_user_id AND ticket.merchant_id = p_merchant_id
    AND ticket.expires_at > now();

  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

REVOKE ALL ON FUNCTION public.create_jumia_oauth_handoff_ticket(uuid, timestamptz)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.create_jumia_oauth_handoff_ticket(uuid, timestamptz)
  TO authenticated;
REVOKE ALL ON FUNCTION public.redeem_jumia_oauth_handoff_ticket(uuid, text, timestamptz)
  FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.redeem_jumia_oauth_handoff_ticket(uuid, text, timestamptz)
  TO anon, authenticated;
REVOKE ALL ON FUNCTION public.exchange_jumia_oauth_handoff_ticket(uuid, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.exchange_jumia_oauth_handoff_ticket(uuid, uuid)
  TO authenticated;

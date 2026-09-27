-- Serialize self-authorization selection validation around rotating refresh
-- credentials, and correct the mobile handoff ticket RETURNING ambiguity.

ALTER TABLE public.jumia_self_authorization_discoveries
  ADD COLUMN IF NOT EXISTS claim_token uuid,
  ADD COLUMN IF NOT EXISTS claim_expires_at timestamptz;

CREATE OR REPLACE FUNCTION public.claim_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_client_key_hash text
)
RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_claim_token uuid := gen_random_uuid();
  v_credential_ciphertext text;
BEGIN
  IF v_user_id IS NULL OR NOT (
    EXISTS (
      SELECT 1 FROM public.merchants AS merchant
      WHERE merchant.id = p_merchant_id AND merchant.user_id = v_user_id
    )
    OR public.check_staff_permission(
      v_user_id, p_merchant_id, 'integrations', 'manage'
    )
  ) THEN
    RAISE EXCEPTION 'Not authorized to manage Jumia connections'
      USING ERRCODE = '42501';
  END IF;

  UPDATE public.jumia_self_authorization_discoveries AS discovery
  SET claim_token = v_claim_token,
      claim_expires_at = now() + interval '2 minutes'
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.client_key_hash = p_client_key_hash
    AND discovery.consumed_at IS NULL
    AND discovery.expires_at > now()
    AND (
      discovery.claim_token IS NULL
      OR discovery.claim_expires_at <= now()
    )
  RETURNING discovery.credential_ciphertext
  INTO v_credential_ciphertext;

  IF v_credential_ciphertext IS NULL THEN
    RETURN NULL;
  END IF;
  RETURN jsonb_build_object(
    'claim_token', v_claim_token,
    'credential_ciphertext', v_credential_ciphertext
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.update_claimed_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_claim_token uuid,
  p_credential_ciphertext text
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF v_user_id IS NULL
    OR char_length(p_credential_ciphertext) NOT BETWEEN 32 AND 16384
  THEN
    RETURN false;
  END IF;

  UPDATE public.jumia_self_authorization_discoveries AS discovery
  SET credential_ciphertext = p_credential_ciphertext,
      claim_expires_at = now() + interval '2 minutes'
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.claim_token = p_claim_token
    AND discovery.claim_expires_at > now()
    AND discovery.expires_at > now();
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_claim_token uuid
)
RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_updated integer;
BEGIN
  IF v_user_id IS NULL THEN RETURN false; END IF;
  UPDATE public.jumia_self_authorization_discoveries AS discovery
  SET claim_token = NULL, claim_expires_at = NULL
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.claim_token = p_claim_token;
  GET DIAGNOSTICS v_updated = ROW_COUNT;
  RETURN v_updated = 1;
END;
$$;

CREATE OR REPLACE FUNCTION public.consume_jumia_self_authorization_discovery(
  p_discovery_id uuid,
  p_merchant_id uuid,
  p_client_key_hash text,
  p_claim_token uuid
)
RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_user_id uuid := (SELECT auth.uid());
  v_credential_ciphertext text;
BEGIN
  IF v_user_id IS NULL THEN RETURN NULL; END IF;
  DELETE FROM public.jumia_self_authorization_discoveries AS discovery
  WHERE discovery.id = p_discovery_id
    AND discovery.merchant_id = p_merchant_id
    AND discovery.user_id = v_user_id
    AND discovery.client_key_hash = p_client_key_hash
    AND discovery.claim_token = p_claim_token
    AND discovery.claim_expires_at > now()
    AND discovery.expires_at > now()
  RETURNING discovery.credential_ciphertext
  INTO v_credential_ciphertext;
  RETURN v_credential_ciphertext;
END;
$$;

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
  INSERT INTO public.oauth_handoff_tickets AS ticket (
    merchant_id, user_id, expires_at
  ) VALUES (p_merchant_id, v_user_id, p_expires_at)
  RETURNING ticket.id, ticket.expires_at;
END;
$$;

REVOKE ALL ON FUNCTION public.claim_jumia_self_authorization_discovery(
  uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_claimed_jumia_self_authorization_discovery(
  uuid, uuid, uuid, text
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_jumia_self_authorization_discovery(
  uuid, uuid, uuid
) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.consume_jumia_self_authorization_discovery(
  uuid, uuid, text, uuid
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.claim_jumia_self_authorization_discovery(
  uuid, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_claimed_jumia_self_authorization_discovery(
  uuid, uuid, uuid, text
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.release_jumia_self_authorization_discovery(
  uuid, uuid, uuid
) TO authenticated;
GRANT EXECUTE ON FUNCTION public.consume_jumia_self_authorization_discovery(
  uuid, uuid, text, uuid
) TO authenticated;

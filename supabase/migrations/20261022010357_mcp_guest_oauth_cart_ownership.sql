-- OAuth starts with an empty cart. Historical merchant inference cannot bind
-- an empty legacy row, so the tenant-scoped worker must bind it atomically.
CREATE FUNCTION public.mcp_guest_oauth_seed_cart(p_merchant_id uuid,p_token text,p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE r record; owner_id uuid;
BEGIN
  IF current_setting('request.jwt.claims',true)::jsonb ->> 'role' IS DISTINCT FROM 'mcp_guest_oauth_worker'
    OR current_setting('request.jwt.claims',true)::jsonb ->> 'merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' OR p_expires_at IS NULL
    OR p_expires_at<=now() OR p_expires_at>now()+interval '7 days' THEN
    RAISE EXCEPTION 'invalid_request';
  END IF;
  IF NOT EXISTS(SELECT 1 FROM public.merchants WHERE id=p_merchant_id
    AND premium_features @> '["shared_cart"]'::jsonb) THEN
    RAISE EXCEPTION 'merchant_unavailable';
  END IF;
  -- Preserve the existing global capacity gate and token validation.
  SELECT * INTO STRICT r FROM public.upsert_mcp_guest_cart(p_token,'[]'::jsonb,p_expires_at,NULL);
  IF r.outcome='ok' THEN
    UPDATE public.mcp_guest_carts SET merchant_id=p_merchant_id WHERE token=p_token;
    RETURN true;
  END IF;
  IF r.outcome='conflict' THEN
    SELECT merchant_id INTO owner_id FROM public.mcp_guest_carts
      WHERE token=p_token AND expires_at>now();
    -- Idempotent replay preserves items and expiry; never claim an ownerless
    -- historical cart or another tenant's token.
    RETURN owner_id IS NOT DISTINCT FROM p_merchant_id;
  END IF;
  RETURN false;
END $$;
REVOKE ALL ON FUNCTION public.mcp_guest_oauth_seed_cart(uuid,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_guest_oauth_seed_cart(uuid,text,timestamptz) TO mcp_guest_oauth_worker;

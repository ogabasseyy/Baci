-- Reserve tenant-wide headroom for existing connections and short-lived OAuth
-- metadata. Seven-day grants have a separate 2,000-row admission ceiling; the
-- 10,000-row hard bound remains. Counts and inserts share the existing merchant
-- advisory lock across resources, replicas, IPs and encryption-key namespaces.
-- Expired records are purged by the existing worker before every CAS.
CREATE OR REPLACE FUNCTION public.mcp_guest_oauth_cas(p_merchant_id uuid,p_key text,p_revision bigint,p_ciphertext text,p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed bigint;
BEGIN
  IF current_setting('request.jwt.claims',true)::jsonb ->> 'role' IS DISTINCT FROM 'mcp_guest_oauth_worker'
    OR current_setting('request.jwt.claims',true)::jsonb ->> 'merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_revision < 0 OR p_expires_at <= now() OR p_expires_at > now()+interval '7 days' THEN
    RAISE EXCEPTION 'invalid_expiry';
  END IF;
  IF p_revision=0 THEN
    -- Serialize insert admission per tenant, including uncommitted contenders.
    PERFORM pg_advisory_xact_lock(hashtextextended('guest-oauth-capacity:'||p_merchant_id::text,0));
    IF NOT EXISTS (SELECT 1 FROM public.mcp_guest_oauth_records r
        WHERE r.merchant_id=p_merchant_id AND r.record_key=p_key)
      AND (SELECT count(*) FROM public.mcp_guest_oauth_records r
        WHERE r.merchant_id=p_merchant_id) >= 10000 THEN
      RAISE EXCEPTION 'oauth_capacity_exceeded';
    END IF;
    IF p_key LIKE 'grant:%'
      AND NOT EXISTS (SELECT 1 FROM public.mcp_guest_oauth_records r
        WHERE r.merchant_id=p_merchant_id AND r.record_key=p_key)
      AND (SELECT count(*) FROM public.mcp_guest_oauth_records r
        WHERE r.merchant_id=p_merchant_id AND r.record_key LIKE 'grant:%') >= 2000 THEN
      RAISE EXCEPTION 'oauth_grant_capacity_exceeded';
    END IF;
    INSERT INTO public.mcp_guest_oauth_records(merchant_id,record_key,ciphertext,revision,expires_at)
      VALUES(p_merchant_id,p_key,p_ciphertext,1,p_expires_at)
      ON CONFLICT DO NOTHING;
  ELSE
    UPDATE public.mcp_guest_oauth_records r SET ciphertext=p_ciphertext,revision=r.revision+1,expires_at=p_expires_at
      WHERE r.merchant_id=p_merchant_id AND r.record_key=p_key AND r.revision=p_revision AND r.expires_at>now()
        AND p_expires_at<=r.created_at+interval '7 days';
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;

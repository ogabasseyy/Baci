-- Dormant infrastructure only. No production worker credential or pilot activation.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='mcp_guest_oauth_worker') THEN
    CREATE ROLE mcp_guest_oauth_worker NOLOGIN NOINHERIT;
  END IF;
END $$;
GRANT mcp_guest_oauth_worker TO authenticator;
GRANT USAGE ON SCHEMA public TO mcp_guest_oauth_worker;
CREATE TABLE public.mcp_guest_oauth_records (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  record_key text NOT NULL CHECK (record_key ~ '^(code|access|refresh|grant|consent):[A-Za-z0-9_-]{1,128}$'),
  ciphertext text NOT NULL CHECK (octet_length(ciphertext) BETWEEN 40 AND 32768),
  revision bigint NOT NULL CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  PRIMARY KEY (merchant_id,record_key),
  CHECK (expires_at <= created_at + interval '7 days')
);
ALTER TABLE public.mcp_guest_oauth_records ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.mcp_guest_oauth_records FROM PUBLIC,anon,authenticated,mcp_guest_oauth_worker;
CREATE INDEX mcp_guest_oauth_records_expiry ON public.mcp_guest_oauth_records(merchant_id,expires_at);

CREATE FUNCTION public.mcp_guest_oauth_read(p_merchant_id uuid,p_key text)
RETURNS TABLE(ciphertext text,revision bigint,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
  IF current_setting('request.jwt.claims',true)::jsonb ->> 'role' IS DISTINCT FROM 'mcp_guest_oauth_worker'
    OR current_setting('request.jwt.claims',true)::jsonb ->> 'merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  RETURN QUERY SELECT r.ciphertext,r.revision,r.expires_at
    FROM public.mcp_guest_oauth_records r
    WHERE r.merchant_id=p_merchant_id AND r.record_key=p_key AND r.expires_at>now();
END $$;
CREATE FUNCTION public.mcp_guest_oauth_cas(p_merchant_id uuid,p_key text,p_revision bigint,p_ciphertext text,p_expires_at timestamptz)
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
REVOKE ALL ON FUNCTION public.mcp_guest_oauth_read(uuid,text) FROM PUBLIC,anon,authenticated;
REVOKE ALL ON FUNCTION public.mcp_guest_oauth_cas(uuid,text,bigint,text,timestamptz) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_guest_oauth_read(uuid,text) TO mcp_guest_oauth_worker;
GRANT EXECUTE ON FUNCTION public.mcp_guest_oauth_cas(uuid,text,bigint,text,timestamptz) TO mcp_guest_oauth_worker;

-- Only expired OAuth records for this worker's tenant; never commerce carts.
CREATE FUNCTION public.mcp_guest_oauth_purge_expired(p_merchant_id uuid)
RETURNS bigint LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE removed bigint;
BEGIN
  IF current_setting('request.jwt.claims',true)::jsonb ->> 'role' IS DISTINCT FROM 'mcp_guest_oauth_worker'
    OR current_setting('request.jwt.claims',true)::jsonb ->> 'merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  DELETE FROM public.mcp_guest_oauth_records r WHERE r.merchant_id=p_merchant_id AND r.record_key IN (
    SELECT e.record_key FROM public.mcp_guest_oauth_records e
    WHERE e.merchant_id=p_merchant_id AND e.expires_at<=now() ORDER BY e.expires_at LIMIT 500
  );
  GET DIAGNOSTICS removed=ROW_COUNT;
  RETURN removed;
END $$;
REVOKE ALL ON FUNCTION public.mcp_guest_oauth_purge_expired(uuid) FROM PUBLIC,anon,authenticated;
GRANT EXECUTE ON FUNCTION public.mcp_guest_oauth_purge_expired(uuid) TO mcp_guest_oauth_worker;

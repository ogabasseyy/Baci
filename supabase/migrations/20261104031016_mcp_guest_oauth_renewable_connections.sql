-- Renewable authorization metadata only. Cart tables, grants and retention are unchanged.
-- Only valid, unexpired revision-matched grants can advance their authorization lease.
-- Owner-approved correction of this unapplied migration: guards never mask drift.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
    WHERE a.attrelid='public.mcp_guest_oauth_records'::regclass
      AND a.attname='renewed_at' AND NOT a.attisdropped)
    AND NOT EXISTS (SELECT 1 FROM pg_catalog.pg_attribute a
      JOIN pg_catalog.pg_attrdef d ON d.adrelid=a.attrelid AND d.adnum=a.attnum
      WHERE a.attrelid='public.mcp_guest_oauth_records'::regclass
        AND a.attname='renewed_at' AND NOT a.attisdropped
        AND a.atttypid='timestamptz'::regtype AND a.attnotnull
        AND pg_catalog.pg_get_expr(d.adbin,d.adrelid)='now()') THEN
    RAISE EXCEPTION 'unexpected_oauth_renewed_at_schema';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint c
    WHERE c.conrelid='public.mcp_guest_oauth_records'::regclass
      AND c.conname='mcp_guest_oauth_records_check' AND c.contype='c'
      AND c.convalidated AND NOT c.connoinherit
      AND regexp_replace(pg_catalog.pg_get_expr(c.conbin,c.conrelid), '[[:space:]()]', '', 'g')
        = 'expires_at<=created_at+''7days''::interval') THEN
    RAISE EXCEPTION 'unexpected_oauth_lifetime_schema';
  END IF;
END $$;
ALTER TABLE public.mcp_guest_oauth_records ADD COLUMN IF NOT EXISTS renewed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.mcp_guest_oauth_records DROP CONSTRAINT IF EXISTS mcp_guest_oauth_records_check;
ALTER TABLE public.mcp_guest_oauth_records ADD CONSTRAINT mcp_guest_oauth_record_lifetime CHECK (
  CASE WHEN record_key LIKE 'grant:%' THEN expires_at <= renewed_at + interval '90 days'
       ELSE expires_at <= created_at + interval '7 days' END
) NOT VALID;
CREATE OR REPLACE FUNCTION public.mcp_guest_oauth_cas(p_merchant_id uuid,p_key text,p_revision bigint,p_ciphertext text,p_expires_at timestamptz)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE changed bigint; is_grant boolean := p_key LIKE 'grant:%';
BEGIN
  IF current_setting('request.jwt.claims',true)::jsonb ->> 'role' IS DISTINCT FROM 'mcp_guest_oauth_worker'
    OR current_setting('request.jwt.claims',true)::jsonb ->> 'merchant_id' IS DISTINCT FROM p_merchant_id::text THEN
    RAISE EXCEPTION 'unauthorized';
  END IF;
  IF p_revision IS NULL OR p_revision < 0 OR p_expires_at IS NULL OR p_expires_at <= now()
    OR p_expires_at > now() + (CASE WHEN is_grant THEN interval '90 days' ELSE interval '7 days' END) THEN
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
    UPDATE public.mcp_guest_oauth_records r SET ciphertext=p_ciphertext,revision=r.revision+1,expires_at=p_expires_at,renewed_at=now()
      WHERE r.merchant_id=p_merchant_id AND r.record_key=p_key AND r.revision=p_revision AND r.expires_at>now()
        AND (is_grant OR p_expires_at<=r.created_at+interval '7 days');
  END IF;
  GET DIAGNOSTICS changed=ROW_COUNT;
  RETURN changed=1;
END $$;

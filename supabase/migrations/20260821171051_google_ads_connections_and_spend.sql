-- Google Ads merchant connections and daily reporting snapshots.
--
-- OAuth access/refresh grants are encrypted by the application before they are
-- written to merchant_ad_connections. This table deliberately does not expose
-- plaintext credentials to browser settings or analytics responses.

CREATE TABLE IF NOT EXISTS public.merchant_ad_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_ads'
    CHECK (provider = 'google_ads'),
  status text NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disconnected', 'error')),
  provider_customer_id text,
  access_token_ciphertext text,
  refresh_token_ciphertext text,
  token_expires_at timestamptz,
  scopes text[] NOT NULL DEFAULT ARRAY[]::text[],
  last_synced_at timestamptz,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_ad_connections_merchant_provider_key
    UNIQUE (merchant_id, provider)
);

CREATE INDEX IF NOT EXISTS merchant_ad_connections_merchant_idx
  ON public.merchant_ad_connections (merchant_id);

CREATE TABLE IF NOT EXISTS public.merchant_ad_spend_daily (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  provider text NOT NULL DEFAULT 'google_ads'
    CHECK (provider = 'google_ads'),
  provider_customer_id text NOT NULL,
  spend_date date NOT NULL,
  currency_code text NOT NULL CHECK (char_length(currency_code) = 3),
  spend_micros bigint NOT NULL DEFAULT 0 CHECK (spend_micros >= 0),
  impressions bigint NOT NULL DEFAULT 0 CHECK (impressions >= 0),
  clicks bigint NOT NULL DEFAULT 0 CHECK (clicks >= 0),
  conversions numeric(20, 6) NOT NULL DEFAULT 0 CHECK (conversions >= 0),
  fetched_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT merchant_ad_spend_daily_merchant_provider_customer_date_key
    UNIQUE (merchant_id, provider, provider_customer_id, spend_date)
);

CREATE INDEX IF NOT EXISTS merchant_ad_spend_daily_lookup_idx
  ON public.merchant_ad_spend_daily
    (merchant_id, provider, spend_date DESC);

ALTER TABLE public.merchant_ad_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.merchant_ad_spend_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS merchant_ad_connections_select ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_select
  ON public.merchant_ad_connections
  FOR SELECT TO authenticated
  USING (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_connections_insert ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_insert
  ON public.merchant_ad_connections
  FOR INSERT TO authenticated
  WITH CHECK (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_connections_update ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_update
  ON public.merchant_ad_connections
  FOR UPDATE TO authenticated
  USING (public.has_merchant_access(merchant_id))
  WITH CHECK (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_connections_delete ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_delete
  ON public.merchant_ad_connections
  FOR DELETE TO authenticated
  USING (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_connections_service_role ON public.merchant_ad_connections;
CREATE POLICY merchant_ad_connections_service_role
  ON public.merchant_ad_connections
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP POLICY IF EXISTS merchant_ad_spend_daily_select ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_select
  ON public.merchant_ad_spend_daily
  FOR SELECT TO authenticated
  USING (public.has_merchant_access(merchant_id));

-- The authenticated sync route only writes rows after it has fetched and
-- normalized them from Google Ads. This tenant policy keeps the write path
-- scoped to the caller's merchant; service-role workers remain supported.
DROP POLICY IF EXISTS merchant_ad_spend_daily_insert ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_insert
  ON public.merchant_ad_spend_daily
  FOR INSERT TO authenticated
  WITH CHECK (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_spend_daily_update ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_update
  ON public.merchant_ad_spend_daily
  FOR UPDATE TO authenticated
  USING (public.has_merchant_access(merchant_id))
  WITH CHECK (public.has_merchant_access(merchant_id));

DROP POLICY IF EXISTS merchant_ad_spend_daily_service_role ON public.merchant_ad_spend_daily;
CREATE POLICY merchant_ad_spend_daily_service_role
  ON public.merchant_ad_spend_daily
  FOR ALL TO service_role
  USING (true)
  WITH CHECK (true);

DROP TRIGGER IF EXISTS merchant_ad_connections_updated_at ON public.merchant_ad_connections;
CREATE TRIGGER merchant_ad_connections_updated_at
  BEFORE UPDATE ON public.merchant_ad_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS merchant_ad_spend_daily_updated_at ON public.merchant_ad_spend_daily;
CREATE TRIGGER merchant_ad_spend_daily_updated_at
  BEFORE UPDATE ON public.merchant_ad_spend_daily
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

REVOKE ALL ON TABLE public.merchant_ad_connections FROM anon;
REVOKE ALL ON TABLE public.merchant_ad_spend_daily FROM anon;
REVOKE ALL ON TABLE public.merchant_ad_connections FROM authenticated;
REVOKE ALL ON TABLE public.merchant_ad_spend_daily FROM authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON TABLE public.merchant_ad_connections TO authenticated;
GRANT SELECT, INSERT, UPDATE ON TABLE public.merchant_ad_spend_daily TO authenticated;
GRANT ALL ON TABLE public.merchant_ad_connections TO service_role;
GRANT ALL ON TABLE public.merchant_ad_spend_daily TO service_role;

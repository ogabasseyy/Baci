-- Preserve the existing proof format; parenthesize JSON extraction before text concatenation.
CREATE OR REPLACE FUNCTION private.verify_shipping_quote_route_proof(
  p_proof jsonb,
  p_action text,
  p_subject_id uuid,
  p_merchant_id uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_secret text;
  v_payload_text text;
  v_canonical text;
  v_expected text;
  v_issued_at timestamptz;
  v_signature text := COALESCE(p_proof->>'signature', '');
BEGIN
  IF p_proof IS NULL
     OR p_action IS NULL OR p_subject_id IS NULL OR p_merchant_id IS NULL
     OR p_proof->>'version' <> 'baci-shipping-quote-proof:v1'
     OR p_proof->>'action' <> p_action
     OR p_proof->>'subject_id' <> p_subject_id::text
     OR p_proof->>'merchant_id' <> p_merchant_id::text
     OR p_proof->>'issued_at' IS NULL
     OR pg_catalog.btrim(p_proof->>'issued_at') = ''
     OR p_proof->>'payload_text' IS NULL
     OR v_signature !~ '^[0-9a-f]{64}$' THEN
    RETURN false;
  END IF;
  BEGIN
    v_issued_at := (p_proof->>'issued_at')::timestamptz;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  IF v_issued_at IS NULL
     OR v_issued_at < pg_catalog.now() - interval '5 minutes'
     OR v_issued_at > pg_catalog.now() + interval '30 seconds' THEN
    RETURN false;
  END IF;
  -- Sign the exact JSON text emitted by the server. This avoids cross-runtime
  -- JSON canonicalization differences and prevents payload substitution.
  v_payload_text := p_proof->>'payload_text';
  BEGIN
    PERFORM v_payload_text::jsonb;
  EXCEPTION WHEN others THEN
    RETURN false;
  END;
  v_canonical := 'baci:shipping-quote-rpc:v1' || E'\n'
    || (p_proof->>'version') || E'\n' || p_action || E'\n'
    || p_subject_id::text || E'\n' || p_merchant_id::text || E'\n'
    || (p_proof->>'issued_at') || E'\n' || v_payload_text;
  IF pg_catalog.to_regclass('vault.decrypted_secrets') IS NOT NULL THEN
    EXECUTE 'SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = $1 LIMIT 1'
      INTO v_secret USING 'service_role_key';
  END IF;
  IF v_secret IS NULL OR pg_catalog.btrim(v_secret) = '' THEN RETURN false; END IF;
  v_expected := pg_catalog.encode(extensions.hmac(v_canonical, v_secret, 'sha256'), 'hex');
  RETURN COALESCE(
    pg_catalog.encode(extensions.digest(v_signature, 'sha256'), 'hex')
      = pg_catalog.encode(extensions.digest(v_expected, 'sha256'), 'hex'),
    false
  );
END;
$$;

REVOKE ALL ON FUNCTION private.verify_shipping_quote_route_proof(jsonb, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated;


-- Normal caller clients only. A server proof binds the provider response; no
-- anonymous table writes, new role, cart, order, payment or booking authority.
CREATE OR REPLACE FUNCTION public.persist_storefront_shipping_quote(p_quote jsonb,p_route_proof jsonb)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_quote public.shipping_quotes%ROWTYPE;
  v_existing public.shipping_quotes%ROWTYPE;
BEGIN
  IF pg_column_size(p_route_proof)>40960 OR jsonb_typeof(p_quote) IS DISTINCT FROM 'object' OR pg_column_size(p_quote)>32768
     OR EXISTS(SELECT 1 FROM jsonb_object_keys(p_quote) k WHERE k NOT IN
       ('id','merchant_id','session_id','provider','service_tier','carrier_name','price','provider_cost','platform_margin','platform_margin_bps','pricing_version','currency','estimated_days','min_days','max_days','pickup_included','insurance_included','is_station_pickup','station_name','station_address','provider_rate_id','provider_metadata','expires_at','quote_request')) THEN
    RAISE EXCEPTION 'invalid_quote_payload' USING ERRCODE='42501';
  END IF;
  BEGIN
    SELECT * INTO v_quote FROM jsonb_populate_record(NULL::public.shipping_quotes,p_quote);
  EXCEPTION WHEN others THEN
    RAISE EXCEPTION 'invalid_quote_payload' USING ERRCODE='42501';
  END;
  IF private.verify_shipping_quote_route_proof(p_route_proof,'persist_storefront_shipping_quote',v_quote.id,v_quote.merchant_id) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object('quote',p_quote) THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE='42501';
  END IF;
  IF v_quote.merchant_id IS NULL OR v_quote.id IS NULL OR v_quote.session_id IS NULL
     OR length(v_quote.session_id) NOT BETWEEN 1 AND 200
     OR v_quote.provider IS NULL OR v_quote.provider NOT IN ('GIGL','TOPSHIP')
     OR v_quote.currency IS DISTINCT FROM 'NGN'
     OR v_quote.price IS NULL OR v_quote.price NOT BETWEEN 0 AND 1000000000
     OR v_quote.expires_at IS NULL OR v_quote.expires_at<=now() OR v_quote.expires_at>now()+interval '24 hours'
     OR jsonb_typeof(v_quote.quote_request) IS DISTINCT FROM 'object'
     OR v_quote.quote_request->>'merchantId' IS DISTINCT FROM v_quote.merchant_id::text
     OR v_quote.quote_request->>'sessionId' IS DISTINCT FROM v_quote.session_id
     OR NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=v_quote.merchant_id AND (m.is_published IS TRUE OR public.has_merchant_access(m.id))) THEN
    RAISE EXCEPTION 'invalid_scoped_shipping_quote' USING ERRCODE='42501';
  END IF;
  INSERT INTO public.shipping_quotes(id,merchant_id,session_id,provider,service_tier,carrier_name,price,provider_cost,platform_margin,platform_margin_bps,pricing_version,currency,estimated_days,min_days,max_days,pickup_included,insurance_included,is_station_pickup,station_name,station_address,provider_rate_id,provider_metadata,expires_at,quote_request)
  VALUES(v_quote.id,v_quote.merchant_id,v_quote.session_id,v_quote.provider,v_quote.service_tier,v_quote.carrier_name,v_quote.price,v_quote.provider_cost,v_quote.platform_margin,v_quote.platform_margin_bps,v_quote.pricing_version,v_quote.currency,v_quote.estimated_days,v_quote.min_days,v_quote.max_days,v_quote.pickup_included,v_quote.insurance_included,v_quote.is_station_pickup,v_quote.station_name,v_quote.station_address,v_quote.provider_rate_id,v_quote.provider_metadata,v_quote.expires_at,v_quote.quote_request)
  ON CONFLICT(id) DO NOTHING;
  IF NOT FOUND THEN
    SELECT * INTO v_existing FROM public.shipping_quotes WHERE id=v_quote.id FOR UPDATE;
    IF v_existing.used IS TRUE OR v_existing.expires_at IS DISTINCT FROM v_quote.expires_at
       OR (to_jsonb(v_existing)-ARRAY['expires_at','created_at','used']) IS DISTINCT FROM (to_jsonb(v_quote)-ARRAY['expires_at','created_at','used']) THEN
      RAISE EXCEPTION 'quote_identity_conflict' USING ERRCODE='23505';
    END IF;
  END IF;
  RETURN v_quote.id;
END;
$$;
REVOKE ALL ON FUNCTION public.persist_storefront_shipping_quote(jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.persist_storefront_shipping_quote(jsonb,jsonb) TO anon,authenticated;

CREATE OR REPLACE FUNCTION public.read_storefront_shipping_quotes(p_merchant_id uuid,p_session_id text,p_request_id uuid,p_route_proof jsonb)
RETURNS TABLE(id uuid,session_id text,provider text,service_tier text,carrier_name text,estimated_days integer,min_days integer,max_days integer,price numeric,currency text,pickup_included boolean,insurance_included boolean,is_station_pickup boolean,station_name text,station_address text,provider_rate_id text,expires_at timestamptz)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_column_size(p_route_proof)>40960 OR p_session_id IS NULL OR length(p_session_id) NOT BETWEEN 1 AND 200
     OR private.verify_shipping_quote_route_proof(p_route_proof,'read_storefront_shipping_quotes',p_request_id,p_merchant_id) IS DISTINCT FROM true
     OR (p_route_proof->>'payload_text')::jsonb IS DISTINCT FROM jsonb_build_object('merchant_id',p_merchant_id,'session_id',p_session_id)
     OR NOT EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id AND (m.is_published IS TRUE OR public.has_merchant_access(m.id))) THEN
    RAISE EXCEPTION 'invalid_shipping_quote_route_proof' USING ERRCODE='42501';
  END IF;
  RETURN QUERY SELECT q.id,q.session_id,q.provider,q.service_tier,q.carrier_name,q.estimated_days,q.min_days,q.max_days,q.price,q.currency,q.pickup_included,q.insurance_included,q.is_station_pickup,q.station_name,q.station_address,q.provider_rate_id,q.expires_at
    FROM public.shipping_quotes q WHERE q.merchant_id=p_merchant_id AND q.session_id=p_session_id AND q.expires_at>now() AND q.used IS NOT TRUE ORDER BY q.price,q.id LIMIT 30;
END;
$$;
REVOKE ALL ON FUNCTION public.read_storefront_shipping_quotes(uuid,text,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.read_storefront_shipping_quotes(uuid,text,uuid,jsonb) TO anon,authenticated;
CREATE INDEX IF NOT EXISTS shipping_quotes_merchant_session_expiry_idx ON public.shipping_quotes(merchant_id,session_id,expires_at);
COMMENT ON FUNCTION public.persist_storefront_shipping_quote(jsonb,jsonb) IS 'Immutable provider quote only, through normal caller auth with existing short-lived server attestation; no order or booking effect.';

-- Read-only readiness proof: a missing/mismatched Vault key is detected before
-- a carrier request, without granting the caller access to that key.
CREATE OR REPLACE FUNCTION public.storefront_shipping_quote_storage_ready(p_merchant_id uuid,p_request_id uuid,p_route_proof jsonb)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF pg_column_size(p_route_proof)>40960 THEN RETURN false; END IF;
  RETURN private.verify_shipping_quote_route_proof(p_route_proof,'storefront_shipping_quote_storage_ready',p_request_id,p_merchant_id) IS TRUE
     AND (p_route_proof->>'payload_text')::jsonb=jsonb_build_object('merchant_id',p_merchant_id)
     AND EXISTS(SELECT 1 FROM public.merchants m WHERE m.id=p_merchant_id AND (m.is_published IS TRUE OR public.has_merchant_access(m.id)));
END;
$$;
REVOKE ALL ON FUNCTION public.storefront_shipping_quote_storage_ready(uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_shipping_quote_storage_ready(uuid,uuid,jsonb) TO anon,authenticated;

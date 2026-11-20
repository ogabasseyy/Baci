-- Partner checkout quotes remain outside the storefront quote pool until
-- a verified paid order claims the quote and establishes booking authority.
CREATE TABLE private.partner_delivery_quotes (
  id uuid PRIMARY KEY,
  merchant_id uuid NOT NULL REFERENCES public.merchants (id),
  connection_id text NOT NULL CHECK (connection_id ~ '^[a-z0-9][a-z0-9_-]{0,79}$'),
  expires_at timestamptz NOT NULL,
  snapshot jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS partner_delivery_quotes_merchant_id_idx
  ON private.partner_delivery_quotes (merchant_id);

ALTER TABLE private.partner_delivery_quotes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.partner_delivery_quotes FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION public.persist_partner_delivery_quote(
  p_quote_id uuid,
  p_merchant_id uuid,
  p_connection_id text,
  p_expires_at timestamptz,
  p_snapshot jsonb,
  p_route_proof jsonb
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_payload jsonb;
BEGIN
  IF p_quote_id IS NULL OR p_merchant_id IS NULL
     OR p_connection_id IS NULL OR p_connection_id !~ '^[a-z0-9][a-z0-9_-]{0,79}$'
     OR p_expires_at IS NULL OR p_expires_at <= pg_catalog.now()
     OR p_expires_at > pg_catalog.now() + interval '1 hour'
     OR pg_catalog.jsonb_typeof(p_snapshot) IS DISTINCT FROM 'object'
     OR pg_catalog.pg_column_size(p_snapshot) > 32768
     OR pg_catalog.pg_column_size(p_route_proof) > 65536 THEN
    RAISE EXCEPTION 'invalid_partner_quote' USING ERRCODE = '22023';
  END IF;

  IF private.verify_shipping_quote_route_proof(
       p_route_proof, 'persist_partner_delivery_quote', p_quote_id, p_merchant_id
     ) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'invalid_partner_quote_proof' USING ERRCODE = '42501';
  END IF;

  v_payload := (p_route_proof->>'payload_text')::jsonb;
  IF v_payload->>'expires_at' IS NULL
     OR (v_payload->>'expires_at')::timestamptz IS DISTINCT FROM p_expires_at
     OR v_payload - 'expires_at' IS DISTINCT FROM pg_catalog.jsonb_build_object(
       'connection_id', p_connection_id, 'snapshot', p_snapshot
     ) THEN
    RAISE EXCEPTION 'invalid_partner_quote_proof' USING ERRCODE = '42501';
  END IF;

  INSERT INTO private.partner_delivery_quotes (
    id, merchant_id, connection_id, expires_at, snapshot
  ) VALUES (
    p_quote_id, p_merchant_id, p_connection_id, p_expires_at, p_snapshot
  )
  ON CONFLICT (id) DO NOTHING;

  IF NOT FOUND AND NOT EXISTS (
    SELECT 1 FROM private.partner_delivery_quotes AS stored
    WHERE stored.id = p_quote_id
      AND stored.merchant_id = p_merchant_id
      AND stored.connection_id = p_connection_id
      AND stored.expires_at = p_expires_at
      AND stored.snapshot = p_snapshot
  ) THEN
    RAISE EXCEPTION 'partner_quote_identity_conflict' USING ERRCODE = '23505';
  END IF;
  RETURN p_quote_id;
END;
$$;

REVOKE ALL ON FUNCTION public.persist_partner_delivery_quote(uuid, uuid, text, timestamptz, jsonb, jsonb)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.persist_partner_delivery_quote(uuid, uuid, text, timestamptz, jsonb, jsonb)
  TO anon, authenticated;

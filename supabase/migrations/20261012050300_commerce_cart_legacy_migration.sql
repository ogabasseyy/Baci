-- Legacy MCP/UCP migration: hash/fence columns plus triggers on the legacy
-- tables (additive; old rows preserved), the atomic migrate RPC, and the
-- MCP fence lookup. The fence triggers block UPDATEs to migrated legacy
-- rows for every writer; retention DELETEs stay allowed.
ALTER TABLE public.mcp_guest_carts
  ADD COLUMN IF NOT EXISTS token_hash text NULL;
ALTER TABLE public.mcp_guest_carts
  ADD COLUMN IF NOT EXISTS migrated_to_cart_id uuid NULL;
ALTER TABLE public.agentic_cart_sessions
  ADD COLUMN IF NOT EXISTS cart_id_hash text NULL;
ALTER TABLE public.agentic_cart_sessions
  ADD COLUMN IF NOT EXISTS migrated_to_cart_id uuid NULL;

CREATE OR REPLACE FUNCTION public.mcp_guest_cart_maintain_token_hash()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.token_hash := encode(pg_catalog.sha256(NEW.token::bytea), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mcp_guest_carts_token_hash_trg ON public.mcp_guest_carts;
CREATE TRIGGER mcp_guest_carts_token_hash_trg
  BEFORE INSERT OR UPDATE OF token ON public.mcp_guest_carts
  FOR EACH ROW EXECUTE FUNCTION public.mcp_guest_cart_maintain_token_hash();

CREATE OR REPLACE FUNCTION public.agentic_cart_maintain_cart_id_hash()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  NEW.cart_id_hash := encode(pg_catalog.sha256(NEW.cart_id::bytea), 'hex');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS agentic_cart_sessions_hash_trg ON public.agentic_cart_sessions;
CREATE TRIGGER agentic_cart_sessions_hash_trg
  BEFORE INSERT OR UPDATE OF cart_id ON public.agentic_cart_sessions
  FOR EACH ROW EXECUTE FUNCTION public.agentic_cart_maintain_cart_id_hash();

UPDATE public.mcp_guest_carts
SET token_hash = encode(pg_catalog.sha256(token::bytea), 'hex')
WHERE token_hash IS NULL;
UPDATE public.agentic_cart_sessions
SET cart_id_hash = encode(pg_catalog.sha256(cart_id::bytea), 'hex')
WHERE cart_id_hash IS NULL;

CREATE INDEX IF NOT EXISTS mcp_guest_carts_token_hash_idx
  ON public.mcp_guest_carts (token_hash);
CREATE INDEX IF NOT EXISTS agentic_cart_sessions_cart_id_hash_idx
  ON public.agentic_cart_sessions (cart_id_hash);

CREATE OR REPLACE FUNCTION public.commerce_cart_block_migrated_write()
RETURNS trigger
LANGUAGE plpgsql SET search_path = ''
AS $$
BEGIN
  IF OLD.migrated_to_cart_id IS NOT NULL THEN
    RAISE EXCEPTION 'migrated cart is read-only' USING ERRCODE = 'P0001';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS mcp_guest_carts_migrated_fence_trg ON public.mcp_guest_carts;
CREATE TRIGGER mcp_guest_carts_migrated_fence_trg
  BEFORE UPDATE ON public.mcp_guest_carts
  FOR EACH ROW EXECUTE FUNCTION public.commerce_cart_block_migrated_write();

DROP TRIGGER IF EXISTS agentic_cart_sessions_migrated_fence_trg ON public.agentic_cart_sessions;
CREATE TRIGGER agentic_cart_sessions_migrated_fence_trg
  BEFORE UPDATE ON public.agentic_cart_sessions
  FOR EACH ROW EXECUTE FUNCTION public.commerce_cart_block_migrated_write();

-- One-shot legacy migration: validates the adapter-mapped lines, fences
-- the legacy row with an optimistic version check, and atomically creates
-- the canonical cart, its single initial grant and the legacy ref.
-- Convergent on (merchant, provider, hash): retries replay the mapping,
-- a second legacy token for an already-migrated principal refreshes.
CREATE OR REPLACE FUNCTION public.commerce_cart_migrate_legacy(
  p_provider text, p_legacy_token_hash text, p_operation_id text,
  p_lines jsonb, p_legacy_version text, p_currency text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_claims jsonb := auth.jwt();
  v_merchant uuid;
  v_principal text;
  v_digest text;
  v_ref public.commerce_cart_legacy_refs%ROWTYPE;
  v_cart_id uuid;
  v_grant_id uuid;
  v_state jsonb;
  v_line jsonb;
  v_product_id uuid;
  v_variant_id uuid;
  v_condition text;
  v_options jsonb;
  v_quantity integer;
  v_voucher_token text;
  v_voucher_award text;
  v_negotiated integer;
  v_neg_status text;
  v_grant_live boolean;
  v_grant_known boolean;
  v_other_cart uuid;
  v_legacy_version_int bigint;
  v_legacy_updated timestamptz;
BEGIN
  IF nullif(v_claims ->> 'cart_merchant_id', '') IS NULL
    OR (v_claims ->> 'cart_merchant_id') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    OR nullif(v_claims ->> 'cart_principal_id', '') IS NULL
    OR (v_claims ->> 'cart_scope') <> 'bootstrap'
    OR (v_claims ->> 'cart_id') IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;
  v_merchant := (v_claims ->> 'cart_merchant_id')::uuid;
  v_principal := v_claims ->> 'cart_principal_id';

  -- Pilot gate (defense in depth with the route-level check): the
  -- shared-cart RPCs refuse merchants without the shared_cart feature,
  -- mirroring the broadcast/account predicates.
  IF NOT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = v_merchant AND m.premium_features @> '["shared_cart"]'::jsonb
  ) THEN
    RETURN jsonb_build_object('ok', false, 'code', 'merchant_unavailable', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  IF p_provider NOT IN ('mcp', 'ucp')
    OR p_legacy_token_hash IS NULL
    OR p_legacy_token_hash !~ '^[a-f0-9]{64}$'
    OR p_operation_id IS NULL OR length(trim(p_operation_id)) = 0 OR length(p_operation_id) > 128
    OR p_currency IS NULL OR p_currency !~ '^[A-Z]{3}$'
    OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) > 20
    OR p_legacy_version IS NULL OR length(trim(p_legacy_version)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('cc-legacy|' || v_merchant::text || '|' || p_provider || '|' || p_legacy_token_hash, 0)
  );

  SELECT * INTO v_ref
  FROM public.commerce_cart_legacy_refs
  WHERE merchant_id = v_merchant AND provider = p_provider AND legacy_hash = p_legacy_token_hash;
  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1 FROM public.commerce_cart_grants g
      WHERE g.cart_id = v_ref.cart_id AND g.merchant_id = v_merchant
        AND g.principal_id = v_principal AND g.expires_at > now() AND g.revoked_at IS NULL
    ) INTO v_grant_live;
    IF NOT coalesce(v_grant_live, false) THEN
      SELECT EXISTS (
        SELECT 1 FROM public.commerce_cart_grants g
        WHERE g.cart_id = v_ref.cart_id AND g.principal_id = v_principal
      ) INTO v_grant_known;
      IF coalesce(v_grant_known, false) THEN
        RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'unauthorized', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    SELECT public.commerce_cart_assemble_state(v_merchant, v_ref.cart_id) INTO v_state;
    IF v_state IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'code', 'expired', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', true, 'state', v_state,
      'currentVersion', (v_state ->> 'version')::integer);
  END IF;

  SELECT r.cart_id INTO v_other_cart
  FROM public.commerce_cart_legacy_refs r
  JOIN public.commerce_cart_grants g
    ON g.cart_id = r.cart_id AND g.merchant_id = r.merchant_id
  WHERE r.merchant_id = v_merchant
    AND g.principal_id = v_principal
    AND g.expires_at > now() AND g.revoked_at IS NULL
    AND (r.provider, r.legacy_hash) <> (p_provider, p_legacy_token_hash)
  LIMIT 1;
  IF v_other_cart IS NOT NULL THEN
    SELECT public.commerce_cart_assemble_state(v_merchant, v_other_cart) INTO v_state;
    RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false,
      'state', v_state, 'currentVersion',
      CASE WHEN v_state IS NULL THEN NULL ELSE (v_state ->> 'version')::integer END);
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_class c
    JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
    WHERE c.relname = 'cart_migrate_want' AND n.nspname LIKE 'pg_temp%'
  ) THEN
    DROP TABLE cart_migrate_want;
  END IF;
  CREATE TEMPORARY TABLE cart_migrate_want (
    product_id uuid, variant_id uuid, condition text, options jsonb,
    quantity integer, voucher_token text, voucher_award uuid,
    negotiated integer, neg_status text
  ) ON COMMIT DROP;
  FOR v_line IN SELECT value FROM jsonb_array_elements(p_lines) value LOOP
    SELECT pi_product, pi_variant, pi_condition, pi_options, pi_quantity,
      pi_voucher_token, pi_voucher_award, pi_negotiated, pi_neg_status
    INTO v_product_id, v_variant_id, v_condition, v_options, v_quantity,
      v_voucher_token, v_voucher_award, v_negotiated, v_neg_status
    FROM public.commerce_cart_parse_input_line(v_line);
    IF v_product_id IS NULL THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    PERFORM public.commerce_cart_require_offer(v_merchant, v_product_id, v_variant_id);
    UPDATE cart_migrate_want w
    SET quantity = w.quantity + v_quantity
    WHERE w.product_id = v_product_id
      AND w.variant_id IS NOT DISTINCT FROM v_variant_id
      AND w.condition IS NOT DISTINCT FROM v_condition
      AND w.options = v_options
      AND w.voucher_token IS NOT DISTINCT FROM v_voucher_token
      AND w.voucher_award IS NOT DISTINCT FROM v_voucher_award::uuid;
    IF NOT FOUND THEN
      INSERT INTO cart_migrate_want VALUES (
        v_product_id, v_variant_id, v_condition, v_options, v_quantity,
        v_voucher_token, v_voucher_award::uuid, v_negotiated,
        CASE WHEN v_negotiated IS NOT NULL AND v_neg_status IS NULL THEN 'accepted' ELSE v_neg_status END
      );
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM cart_migrate_want WHERE quantity > 10) THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;
  SELECT count(*) INTO v_legacy_version_int FROM cart_migrate_want;
  IF v_legacy_version_int > 20 THEN
    RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
  END IF;

  v_cart_id := pg_catalog.gen_random_uuid();
  IF p_provider = 'mcp' THEN
    IF p_legacy_version !~ '^[0-9]+$' THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END IF;
    UPDATE public.mcp_guest_carts
    SET migrated_to_cart_id = v_cart_id
    WHERE token_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND version = p_legacy_version::bigint;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.mcp_guest_carts WHERE token_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  ELSE
    BEGIN
      v_legacy_updated := p_legacy_version::timestamptz;
    EXCEPTION WHEN invalid_datetime_format OR datetime_field_overflow THEN
      RAISE EXCEPTION 'invalid_line' USING ERRCODE = 'P0001';
    END;
    UPDATE public.agentic_cart_sessions
    SET migrated_to_cart_id = v_cart_id
    WHERE cart_id_hash = p_legacy_token_hash
      AND migrated_to_cart_id IS NULL
      AND updated_at = v_legacy_updated;
    IF NOT FOUND THEN
      PERFORM 1 FROM public.agentic_cart_sessions WHERE cart_id_hash = p_legacy_token_hash;
      IF NOT FOUND THEN
        RETURN jsonb_build_object('ok', false, 'code', 'not_found', 'replayed', false, 'state', null, 'currentVersion', null);
      END IF;
      RETURN jsonb_build_object('ok', false, 'code', 'refresh_required', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
  END IF;

  INSERT INTO public.commerce_carts (id, merchant_id, currency, version, state, expires_at)
  VALUES (v_cart_id, v_merchant, p_currency, 1, 'active', now() + interval '7 days');

  v_grant_id := pg_catalog.gen_random_uuid();
  INSERT INTO public.commerce_cart_grants (id, merchant_id, cart_id, principal_id, principal_type, expires_at)
  VALUES (v_grant_id, v_merchant, v_cart_id, v_principal, 'guest', now() + interval '7 days');

  INSERT INTO public.commerce_cart_lines (
    merchant_id, cart_id, product_id, variant_id, condition, options, quantity,
    negotiated_unit_price_minor, negotiation_status, voucher_token, voucher_award_id,
    last_unit_price_minor
  )
  SELECT v_merchant, v_cart_id, w.product_id, w.variant_id, w.condition, w.options,
    CASE WHEN w.voucher_token IS NOT NULL OR w.voucher_award IS NOT NULL THEN 1 ELSE w.quantity END,
    w.negotiated, w.neg_status, w.voucher_token, w.voucher_award,
    public.commerce_cart_offer_price_minor(v_merchant, w.product_id, w.variant_id)
  FROM cart_migrate_want w;
  DROP TABLE cart_migrate_want;

  v_digest := pg_catalog.md5(p_provider || '|' || p_legacy_token_hash || '|' || p_lines::text || '|' || p_currency);
  INSERT INTO public.commerce_cart_legacy_refs (merchant_id, provider, legacy_hash, cart_id, receipt)
  VALUES (v_merchant, p_provider, p_legacy_token_hash, v_cart_id,
    jsonb_build_object('operation_id', p_operation_id, 'digest', v_digest,
      'legacy_version', p_legacy_version, 'migrated_at', now()));

  SELECT public.commerce_cart_assemble_state(v_merchant, v_cart_id) INTO v_state;
  RETURN jsonb_build_object('ok', true, 'code', null, 'replayed', false, 'state', v_state, 'currentVersion', 1);
EXCEPTION
  WHEN raise_exception THEN
    IF SQLERRM = 'invalid_line' OR SQLERRM = 'invalid_offer' THEN
      RETURN jsonb_build_object('ok', false, 'code', 'invalid_item', 'replayed', false, 'state', null, 'currentVersion', null);
    END IF;
    RAISE;
END;
$$;

ALTER FUNCTION public.commerce_cart_migrate_legacy(text, text, text, jsonb, text, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.commerce_cart_migrate_legacy(text, text, text, jsonb, text, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.commerce_cart_migrate_legacy(text, text, text, jsonb, text, text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.commerce_cart_migrate_legacy(text, text, text, jsonb, text, text) TO commerce_cart_shopper;
ALTER FUNCTION public.mcp_guest_cart_maintain_token_hash() OWNER TO postgres;
ALTER FUNCTION public.agentic_cart_maintain_cart_id_hash() OWNER TO postgres;
ALTER FUNCTION public.commerce_cart_block_migrated_write() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.mcp_guest_cart_maintain_token_hash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.agentic_cart_maintain_cart_id_hash() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.commerce_cart_block_migrated_write() FROM PUBLIC;

-- Fence lookup for the MCP store: returns the canonical cart id when the
-- legacy token has migrated, else a single NULL row.
CREATE OR REPLACE FUNCTION public.get_mcp_guest_cart_migration(p_token text)
RETURNS TABLE (migrated_to_cart_id uuid)
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  IF p_token IS NULL OR p_token !~ '^[a-f0-9]{64}$' THEN
    RAISE EXCEPTION USING ERRCODE = '22023', MESSAGE = 'invalid guest cart token';
  END IF;
  RETURN QUERY
  SELECT c.migrated_to_cart_id FROM public.mcp_guest_carts c WHERE c.token = p_token;
  IF NOT FOUND THEN
    migrated_to_cart_id := NULL;
    RETURN NEXT;
  END IF;
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'mcp_guest_cart_worker') THEN
    CREATE ROLE mcp_guest_cart_worker NOLOGIN NOINHERIT NOSUPERUSER NOBYPASSRLS;
  END IF;
END
$$;

ALTER FUNCTION public.get_mcp_guest_cart_migration(text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.get_mcp_guest_cart_migration(text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.get_mcp_guest_cart_migration(text) FROM anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mcp_guest_cart_migration(text) TO mcp_guest_cart_worker;

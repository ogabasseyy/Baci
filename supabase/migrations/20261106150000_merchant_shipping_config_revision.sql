-- Monotonic merchant-wide shipping configuration revision.
--
-- Config writers update this row in the same transaction as their config DML.
-- The storefront projection takes FOR SHARE on the row in a VOLATILE RPC,
-- then reads the config. Under READ COMMITTED, a reader that waits for a
-- writer sees that writer's committed configuration in the following SQL
-- commands. No global/advisory lock is used. Revision is not yet consumed by
-- the order binder; this migration alone does not attest a checkout quote.
CREATE TABLE IF NOT EXISTS public.merchant_shipping_config_revisions (
  merchant_id uuid PRIMARY KEY,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.merchant_shipping_config_revisions ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.merchant_shipping_config_revisions
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.bump_merchant_shipping_config_revision(
  p_first uuid,
  p_second uuid DEFAULT NULL
) RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_merchant uuid;
BEGIN
  -- Sorted row updates make a single reassignment acquire the old/new mutexes
  -- in deterministic order. A PostgreSQL deadlock/serialization error aborts
  -- the entire config statement; callers must not retry it blindly.
  FOR v_merchant IN
    SELECT DISTINCT candidate.merchant_id
    FROM (VALUES (p_first), (p_second)) AS candidate(merchant_id)
    WHERE candidate.merchant_id IS NOT NULL
    ORDER BY candidate.merchant_id
  LOOP
    -- Child FK cascades can fire after the merchant row is deleted. Never
    -- recreate a deleted merchant's revision while those rows are removed.
    IF NOT EXISTS (SELECT 1 FROM public.merchants m WHERE m.id = v_merchant) THEN
      CONTINUE;
    END IF;
    INSERT INTO public.merchant_shipping_config_revisions (merchant_id, revision, updated_at)
      VALUES (v_merchant, 2, now())
      ON CONFLICT (merchant_id) DO UPDATE
        SET revision = public.merchant_shipping_config_revisions.revision + 1,
            updated_at = now();
  END LOOP;
END;
$$;
ALTER FUNCTION private.bump_merchant_shipping_config_revision(uuid, uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION private.bump_merchant_shipping_config_revision(uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.track_shipping_config_row_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_old uuid;
  v_new uuid;
BEGIN
  IF TG_TABLE_NAME = 'merchants' THEN
    IF OLD.country IS NOT DISTINCT FROM NEW.country
      AND OLD.payout_currency IS NOT DISTINCT FROM NEW.payout_currency THEN
      RETURN NEW;
    END IF;
    v_old := OLD.id;
    v_new := NEW.id;
  ELSIF TG_TABLE_NAME = 'merchant_feature_settings' THEN
    IF TG_OP = 'UPDATE'
      AND OLD.shipping_providers IS NOT DISTINCT FROM NEW.shipping_providers THEN
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN v_old := OLD.merchant_id; ELSE v_new := NEW.merchant_id; END IF;
  ELSIF TG_OP = 'INSERT' THEN
    v_new := NEW.merchant_id;
  ELSIF TG_OP = 'DELETE' THEN
    v_old := OLD.merchant_id;
  ELSE
    v_old := OLD.merchant_id;
    v_new := NEW.merchant_id;
  END IF;

  PERFORM private.bump_merchant_shipping_config_revision(v_old, v_new);
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.track_shipping_config_row_change() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.track_shipping_config_row_change()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.initialize_merchant_shipping_config_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.merchant_shipping_config_revisions (merchant_id, revision)
  VALUES (NEW.id, 1)
  ON CONFLICT (merchant_id) DO NOTHING;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.initialize_merchant_shipping_config_revision() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.initialize_merchant_shipping_config_revision()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.cleanup_merchant_shipping_config_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  DELETE FROM public.merchant_shipping_config_revisions WHERE merchant_id = OLD.id;
  RETURN OLD;
END;
$$;
ALTER FUNCTION private.cleanup_merchant_shipping_config_revision() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.cleanup_merchant_shipping_config_revision()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS initialize_merchant_shipping_config_revision ON public.merchants;
CREATE TRIGGER initialize_merchant_shipping_config_revision
  AFTER INSERT ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION private.initialize_merchant_shipping_config_revision();
-- Install the seed trigger before backfill. CREATE TRIGGER waits for in-flight
-- merchant writers; once it completes, this backfill includes any merchant
-- whose insert committed while trigger installation waited.
INSERT INTO public.merchant_shipping_config_revisions (merchant_id, revision)
SELECT id, 1 FROM public.merchants
ON CONFLICT (merchant_id) DO NOTHING;
DROP TRIGGER IF EXISTS track_merchant_shipping_currency_revision ON public.merchants;
CREATE TRIGGER track_merchant_shipping_currency_revision
  AFTER UPDATE OF country, payout_currency ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION private.track_shipping_config_row_change();
DROP TRIGGER IF EXISTS cleanup_merchant_shipping_config_revision ON public.merchants;
CREATE TRIGGER cleanup_merchant_shipping_config_revision
  BEFORE DELETE ON public.merchants
  FOR EACH ROW EXECUTE FUNCTION private.cleanup_merchant_shipping_config_revision();

DROP TRIGGER IF EXISTS track_shipping_zone_config_revision ON public.merchant_shipping_zones;
CREATE TRIGGER track_shipping_zone_config_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_shipping_zones
  FOR EACH ROW EXECUTE FUNCTION private.track_shipping_config_row_change();
DROP TRIGGER IF EXISTS track_shipping_location_config_revision ON public.merchant_shipping_zone_locations;
CREATE TRIGGER track_shipping_location_config_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_shipping_zone_locations
  FOR EACH ROW EXECUTE FUNCTION private.track_shipping_config_row_change();
DROP TRIGGER IF EXISTS track_shipping_rate_config_revision ON public.merchant_shipping_rates;
CREATE TRIGGER track_shipping_rate_config_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_shipping_rates
  FOR EACH ROW EXECUTE FUNCTION private.track_shipping_config_row_change();
DROP TRIGGER IF EXISTS track_merchant_shipping_provider_revision ON public.merchant_feature_settings;
CREATE TRIGGER track_merchant_shipping_provider_revision
  AFTER INSERT OR UPDATE OR DELETE ON public.merchant_feature_settings
  FOR EACH ROW EXECUTE FUNCTION private.track_shipping_config_row_change();

-- This VOLATILE function first takes a shared merchant revision row lock.
-- Same-merchant quote readers remain concurrent; config writers' revision
-- UPDATE conflicts with these shared locks. Every
-- subsequent query gets a fresh READ COMMITTED snapshot after any lock wait,
-- so rates, locations, merchant country/currency, providers and revision are
-- serialized with config writers without a global lock.
CREATE OR REPLACE FUNCTION public.get_storefront_shipping_rates(p_merchant_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_revision bigint;
  v_result jsonb;
BEGIN
  PERFORM 1 FROM public.merchants m WHERE m.id = p_merchant_id FOR KEY SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipping_merchant_not_found';
  END IF;

  SELECT r.revision INTO v_revision
  FROM public.merchant_shipping_config_revisions r
  WHERE r.merchant_id = p_merchant_id
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'shipping_config_revision_missing';
  END IF;

  SELECT jsonb_build_object(
    'zones', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', z.id, 'name', z.name, 'is_rest_of_world', z.is_rest_of_world
      ) ORDER BY z.is_rest_of_world, z.name)
      FROM public.merchant_shipping_zones z
      WHERE z.merchant_id = p_merchant_id AND z.active
    ), '[]'::jsonb),
    'locations', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'zone_id', l.zone_id, 'country_code', l.country_code,
        'subdivision_code', l.subdivision_code
      ) ORDER BY l.country_code, l.subdivision_code)
      FROM public.merchant_shipping_zone_locations l
      JOIN public.merchant_shipping_zones z ON z.id = l.zone_id
      WHERE z.merchant_id = p_merchant_id AND z.active
    ), '[]'::jsonb),
    'rates', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', r.id, 'zone_id', r.zone_id, 'name', r.name, 'kind', r.kind,
        'currency', r.currency, 'base_amount', r.base_amount,
        'condition_type', r.condition_type, 'min_subtotal', r.min_subtotal,
        'max_subtotal', r.max_subtotal, 'free_over_amount', r.free_over_amount,
        'delivery_min_days', r.delivery_min_days,
        'delivery_max_days', r.delivery_max_days,
        'pickup_address', r.pickup_address, 'sort_order', r.sort_order
      ) ORDER BY r.sort_order, r.base_amount, r.id)
      FROM public.merchant_shipping_rates r
      JOIN public.merchant_shipping_zones z ON z.id = r.zone_id
      WHERE r.merchant_id = p_merchant_id AND r.active AND z.active
    ), '[]'::jsonb),
    'merchant_payout_currency', (SELECT m.payout_currency FROM public.merchants m WHERE m.id = p_merchant_id),
    'merchant_country', (SELECT m.country FROM public.merchants m WHERE m.id = p_merchant_id),
    'shipping_providers', COALESCE((
      SELECT jsonb_agg(provider.provider ORDER BY provider.first_position)
      FROM (
        SELECT lower(btrim(entry.value)) AS provider,
          min(entry.ordinality) AS first_position
        FROM public.merchant_feature_settings fs
        CROSS JOIN LATERAL jsonb_array_elements_text(
          CASE
            WHEN jsonb_typeof(fs.shipping_providers) = 'array'
              THEN fs.shipping_providers
            ELSE '[]'::jsonb
          END
        ) WITH ORDINALITY AS entry(value, ordinality)
        WHERE fs.merchant_id = p_merchant_id
          AND lower(btrim(entry.value)) = ANY (
            private.supported_carrier_provider_ids()
          )
        GROUP BY lower(btrim(entry.value))
      ) AS provider
    ), '[]'::jsonb),
    'shipping_config_revision', v_revision::text
  ) INTO v_result;
  RETURN v_result;
END;
$$;

COMMENT ON FUNCTION public.get_storefront_shipping_rates(uuid) IS
  'Returns checkout-safe shipping config serialized with its merchant revision row; does not by itself attest an order checkout.';
REVOKE ALL ON FUNCTION public.get_storefront_shipping_rates(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_storefront_shipping_rates(uuid) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';

-- REDVAULT is a private Ogabassey-only payment-bound discount. This migration
-- deliberately creates no merchant activation path and defaults runtime off.

CREATE TABLE IF NOT EXISTS private.uba_redvault_runtime (
  partnership text PRIMARY KEY CHECK (partnership = 'uba_redvault'),
  enabled boolean NOT NULL DEFAULT false,
  commercial_terms_confirmed boolean NOT NULL DEFAULT false,
  commercial_terms jsonb,
  updated_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);

INSERT INTO private.uba_redvault_runtime (partnership)
VALUES ('uba_redvault')
ON CONFLICT (partnership) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.uba_redvault_discount_binding (
  discount_code_id uuid PRIMARY KEY REFERENCES public.discount_codes(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL CHECK (merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid),
  partnership text NOT NULL CHECK (partnership = 'uba_redvault'),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now()
);
CREATE UNIQUE INDEX IF NOT EXISTS uba_redvault_one_binding ON private.uba_redvault_discount_binding(merchant_id, partnership);
CREATE INDEX IF NOT EXISTS uba_redvault_discount_binding_merchant_id_idx
  ON private.uba_redvault_discount_binding (merchant_id);

CREATE OR REPLACE FUNCTION private.validate_redvault_discount_binding()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'INSERT' THEN RAISE EXCEPTION 'redvault_discount_binding_is_immutable'; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.discount_codes WHERE id = NEW.discount_code_id AND merchant_id = NEW.merchant_id AND discount_type = 'percentage' AND discount_value = 5) THEN RAISE EXCEPTION 'redvault_binding_invalid'; END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION private.validate_redvault_discount_binding() FROM PUBLIC, anon, authenticated, service_role;
ALTER FUNCTION private.validate_redvault_discount_binding() OWNER TO postgres;
CREATE TRIGGER validate_redvault_discount_binding BEFORE INSERT OR UPDATE OR DELETE ON private.uba_redvault_discount_binding
  FOR EACH ROW EXECUTE FUNCTION private.validate_redvault_discount_binding();

CREATE TABLE IF NOT EXISTS private.uba_redvault_applications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL UNIQUE REFERENCES public.orders(id) ON DELETE RESTRICT,
  discount_code_id uuid NOT NULL REFERENCES public.discount_codes(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL,
  quote_version_id uuid NOT NULL UNIQUE,
  quote_payload_hash text NOT NULL CHECK (quote_payload_hash ~ '^[0-9a-f]{64}$'),
  quote_payload jsonb NOT NULL,
  proof_context jsonb NOT NULL DEFAULT '{}'::jsonb,
  customer_email text NOT NULL,
  user_id uuid,
  checkout_key text NOT NULL,
  request_hash text NOT NULL,
  discount_kobo bigint NOT NULL CHECK (discount_kobo > 0),
  eligible_subtotal_kobo bigint NOT NULL CHECK (eligible_subtotal_kobo > 0),
  proof_id text,
  status text NOT NULL CHECK (status IN ('draft', 'pending', 'approved', 'held', 'void')),
  created_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  CHECK (merchant_id = '6b5cb8a4-5575-456c-b936-8cdfae30db74'::uuid)
);
CREATE UNIQUE INDEX IF NOT EXISTS uba_redvault_checkout_key ON private.uba_redvault_applications(merchant_id, customer_email, checkout_key);
CREATE INDEX IF NOT EXISTS uba_redvault_applications_user_id ON private.uba_redvault_applications(user_id);
CREATE INDEX IF NOT EXISTS uba_redvault_applications_discount_code_id_idx
  ON private.uba_redvault_applications (discount_code_id);

CREATE TABLE IF NOT EXISTS private.uba_redvault_line_allocations (
  application_id uuid NOT NULL REFERENCES private.uba_redvault_applications(id) ON DELETE RESTRICT,
  order_item_id uuid NOT NULL REFERENCES public.order_items(id) ON DELETE RESTRICT,
  line_id integer NOT NULL,
  unit_ordinal integer NOT NULL CHECK (unit_ordinal > 0),
  allocation_kobo bigint NOT NULL CHECK (allocation_kobo >= 0),
  product_id uuid NOT NULL,
  variant_id uuid,
  condition text,
  variant_attributes jsonb NOT NULL DEFAULT '{}'::jsonb,
  unit_price_kobo bigint NOT NULL CHECK (unit_price_kobo >= 0),
  vat_category_code text,
  vat_rate_bp integer NOT NULL CHECK (vat_rate_bp >= 0),
  tax_basis text NOT NULL CHECK (tax_basis = 'exclusive'),
  PRIMARY KEY (application_id, order_item_id, unit_ordinal)
);
CREATE INDEX IF NOT EXISTS uba_redvault_line_allocations_order_item_id_idx
  ON private.uba_redvault_line_allocations (order_item_id);

CREATE TABLE IF NOT EXISTS private.redvault_discount_proof_replay (
  proof_id text PRIMARY KEY,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE RESTRICT,
  quote_version_id uuid NOT NULL,
  merchant_id uuid NOT NULL,
  consumed_at timestamptz NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (order_id, quote_version_id, payload_hash)
);
CREATE INDEX IF NOT EXISTS redvault_discount_proof_replay_order_id_idx
  ON private.redvault_discount_proof_replay (order_id);

ALTER TABLE private.uba_redvault_runtime ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uba_redvault_discount_binding ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uba_redvault_applications ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.uba_redvault_line_allocations ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.redvault_discount_proof_replay ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE private.uba_redvault_runtime, private.uba_redvault_discount_binding,
  private.uba_redvault_applications, private.uba_redvault_line_allocations,
  private.redvault_discount_proof_replay FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_uba_redvault_generic_redemption()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM private.uba_redvault_discount_binding b WHERE b.discount_code_id = NEW.discount_code_id) THEN
    RAISE EXCEPTION 'redvault_discount_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_uba_redvault_generic_redemption() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_uba_redvault_generic_redemption() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS reject_uba_redvault_generic_redemption ON public.discount_code_usage;
CREATE TRIGGER reject_uba_redvault_generic_redemption
  BEFORE INSERT OR UPDATE ON public.discount_code_usage
  FOR EACH ROW EXECUTE FUNCTION private.reject_uba_redvault_generic_redemption();

CREATE OR REPLACE FUNCTION private.prevent_uba_redvault_discount_mutation()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM private.uba_redvault_discount_binding b WHERE b.discount_code_id = OLD.id) THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'redvault_discount_binding_is_immutable';
  END IF;
  IF (NEW.merchant_id, NEW.code, NEW.discount_type, NEW.discount_value, NEW.applies_to, NEW.is_active,
         NEW.minimum_purchase_amount, NEW.maximum_discount_amount, NEW.product_ids, NEW.category_ids,
         NEW.id, NEW.usage_count, NEW.usage_limit, NEW.usage_limit_per_customer, NEW.starts_at, NEW.expires_at)
      IS DISTINCT FROM
        (OLD.merchant_id, OLD.code, OLD.discount_type, OLD.discount_value, OLD.applies_to, OLD.is_active,
         OLD.minimum_purchase_amount, OLD.maximum_discount_amount, OLD.product_ids, OLD.category_ids,
         OLD.id, OLD.usage_count, OLD.usage_limit, OLD.usage_limit_per_customer, OLD.starts_at, OLD.expires_at) THEN
    RAISE EXCEPTION 'redvault_discount_binding_is_immutable';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.prevent_uba_redvault_discount_mutation() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.prevent_uba_redvault_discount_mutation() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS prevent_uba_redvault_discount_mutation ON public.discount_codes;
CREATE TRIGGER prevent_uba_redvault_discount_mutation
  BEFORE UPDATE OR DELETE ON public.discount_codes
  FOR EACH ROW EXECUTE FUNCTION private.prevent_uba_redvault_discount_mutation();

CREATE TABLE IF NOT EXISTS private.uba_redvault_write_context (
  transaction_id bigint PRIMARY KEY
);
ALTER TABLE private.uba_redvault_write_context ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON private.uba_redvault_write_context FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION private.reject_unscoped_redvault_order()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF (NEW.payment_method = 'uba_redvault' OR (TG_OP = 'UPDATE' AND OLD.payment_method = 'uba_redvault'))
    AND NOT EXISTS (SELECT 1 FROM private.uba_redvault_write_context WHERE transaction_id = pg_catalog.txid_current()) THEN
    RAISE EXCEPTION 'redvault_order_requires_protected_path';
  END IF;
  RETURN NEW;
END;
$$;
ALTER FUNCTION private.reject_unscoped_redvault_order() OWNER TO postgres;
REVOKE ALL ON FUNCTION private.reject_unscoped_redvault_order() FROM PUBLIC, anon, authenticated, service_role;
DROP TRIGGER IF EXISTS reject_unscoped_redvault_order ON public.orders;
CREATE TRIGGER reject_unscoped_redvault_order
  BEFORE INSERT OR UPDATE ON public.orders
  FOR EACH ROW EXECUTE FUNCTION private.reject_unscoped_redvault_order();

CREATE POLICY redvault_no_direct_access ON private.uba_redvault_runtime
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
CREATE POLICY redvault_no_direct_access ON private.uba_redvault_discount_binding
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
CREATE POLICY redvault_no_direct_access ON private.uba_redvault_applications
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
CREATE POLICY redvault_no_direct_access ON private.uba_redvault_line_allocations
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
CREATE POLICY redvault_no_direct_access ON private.redvault_discount_proof_replay
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);
CREATE POLICY redvault_no_direct_access ON private.uba_redvault_write_context
  AS RESTRICTIVE FOR ALL TO anon, authenticated, service_role USING (false) WITH CHECK (false);

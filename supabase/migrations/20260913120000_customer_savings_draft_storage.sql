BEGIN;
CREATE SCHEMA IF NOT EXISTS savings_draft_private;
REVOKE ALL ON SCHEMA savings_draft_private FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE savings_draft_private.documents (
  version text NOT NULL,
  sha256 text NOT NULL,
  content text NOT NULL CHECK (octet_length(content) BETWEEN 1 AND 32768 AND length(btrim(content)) > 0),
  PRIMARY KEY (version, sha256),
  FOREIGN KEY (version, sha256) REFERENCES piggyvest_goal_policy.terms(version, sha256),
  CHECK (encode(extensions.digest(convert_to(content, 'UTF8'), 'sha256'), 'hex') = sha256)
);
CREATE TABLE savings_draft_private.settings (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id),
  enabled boolean NOT NULL DEFAULT false,
  environment text NOT NULL CHECK (environment = 'local_test'),
  terms_version text NOT NULL,
  terms_hash text NOT NULL,
  FOREIGN KEY (terms_version, terms_hash) REFERENCES savings_draft_private.documents(version, sha256)
);
CREATE INDEX savings_draft_settings_terms_idx ON savings_draft_private.settings(terms_version, terms_hash);

CREATE TABLE public.customer_savings_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  request_id uuid NOT NULL,
  revision_id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES public.products(id),
  variant_id uuid REFERENCES public.product_variants(id),
  catalogue jsonb NOT NULL,
  terms_version text NOT NULL,
  terms_hash text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  accepted_at timestamptz,
  UNIQUE (merchant_id, customer_id, request_id),
  FOREIGN KEY (terms_version, terms_hash) REFERENCES savings_draft_private.documents(version, sha256),
  CHECK (accepted_at IS NULL OR accepted_at >= created_at)
);
CREATE INDEX customer_savings_drafts_customer_idx ON public.customer_savings_drafts(customer_id, created_at DESC);
CREATE INDEX customer_savings_drafts_actor_idx ON public.customer_savings_drafts(actor_id);
CREATE INDEX customer_savings_drafts_product_idx ON public.customer_savings_drafts(product_id);
CREATE INDEX customer_savings_drafts_variant_idx ON public.customer_savings_drafts(variant_id);
CREATE INDEX customer_savings_drafts_terms_idx ON public.customer_savings_drafts(terms_version, terms_hash);

CREATE FUNCTION savings_draft_private.visible(p_customer uuid, p_merchant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customers customer
    JOIN public.merchants merchant ON merchant.id = customer.merchant_id
    JOIN savings_draft_private.settings settings ON settings.merchant_id = merchant.id
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant
      AND customer.user_id = auth.uid() AND merchant.is_published IS TRUE
      AND settings.enabled AND settings.environment = 'local_test'
  );
$$;
ALTER TABLE public.customer_savings_drafts ENABLE ROW LEVEL SECURITY;
CREATE POLICY customer_savings_drafts_read ON public.customer_savings_drafts FOR SELECT TO authenticated
  USING (actor_id = auth.uid() AND savings_draft_private.visible(customer_id, merchant_id));
ALTER TABLE savings_draft_private.documents ENABLE ROW LEVEL SECURITY;
ALTER TABLE savings_draft_private.settings ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_documents ON savings_draft_private.documents AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
CREATE POLICY deny_settings ON savings_draft_private.settings AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON public.customer_savings_drafts FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON ALL TABLES IN SCHEMA savings_draft_private FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION savings_draft_private.visible(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA savings_draft_private TO authenticated;
GRANT EXECUTE ON FUNCTION savings_draft_private.visible(uuid, uuid) TO authenticated;
GRANT SELECT ON public.customer_savings_drafts TO authenticated;

CREATE TRIGGER savings_draft_documents_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON savings_draft_private.documents FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_goal_policy.immutable();
CREATE FUNCTION savings_draft_private.guard_draft() RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF TG_OP <> 'UPDATE' OR OLD.accepted_at IS NOT NULL OR NEW.accepted_at IS NULL
    OR (to_jsonb(NEW) - 'accepted_at') IS DISTINCT FROM (to_jsonb(OLD) - 'accepted_at') THEN
    RAISE EXCEPTION 'Draft immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION savings_draft_private.guard_draft() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER customer_savings_drafts_immutable BEFORE UPDATE OR DELETE ON public.customer_savings_drafts
  FOR EACH ROW EXECUTE FUNCTION savings_draft_private.guard_draft();
CREATE TRIGGER customer_savings_drafts_no_truncate BEFORE TRUNCATE ON public.customer_savings_drafts
  FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_goal_policy.immutable();
COMMIT;

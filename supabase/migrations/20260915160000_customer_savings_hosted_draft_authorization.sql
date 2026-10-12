BEGIN;

ALTER TABLE savings_draft_private.settings DROP CONSTRAINT settings_environment_check;
ALTER TABLE savings_draft_private.settings ADD CONSTRAINT settings_environment_check
  CHECK (environment IN ('local_test', 'hosted_draft'));

CREATE TABLE savings_draft_private.hosted_draft_bindings (
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  system_identifier text NOT NULL,
  database_name name NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  PRIMARY KEY (merchant_id, actor_id)
);
CREATE INDEX hosted_draft_bindings_actor_idx ON savings_draft_private.hosted_draft_bindings(actor_id);
CREATE INDEX hosted_draft_bindings_customer_idx ON savings_draft_private.hosted_draft_bindings(customer_id);
ALTER TABLE savings_draft_private.hosted_draft_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_hosted_draft_bindings ON savings_draft_private.hosted_draft_bindings
  AS RESTRICTIVE FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON savings_draft_private.hosted_draft_bindings FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION savings_draft_private.guard_hosted_draft_binding()
RETURNS trigger LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  IF session_user <> 'supabase_admin' OR current_user <> 'supabase_admin'
    OR NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles
      WHERE rolname = session_user AND oid = 10 AND rolsuper)
    OR pg_catalog.inet_client_addr() IS NOT NULL
    OR pg_catalog.current_database() <> 'postgres'
    OR (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802' THEN
    RAISE EXCEPTION 'Hosted draft admin socket required' USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF TG_OP = 'TRUNCATE' THEN RETURN NULL; END IF;
  IF NEW.merchant_id <> '10000000-0000-4000-8000-000000000001'::uuid
    OR NEW.system_identifier <> '7685292944002592802' OR NEW.database_name <> 'postgres'
    OR NOT EXISTS (SELECT 1 FROM public.customers customer
      JOIN auth.users actor ON actor.id = customer.user_id
      JOIN public.merchants merchant ON merchant.id = customer.merchant_id
      WHERE customer.id = NEW.customer_id AND customer.user_id = NEW.actor_id
        AND customer.merchant_id = NEW.merchant_id AND merchant.is_published IS TRUE) THEN
    RAISE EXCEPTION 'Hosted draft binding denied' USING ERRCODE = '42501';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION savings_draft_private.guard_hosted_draft_binding() FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER hosted_draft_binding_guard BEFORE INSERT OR UPDATE OR DELETE
  ON savings_draft_private.hosted_draft_bindings FOR EACH ROW
  EXECUTE FUNCTION savings_draft_private.guard_hosted_draft_binding();
CREATE TRIGGER hosted_draft_binding_truncate_guard BEFORE TRUNCATE
  ON savings_draft_private.hosted_draft_bindings FOR EACH STATEMENT
  EXECUTE FUNCTION savings_draft_private.guard_hosted_draft_binding();

CREATE FUNCTION savings_draft_private.hosted_draft_visible(p_customer uuid, p_merchant uuid)
RETURNS boolean LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF auth.uid() IS NULL OR p_merchant IS DISTINCT FROM '10000000-0000-4000-8000-000000000001'::uuid
    OR pg_catalog.current_database() <> 'postgres' THEN RETURN false; END IF;
  IF (SELECT system_identifier::text FROM pg_catalog.pg_control_system()) <> '7685292944002592802' THEN
    RETURN false;
  END IF;
  RETURN EXISTS (SELECT 1 FROM savings_draft_private.hosted_draft_bindings binding
    JOIN public.customers customer ON customer.id = binding.customer_id
      AND customer.merchant_id = binding.merchant_id AND customer.user_id = binding.actor_id
    JOIN public.merchants merchant ON merchant.id = customer.merchant_id
    WHERE binding.merchant_id = p_merchant AND binding.customer_id = p_customer
      AND binding.actor_id = auth.uid() AND binding.enabled AND merchant.is_published IS TRUE
      AND binding.system_identifier = '7685292944002592802' AND binding.database_name = 'postgres');
EXCEPTION WHEN insufficient_privilege THEN RETURN false;
END;
$$;
REVOKE ALL ON FUNCTION savings_draft_private.hosted_draft_visible(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION savings_draft_private.visible(p_customer uuid, p_merchant uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.customers customer
    JOIN public.merchants merchant ON merchant.id = customer.merchant_id
    JOIN savings_draft_private.settings settings ON settings.merchant_id = merchant.id
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant
      AND customer.user_id = auth.uid() AND merchant.is_published IS TRUE AND settings.enabled
      AND CASE settings.environment
        WHEN 'local_test' THEN true
        WHEN 'hosted_draft' THEN savings_draft_private.hosted_draft_visible(p_customer, p_merchant)
        ELSE false
      END
  );
$$;

COMMIT;

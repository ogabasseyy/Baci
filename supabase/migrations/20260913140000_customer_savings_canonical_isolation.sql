BEGIN;
CREATE TABLE savings_draft_private.canonical_creation_scopes (
  merchant_id uuid PRIMARY KEY REFERENCES public.merchants(id),
  environment text NOT NULL DEFAULT 'local_test' CHECK (environment = 'local_test'),
  authorized_login name NOT NULL DEFAULT 'savings_local_plan_writer' CHECK (authorized_login = 'savings_local_plan_writer'),
  enabled boolean NOT NULL DEFAULT false
);
ALTER TABLE savings_draft_private.canonical_creation_scopes ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_canonical_creation_scopes ON savings_draft_private.canonical_creation_scopes AS RESTRICTIVE
  FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON savings_draft_private.canonical_creation_scopes FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER canonical_creation_scopes_immutable BEFORE UPDATE OR DELETE
  ON savings_draft_private.canonical_creation_scopes FOR EACH ROW EXECUTE FUNCTION piggyvest_goal_policy.guard_configuration();
CREATE TRIGGER canonical_creation_scopes_no_truncate BEFORE TRUNCATE
  ON savings_draft_private.canonical_creation_scopes FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_goal_policy.immutable();

ALTER TABLE public.customer_savings_drafts ADD CONSTRAINT customer_savings_drafts_canonical_identity_key
  UNIQUE(id, revision_id, merchant_id, customer_id, actor_id);
ALTER TABLE public.customer_savings_goals
  ADD COLUMN goal_kind text NOT NULL DEFAULT 'legacy' CHECK (goal_kind IN ('legacy', 'canonical_local')),
  ADD COLUMN canonical_draft_id uuid UNIQUE,
  ADD COLUMN canonical_draft_revision_id uuid,
  ADD COLUMN canonical_actor_id uuid,
  ALTER COLUMN contribution_amount DROP NOT NULL,
  ALTER COLUMN contribution_frequency DROP NOT NULL,
  ALTER COLUMN start_date DROP NOT NULL,
  ALTER COLUMN maturity_date DROP NOT NULL,
  ALTER COLUMN terms_accepted_at DROP NOT NULL,
  ALTER COLUMN non_withdrawable_accepted_at DROP NOT NULL,
  ADD CONSTRAINT customer_savings_goals_canonical_identity_fk
    FOREIGN KEY(canonical_draft_id, canonical_draft_revision_id, merchant_id, customer_id, canonical_actor_id)
    REFERENCES public.customer_savings_drafts(id, revision_id, merchant_id, customer_id, actor_id),
  ADD CONSTRAINT customer_savings_goals_kind_shape_check CHECK (
    (goal_kind = 'legacy'
      AND canonical_draft_id IS NULL AND canonical_draft_revision_id IS NULL AND canonical_actor_id IS NULL
      AND contribution_amount IS NOT NULL AND contribution_frequency IS NOT NULL
      AND start_date IS NOT NULL AND maturity_date IS NOT NULL
      AND terms_accepted_at IS NOT NULL AND non_withdrawable_accepted_at IS NOT NULL)
    OR
    (goal_kind = 'canonical_local'
      AND canonical_draft_id IS NOT NULL AND canonical_draft_revision_id IS NOT NULL AND canonical_actor_id IS NOT NULL
      AND contribution_amount IS NULL AND contribution_frequency IS NULL AND preferred_debit_time IS NULL
      AND start_date IS NULL AND maturity_date IS NULL AND saved_payment_method_id IS NULL
      AND terms_accepted_at IS NULL AND non_withdrawable_accepted_at IS NULL
      AND auto_debit_authorized_at IS NULL AND early_end_fee_accepted_at IS NULL
      AND current_amount = 0 AND initial_contribution_amount = 0 AND break_fee_percent = 0
      AND status = 'paused' AND source_mode = 'manual'
      AND completed_at IS NULL AND cancelled_at IS NULL AND spent_at IS NULL
      AND future_debits_cancelled_at IS NULL AND applied_order_id IS NULL AND metadata = '{}'::jsonb)
  );
CREATE INDEX customer_savings_goals_canonical_actor_idx ON public.customer_savings_goals(canonical_actor_id)
  WHERE canonical_actor_id IS NOT NULL;
CREATE POLICY customer_savings_goals_legacy_projection ON public.customer_savings_goals AS RESTRICTIVE
  FOR ALL TO authenticated USING(goal_kind = 'legacy') WITH CHECK(goal_kind = 'legacy');

CREATE FUNCTION savings_draft_private.guard_canonical_goal() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE draft public.customer_savings_drafts%ROWTYPE; catalogue jsonb; price numeric; required_field text;
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.goal_kind = 'canonical_local' THEN
      RAISE EXCEPTION 'Canonical goal mutation unavailable' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' THEN
    IF NEW.goal_kind IS DISTINCT FROM OLD.goal_kind OR OLD.goal_kind = 'canonical_local' THEN
      RAISE EXCEPTION 'Canonical goal mutation unavailable' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.goal_kind = 'legacy' THEN
    FOREACH required_field IN ARRAY ARRAY['contribution_amount','contribution_frequency','start_date','maturity_date','terms_accepted_at','non_withdrawable_accepted_at'] LOOP
      IF to_jsonb(NEW)->required_field = 'null'::jsonb THEN
        RAISE EXCEPTION 'null value in column % violates not-null constraint', required_field
          USING ERRCODE = '23502', COLUMN = required_field, TABLE = 'customer_savings_goals', SCHEMA = 'public';
      END IF;
    END LOOP;
    RETURN NEW;
  END IF;
  IF session_user <> 'savings_local_plan_writer' OR inet_client_addr() IS NOT NULL
    OR current_database() <> 'postgres' OR current_setting('transaction_isolation') <> 'read committed'
    OR NOT EXISTS(SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = session_user
      AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb AND NOT rolreplication)
    OR EXISTS(SELECT 1 FROM pg_catalog.pg_auth_members membership
      JOIN pg_catalog.pg_roles login ON login.oid = membership.member WHERE login.rolname = session_user) THEN
    RAISE EXCEPTION 'Canonical creation local boundary denied' USING ERRCODE = '42501';
  END IF;
  PERFORM merchant_id FROM savings_draft_private.canonical_creation_scopes
    WHERE merchant_id = NEW.merchant_id AND enabled AND environment = 'local_test'
      AND authorized_login = session_user FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical creation disabled' USING ERRCODE = '42501'; END IF;
  PERFORM id FROM public.customers WHERE id = NEW.customer_id AND merchant_id = NEW.merchant_id
    AND user_id = NEW.canonical_actor_id FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical actor denied' USING ERRCODE = '42501'; END IF;
  PERFORM id FROM public.merchants WHERE id = NEW.merchant_id AND is_published IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical merchant denied' USING ERRCODE = '42501'; END IF;
  PERFORM merchant_id FROM savings_draft_private.settings WHERE merchant_id = NEW.merchant_id
    AND enabled AND environment = 'local_test' FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical draft disabled' USING ERRCODE = '42501'; END IF;
  SELECT source.id, source.revision_id, source.product_id, source.variant_id, source.catalogue,
    source.terms_version, source.terms_hash, source.accepted_at
    INTO draft.id, draft.revision_id, draft.product_id, draft.variant_id, draft.catalogue,
      draft.terms_version, draft.terms_hash, draft.accepted_at
    FROM public.customer_savings_drafts source
    WHERE source.id = NEW.canonical_draft_id AND source.revision_id = NEW.canonical_draft_revision_id
      AND source.merchant_id = NEW.merchant_id AND source.customer_id = NEW.customer_id
      AND source.actor_id = NEW.canonical_actor_id FOR UPDATE;
  IF NOT FOUND OR draft.accepted_at IS NULL OR NEW.product_id IS DISTINCT FROM draft.product_id
    OR NEW.variant_id IS DISTINCT FROM draft.variant_id THEN
    RAISE EXCEPTION 'Canonical draft review required' USING ERRCODE = '23514';
  END IF;
  PERFORM terms.version FROM piggyvest_goal_policy.terms terms
    JOIN savings_draft_private.settings settings ON settings.merchant_id = NEW.merchant_id
      AND settings.terms_version = terms.version AND settings.terms_hash = terms.sha256
    WHERE terms.version = draft.terms_version AND terms.sha256 = draft.terms_hash AND terms.enabled FOR SHARE OF terms;
  IF NOT FOUND THEN RAISE EXCEPTION 'Canonical terms unavailable' USING ERRCODE = '42501'; END IF;
  catalogue := savings_draft_private.catalogue(NEW.merchant_id, NEW.product_id, NEW.variant_id);
  price := COALESCE((catalogue#>>'{variants,0,price_override}')::numeric, (catalogue->>'price')::numeric);
  IF catalogue IS DISTINCT FROM draft.catalogue OR NEW.target_amount IS DISTINCT FROM price
    OR price * 100 NOT BETWEEN 1 AND 9007199254740991 OR trunc(price * 100) <> price * 100
    OR NEW.product_snapshot->>'selectionStatus' IS DISTINCT FROM 'exact'
    OR (NEW.product_snapshot->>'variantId')::uuid IS DISTINCT FROM NEW.variant_id
    OR (NEW.product_snapshot->>'price')::numeric IS DISTINCT FROM price
    OR NEW.product_snapshot->>'name' IS DISTINCT FROM catalogue->>'name'
    OR NEW.product_snapshot->>'condition' IS DISTINCT FROM COALESCE(catalogue#>>'{variants,0,condition}', catalogue->>'condition') THEN
    RAISE EXCEPTION 'Canonical catalogue review required' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER zz_customer_savings_canonical_goal BEFORE INSERT OR UPDATE OR DELETE
  ON public.customer_savings_goals FOR EACH ROW EXECUTE FUNCTION savings_draft_private.guard_canonical_goal();

CREATE FUNCTION savings_draft_private.reject_canonical_activity() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE previous_goal uuid; next_goal uuid; kind text;
BEGIN
  IF TG_OP <> 'INSERT' THEN previous_goal := OLD.goal_id; END IF;
  IF TG_OP <> 'DELETE' THEN next_goal := NEW.goal_id; END IF;
  FOR kind IN SELECT goal.goal_kind FROM public.customer_savings_goals goal
    WHERE goal.id IN (previous_goal, next_goal) ORDER BY goal.id FOR SHARE LOOP
    IF kind = 'canonical_local' THEN
      RAISE EXCEPTION 'Canonical financial activity unavailable' USING ERRCODE = '23514';
    END IF;
  END LOOP;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON public.customer_savings_contributions FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON public.customer_savings_redemptions FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON public.customer_savings_events FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_savings_ledger.operations FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_staging.provisioning_intents FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_staging.wallet_goal_mappings FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
CREATE TRIGGER aaa_reject_canonical_activity BEFORE INSERT OR UPDATE OR DELETE
  ON piggyvest_goal_policy.lifecycle_activations FOR EACH ROW EXECUTE FUNCTION savings_draft_private.reject_canonical_activity();
REVOKE ALL ON FUNCTION savings_draft_private.guard_canonical_goal(), savings_draft_private.reject_canonical_activity()
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON COLUMN public.customer_savings_goals.goal_kind IS
  'Stage-one schema isolation only. Legacy remains the default with its original constraints and mandatory fields. Canonical local rows require an independently reviewed restricted login and empty-by-default scope registry. No entrypoint, role, scope, grant or lifecycle capability is provisioned here.';
COMMIT;

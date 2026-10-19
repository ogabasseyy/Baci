BEGIN;
CREATE TABLE savings_draft_private.canonical_bindings (
  draft_id uuid PRIMARY KEY REFERENCES public.customer_savings_drafts(id),
  draft_revision_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_drafts(revision_id),
  goal_id uuid NOT NULL UNIQUE REFERENCES public.customer_savings_goals(id),
  policy_revision_id uuid NOT NULL UNIQUE REFERENCES piggyvest_goal_policy.snapshots(revision_id),
  integration_id uuid NOT NULL REFERENCES piggyvest_staging.integrations(id),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id),
  customer_id uuid NOT NULL REFERENCES public.customers(id),
  actor_id uuid NOT NULL REFERENCES auth.users(id),
  bound_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX savings_canonical_binding_integration_idx ON savings_draft_private.canonical_bindings(integration_id);
CREATE INDEX savings_canonical_binding_merchant_idx ON savings_draft_private.canonical_bindings(merchant_id);
CREATE INDEX savings_canonical_binding_customer_idx ON savings_draft_private.canonical_bindings(customer_id);
CREATE INDEX savings_canonical_binding_actor_idx ON savings_draft_private.canonical_bindings(actor_id);
ALTER TABLE savings_draft_private.canonical_bindings ENABLE ROW LEVEL SECURITY;
CREATE POLICY deny_canonical_bindings ON savings_draft_private.canonical_bindings AS RESTRICTIVE
  FOR ALL TO PUBLIC USING(false) WITH CHECK(false);
REVOKE ALL ON savings_draft_private.canonical_bindings FROM PUBLIC, anon, authenticated, service_role;
CREATE TRIGGER canonical_bindings_immutable BEFORE UPDATE OR DELETE OR TRUNCATE
  ON savings_draft_private.canonical_bindings FOR EACH STATEMENT EXECUTE FUNCTION piggyvest_goal_policy.immutable();

CREATE FUNCTION savings_draft_private.bind_canonical(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid, p_draft uuid, p_draft_revision uuid, p_policy_revision uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  draft public.customer_savings_drafts%ROWTYPE;
  saved savings_draft_private.canonical_bindings%ROWTYPE;
  policy jsonb; catalogue jsonb; variant jsonb; price numeric; closure jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' OR inet_client_addr() IS NOT NULL
    OR current_database() <> 'piggyvest_local' THEN
    RAISE EXCEPTION 'Draft binding local execution required' USING ERRCODE = '42501';
  END IF;
  IF p_actor IS NULL OR p_draft IS NULL OR p_draft_revision IS NULL OR p_policy_revision IS NULL THEN
    RAISE EXCEPTION 'Draft binding invalid input' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  IF NOT EXISTS(SELECT 1 FROM public.customers WHERE id = p_customer AND merchant_id = p_merchant AND user_id = p_actor) THEN
    RAISE EXCEPTION 'Draft binding actor denied' USING ERRCODE = '42501';
  END IF;
  PERFORM id FROM public.merchants WHERE id = p_merchant AND is_published IS TRUE FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft binding unavailable' USING ERRCODE = '42501'; END IF;
  SELECT source.id, source.revision_id, source.product_id, source.variant_id, source.catalogue,
    source.terms_version, source.terms_hash, source.accepted_at
    INTO draft.id, draft.revision_id, draft.product_id, draft.variant_id, draft.catalogue,
      draft.terms_version, draft.terms_hash, draft.accepted_at
    FROM public.customer_savings_drafts source
    JOIN savings_draft_private.settings settings ON settings.merchant_id = source.merchant_id
    WHERE source.id = p_draft AND source.merchant_id = p_merchant AND source.customer_id = p_customer
      AND source.actor_id = p_actor AND settings.enabled AND settings.environment = 'local_test'
      AND settings.terms_version = source.terms_version AND settings.terms_hash = source.terms_hash
    FOR SHARE OF settings;
  IF NOT FOUND THEN RAISE EXCEPTION 'Draft binding unavailable' USING ERRCODE = '42501'; END IF;
  PERFORM id FROM public.customer_savings_drafts WHERE id = p_draft FOR UPDATE;
  IF draft.accepted_at IS NULL OR draft.revision_id IS DISTINCT FROM p_draft_revision THEN
    RAISE EXCEPTION 'Draft binding review required' USING ERRCODE = '23514';
  END IF;
  policy := piggyvest_goal_policy.read(p_integration, p_merchant, p_customer, p_goal, p_business);
  closure := piggyvest_draft_closure.read(p_integration, p_merchant, p_customer, p_goal, p_business, p_actor);
  IF policy IS NULL OR closure->>'status' IS DISTINCT FROM 'available'
    OR (policy->>'revisionId')::uuid IS DISTINCT FROM p_policy_revision
    OR policy->>'actorId' IS NOT NULL OR policy->>'acceptedAt' IS NOT NULL
    OR policy->'command'->'guarantee' IS DISTINCT FROM 'null'::jsonb
    OR policy->'command'->>'termsVersion' IS DISTINCT FROM draft.terms_version
    OR policy->'command'->>'termsHash' IS DISTINCT FROM draft.terms_hash
    OR (policy->'command'->>'productId')::uuid IS DISTINCT FROM draft.product_id
    OR (policy->'command'->>'variantId')::uuid IS DISTINCT FROM draft.variant_id
    OR (policy->'command'->>'quoteExpiresAt')::timestamptz <= clock_timestamp()
    OR NOT EXISTS(SELECT 1 FROM piggyvest_goal_policy.snapshots WHERE goal_id = p_goal AND revision_id = p_policy_revision) THEN
    RAISE EXCEPTION 'Draft binding review required' USING ERRCODE = '23514';
  END IF;
  catalogue := savings_draft_private.catalogue(p_merchant, draft.product_id, draft.variant_id);
  IF catalogue IS DISTINCT FROM draft.catalogue THEN
    RAISE EXCEPTION 'Draft binding catalogue changed' USING ERRCODE = '23514';
  END IF;
  variant := catalogue->'variants'->0;
  price := COALESCE((variant->>'price_override')::numeric, (catalogue->>'price')::numeric);
  IF price * 100 NOT BETWEEN 1 AND 9007199254740991 OR trunc(price * 100) <> price * 100
    OR (policy->'command'->>'quoteKobo')::numeric IS DISTINCT FROM price * 100
    OR (policy->'device'->>'price')::numeric IS DISTINCT FROM price
    OR policy->'device'->>'name' IS DISTINCT FROM catalogue->>'name'
    OR policy->'device'->>'condition' IS DISTINCT FROM COALESCE(variant->>'condition', catalogue->>'condition') THEN
    RAISE EXCEPTION 'Draft binding quote mismatch' USING ERRCODE = '23514';
  END IF;
  SELECT binding.draft_id, binding.draft_revision_id, binding.goal_id, binding.policy_revision_id,
    binding.integration_id, binding.merchant_id, binding.customer_id, binding.actor_id, binding.bound_at
    INTO saved FROM savings_draft_private.canonical_bindings binding WHERE binding.draft_id = p_draft OR binding.goal_id = p_goal;
  IF FOUND THEN
    IF saved.draft_id IS DISTINCT FROM p_draft OR saved.goal_id IS DISTINCT FROM p_goal
      OR saved.draft_revision_id IS DISTINCT FROM p_draft_revision OR saved.policy_revision_id IS DISTINCT FROM p_policy_revision
      OR saved.integration_id IS DISTINCT FROM p_integration OR saved.merchant_id IS DISTINCT FROM p_merchant
      OR saved.customer_id IS DISTINCT FROM p_customer OR saved.actor_id IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'Draft binding conflict' USING ERRCODE = '23505';
    END IF;
  ELSE
    INSERT INTO savings_draft_private.canonical_bindings(draft_id, draft_revision_id, goal_id, policy_revision_id,
      integration_id, merchant_id, customer_id, actor_id)
      VALUES(p_draft, p_draft_revision, p_goal, p_policy_revision, p_integration, p_merchant, p_customer, p_actor)
      RETURNING bound_at INTO saved.bound_at;
  END IF;
  RETURN jsonb_build_object('draftId', p_draft, 'draftRevisionId', p_draft_revision, 'goalId', p_goal,
    'policyRevisionId', p_policy_revision, 'outcome', 'bound', 'boundAt', saved.bound_at);
END $$;
REVOKE ALL ON FUNCTION savings_draft_private.bind_canonical(uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;
COMMENT ON FUNCTION savings_draft_private.bind_canonical(uuid, uuid, uuid, uuid, text, uuid, uuid, uuid, uuid) IS
  'Unregistered local-only binding to an existing isolated canonical draft. No grants seeded. Parent must review executor registration and narrowly grant this function to the existing policy writer. No goal creation, policy consent, schedule, provisioning, activation or ledger writes. Replay revalidates current eligibility and may require review after subsequent changes. Never copy authenticated data between databases or substitute SET ROLE for the required login.';
COMMIT;

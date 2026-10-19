BEGIN;
-- Goal-policy prerequisite tables. The draft storage/binding migrations and
-- the policy-store/lifecycle application paths consume the
-- piggyvest_goal_policy schema, but the original 20260912140000 migration was
-- never copied into this repository's chain, so a clean database stops at the
-- draft-storage foreign key before any savings, webhook, notification, or
-- funding migration can run. This backfill provides the schema at the exact
-- missing version (sorts before every consumer) so the chain replays.
--
-- Every object below is derived from its in-repo consumers (migration
-- foreign keys/triggers plus the goal-policy-store, goal-lifecycle, and
-- funding-capability statement contracts and zod result schemas); nothing is
-- copied from the other worktree's older integration architecture, and no
-- reference is made to its staging-registry coupling. Behavior is fail-closed
-- throughout: missing terms, snapshots, bindings, or lifecycle acceptances
-- raise (or return NULL for reads), never synthesize policy.
--
-- Tables: terms (reviewed policy documents), snapshots (staged policy
-- revisions per goal), lifecycle_terms (prepared/accepted durations),
-- lifecycle_activations (activation receipts). Reference rows (terms) are
-- seeded out-of-band by deployments; an empty terms table fails every policy
-- write closed. Tables referenced only by manually-run tests against the
-- provisioned synthetic database (bindings, lifecycle_gates, consents) are
-- intentionally not recreated here.
CREATE SCHEMA IF NOT EXISTS piggyvest_goal_policy;
REVOKE ALL ON SCHEMA piggyvest_goal_policy FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_goal_policy.terms (
  version text NOT NULL,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (version, sha256)
);
ALTER TABLE piggyvest_goal_policy.terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_goal_policy.terms FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_goal_policy.snapshots (
  revision_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL,
  policy jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX piggyvest_goal_policy_snapshots_goal_idx
  ON piggyvest_goal_policy.snapshots (goal_id, created_at DESC);
ALTER TABLE piggyvest_goal_policy.snapshots ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_goal_policy.snapshots FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_goal_policy.lifecycle_terms (
  goal_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  duration_months integer NOT NULL CHECK (duration_months BETWEEN 1 AND 6),
  actor_id uuid,
  accepted_at timestamptz,
  prepared_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (goal_id, revision_id),
  CHECK ((actor_id IS NULL) = (accepted_at IS NULL))
);
ALTER TABLE piggyvest_goal_policy.lifecycle_terms ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_goal_policy.lifecycle_terms FROM PUBLIC, anon, authenticated, service_role;

CREATE TABLE piggyvest_goal_policy.lifecycle_activations (
  operation_id uuid PRIMARY KEY,
  goal_id uuid NOT NULL,
  revision_id uuid NOT NULL,
  duration_months integer NOT NULL CHECK (duration_months BETWEEN 1 AND 6),
  guarantee_kobo bigint NOT NULL CHECK (guarantee_kobo > 0),
  activated_at timestamptz NOT NULL DEFAULT now(),
  matures_at timestamptz NOT NULL,
  grace_expires_at timestamptz NOT NULL,
  CHECK (matures_at > activated_at AND grace_expires_at > matures_at)
);
CREATE INDEX piggyvest_goal_policy_activations_goal_idx
  ON piggyvest_goal_policy.lifecycle_activations (goal_id);
ALTER TABLE piggyvest_goal_policy.lifecycle_activations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE piggyvest_goal_policy.lifecycle_activations FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION piggyvest_goal_policy.immutable()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  RAISE EXCEPTION 'goal policy configuration is immutable' USING ERRCODE = '23514';
  RETURN NULL;
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.immutable()
  FROM PUBLIC, anon, authenticated, service_role;

-- Row guard for canonical_creation_scopes (UPDATE/DELETE): the scope row's
-- identity (merchant, environment, authorized login) is immutable; only the
-- enabled flag may flip, and only through a privileged writer. Anything else
-- raises instead of silently re-scoping canonical creation.
CREATE FUNCTION piggyvest_goal_policy.guard_configuration()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'goal policy configuration is immutable' USING ERRCODE = '23514';
  END IF;
  IF NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
    OR NEW.environment IS DISTINCT FROM OLD.environment
    OR NEW.authorized_login IS DISTINCT FROM OLD.authorized_login
  THEN
    RAISE EXCEPTION 'goal policy configuration identity is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.guard_configuration()
  FROM PUBLIC, anon, authenticated, service_role;

-- Scope serialization for policy mutations: one writer per
-- (integration, merchant, customer, goal, business) at a time so concurrent
-- stage/accept/activate calls serialize instead of interleaving snapshots.
CREATE FUNCTION piggyvest_goal_policy.lock_scope(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
BEGIN
  IF p_integration IS NULL OR p_merchant IS NULL OR p_customer IS NULL
    OR p_goal IS NULL OR p_business IS NULL THEN
    RAISE EXCEPTION 'policy scope lock requires a full scope' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      pg_catalog.concat_ws('|', p_integration::text, p_merchant::text,
        p_customer::text, p_goal::text, p_business),
      0
    )
  );
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.lock_scope(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Stage a policy command as a snapshot revision. Validates the caller scope,
-- the referenced terms (enabled), goal freshness (millisecond-truncated
-- optimistic concurrency; application Dates carry millisecond precision), an
-- unexpired quote that matches the live catalogue price, and the draft-only
-- invariants (null guarantee, draft lifecycle, paused collection). The device
-- block is built from the live catalogue so binding-time comparisons hold;
-- the variant label mirrors the application's attribute-values convention
-- (deterministic key order) with the sku fallback. Restaging an identical
-- revision is idempotent; a conflicting restage raises.
CREATE FUNCTION piggyvest_goal_policy.stage(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_command jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_revision uuid;
  v_goal public.customer_savings_goals%ROWTYPE;
  v_catalogue jsonb;
  v_variant jsonb;
  v_price numeric;
  v_label text;
  v_policy jsonb;
  v_existing jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'policy stage denied' USING ERRCODE = '42501';
  END IF;
  IF p_command IS NULL
    OR p_command->>'revisionId' IS NULL
    OR p_command->>'termsVersion' IS NULL
    OR p_command->>'termsHash' IS NULL
    OR (p_command->>'quoteKobo')::numeric IS NULL
    OR (p_command->>'quoteKobo')::numeric <= 0
    OR (p_command->>'quoteKobo')::numeric <> pg_catalog.trunc((p_command->>'quoteKobo')::numeric)
    OR p_command->'guarantee' IS DISTINCT FROM 'null'::jsonb
    OR p_command->>'lifecycle' IS DISTINCT FROM 'draft'
    OR (p_command->>'collectionPaused')::boolean IS DISTINCT FROM true
    OR (p_command->>'quoteExpiresAt')::timestamptz <= pg_catalog.clock_timestamp()
  THEN
    RAISE EXCEPTION 'policy stage invalid command' USING ERRCODE = '22023';
  END IF;
  BEGIN
    v_revision := (p_command->>'revisionId')::uuid;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'policy stage invalid command' USING ERRCODE = '22023';
  END;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy stage unavailable' USING ERRCODE = '42501'; END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy stage ownership mismatch' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_goal FROM public.customer_savings_goals AS goal
    WHERE goal.id = p_goal AND goal.customer_id = p_customer AND goal.merchant_id = p_merchant FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy stage ownership mismatch' USING ERRCODE = '42501'; END IF;
  IF pg_catalog.date_trunc('milliseconds', v_goal.updated_at) IS DISTINCT FROM
    pg_catalog.date_trunc('milliseconds', (p_command->>'expectedGoalUpdatedAt')::timestamptz) THEN
    RAISE EXCEPTION 'policy stage stale goal' USING ERRCODE = '23514';
  END IF;
  PERFORM 1 FROM piggyvest_goal_policy.terms AS terms
    WHERE terms.version = p_command->>'termsVersion'
      AND terms.sha256 = p_command->>'termsHash'
      AND terms.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy stage terms unavailable' USING ERRCODE = '42501'; END IF;
  SELECT existing.policy INTO v_existing FROM piggyvest_goal_policy.snapshots AS existing
    WHERE existing.revision_id = v_revision;
  IF FOUND THEN
    IF v_existing->>'revisionId' IS DISTINCT FROM p_command->>'revisionId'
      OR v_existing->'command' IS DISTINCT FROM p_command THEN
      RAISE EXCEPTION 'policy stage revision conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('revisionId', v_revision, 'outcome', 'staged');
  END IF;
  -- Catalogue lookup enforces product availability and exact-variant
  -- selection; it raises (P0002/22023/23514) when the device cannot be
  -- described exactly.
  v_catalogue := savings_draft_private.catalogue(
    p_merchant, (p_command->>'productId')::uuid, (p_command->>'variantId')::uuid);
  v_variant := v_catalogue->'variants'->0;
  v_price := COALESCE((v_variant->>'price_override')::numeric, (v_catalogue->>'price')::numeric);
  IF (p_command->>'quoteKobo')::numeric IS DISTINCT FROM v_price * 100 THEN
    RAISE EXCEPTION 'policy stage quote mismatch' USING ERRCODE = '23514';
  END IF;
  IF p_command->>'variantId' IS NULL THEN
    v_label := NULL;
  ELSE
    SELECT pg_catalog.left(pg_catalog.btrim(COALESCE(
      (SELECT pg_catalog.string_agg(scalar.value_text, ' / ' ORDER BY scalar.key)
       FROM (SELECT entry.key, entry.value #>> '{}' AS value_text,
                    pg_catalog.jsonb_typeof(entry.value) AS value_type
             FROM pg_catalog.jsonb_each(v_variant->'attributes') AS entry(key, value)) AS scalar
       WHERE scalar.value_type IN ('string', 'number', 'boolean') AND scalar.value_text <> ''),
      pg_catalog.nullif(pg_catalog.btrim(v_variant->>'sku'), ''),
      pg_catalog.nullif(pg_catalog.btrim(v_variant->>'condition'), ''),
      'Variant'
    )), 200) INTO v_label;
  END IF;
  v_policy := jsonb_build_object(
    'revisionId', v_revision,
    'command', p_command,
    'device', jsonb_build_object(
      'name', v_catalogue->>'name',
      'condition', COALESCE(v_variant->>'condition', v_catalogue->>'condition'),
      'variantId', p_command->>'variantId',
      'variantLabel', v_label,
      'selectionStatus', 'exact',
      'price', v_price
    ),
    'actorId', NULL,
    'acceptedAt', NULL,
    'durationMonths', NULL
  );
  INSERT INTO piggyvest_goal_policy.snapshots(revision_id, goal_id, policy)
    VALUES (v_revision, p_goal, v_policy);
  RETURN jsonb_build_object('revisionId', v_revision, 'outcome', 'staged');
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.stage(uuid, uuid, uuid, uuid, text, jsonb)
  FROM PUBLIC, anon, authenticated, service_role;

-- Accept a staged revision: binds the actor, stamps acceptance, and returns
-- the accepted receipt. Requires an existing unaccepted snapshot for the
-- scoped goal, an actor bound to the customer, and an unexpired quote (same
-- rule the binder enforces). Re-accepting the identical (revision, actor)
-- pair is idempotent; any other re-accept raises.
CREATE FUNCTION piggyvest_goal_policy.accept(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_revision uuid, p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_policy jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'policy accept denied' USING ERRCODE = '42501';
  END IF;
  IF p_revision IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'policy accept invalid input' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  PERFORM registry.id FROM piggyvest_staging.integrations AS registry
    WHERE registry.id = p_integration AND registry.enabled FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy accept unavailable' USING ERRCODE = '42501'; END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant
      AND customer.user_id = p_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy accept actor denied' USING ERRCODE = '42501'; END IF;
  SELECT snapshots.policy INTO v_policy FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.revision_id = p_revision AND snapshots.goal_id = p_goal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'policy accept unknown revision' USING ERRCODE = '23514'; END IF;
  IF v_policy->>'actorId' IS NOT NULL THEN
    IF (v_policy->>'actorId')::uuid IS DISTINCT FROM p_actor THEN
      RAISE EXCEPTION 'policy accept actor conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('revisionId', p_revision, 'outcome', 'accepted');
  END IF;
  IF (v_policy->'command'->>'quoteExpiresAt')::timestamptz <= pg_catalog.clock_timestamp() THEN
    RAISE EXCEPTION 'policy accept quote expired' USING ERRCODE = '23514';
  END IF;
  UPDATE piggyvest_goal_policy.snapshots AS snapshots
    SET policy = pg_catalog.jsonb_set(
      pg_catalog.jsonb_set(v_policy, '{actorId}', pg_catalog.to_jsonb(p_actor)),
      '{acceptedAt}', pg_catalog.to_jsonb(pg_catalog.clock_timestamp()))
    WHERE snapshots.revision_id = p_revision;
  RETURN jsonb_build_object('revisionId', p_revision, 'outcome', 'accepted');
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.accept(uuid, uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Read the latest staged policy for a goal: the newest snapshot's stored
-- document, or NULL when nothing is staged. Reads never raise for missing
-- policy; callers treat NULL as unavailable.
CREATE FUNCTION piggyvest_goal_policy.read(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_policy jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'policy read denied' USING ERRCODE = '42501';
  END IF;
  IF p_integration IS NULL OR p_merchant IS NULL OR p_customer IS NULL
    OR p_goal IS NULL OR p_business IS NULL THEN
    RAISE EXCEPTION 'policy read invalid scope' USING ERRCODE = '22023';
  END IF;
  SELECT snapshots.policy INTO v_policy FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.goal_id = p_goal ORDER BY snapshots.created_at DESC LIMIT 1;
  RETURN v_policy;
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.read(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated, service_role;

-- Prepare lifecycle duration terms for a staged revision: records the
-- chosen 1..6 month duration. Requires the staged snapshot; re-preparing
-- the identical duration is idempotent, a conflicting duration raises, and
-- preparing after acceptance raises.
CREATE FUNCTION piggyvest_goal_policy.prepare_lifecycle_terms(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_revision uuid, p_duration_months integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_existing piggyvest_goal_policy.lifecycle_terms%ROWTYPE;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'lifecycle terms denied' USING ERRCODE = '42501';
  END IF;
  IF p_revision IS NULL OR p_duration_months IS NULL
    OR p_duration_months NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'lifecycle terms invalid input' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  PERFORM snapshots.revision_id FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.revision_id = p_revision AND snapshots.goal_id = p_goal FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle terms unknown revision' USING ERRCODE = '23514'; END IF;
  SELECT * INTO v_existing FROM piggyvest_goal_policy.lifecycle_terms AS terms
    WHERE terms.goal_id = p_goal AND terms.revision_id = p_revision FOR UPDATE;
  IF FOUND THEN
    IF v_existing.duration_months IS DISTINCT FROM p_duration_months
      OR v_existing.actor_id IS NOT NULL THEN
      RAISE EXCEPTION 'lifecycle terms conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('revisionId', p_revision,
      'durationMonths', p_duration_months, 'outcome', 'prepared');
  END IF;
  INSERT INTO piggyvest_goal_policy.lifecycle_terms(goal_id, revision_id, duration_months)
    VALUES (p_goal, p_revision, p_duration_months);
  RETURN jsonb_build_object('revisionId', p_revision,
    'durationMonths', p_duration_months, 'outcome', 'prepared');
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.prepare_lifecycle_terms(uuid, uuid, uuid, uuid, text, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Accept lifecycle duration terms: binds the actor to the prepared duration
-- and stamps the snapshot accepted in the same row lock, so the policy and
-- its duration accept together or not at all. Re-accepting the identical
-- triple is idempotent; anything else raises.
CREATE FUNCTION piggyvest_goal_policy.accept_lifecycle_terms(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_revision uuid, p_actor uuid, p_duration_months integer
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_existing piggyvest_goal_policy.lifecycle_terms%ROWTYPE;
  v_policy jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'lifecycle terms denied' USING ERRCODE = '42501';
  END IF;
  IF p_revision IS NULL OR p_actor IS NULL OR p_duration_months IS NULL
    OR p_duration_months NOT BETWEEN 1 AND 6 THEN
    RAISE EXCEPTION 'lifecycle terms invalid input' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant
      AND customer.user_id = p_actor FOR SHARE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle terms actor denied' USING ERRCODE = '42501'; END IF;
  SELECT * INTO v_existing FROM piggyvest_goal_policy.lifecycle_terms AS terms
    WHERE terms.goal_id = p_goal AND terms.revision_id = p_revision FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle terms not prepared' USING ERRCODE = '23514'; END IF;
  IF v_existing.duration_months IS DISTINCT FROM p_duration_months THEN
    RAISE EXCEPTION 'lifecycle terms duration conflict' USING ERRCODE = '23505';
  END IF;
  SELECT snapshots.policy INTO v_policy FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.revision_id = p_revision AND snapshots.goal_id = p_goal FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'lifecycle terms unknown revision' USING ERRCODE = '23514'; END IF;
  IF v_policy->>'actorId' IS NOT NULL AND (v_policy->>'actorId')::uuid IS DISTINCT FROM p_actor THEN
    RAISE EXCEPTION 'lifecycle terms actor conflict' USING ERRCODE = '23505';
  END IF;
  IF (v_policy->'command'->>'quoteExpiresAt')::timestamptz <= pg_catalog.clock_timestamp()
    AND v_policy->>'actorId' IS NULL THEN
    RAISE EXCEPTION 'lifecycle terms quote expired' USING ERRCODE = '23514';
  END IF;
  UPDATE piggyvest_goal_policy.lifecycle_terms AS terms
    SET actor_id = p_actor, accepted_at = pg_catalog.clock_timestamp()
    WHERE terms.goal_id = p_goal AND terms.revision_id = p_revision;
  UPDATE piggyvest_goal_policy.snapshots AS snapshots
    SET policy = snapshots.policy
      || pg_catalog.jsonb_build_object('actorId', p_actor,
        'acceptedAt', pg_catalog.clock_timestamp(), 'durationMonths', p_duration_months)
    WHERE snapshots.revision_id = p_revision;
  RETURN jsonb_build_object('revisionId', p_revision,
    'durationMonths', p_duration_months, 'outcome', 'accepted');
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.accept_lifecycle_terms(uuid, uuid, uuid, uuid, text, uuid, uuid, integer)
  FROM PUBLIC, anon, authenticated, service_role;

-- Activate a goal lifecycle: requires the snapshot accepted with accepted
-- lifecycle terms for the same revision, then records the activation receipt
-- (idempotent per operation id; a conflicting replay raises). The guarantee
-- is the staged quote; maturity is activation plus the accepted duration and
-- grace seven days later (documented derivation: no consumer pins the grace
-- offset). Collection stays paused and unconsented: activation never moves
-- money, which matches the nonfinancial draft boundary.
CREATE FUNCTION piggyvest_goal_policy.activate_lifecycle(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_revision uuid, p_operation uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_policy jsonb;
  v_months integer;
  v_guarantee bigint;
  v_activated timestamptz;
  v_matures timestamptz;
  v_grace timestamptz;
  v_existing piggyvest_goal_policy.lifecycle_activations%ROWTYPE;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'lifecycle activation denied' USING ERRCODE = '42501';
  END IF;
  IF p_revision IS NULL OR p_operation IS NULL THEN
    RAISE EXCEPTION 'lifecycle activation invalid input' USING ERRCODE = '22023';
  END IF;
  PERFORM piggyvest_goal_policy.lock_scope(p_integration, p_merchant, p_customer, p_goal, p_business);
  SELECT * INTO v_existing FROM piggyvest_goal_policy.lifecycle_activations AS activations
    WHERE activations.operation_id = p_operation;
  IF FOUND THEN
    IF v_existing.goal_id IS DISTINCT FROM p_goal
      OR v_existing.revision_id IS DISTINCT FROM p_revision THEN
      RAISE EXCEPTION 'lifecycle activation conflict' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('operationId', p_operation, 'revisionId', p_revision,
      'lifecycle', 'active', 'activatedAt', v_existing.activated_at,
      'guaranteeKobo', v_existing.guarantee_kobo, 'collectionPaused', true,
      'collectionConsent', 'not_granted', 'evidence', 'local_synthetic_only',
      'durationMonths', v_existing.duration_months, 'maturesAt', v_existing.matures_at,
      'graceExpiresAt', v_existing.grace_expires_at);
  END IF;
  SELECT snapshots.policy INTO v_policy FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.revision_id = p_revision AND snapshots.goal_id = p_goal FOR SHARE;
  IF NOT FOUND OR v_policy->>'actorId' IS NULL THEN
    RAISE EXCEPTION 'lifecycle activation unaccepted policy' USING ERRCODE = '23514';
  END IF;
  SELECT terms.duration_months INTO v_months FROM piggyvest_goal_policy.lifecycle_terms AS terms
    WHERE terms.goal_id = p_goal AND terms.revision_id = p_revision
      AND terms.actor_id IS NOT NULL FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'lifecycle activation terms unaccepted' USING ERRCODE = '23514';
  END IF;
  v_guarantee := (v_policy->'command'->>'quoteKobo')::bigint;
  IF v_guarantee IS NULL OR v_guarantee <= 0 THEN
    RAISE EXCEPTION 'lifecycle activation invalid guarantee' USING ERRCODE = '23514';
  END IF;
  v_activated := pg_catalog.clock_timestamp();
  v_matures := v_activated + pg_catalog.make_interval(months => v_months);
  v_grace := v_matures + pg_catalog.make_interval(days => 7);
  INSERT INTO piggyvest_goal_policy.lifecycle_activations(
      operation_id, goal_id, revision_id, duration_months, guarantee_kobo,
      activated_at, matures_at, grace_expires_at)
    VALUES (p_operation, p_goal, p_revision, v_months, v_guarantee,
      v_activated, v_matures, v_grace);
  RETURN jsonb_build_object('operationId', p_operation, 'revisionId', p_revision,
    'lifecycle', 'active', 'activatedAt', v_activated,
    'guaranteeKobo', v_guarantee, 'collectionPaused', true,
    'collectionConsent', 'not_granted', 'evidence', 'local_synthetic_only',
    'durationMonths', v_months, 'maturesAt', v_matures,
    'graceExpiresAt', v_grace);
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.activate_lifecycle(uuid, uuid, uuid, uuid, text, uuid, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

-- Read the funding capability for a goal: the wallet identity bound to the
-- goal, the latest staged policy, and the ledger snapshot. Any missing piece
-- (unbound actor, no mapping, no staged policy, no ledger binding) returns
-- NULL instead of a partial capability; callers treat NULL as unavailable.
CREATE FUNCTION piggyvest_goal_policy.read_funding_capability(
  p_integration uuid, p_merchant uuid, p_customer uuid, p_goal uuid, p_business text,
  p_actor uuid
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO '' AS $$
DECLARE
  v_wallet text;
  v_wallet_customer text;
  v_policy jsonb;
  v_snapshot jsonb;
BEGIN
  IF session_user <> 'piggyvest_staging_policy_writer' THEN
    RAISE EXCEPTION 'funding capability denied' USING ERRCODE = '42501';
  END IF;
  IF p_integration IS NULL OR p_merchant IS NULL OR p_customer IS NULL
    OR p_goal IS NULL OR p_business IS NULL OR p_actor IS NULL THEN
    RAISE EXCEPTION 'funding capability invalid scope' USING ERRCODE = '22023';
  END IF;
  PERFORM customer.id FROM public.customers AS customer
    WHERE customer.id = p_customer AND customer.merchant_id = p_merchant
      AND customer.user_id = p_actor FOR SHARE;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT mapping.provider_wallet_id, mapping.provider_customer_id
    INTO v_wallet, v_wallet_customer
    FROM piggyvest_staging.wallet_goal_mappings AS mapping
    JOIN piggyvest_staging.integrations AS registry
      ON registry.id = mapping.integration_id AND registry.enabled
    WHERE mapping.integration_id = p_integration
      AND mapping.merchant_id = p_merchant
      AND mapping.customer_id = p_customer
      AND mapping.goal_id = p_goal
    FOR SHARE OF registry;
  IF NOT FOUND THEN RETURN NULL; END IF;
  SELECT snapshots.policy INTO v_policy FROM piggyvest_goal_policy.snapshots AS snapshots
    WHERE snapshots.goal_id = p_goal ORDER BY snapshots.created_at DESC LIMIT 1;
  IF NOT FOUND THEN RETURN NULL; END IF;
  BEGIN
    v_snapshot := piggyvest_savings_ledger.snapshot(p_integration, p_merchant, p_customer, p_goal);
  EXCEPTION WHEN insufficient_privilege THEN
    RETURN NULL;
  END;
  RETURN jsonb_build_object(
    'identity', jsonb_build_object('environment', 'staging',
      'integrationId', p_integration, 'merchantId', p_merchant,
      'customerId', p_customer, 'goalId', p_goal,
      'providerWalletId', v_wallet, 'providerCustomerId', v_wallet_customer),
    'policy', v_policy,
    'ledgerSnapshot', v_snapshot
  );
END $$;
REVOKE ALL ON FUNCTION piggyvest_goal_policy.read_funding_capability(uuid, uuid, uuid, uuid, text, uuid)
  FROM PUBLIC, anon, authenticated, service_role;

COMMENT ON SCHEMA piggyvest_goal_policy IS
  'Goal-policy prerequisite (reconstructed from in-repo consumers). Terms, staged snapshots, lifecycle terms, and activation receipts. Every mutating entrypoint serializes on lock_scope, validates ownership, and fails closed; reads return NULL when unavailable.';
COMMIT;

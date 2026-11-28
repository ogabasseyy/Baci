-- Cloudflare for SaaS multi-tenant custom-domain lifecycle.
-- Mirrors the restricted-writer boundary in 20261122064203_wallet_dva_restricted_writer.sql.
-- Does not create login passwords or grant direct table writes to authenticated users.

DO $roles$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_domain_lifecycle_writer'
  ) THEN
    CREATE ROLE baci_domain_lifecycle_writer
      NOLOGIN NOSUPERUSER NOBYPASSRLS NOCREATEROLE NOCREATEDB NOREPLICATION;
  END IF;
END;
$roles$;

DO $assert_role$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_catalog.pg_roles
    WHERE rolname = 'baci_domain_lifecycle_writer'
      AND NOT rolcanlogin
      AND NOT rolsuper
      AND NOT rolbypassrls
      AND NOT rolcreaterole
      AND NOT rolcreatedb
      AND NOT rolreplication
  ) THEN
    RAISE EXCEPTION
      'baci_domain_lifecycle_writer must be a non-login least-privilege role'
      USING ERRCODE = '42501';
  END IF;
END;
$assert_role$;

CREATE SCHEMA IF NOT EXISTS domain_lifecycle_private;
REVOKE ALL ON SCHEMA domain_lifecycle_private FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA domain_lifecycle_private TO baci_domain_lifecycle_writer;

CREATE TABLE IF NOT EXISTS public.domain_provider_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain_id uuid NOT NULL UNIQUE REFERENCES public.domains(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  hostname text NOT NULL UNIQUE,
  dns_routing_provider text NOT NULL DEFAULT 'cloudflare_saas'
    CHECK (dns_routing_provider IN ('cloudflare_saas', 'vercel')),
  cloudflare_zone_id text,
  cloudflare_hostname_id text,
  requested_is_primary boolean NOT NULL DEFAULT false,
  lifecycle_state text NOT NULL DEFAULT 'provisioning'
    CHECK (
      lifecycle_state IN (
        'provisioning',
        'pending_verification',
        'verifying_routing',
        'active',
        'deleting',
        'deleting_reconciling'
      )
    ),
  current_operation_id uuid,
  in_flight_lease_until timestamptz,
  cloudflare_create_state text NOT NULL DEFAULT 'none'
    CHECK (
      cloudflare_create_state IN (
        'none',
        'in_flight',
        'indeterminate',
        'confirmed',
        'deleted'
      )
    ),
  vercel_create_state text NOT NULL DEFAULT 'none'
    CHECK (
      vercel_create_state IN (
        'none',
        'in_flight',
        'indeterminate',
        'confirmed',
        'deleted'
      )
    ),
  next_reconcile_at timestamptz,
  provider_verification_records jsonb NOT NULL DEFAULT '[]'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_domain_provider_bindings_merchant_id
  ON public.domain_provider_bindings (merchant_id);

CREATE INDEX IF NOT EXISTS idx_domain_provider_bindings_reconcile_due
  ON public.domain_provider_bindings (next_reconcile_at)
  WHERE lifecycle_state IN ('provisioning', 'verifying_routing', 'deleting', 'deleting_reconciling');

CREATE TABLE IF NOT EXISTS domain_lifecycle_private.domain_provider_attempts (
  attempt_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  binding_id uuid NOT NULL REFERENCES public.domain_provider_bindings(id) ON DELETE CASCADE,
  provider text NOT NULL CHECK (provider IN ('cloudflare', 'vercel')),
  operation_id uuid NOT NULL,
  state text NOT NULL CHECK (state IN ('in_flight', 'indeterminate', 'confirmed', 'deleted', 'failed')),
  provider_object_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_domain_provider_attempts_binding_provider
  ON domain_lifecycle_private.domain_provider_attempts (binding_id, provider, created_at DESC);

ALTER TABLE public.domain_provider_bindings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.domain_provider_bindings FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.domain_provider_bindings TO authenticated;

DROP POLICY IF EXISTS domain_provider_bindings_merchant_select ON public.domain_provider_bindings;
CREATE POLICY domain_provider_bindings_merchant_select
  ON public.domain_provider_bindings
  FOR SELECT
  TO authenticated
  USING (
    public.check_staff_permission(
      auth.uid(),
      domain_provider_bindings.merchant_id,
      'settings',
      'view'
    )
  );

-- Protect SaaS-bound parent `public.domains` rows from direct client mutations
-- to routing-authoritative columns AND from direct client DELETEs.
CREATE OR REPLACE FUNCTION domain_lifecycle_private.guard_saas_bound_domains_parent_update()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $trigger$
BEGIN
  IF pg_catalog.current_setting('app.domain_lifecycle_bypass', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN
      RETURN OLD;
    END IF;
    RETURN NEW;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.domain_provider_bindings b
    WHERE b.domain_id = OLD.id
  ) THEN
    IF TG_OP = 'DELETE' THEN
      RAISE EXCEPTION
        'SaaS-bound domains must be deleted through domain lifecycle RPCs'
        USING ERRCODE = '42501';
    END IF;

    IF NEW.domain IS DISTINCT FROM OLD.domain
      OR NEW.merchant_id IS DISTINCT FROM OLD.merchant_id
      OR NEW.status IS DISTINCT FROM OLD.status
      OR NEW.ssl_status IS DISTINCT FROM OLD.ssl_status
      OR NEW.verified_at IS DISTINCT FROM OLD.verified_at
      OR NEW.is_primary IS DISTINCT FROM OLD.is_primary
    THEN
      RAISE EXCEPTION
        'SaaS-bound domain routing columns must be updated through domain lifecycle RPCs'
        USING ERRCODE = '42501';
    END IF;
  END IF;

  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$trigger$;

DROP TRIGGER IF EXISTS trg_guard_saas_bound_domains_parent_update ON public.domains;
CREATE TRIGGER trg_guard_saas_bound_domains_parent_update
  BEFORE UPDATE OR DELETE ON public.domains
  FOR EACH ROW
  EXECUTE FUNCTION domain_lifecycle_private.guard_saas_bound_domains_parent_update();

-- Helper: resolve caller's merchant_id and enforce owner or active staff with
-- effective settings.edit permission (honoring explicit per-user revocations).
CREATE OR REPLACE FUNCTION domain_lifecycle_private.resolve_authorized_merchant_for_domain_edit()
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_uid uuid := auth.uid();
  v_merchant_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'unauthorized' USING ERRCODE = '42501';
  END IF;

  SELECT m.id
  INTO v_merchant_id
  FROM public.merchants m
  WHERE m.user_id = v_uid
  LIMIT 1;

  IF v_merchant_id IS NOT NULL THEN
    RETURN v_merchant_id;
  END IF;

  SELECT s.merchant_id
  INTO v_merchant_id
  FROM public.staff_members s
  WHERE s.user_id = v_uid
    AND s.status = 'active'
    AND public.check_staff_permission(v_uid, s.merchant_id, 'settings', 'edit')
  LIMIT 1;

  IF v_merchant_id IS NULL THEN
    RAISE EXCEPTION 'forbidden_settings_edit' USING ERRCODE = '42501';
  END IF;

  RETURN v_merchant_id;
END;
$fn$;

-- Merchant-callable Intent RPC 1: Reserve BYOD SaaS domain onboarding
CREATE OR REPLACE FUNCTION public.reserve_merchant_domain_onboarding(
  p_hostname text,
  p_is_primary boolean DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_merchant_id uuid;
  v_hostname text;
  v_tld text;
  v_entitled boolean := false;
  v_existing public.domain_provider_bindings%ROWTYPE;
  v_domain_id uuid;
  v_op_id uuid := gen_random_uuid();
  v_lease_until timestamptz := now() + interval '30 seconds';
BEGIN
  v_merchant_id := domain_lifecycle_private.resolve_authorized_merchant_for_domain_edit();
  v_hostname := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hostname, '')));

  IF v_hostname = ''
    OR length(v_hostname) > 253
    OR v_hostname !~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
  THEN
    RAISE EXCEPTION 'invalid_hostname' USING ERRCODE = '22023';
  END IF;

  SELECT (
    (
      jsonb_typeof(m.premium_features) = 'array'
      AND (
        m.premium_features ? 'custom_domain'
        OR m.premium_features ? 'all_features'
      )
    )
    OR (
      m.plan_tier IN ('starter', 'pro', 'business', 'enterprise')
      AND (m.plan_expires_at IS NULL OR m.plan_expires_at > now())
    )
  )
  INTO v_entitled
  FROM public.merchants m
  WHERE m.id = v_merchant_id;

  IF coalesce(v_entitled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'custom_domain_entitlement_required' USING ERRCODE = '42501';
  END IF;

  PERFORM pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('domain_reserve:' || v_hostname, 0)
  );

  SELECT b.*
  INTO v_existing
  FROM public.domain_provider_bindings b
  WHERE b.hostname = v_hostname
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.merchant_id <> v_merchant_id THEN
      RAISE EXCEPTION 'domain_already_registered' USING ERRCODE = '23505';
    END IF;

    IF v_existing.lifecycle_state IN ('deleting', 'deleting_reconciling') THEN
      RAISE EXCEPTION 'domain_deletion_in_progress' USING ERRCODE = 'P0001';
    END IF;

    IF v_existing.in_flight_lease_until IS NOT NULL
      AND v_existing.in_flight_lease_until > now()
    THEN
      RETURN jsonb_build_object(
        'status', 'in_flight',
        'domain_id', v_existing.domain_id,
        'binding_id', v_existing.id,
        'operation_id', v_existing.current_operation_id,
        'lifecycle_state', v_existing.lifecycle_state,
        'verification_records', v_existing.provider_verification_records
      );
    END IF;

    -- Lease expired: take over with a new operation_id while preserving
    -- existing unresolved attempts in domain_provider_attempts.
    UPDATE public.domain_provider_bindings
    SET current_operation_id = v_op_id,
        in_flight_lease_until = v_lease_until,
        next_reconcile_at = v_lease_until,
        requested_is_primary = coalesce(p_is_primary, requested_is_primary),
        updated_at = now()
    WHERE id = v_existing.id;

    RETURN jsonb_build_object(
      'status', 'resumed',
      'domain_id', v_existing.domain_id,
      'binding_id', v_existing.id,
      'operation_id', v_op_id,
      'lifecycle_state', v_existing.lifecycle_state,
      'cloudflare_create_state', v_existing.cloudflare_create_state,
      'vercel_create_state', v_existing.vercel_create_state
    );
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.domains d WHERE pg_catalog.lower(d.domain) = v_hostname
  ) THEN
    RAISE EXCEPTION 'domain_already_registered' USING ERRCODE = '23505';
  END IF;

  v_tld := '.' || pg_catalog.split_part(v_hostname, '.', pg_catalog.array_length(pg_catalog.string_to_array(v_hostname, '.'), 1));

  -- Always insert parent domains row with is_primary = false + valid pending
  -- verification_token and expiry (satisfies domains_check & unique primary index).
  INSERT INTO public.domains (
    merchant_id,
    domain,
    tld,
    domain_type,
    status,
    ssl_status,
    is_primary,
    verification_token,
    verification_token_expires_at
  )
  VALUES (
    v_merchant_id,
    v_hostname,
    v_tld,
    'custom',
    'pending',
    'pending',
    false,
    gen_random_uuid()::text,
    now() + interval '48 hours'
  )
  RETURNING id INTO v_domain_id;

  INSERT INTO public.domain_provider_bindings (
    domain_id,
    merchant_id,
    hostname,
    dns_routing_provider,
    requested_is_primary,
    lifecycle_state,
    current_operation_id,
    in_flight_lease_until,
    next_reconcile_at
  )
  VALUES (
    v_domain_id,
    v_merchant_id,
    v_hostname,
    'cloudflare_saas',
    coalesce(p_is_primary, false),
    'provisioning',
    v_op_id,
    v_lease_until,
    v_lease_until
  );

  RETURN jsonb_build_object(
    'status', 'reserved',
    'domain_id', v_domain_id,
    'operation_id', v_op_id,
    'lifecycle_state', 'provisioning'
  );
END;
$fn$;

-- Merchant-callable Intent RPC 2: Request deletion of a merchant-owned domain
CREATE OR REPLACE FUNCTION public.request_merchant_domain_deletion(
  p_hostname text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_merchant_id uuid;
  v_hostname text;
  v_domain_id uuid;
  v_binding public.domain_provider_bindings%ROWTYPE;
  v_op_id uuid := gen_random_uuid();
  v_lease_until timestamptz := now() + interval '30 seconds';
BEGIN
  v_merchant_id := domain_lifecycle_private.resolve_authorized_merchant_for_domain_edit();
  v_hostname := pg_catalog.lower(pg_catalog.btrim(coalesce(p_hostname, '')));

  SELECT d.id
  INTO v_domain_id
  FROM public.domains d
  WHERE d.merchant_id = v_merchant_id
    AND pg_catalog.lower(d.domain) = v_hostname
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;

  SELECT b.*
  INTO v_binding
  FROM public.domain_provider_bindings b
  WHERE b.domain_id = v_domain_id
  FOR UPDATE;

  IF NOT FOUND THEN
    -- Legacy Vercel BYOD or Baci-purchased domain (no SaaS binding)
    RETURN jsonb_build_object(
      'status', 'legacy',
      'domain_id', v_domain_id
    );
  END IF;

  IF v_binding.lifecycle_state = 'provisioning'
    AND v_binding.in_flight_lease_until IS NOT NULL
    AND v_binding.in_flight_lease_until > now()
  THEN
    RAISE EXCEPTION 'in_flight_lease_active' USING ERRCODE = 'P0001';
  END IF;

  IF v_binding.lifecycle_state IN ('deleting', 'deleting_reconciling')
    AND v_binding.in_flight_lease_until IS NOT NULL
    AND v_binding.in_flight_lease_until > now()
  THEN
    RETURN jsonb_build_object(
      'status', 'in_flight',
      'domain_id', v_domain_id,
      'binding_id', v_binding.id,
      'operation_id', v_binding.current_operation_id,
      'cloudflare_zone_id', v_binding.cloudflare_zone_id,
      'cloudflare_hostname_id', v_binding.cloudflare_hostname_id,
      'cloudflare_create_state', v_binding.cloudflare_create_state,
      'vercel_create_state', v_binding.vercel_create_state
    );
  END IF;

  UPDATE public.domain_provider_bindings
  SET lifecycle_state = 'deleting',
      current_operation_id = v_op_id,
      in_flight_lease_until = v_lease_until,
      next_reconcile_at = v_lease_until,
      updated_at = now()
  WHERE id = v_binding.id;

  RETURN jsonb_build_object(
    'status', 'deleting',
    'domain_id', v_domain_id,
    'binding_id', v_binding.id,
    'operation_id', v_op_id,
    'cloudflare_zone_id', v_binding.cloudflare_zone_id,
    'cloudflare_hostname_id', v_binding.cloudflare_hostname_id,
    'cloudflare_create_state', v_binding.cloudflare_create_state,
    'vercel_create_state', v_binding.vercel_create_state
  );
END;
$fn$;

-- Merchant-callable Intent RPC 3: Atomically set an active domain as primary
-- (handles SaaS-bound domains cleanly without bypassing the parent guard trigger)
CREATE OR REPLACE FUNCTION public.set_merchant_primary_domain(
  p_domain text
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_merchant_id uuid;
  v_hostname text;
  v_entitled boolean := false;
  v_target public.domains%ROWTYPE;
BEGIN
  v_merchant_id := domain_lifecycle_private.resolve_authorized_merchant_for_domain_edit();
  v_hostname := pg_catalog.lower(pg_catalog.btrim(coalesce(p_domain, '')));

  SELECT (
    (
      jsonb_typeof(m.premium_features) = 'array'
      AND (
        m.premium_features ? 'custom_domain'
        OR m.premium_features ? 'all_features'
      )
    )
    OR (
      m.plan_tier IN ('starter', 'pro', 'business', 'enterprise')
      AND (m.plan_expires_at IS NULL OR m.plan_expires_at > now())
    )
  )
  INTO v_entitled
  FROM public.merchants m
  WHERE m.id = v_merchant_id;

  IF coalesce(v_entitled, false) IS NOT TRUE THEN
    RAISE EXCEPTION 'custom_domain_entitlement_required' USING ERRCODE = '42501';
  END IF;

  SELECT d.*
  INTO v_target
  FROM public.domains d
  WHERE d.merchant_id = v_merchant_id
    AND pg_catalog.lower(d.domain) = v_hostname
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain_not_found' USING ERRCODE = 'P0001';
  END IF;

  IF v_target.status <> 'active' THEN
    RAISE EXCEPTION 'domain_not_active' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.set_config('app.domain_lifecycle_bypass', 'on', true);

  UPDATE public.domains
  SET is_primary = false,
      updated_at = now()
  WHERE merchant_id = v_merchant_id
    AND is_primary IS TRUE
    AND id <> v_target.id;

  UPDATE public.domains
  SET is_primary = true,
      updated_at = now()
  WHERE id = v_target.id;

  RETURN jsonb_build_object(
    'status', 'updated',
    'domain_id', v_target.id,
    'domain', v_target.domain
  );
END;
$fn$;

REVOKE ALL ON FUNCTION public.reserve_merchant_domain_onboarding(text, boolean) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.reserve_merchant_domain_onboarding(text, boolean) TO authenticated;

REVOKE ALL ON FUNCTION public.request_merchant_domain_deletion(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.request_merchant_domain_deletion(text) TO authenticated;

REVOKE ALL ON FUNCTION public.set_merchant_primary_domain(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_merchant_primary_domain(text) TO authenticated;

-- Trusted Server-Only RPC 1: Claim due bindings exclusively (post-commit safe)
CREATE OR REPLACE FUNCTION domain_lifecycle_private.claim_due_domain_bindings(
  p_limit int DEFAULT 10,
  p_lease_seconds int DEFAULT 30
)
RETURNS SETOF public.domain_provider_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_limit int := GREATEST(1, LEAST(coalesce(p_limit, 10), 50));
  v_lease_secs int := GREATEST(10, LEAST(coalesce(p_lease_seconds, 30), 300));
  v_lease_until timestamptz := now() + pg_catalog.make_interval(secs => v_lease_secs);
BEGIN
  RETURN QUERY
  WITH due AS (
    SELECT b.id
    FROM public.domain_provider_bindings b
    WHERE (b.in_flight_lease_until IS NULL OR b.in_flight_lease_until <= now())
      AND b.lifecycle_state IN ('provisioning', 'verifying_routing', 'deleting', 'deleting_reconciling')
      AND (b.next_reconcile_at IS NULL OR b.next_reconcile_at <= now())
    ORDER BY coalesce(b.next_reconcile_at, b.updated_at) ASC
    LIMIT v_limit
    FOR UPDATE SKIP LOCKED
  )
  UPDATE public.domain_provider_bindings b
  SET current_operation_id = gen_random_uuid(),
      in_flight_lease_until = v_lease_until,
      next_reconcile_at = v_lease_until,
      updated_at = now()
  FROM due
  WHERE b.id = due.id
  RETURNING b.*;
END;
$fn$;

-- Trusted Server-Only RPC 2: Record provider attempt / result (fenced by operation_id)
CREATE OR REPLACE FUNCTION domain_lifecycle_private.record_domain_provider_result(
  p_domain_id uuid,
  p_operation_id uuid,
  p_provider text,
  p_state text,
  p_cloudflare_zone_id text DEFAULT NULL,
  p_cloudflare_hostname_id text DEFAULT NULL,
  p_verification_records jsonb DEFAULT NULL,
  p_next_reconcile_seconds int DEFAULT NULL
)
RETURNS public.domain_provider_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
  v_next_reconcile timestamptz;
BEGIN
  SELECT b.*
  INTO v_binding
  FROM public.domain_provider_bindings b
  WHERE b.domain_id = p_domain_id
    AND b.current_operation_id = p_operation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_or_invalid_operation_id' USING ERRCODE = 'P0001';
  END IF;

  INSERT INTO domain_lifecycle_private.domain_provider_attempts (
    binding_id,
    provider,
    operation_id,
    state,
    provider_object_id,
    resolved_at
  )
  VALUES (
    v_binding.id,
    p_provider,
    p_operation_id,
    p_state,
    CASE WHEN p_provider = 'cloudflare' THEN p_cloudflare_hostname_id ELSE NULL END,
    CASE WHEN p_state IN ('confirmed', 'deleted', 'failed') THEN now() ELSE NULL END
  );

  v_next_reconcile := CASE
    WHEN p_next_reconcile_seconds IS NOT NULL THEN now() + pg_catalog.make_interval(secs => GREATEST(10, p_next_reconcile_seconds))
    WHEN p_state = 'in_flight' THEN coalesce(v_binding.in_flight_lease_until, now() + interval '30 seconds')
    WHEN p_state = 'indeterminate' THEN now() + interval '120 seconds'
    ELSE v_binding.next_reconcile_at
  END;

  UPDATE public.domain_provider_bindings
  SET cloudflare_zone_id = coalesce(p_cloudflare_zone_id, cloudflare_zone_id),
      cloudflare_hostname_id = coalesce(p_cloudflare_hostname_id, cloudflare_hostname_id),
      cloudflare_create_state = CASE WHEN p_provider = 'cloudflare' THEN p_state ELSE cloudflare_create_state END,
      vercel_create_state = CASE WHEN p_provider = 'vercel' THEN p_state ELSE vercel_create_state END,
      provider_verification_records = coalesce(p_verification_records, provider_verification_records),
      next_reconcile_at = v_next_reconcile,
      lifecycle_state = CASE
        WHEN lifecycle_state = 'provisioning'
          AND (CASE WHEN p_provider = 'cloudflare' THEN p_state ELSE cloudflare_create_state END) = 'confirmed'
          AND (CASE WHEN p_provider = 'vercel' THEN p_state ELSE vercel_create_state END) = 'confirmed'
        THEN 'pending_verification'
        WHEN lifecycle_state = 'deleting'
          AND (
            (CASE WHEN p_provider = 'cloudflare' THEN p_state ELSE cloudflare_create_state END) IN ('in_flight', 'indeterminate')
            OR (CASE WHEN p_provider = 'vercel' THEN p_state ELSE vercel_create_state END) IN ('in_flight', 'indeterminate')
          )
        THEN 'deleting_reconciling'
        ELSE lifecycle_state
      END,
      in_flight_lease_until = CASE
        WHEN lifecycle_state = 'provisioning'
          AND (CASE WHEN p_provider = 'cloudflare' THEN p_state ELSE cloudflare_create_state END) = 'confirmed'
          AND (CASE WHEN p_provider = 'vercel' THEN p_state ELSE vercel_create_state END) = 'confirmed'
        THEN NULL
        ELSE in_flight_lease_until
      END,
      updated_at = now()
  WHERE id = v_binding.id
  RETURNING * INTO v_binding;

  RETURN v_binding;
END;
$fn$;

-- Trusted Server-Only RPC 3: Advance to verifying_routing (inbound-only Edge Config probe)
-- Sets a 30s lease + next_reconcile_at so an interrupted probe is automatically
-- recovered by the reconciler or by a subsequent verify retry after lease expiry.
CREATE OR REPLACE FUNCTION domain_lifecycle_private.advance_domain_to_verifying_routing(
  p_domain_id uuid,
  p_operation_id uuid
)
RETURNS public.domain_provider_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
  v_lease_until timestamptz := now() + interval '30 seconds';
BEGIN
  UPDATE public.domain_provider_bindings
  SET lifecycle_state = 'verifying_routing',
      current_operation_id = p_operation_id,
      in_flight_lease_until = v_lease_until,
      next_reconcile_at = v_lease_until,
      updated_at = now()
  WHERE domain_id = p_domain_id
    AND (
      lifecycle_state = 'pending_verification'
      OR (
        lifecycle_state = 'verifying_routing'
        AND (in_flight_lease_until IS NULL OR in_flight_lease_until <= now())
      )
    )
  RETURNING * INTO v_binding;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain_not_ready_for_routing_verification' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_binding;
END;
$fn$;

-- Trusted Server-Only RPC 4: Commit active + atomic primary swap + ssl_status/verified_at
CREATE OR REPLACE FUNCTION domain_lifecycle_private.commit_domain_active(
  p_domain_id uuid,
  p_operation_id uuid
)
RETURNS public.domain_provider_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
BEGIN
  SELECT b.*
  INTO v_binding
  FROM public.domain_provider_bindings b
  WHERE b.domain_id = p_domain_id
    AND b.current_operation_id = p_operation_id
    AND b.lifecycle_state = 'verifying_routing'
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain_not_in_verifying_routing' USING ERRCODE = 'P0001';
  END IF;

  PERFORM pg_catalog.set_config('app.domain_lifecycle_bypass', 'on', true);

  IF v_binding.requested_is_primary THEN
    UPDATE public.domains
    SET is_primary = false,
        updated_at = now()
    WHERE merchant_id = v_binding.merchant_id
      AND is_primary IS TRUE
      AND id <> v_binding.domain_id;
  END IF;

  UPDATE public.domains
  SET status = 'active',
      ssl_status = 'active',
      verified_at = now(),
      is_primary = CASE WHEN v_binding.requested_is_primary THEN true ELSE is_primary END,
      updated_at = now()
  WHERE id = v_binding.domain_id;

  UPDATE public.domain_provider_bindings
  SET lifecycle_state = 'active',
      in_flight_lease_until = NULL,
      next_reconcile_at = NULL,
      updated_at = now()
  WHERE id = v_binding.id
  RETURNING * INTO v_binding;

  RETURN v_binding;
END;
$fn$;

-- Trusted Server-Only RPC 5: Withdraw failed routing probe
CREATE OR REPLACE FUNCTION domain_lifecycle_private.withdraw_domain_verifying_routing(
  p_domain_id uuid,
  p_operation_id uuid
)
RETURNS public.domain_provider_bindings
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
BEGIN
  UPDATE public.domain_provider_bindings
  SET lifecycle_state = 'pending_verification',
      in_flight_lease_until = NULL,
      updated_at = now()
  WHERE domain_id = p_domain_id
    AND current_operation_id = p_operation_id
    AND lifecycle_state = 'verifying_routing'
  RETURNING * INTO v_binding;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'domain_not_in_verifying_routing' USING ERRCODE = 'P0001';
  END IF;

  RETURN v_binding;
END;
$fn$;

-- Trusted Server-Only RPC 6: Finalize deletion only when both providers are terminal or operator reconciled
CREATE OR REPLACE FUNCTION domain_lifecycle_private.finalize_domain_deletion(
  p_domain_id uuid,
  p_operation_id uuid,
  p_operator_reconciled boolean DEFAULT false
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $fn$
DECLARE
  v_binding public.domain_provider_bindings%ROWTYPE;
BEGIN
  SELECT b.*
  INTO v_binding
  FROM public.domain_provider_bindings b
  WHERE b.domain_id = p_domain_id
    AND b.current_operation_id = p_operation_id
    AND b.lifecycle_state IN ('deleting', 'deleting_reconciling')
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'stale_or_invalid_deletion_operation' USING ERRCODE = 'P0001';
  END IF;

  IF NOT coalesce(p_operator_reconciled, false) THEN
    IF v_binding.cloudflare_create_state IN ('in_flight', 'indeterminate', 'confirmed')
      OR v_binding.vercel_create_state IN ('in_flight', 'indeterminate', 'confirmed')
    THEN
      UPDATE public.domain_provider_bindings
      SET lifecycle_state = 'deleting_reconciling',
          in_flight_lease_until = NULL,
          next_reconcile_at = now() + interval '120 seconds',
          updated_at = now()
      WHERE id = v_binding.id;
      RETURN false;
    END IF;
  END IF;

  PERFORM pg_catalog.set_config('app.domain_lifecycle_bypass', 'on', true);
  DELETE FROM public.domains WHERE id = v_binding.domain_id;
  RETURN true;
END;
$fn$;

-- Trusted Server-Only RPC 7: List active SaaS hostnames & zones for cache purge
-- Avoids constructing a service-role client outside the approved cache-drain route.
CREATE OR REPLACE FUNCTION domain_lifecycle_private.list_active_saas_purge_targets(
  p_merchant_id uuid
)
RETURNS TABLE (hostname text, cloudflare_zone_id text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = ''
AS $fn$
  SELECT b.hostname, b.cloudflare_zone_id
  FROM public.domain_provider_bindings b
  WHERE b.merchant_id = p_merchant_id
    AND b.lifecycle_state = 'active'
    AND b.dns_routing_provider = 'cloudflare_saas';
$fn$;

REVOKE ALL ON FUNCTION domain_lifecycle_private.claim_due_domain_bindings(int, int) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.record_domain_provider_result(uuid, uuid, text, text, text, text, jsonb, int) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.advance_domain_to_verifying_routing(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.commit_domain_active(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.withdraw_domain_verifying_routing(uuid, uuid) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.finalize_domain_deletion(uuid, uuid, boolean) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION domain_lifecycle_private.list_active_saas_purge_targets(uuid) FROM PUBLIC, anon, authenticated, service_role;

GRANT EXECUTE ON FUNCTION domain_lifecycle_private.claim_due_domain_bindings(int, int) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.record_domain_provider_result(uuid, uuid, text, text, text, text, jsonb, int) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.advance_domain_to_verifying_routing(uuid, uuid) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.commit_domain_active(uuid, uuid) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.withdraw_domain_verifying_routing(uuid, uuid) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.finalize_domain_deletion(uuid, uuid, boolean) TO baci_domain_lifecycle_writer;
GRANT EXECUTE ON FUNCTION domain_lifecycle_private.list_active_saas_purge_targets(uuid) TO baci_domain_lifecycle_writer;

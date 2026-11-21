-- Isolated local PostgreSQL 17 bootstrap mirroring the origin/main (5141bd4d71)
-- Supabase roles, schemas, and quiz v2 tables/functions/triggers so that
-- 20261118170000_quiz_stage1_edge_prototype_v2.sql and quiz_stage1_prototype.sql
-- execute against real PostgreSQL without touching any remote/cloud DB.

\set ON_ERROR_STOP on

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'postgres') THEN
    CREATE ROLE postgres SUPERUSER LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
    CREATE ROLE authenticated NOLOGIN NOINHERIT;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN NOINHERIT BYPASSRLS;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticator') THEN
    CREATE ROLE authenticator NOINHERIT LOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'gigl_tracking_worker') THEN
    CREATE ROLE gigl_tracking_worker NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

GRANT anon, authenticated, service_role, gigl_tracking_worker TO authenticator;

CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS private;
CREATE SCHEMA IF NOT EXISTS realtime;

CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA extensions;
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

GRANT USAGE ON SCHEMA public, extensions, auth TO anon, authenticated, service_role;
GRANT ALL ON SCHEMA public TO postgres;

-- Emulate Supabase auth.uid() / auth.role()
CREATE OR REPLACE FUNCTION auth.uid()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.sub', true), ''),
    NULLIF((NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub'), '')
  )::uuid;
$$;

CREATE OR REPLACE FUNCTION auth.role()
RETURNS text
LANGUAGE sql
STABLE
AS $$
  SELECT COALESCE(
    NULLIF(pg_catalog.current_setting('request.jwt.claim.role', true), ''),
    NULLIF((NULLIF(pg_catalog.current_setting('request.jwt.claims', true), '')::jsonb ->> 'role'), ''),
    current_user::text
  );
$$;

GRANT EXECUTE ON FUNCTION auth.uid(), auth.role() TO PUBLIC;

CREATE TABLE IF NOT EXISTS auth.users (
  id uuid PRIMARY KEY,
  instance_id uuid,
  aud text,
  role text,
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  raw_app_meta_data jsonb DEFAULT '{}'::jsonb,
  raw_user_meta_data jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.merchants (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  user_id uuid,
  email text NOT NULL,
  business_name text,
  slug text,
  payout_currency text DEFAULT 'NGN',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.products (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  name text NOT NULL,
  price numeric(10,2) NOT NULL,
  stock_quantity integer DEFAULT 0,
  manage_stock boolean DEFAULT true,
  has_variants boolean DEFAULT false,
  variant_model text,
  inventory_tracking_policy text DEFAULT 'none',
  status text DEFAULT 'draft',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_variants (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  price_override numeric(10,2),
  stock_quantity integer DEFAULT 0,
  inventory_tracking_policy text DEFAULT 'none',
  is_inventory_anchor boolean DEFAULT false,
  attributes jsonb DEFAULT '{}'::jsonb
);

CREATE TABLE IF NOT EXISTS public.customers (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  merchant_id uuid REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid,
  email text,
  first_name text,
  last_name text,
  phone text,
  full_name text,
  username text,
  username_changed_at timestamptz,
  date_of_birth date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  deleted_at timestamptz
);

CREATE UNIQUE INDEX IF NOT EXISTS customers_merchant_email_unique
  ON public.customers (merchant_id, lower(email))
  WHERE email IS NOT NULL AND email <> '';
CREATE INDEX IF NOT EXISTS idx_customers_user_id ON public.customers (user_id);
CREATE INDEX IF NOT EXISTS idx_customers_deleted_at ON public.customers (deleted_at);

CREATE TABLE IF NOT EXISTS public.orders (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  customer_id uuid REFERENCES public.customers(id) ON DELETE SET NULL,
  order_number text,
  customer_email text,
  customer_name text,
  customer_phone text,
  subtotal numeric(12,2) DEFAULT 0,
  shipping_fee numeric(12,2) DEFAULT 0,
  discount_amount numeric(12,2) DEFAULT 0,
  tax_amount numeric(12,2) DEFAULT 0,
  total numeric(12,2) DEFAULT 0,
  currency text DEFAULT 'NGN',
  payment_method text,
  payment_status text DEFAULT 'pending',
  shipping_status text DEFAULT 'pending',
  source text,
  notes text,
  tax_basis text,
  fulfillment_details jsonb,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.order_items (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  order_id uuid NOT NULL REFERENCES public.orders(id) ON DELETE CASCADE,
  product_id uuid,
  variant_id uuid,
  variant_name text,
  name text,
  price numeric(12,2) DEFAULT 0,
  quantity integer DEFAULT 1,
  condition text,
  variant_attributes jsonb DEFAULT '{}'::jsonb,
  fulfillment_data jsonb
);

CREATE TABLE IF NOT EXISTS public.quiz_events (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  slug text NOT NULL,
  title text NOT NULL,
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'active', 'completed', 'cancelled')),
  starts_at timestamptz,
  ends_at timestamptz,
  award_finalized_at timestamptz,
  compliance_verified boolean NOT NULL DEFAULT false,
  nlrc_permit_ref text,
  published_odds jsonb NOT NULL DEFAULT '{}'::jsonb,
  compliance_flags jsonb NOT NULL DEFAULT '{}'::jsonb,
  settings jsonb NOT NULL DEFAULT '{}'::jsonb,
  mode text NOT NULL DEFAULT 'live' CHECK (mode IN ('test', 'live')),
  contract_version integer NOT NULL DEFAULT 1 CHECK (contract_version IN (1, 2)),
  results_published_at timestamptz,
  rules_version text,
  question_count integer NOT NULL DEFAULT 1,
  time_per_question_seconds integer NOT NULL DEFAULT 30,
  maximum_play_seconds integer NOT NULL DEFAULT 30,
  live_window_seconds integer NOT NULL DEFAULT 30,
  max_attempts integer NOT NULL DEFAULT 1,
  time_zone text NOT NULL DEFAULT 'Africa/Lagos',
  attempts_terminalized_at timestamptz,
  finalization_state text NOT NULL DEFAULT 'pending' CHECK (finalization_state IN ('pending', 'blocked', 'awarded', 'no_winner', 'test_published')),
  finalization_error_code text,
  claim_window_seconds integer CHECK (claim_window_seconds IS NULL OR claim_window_seconds > 0),
  regulatory_basis text,
  regulatory_jurisdiction text,
  regulatory_evidence_ref text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (merchant_id, slug)
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_events_id_merchant_unique ON public.quiz_events (id, merchant_id);

CREATE TABLE IF NOT EXISTS public.quiz_question_slots (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  slot_index integer NOT NULL CHECK (slot_index > 0),
  category text,
  difficulty text NOT NULL DEFAULT 'standard',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, slot_index)
);

CREATE TABLE IF NOT EXISTS public.quiz_question_variants (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  slot_id uuid NOT NULL REFERENCES public.quiz_question_slots(id) ON DELETE CASCADE,
  variant_key text NOT NULL,
  prompt text NOT NULL,
  options jsonb NOT NULL DEFAULT '[]'::jsonb,
  answer_key_hash text,
  explanation text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (slot_id, variant_key)
);

CREATE TABLE IF NOT EXISTS public.quiz_attempts (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'started' CHECK (status IN ('started', 'submitted', 'scored', 'disqualified', 'expired', 'test_reset', 'tester_revoked', 'event_cancelled')),
  attempt_number integer NOT NULL DEFAULT 1 CHECK (attempt_number > 0),
  integrity_tier text NOT NULL DEFAULT 'unknown',
  route_proof_id text,
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0),
  started_at timestamptz NOT NULL DEFAULT now(),
  submitted_at timestamptz,
  leaderboard_username text,
  rules_version text,
  terms_accepted_at timestamptz,
  app_version text,
  platform text CHECK (platform IS NULL OR platform IN ('android', 'ios', 'web')),
  start_request_id uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, customer_id, attempt_number)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_event ON public.quiz_attempts(event_id);
CREATE INDEX IF NOT EXISTS idx_quiz_attempts_customer ON public.quiz_attempts(customer_id, event_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_attempts_start_request_unique ON public.quiz_attempts (event_id, customer_id, start_request_id) WHERE start_request_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_quiz_attempts_one_started_per_customer ON public.quiz_attempts (event_id, customer_id) WHERE status = 'started';

CREATE TABLE IF NOT EXISTS public.quiz_attempt_questions (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  slot_id uuid NOT NULL REFERENCES public.quiz_question_slots(id) ON DELETE RESTRICT,
  variant_id uuid NOT NULL REFERENCES public.quiz_question_variants(id) ON DELETE RESTRICT,
  position integer NOT NULL CHECK (position > 0),
  option_order jsonb NOT NULL DEFAULT '[]'::jsonb,
  issued_at timestamptz,
  time_limit_ms integer CHECK (time_limit_ms IS NULL OR time_limit_ms BETWEEN 1 AND 60000),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, position),
  UNIQUE (attempt_id, slot_id)
);
CREATE INDEX IF NOT EXISTS idx_quiz_attempt_questions_attempt ON public.quiz_attempt_questions(attempt_id);

CREATE TABLE IF NOT EXISTS public.quiz_attempt_answers (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  attempt_question_id uuid NOT NULL REFERENCES public.quiz_attempt_questions(id) ON DELETE CASCADE,
  answer_payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  answered_at timestamptz NOT NULL DEFAULT now(),
  answered_in_ms integer CHECK (answered_in_ms IS NULL OR answered_in_ms BETWEEN 0 AND 60000),
  score_delta integer NOT NULL DEFAULT 0,
  UNIQUE (attempt_question_id)
);

CREATE TABLE IF NOT EXISTS public.quiz_attempt_signal_flags (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  attempt_id uuid NOT NULL REFERENCES public.quiz_attempts(id) ON DELETE CASCADE,
  signal_key text NOT NULL,
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info', 'warning', 'block')),
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (attempt_id, signal_key)
);

CREATE TABLE IF NOT EXISTS public.quiz_awards (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  attempt_id uuid REFERENCES public.quiz_attempts(id) ON DELETE SET NULL,
  customer_id uuid NOT NULL REFERENCES public.customers(id) ON DELETE RESTRICT,
  award_type text NOT NULL CHECK (award_type IN ('grand', 'cash', 'store_credit')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'claimed', 'void')),
  amount numeric(12,2),
  currency text NOT NULL DEFAULT 'NGN',
  product_id uuid,
  variant_id uuid,
  condition text,
  reserved_order_id uuid,
  reserved_order_item_id uuid,
  award_source text,
  approved_at timestamptz,
  claim_expires_at timestamptz,
  expired_at timestamptz,
  claimed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_prize_reservations (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL UNIQUE REFERENCES public.quiz_events(id) ON DELETE RESTRICT,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE RESTRICT,
  product_id uuid NOT NULL REFERENCES public.products(id) ON DELETE RESTRICT,
  variant_id uuid REFERENCES public.product_variants(id) ON DELETE RESTRICT,
  condition text,
  inventory_unit_id uuid,
  inventory_kind text NOT NULL CHECK (inventory_kind IN ('unlimited', 'aggregate', 'serialized')),
  quantity integer NOT NULL DEFAULT 1,
  state text NOT NULL DEFAULT 'reserved' CHECK (state IN ('reserved', 'transferred', 'released')),
  award_id uuid REFERENCES public.quiz_awards(id) ON DELETE RESTRICT,
  reserved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  transferred_at timestamptz,
  released_at timestamptz,
  release_reason text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS public.quiz_event_testers (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  merchant_id uuid NOT NULL REFERENCES public.merchants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  revoked_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (event_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.leaderboard_refresh_log (
  id uuid PRIMARY KEY DEFAULT extensions.uuid_generate_v4(),
  event_id uuid NOT NULL REFERENCES public.quiz_events(id) ON DELETE CASCADE,
  refresh_reason text NOT NULL,
  status text NOT NULL DEFAULT 'queued',
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.quiz_runtime_control_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  production_phase boolean NOT NULL DEFAULT false,
  production_approved boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
INSERT INTO public.quiz_runtime_control_v2 (singleton, production_phase, production_approved)
VALUES (true, false, false) ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS private.quiz_test_publication_control_v2 (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  score_repair_ready boolean NOT NULL DEFAULT false
);
INSERT INTO private.quiz_test_publication_control_v2 (singleton, score_repair_ready)
VALUES (true, false) ON CONFLICT (singleton) DO NOTHING;

-- Baseline helper stubs matching origin/main contracts
CREATE OR REPLACE FUNCTION public.has_merchant_access(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.merchants m
    WHERE m.id = p_merchant_id AND m.user_id = auth.uid()
  );
$$;

CREATE OR REPLACE FUNCTION public.quiz_compare_signatures(p_left text, p_right text)
RETURNS boolean LANGUAGE sql SECURITY DEFINER SET search_path = ''
AS $$
  SELECT pg_catalog.length(COALESCE(p_left, '')) = 64
    AND pg_catalog.length(COALESCE(p_right, '')) = 64
    AND extensions.digest(COALESCE(p_left, ''), 'sha256') = extensions.digest(COALESCE(p_right, ''), 'sha256');
$$;

CREATE OR REPLACE FUNCTION public.quiz_route_proof_valid(
  p_route_proof jsonb,
  p_expected_action text DEFAULT NULL,
  p_expected_subject_id text DEFAULT NULL,
  p_expected_user_id uuid DEFAULT NULL
) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;

CREATE OR REPLACE FUNCTION public.quiz_normalize_answer_key(p_answer text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT pg_catalog.lower(pg_catalog.btrim(COALESCE(p_answer, ''))); $$;

CREATE OR REPLACE FUNCTION public.quiz_answer_key_hash(p_answer text)
RETURNS text LANGUAGE sql IMMUTABLE SET search_path = ''
AS $$ SELECT pg_catalog.encode(extensions.digest(public.quiz_normalize_answer_key(p_answer), 'sha256'), 'hex'); $$;

CREATE OR REPLACE FUNCTION public.quiz_answer_key_matches(p_answer text, p_answer_key_hash text)
RETURNS boolean LANGUAGE sql STABLE SET search_path = ''
AS $$
  SELECT COALESCE(p_answer_key_hash, '') ~ '^[0-9a-f]{64}$'
    AND public.quiz_compare_signatures(public.quiz_answer_key_hash(p_answer), pg_catalog.lower(COALESCE(p_answer_key_hash, '')));
$$;

CREATE OR REPLACE FUNCTION public.quiz_effective_question_deadline_v2(
  p_issued_at timestamptz,
  p_event_ends_at timestamptz,
  p_time_limit_seconds integer
) RETURNS timestamptz LANGUAGE sql IMMUTABLE STRICT SET search_path = ''
AS $$ SELECT LEAST(p_event_ends_at, p_issued_at + pg_catalog.make_interval(secs => GREATEST(p_time_limit_seconds, 0))); $$;

CREATE OR REPLACE FUNCTION private.quiz_live_prize_regulatory_ready_v2(p_event_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.quiz_events AS event
    WHERE event.id = p_event_id
      AND event.contract_version = 2
      AND event.mode = 'live'
      AND event.compliance_verified IS TRUE
      AND event.regulatory_basis IN ('free_skill_competition', 'state_permit', 'fccpc_registration')
      AND pg_catalog.length(pg_catalog.btrim(event.regulatory_jurisdiction)) BETWEEN 2 AND 100
      AND pg_catalog.length(pg_catalog.btrim(event.regulatory_evidence_ref)) BETWEEN 3 AND 240
      AND pg_catalog.length(pg_catalog.btrim(event.rules_version)) > 0
  );
$$;

CREATE OR REPLACE FUNCTION private.promote_due_scheduled_quiz_events_clock_v2()
RETURNS integer LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE v_count integer;
BEGIN
  UPDATE public.quiz_events SET status = 'active', updated_at = pg_catalog.clock_timestamp()
  WHERE contract_version = 2 AND status = 'scheduled'
    AND starts_at <= pg_catalog.clock_timestamp() AND ends_at > pg_catalog.clock_timestamp();
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION private.release_quiz_prize_reservation_v2(p_event_id uuid, p_reason text)
RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  UPDATE public.quiz_prize_reservations
  SET state = 'released', released_at = pg_catalog.clock_timestamp(), release_reason = p_reason
  WHERE event_id = p_event_id AND state = 'reserved';
  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION private.transfer_quiz_prize_to_winner_v2(
  p_event_id uuid, p_attempt_id uuid, p_customer_id uuid
) RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_event public.quiz_events%ROWTYPE;
  v_res public.quiz_prize_reservations%ROWTYPE;
  v_award_id uuid;
  v_price numeric;
BEGIN
  SELECT * INTO v_event FROM public.quiz_events WHERE id = p_event_id FOR UPDATE;
  SELECT * INTO v_res FROM public.quiz_prize_reservations WHERE event_id = p_event_id FOR UPDATE;
  SELECT price INTO v_price FROM public.products WHERE id = v_res.product_id;
  INSERT INTO public.quiz_awards (
    event_id, attempt_id, customer_id, award_type, status, amount,
    product_id, award_source, approved_at, claim_expires_at
  ) VALUES (
    p_event_id, p_attempt_id, p_customer_id, 'store_credit', 'approved', COALESCE(v_price, 0),
    v_res.product_id, 'ranked_product_v2', pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp() + pg_catalog.make_interval(secs => v_event.claim_window_seconds)
  ) RETURNING id INTO v_award_id;
  UPDATE public.quiz_prize_reservations
  SET state = 'transferred', award_id = v_award_id, transferred_at = pg_catalog.clock_timestamp()
  WHERE id = v_res.id;
  RETURN v_award_id;
END;
$$;

CREATE OR REPLACE FUNCTION private.quiz_attempt_state_v2(p_attempt_id uuid, p_now timestamptz)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
BEGIN
  RETURN pg_catalog.jsonb_build_object('attemptId', p_attempt_id, 'status', 'in_progress');
END;
$$;

-- Apply harden_public_definer_function_privileges defaults (20261030233000)
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;

-- Apply existing quiz migrations verbatim from origin/main
\ir ../../../supabase/migrations/20260714102200_quiz_identity_and_device_caps.sql
\ir ../../../supabase/migrations/20260812170000_quiz_materialized_final_rankings_v2.sql
\ir ../../../supabase/migrations/20260812183000_quiz_millisecond_tiebreak_alias_fix.sql
\ir ../../../supabase/migrations/20260812190000_quiz_live_standings_v2.sql
\ir ../../../supabase/migrations/20260830193440_quiz_instant_live_publication_score_gate_v2.sql
\ir ../../../supabase/migrations/20260830193441_quiz_instant_test_publication_score_gate_v2.sql
\ir ../../../supabase/migrations/20260830193442_quiz_instant_deadline_publication_v2.sql
\ir ../../../supabase/migrations/20260830193445_quiz_instant_deadline_orchestration_v2.sql
\ir ../../../supabase/migrations/20260831120100_quiz_instant_runtime_gate_commit_and_batch_v2.sql
\ir ../../../supabase/migrations/20260831120200_quiz_instant_live_backlog_index_health_v2.sql
\ir ../../../supabase/migrations/20260831120400_quiz_instant_test_retry_health_v2.sql
\ir ../../../supabase/migrations/20260831120500_quiz_instant_live_terminal_retry_health_v2.sql
\ir ../../../supabase/migrations/20260831121000_quiz_runtime_gate_server_clock_batch_v2.sql
\ir ../../../supabase/migrations/20260924090000_quiz_start_guard_context_v2.sql
\ir ../../../supabase/migrations/20261115120000_quiz_app_attestation_challenges.sql
\ir ../../../supabase/migrations/20261116090000_quiz_start_live_age_gate_v2.sql

-- Emulate GIGL request-scope hook so hook extension is also tested
CREATE OR REPLACE FUNCTION public.enforce_gigl_tracking_worker_request_scope()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  request_method text := current_setting('request.method', true);
  request_path text := current_setting('request.path', true);
  request_role text := auth.role();
BEGIN
  IF request_role = 'mcp_guest_cart_worker' THEN
    IF request_method IS DISTINCT FROM 'POST'
      OR request_path IS NULL
      OR request_path NOT IN ('/rpc/delete_mcp_guest_cart') THEN
      RAISE EXCEPTION 'Guest cart worker request is outside its capability scope'
        USING ERRCODE = '42501';
    END IF;
  END IF;
END;
$$;

-- Apply the Stage 1 migration under test!
\ir ../../../supabase/migrations/20261118170000_quiz_stage1_edge_prototype_v2.sql
\ir ../../../supabase/migrations/20261118170001_gigl_quiz_edge_batch_worker_scope.sql

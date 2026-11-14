-- GL-D: least-privilege database authority for the PiggyVest webhook receiver.
--
-- The receiver (/api/webhooks/piggyvest) used the Supabase service-role key.
-- It now connects as the restricted login baci_piggyvest_webhook_intake, a
-- member of the NOLOGIN group role piggyvest_webhook_intake. The group can do
-- exactly one thing: EXECUTE the SECURITY DEFINER functions of the
-- piggyvest_webhook_intake schema. It holds no table privilege, so it cannot
-- read or write any ledger directly.
--
-- This migration creates the role, the schema and the functions that hand a
-- request to an existing receiver RPC (capture, lease, allocation, staging
-- wallet). The functions over the receiver's own tables follow in the next
-- migration. Creating the LOGIN role and its password is an owner step
-- (never stored in git); membership is granted below once the login exists.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'piggyvest_webhook_intake') THEN
    CREATE ROLE piggyvest_webhook_intake NOLOGIN;
  END IF;
END $$;

-- Only NOLOGIN is converged here: the migration owner may not alter
-- superuser-class attributes (42501). CREATE ROLE defaults leave them off and
-- supabase/tests/piggyvest_webhook_intake_role.sql asserts them via the catalog.
ALTER ROLE piggyvest_webhook_intake NOLOGIN CONNECTION LIMIT -1 PASSWORD NULL;

CREATE SCHEMA IF NOT EXISTS piggyvest_webhook_intake;
REVOKE ALL ON SCHEMA piggyvest_webhook_intake FROM PUBLIC, anon, authenticated, service_role;
GRANT USAGE ON SCHEMA piggyvest_webhook_intake TO piggyvest_webhook_intake;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.capture_delivery(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid capture request' USING ERRCODE = '22023';
  END IF;
  RETURN public.capture_piggyvest_webhook_delivery(p);
END;
$$;

-- Inline completion only: the receiver may close a capture as processed, never
-- claim, fail or dead-letter one (the drain owns those transitions).
CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.resolve_capture(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' OR p->>'state' IS DISTINCT FROM 'processed' THEN
    RAISE EXCEPTION 'Invalid capture resolution' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.to_jsonb(
    public.resolve_piggyvest_webhook_capture((p->>'id')::uuid, NULL::uuid, 'processed', NULL::text));
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.claim_event(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid claim request' USING ERRCODE = '22023';
  END IF;
  RETURN public.claim_piggyvest_webhook_event(p->>'event_id');
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.resolve_event(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid resolution request' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.to_jsonb(public.resolve_piggyvest_webhook_event(
    p->>'event_id', (p->>'claim_token')::uuid, p->>'status', p->>'last_error'));
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.allocate_plan_transfer(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid allocation request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb)
    INTO result
    FROM public.allocate_plan_transfer_contribution(
      (p->>'customer_id')::uuid, (p->>'merchant_id')::uuid, (p->>'amount_kobo')::bigint,
      p->>'provider_transaction_id', p->>'idempotency_key',
      p->>'provider_wallet_id', p->>'provider_customer_id') AS r;
  RETURN result;
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.apply_staging_restriction(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid restriction request' USING ERRCODE = '22023';
  END IF;
  RETURN pg_catalog.to_jsonb(
    public.apply_staging_wallet_restriction(p->>'wallet_id', p->>'status'));
END;
$$;

CREATE OR REPLACE FUNCTION piggyvest_webhook_intake.resolve_staging_owner(p jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog AS $$
DECLARE
  result jsonb;
BEGIN
  IF p IS NULL OR jsonb_typeof(p) <> 'object' THEN
    RAISE EXCEPTION 'Invalid owner request' USING ERRCODE = '22023';
  END IF;
  SELECT COALESCE(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r)), '[]'::jsonb)
    INTO result
    FROM public.resolve_staging_wallet_owner(
      p->>'provider_wallet_id', p->>'provider_customer_id') AS r;
  RETURN result;
END;
$$;

REVOKE ALL ON FUNCTION piggyvest_webhook_intake.capture_delivery(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.resolve_capture(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.claim_event(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.resolve_event(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.allocate_plan_transfer(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.apply_staging_restriction(jsonb) FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION piggyvest_webhook_intake.resolve_staging_owner(jsonb) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.capture_delivery(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.resolve_capture(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.claim_event(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.resolve_event(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.allocate_plan_transfer(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.apply_staging_restriction(jsonb) TO piggyvest_webhook_intake;
GRANT EXECUTE ON FUNCTION piggyvest_webhook_intake.resolve_staging_owner(jsonb) TO piggyvest_webhook_intake;

-- The login is created by the owner outside git. When it already exists,
-- attach it to the group; otherwise the owner runs this GRANT after creating it.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = 'baci_piggyvest_webhook_intake') THEN
    GRANT piggyvest_webhook_intake TO baci_piggyvest_webhook_intake;
  END IF;
END $$;

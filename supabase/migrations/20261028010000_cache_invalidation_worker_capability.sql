-- Restricted PostgREST capability for the Next-hosted cache invalidation
-- drain. This does not grant authenticator membership: the signed role is
-- intentionally unusable until the request-scope migration is deployed,
-- observed by the pre-activation sample gate and separately activated by an
-- owner-approved gate.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_catalog.pg_roles
    WHERE rolname = 'cache_invalidation_worker'
  ) THEN
    CREATE ROLE cache_invalidation_worker NOLOGIN NOINHERIT NOSUPERUSER
      NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;
  END IF;
END
$$;

ALTER ROLE cache_invalidation_worker
  NOLOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE
  NOREPLICATION NOBYPASSRLS CONNECTION LIMIT -1 PASSWORD NULL;
GRANT USAGE ON SCHEMA public TO cache_invalidation_worker;
-- Ensure a pre-existing role cannot use the new function grants before the
-- request-scope hook has been installed and observed.
REVOKE cache_invalidation_worker FROM authenticator;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_catalog.pg_auth_members
    WHERE roleid = 'cache_invalidation_worker'::regrole
      AND member <> 'authenticator'::regrole
  ) THEN
    RAISE EXCEPTION 'cache_invalidation_worker has an unexpected member';
  END IF;
END
$$;

-- Preserve the existing bounded claim policy and permit the dedicated worker
-- role to call this exact RPC. The function remains SECURITY DEFINER and its
-- worker ID is informational only; authority comes from the signed role and
-- the later PostgREST request-scope hook.
CREATE OR REPLACE FUNCTION public.claim_cache_invalidations(
  p_batch_size integer DEFAULT 5,
  p_worker_id text DEFAULT 'cache-invalidation-cron'
)
RETURNS TABLE (
  merchant_id uuid, target_kind text, target_id text,
  related_identifiers text[], product_slugs text[], generation bigint,
  claim_token uuid, attempts integer
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_batch_size integer := greatest(1, least(coalesce(p_batch_size, 5), 5));
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND (SELECT auth.role()) IS DISTINCT FROM 'cache_invalidation_worker' THEN
    RAISE EXCEPTION 'cache_invalidation_worker_required' USING ERRCODE = '42501';
  END IF;

  DELETE FROM public.cache_invalidation_outbox AS outbox
  WHERE outbox.target_kind = 'storefront_product'
    AND outbox.status = 'completed'
    AND outbox.completed_generation = outbox.generation;

  UPDATE public.cache_invalidation_outbox AS outbox
  SET status = 'pending', attempts = 0, next_attempt_at = pg_catalog.now(),
      claim_token = NULL, claimed_by = NULL, claimed_at = NULL,
      last_error_code = NULL, updated_at = pg_catalog.now()
  WHERE outbox.status = 'claimed'
    AND outbox.generation > outbox.claimed_generation
    AND outbox.claimed_at < pg_catalog.now() - interval '2 minutes';

  UPDATE public.cache_invalidation_outbox AS outbox
  SET status = 'dead_letter', claim_token = NULL, claimed_by = NULL,
      claimed_at = NULL, updated_at = pg_catalog.now()
  WHERE outbox.status = 'claimed'
    AND outbox.generation = outbox.claimed_generation
    AND outbox.attempts >= outbox.max_attempts
    AND outbox.claimed_at < pg_catalog.now() - interval '2 minutes';

  RETURN QUERY WITH candidates AS MATERIALIZED (
    SELECT outbox.merchant_id, outbox.target_kind, outbox.target_id
    FROM public.cache_invalidation_outbox AS outbox
    WHERE outbox.attempts < outbox.max_attempts
      AND (
        (outbox.status IN ('pending', 'failed')
          AND outbox.next_attempt_at <= pg_catalog.now())
        OR (outbox.status = 'claimed'
          AND outbox.claimed_at < pg_catalog.now() - interval '2 minutes')
      )
      AND (
        outbox.target_kind = 'storefront_product'
        OR NOT EXISTS (
          SELECT 1
          FROM public.cache_invalidation_outbox AS product_target
          WHERE product_target.merchant_id = outbox.merchant_id
            AND product_target.target_kind = 'storefront_product'
            AND product_target.status = 'dead_letter'
        )
      )
    ORDER BY
      CASE WHEN outbox.target_kind = 'storefront_product' THEN 1 ELSE 0 END,
      outbox.next_attempt_at, outbox.updated_at
    LIMIT v_batch_size
    FOR UPDATE SKIP LOCKED
  ), claimed AS (
    UPDATE public.cache_invalidation_outbox AS outbox
    SET status = 'claimed', claim_token = gen_random_uuid(),
      claimed_generation = outbox.generation,
      claimed_by = pg_catalog.left(coalesce(
        nullif(pg_catalog.btrim(p_worker_id), ''),
        'cache-invalidation-cron'
      ), 100),
      claimed_at = pg_catalog.now(), attempts = outbox.attempts + 1,
      updated_at = pg_catalog.now()
    FROM candidates
    WHERE outbox.merchant_id = candidates.merchant_id
      AND outbox.target_kind = candidates.target_kind
      AND outbox.target_id = candidates.target_id
    RETURNING outbox.merchant_id, outbox.target_kind, outbox.target_id,
      outbox.related_identifiers, outbox.product_slugs,
      outbox.claimed_generation, outbox.claim_token, outbox.attempts
  )
  SELECT claimed.merchant_id, claimed.target_kind, claimed.target_id,
    claimed.related_identifiers, claimed.product_slugs,
    claimed.claimed_generation, claimed.claim_token, claimed.attempts
  FROM claimed;
END;
$$;

CREATE OR REPLACE FUNCTION public.finish_cache_invalidation(
  p_merchant_id uuid,
  p_target_kind text,
  p_target_id text,
  p_generation bigint,
  p_claim_token uuid,
  p_succeeded boolean,
  p_error_code text DEFAULT NULL,
  p_retry_after_seconds integer DEFAULT NULL
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_updated_merchant_id uuid;
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND (SELECT auth.role()) IS DISTINCT FROM 'cache_invalidation_worker' THEN
    RAISE EXCEPTION 'cache_invalidation_worker_required' USING ERRCODE = '42501';
  END IF;

  UPDATE public.cache_invalidation_outbox AS outbox
  SET status = CASE
        WHEN outbox.generation > p_generation THEN 'pending'
        WHEN p_succeeded THEN 'completed'
        WHEN outbox.attempts >= outbox.max_attempts THEN 'dead_letter'
        ELSE 'failed'
      END,
      attempts = CASE
        WHEN outbox.generation > p_generation OR p_succeeded THEN 0
        ELSE outbox.attempts
      END,
      next_attempt_at = CASE
        WHEN outbox.generation > p_generation THEN pg_catalog.now()
        WHEN p_succeeded OR outbox.attempts >= outbox.max_attempts
          THEN outbox.next_attempt_at
        ELSE pg_catalog.now() + pg_catalog.make_interval(
          secs => greatest(
            least(
              900,
              (15 * pg_catalog.power(
                2,
                greatest(outbox.attempts - 1, 0)
              ))::integer
            ),
            least(3600, greatest(coalesce(p_retry_after_seconds, 0), 0))
          )
        )
      END,
      last_error_code = CASE
        WHEN outbox.generation > p_generation OR p_succeeded THEN NULL
        WHEN coalesce(p_error_code, '') ~ '^[a-z0-9_]{1,100}$'
          THEN p_error_code
        ELSE 'unknown_failure'
      END,
      completed_generation = CASE
        WHEN p_succeeded THEN p_generation
        ELSE outbox.completed_generation
      END,
      completed_at = CASE
        WHEN p_succeeded THEN pg_catalog.now()
        ELSE outbox.completed_at
      END,
      claim_token = NULL,
      claimed_by = NULL,
      claimed_at = NULL,
      updated_at = pg_catalog.now()
  WHERE outbox.merchant_id = p_merchant_id
    AND outbox.target_kind = p_target_kind
    AND outbox.target_id = p_target_id
    AND outbox.status = 'claimed'
    AND outbox.claimed_generation = p_generation
    AND outbox.claim_token = p_claim_token
  RETURNING outbox.merchant_id INTO v_updated_merchant_id;

  IF v_updated_merchant_id IS NOT NULL
    AND p_succeeded
    AND p_target_kind = 'storefront_product'
  THEN
    PERFORM public.enqueue_storefront_cache_targets(v_updated_merchant_id);
  END IF;

  RETURN v_updated_merchant_id IS NOT NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.has_cache_invalidation_dead_letters()
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  IF (SELECT auth.role()) IS DISTINCT FROM 'service_role'
    AND (SELECT auth.role()) IS DISTINCT FROM 'cache_invalidation_worker' THEN
    RAISE EXCEPTION 'cache_invalidation_worker_required' USING ERRCODE = '42501';
  END IF;
  RETURN EXISTS (
    SELECT 1 FROM public.cache_invalidation_outbox AS outbox
    WHERE outbox.status = 'dead_letter'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.claim_cache_invalidations(integer, text)
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.claim_cache_invalidations(integer, text)
  TO service_role, cache_invalidation_worker;
REVOKE ALL ON FUNCTION public.finish_cache_invalidation(
  uuid, text, text, bigint, uuid, boolean, text, integer
) FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.finish_cache_invalidation(
  uuid, text, text, bigint, uuid, boolean, text, integer
) TO service_role, cache_invalidation_worker;
REVOKE ALL ON FUNCTION public.has_cache_invalidation_dead_letters()
  FROM PUBLIC, anon, authenticated, service_role, postgres;
GRANT EXECUTE ON FUNCTION public.has_cache_invalidation_dead_letters()
  TO service_role, cache_invalidation_worker;

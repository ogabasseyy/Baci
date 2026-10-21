-- Append-only: durable per-(merchant, network-origin) intake budget.
--
-- The proxy's per-IP sliding window (10/hour, Redis) binds first while
-- Redis is healthy, but on a Redis outage it degrades to per-instance
-- memory buckets, so one network origin spending 10/hour on each of N
-- edge instances can pool the whole 50/hour merchant budget alone. This
-- migration backstops that primary gate with a database-enforced fixed
-- window (10/hour per merchant per caller-network hash) that holds
-- regardless of Redis health. The hash is an HMAC of the route's TRUSTED
-- network signal (see getTrustedClientIdentifier) under a dedicated
-- intake-net key: raw IPs never reach the database, and 'unknown'
-- callers share one tight bucket per merchant (fail-closed). The limit
-- matches the proxy's cross-merchant total, so while Redis is healthy
-- the proxy still binds first and this budget is a pure backstop. Fixed
-- hourly windows admit a boundary burst of up to 20/hour per (merchant,
-- origin) worst case — accepted, still below the 50/hour merchant
-- backstop. Rotating real network origins can still pool the merchant
-- budget (distributed residual); bounding that needs an owner-gated
-- scarce caller signal (CAPTCHA/proof-of-work), not a header, cookie, or
-- token check — see the intake route threat model.
--
-- Signature change (expand-contract): the RPC gains p_caller_net_hash
-- (HMAC hex). The old 4-argument overload is deliberately RETAINED: deploys
-- apply migrations before the Vercel route revision, so dropping it here
-- would 500 every intake submission from still-running old route instances
-- until the new revision serves 100% of traffic. The retained overload
-- skips the network budget (merchant/contact budgets still bind); it is a
-- deprecated rollout shim, removal tracked in #3750 once the new route is
-- fully live. The storefront_intake-only grant is applied to the new
-- signature; the old grant persists untouched on the old signature.
BEGIN;

CREATE TABLE IF NOT EXISTS storefront_search_private.intake_net_windows (
  merchant_id uuid NOT NULL,
  net_hash text NOT NULL CHECK (char_length(net_hash) = 64),
  window_start timestamptz NOT NULL,
  request_count integer NOT NULL DEFAULT 0 CHECK (request_count >= 0),
  PRIMARY KEY (merchant_id, net_hash, window_start)
);
-- Least-privilege ledger: RLS on with no policies (deny-by-default for
-- non-owners; the SECURITY DEFINER owner path bypasses RLS), plus
-- explicit revokes. storefront_search_private is not PostgREST-exposed.
ALTER TABLE storefront_search_private.intake_net_windows ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON storefront_search_private.intake_net_windows FROM PUBLIC, anon, authenticated, service_role;
-- The composite PK cannot serve the window_start-only prune predicate, so
-- index it: every admission deletes expired windows, and the scan cost
-- would otherwise grow with the (attacker-inflatable) origin population.
CREATE INDEX IF NOT EXISTS intake_net_windows_window_start_idx
  ON storefront_search_private.intake_net_windows (window_start);

-- Expired-window cleanup, extracted so it is directly testable. Only the
-- current window is ever read; expired rows are garbage from any merchant,
-- including inactive ones no admission will ever prune merchant-scoped.
-- Bounded to 200 rows per call (index-ordered): the prune runs inside the
-- admission transaction, so an unbounded cross-merchant delete would couple
-- unrelated merchants' latency and row locks at each hour rollover.
CREATE OR REPLACE FUNCTION storefront_search_private.prune_intake_net_windows()
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = '' AS $$
  DELETE FROM storefront_search_private.intake_net_windows
  WHERE ctid IN (
    SELECT ctid FROM storefront_search_private.intake_net_windows
    WHERE window_start < date_trunc('hour', now())
    ORDER BY window_start LIMIT 200
  );
$$;
REVOKE ALL ON FUNCTION storefront_search_private.prune_intake_net_windows() FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.submit_storefront_product_request(p_merchant_slug text, p_query text, p_contact text, p_request_id uuid, p_caller_net_hash text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_merchant uuid; v_existing public.storefront_product_requests; v_query text := btrim(p_query); v_contact text := btrim(p_contact); v_contact_key text; v_window_start timestamptz; v_net_count integer;
BEGIN
  IF p_request_id IS NULL OR v_query IS NULL OR char_length(v_query) NOT BETWEEN 2 AND 120 OR v_query !~ '[[:alnum:]]'
    OR v_contact IS NULL OR char_length(v_contact) NOT BETWEEN 5 AND 160
    OR NOT (v_contact ~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
      OR (v_contact ~ '^\+?[0-9 ()-]{7,25}$' AND char_length(regexp_replace(v_contact, '[^0-9]', '', 'g')) >= 7))
    OR p_caller_net_hash IS NULL OR p_caller_net_hash !~ '^[0-9a-f]{64}$' THEN
    RAISE EXCEPTION 'Invalid product request' USING ERRCODE = '22023';
  END IF;
  v_contact_key := storefront_search_private.normalize_request_contact_key(v_contact);
  SELECT id INTO v_merchant FROM public.merchants WHERE slug = p_merchant_slug AND (COALESCE(is_published, FALSE) IS TRUE OR COALESCE(is_platform_admin, FALSE) IS TRUE) AND user_id IS NOT NULL;
  IF v_merchant IS NULL THEN RAISE EXCEPTION 'Store unavailable' USING ERRCODE = 'P0001'; END IF;
  -- Serialize rates and duplicate submissions for this merchant, including concurrent calls.
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(v_merchant::text, 0));
  SELECT id, merchant_id, query, contact, created_at, delivered_at, notification_id INTO v_existing FROM public.storefront_product_requests WHERE id = p_request_id;
  IF FOUND THEN
    -- A retry resubmits the same request under one id: compare by the same
    -- canonical keys the 24h dedup uses, or a casing/whitespace-only
    -- spelling variant surfaces as a conflict instead of success.
    IF v_existing.merchant_id = v_merchant AND storefront_search_private.normalize_request_query_key(v_existing.query) = storefront_search_private.normalize_request_query_key(v_query) AND storefront_search_private.normalize_request_contact_key(v_existing.contact) = v_contact_key THEN RETURN; END IF;
    RAISE EXCEPTION 'Request conflict' USING ERRCODE = '23505';
  END IF;
  IF EXISTS (SELECT 1 FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND storefront_search_private.normalize_request_contact_key(contact) = v_contact_key AND storefront_search_private.normalize_request_query_key(query) = storefront_search_private.normalize_request_query_key(v_query) AND created_at > now() - interval '24 hours') THEN RETURN; END IF;
  -- Durable network-origin budget: fixed hourly window. Expired windows
  -- are pruned probabilistically (~1% of admissions, 200 rows max per
  -- call) rather than on every call: the prune spans all merchants while
  -- serialization is only per-merchant, so an unbounded every-admission
  -- prune would serialize unrelated merchants against each other at each
  -- hour rollover. Only the current window is ever read, so deferred
  -- cleanup is pure garbage collection. Retries and 24h dedup hits
  -- returned above consume no budget.
  v_window_start := date_trunc('hour', now());
  IF random() < 0.01 THEN
    PERFORM storefront_search_private.prune_intake_net_windows();
  END IF;
  SELECT request_count INTO v_net_count FROM storefront_search_private.intake_net_windows WHERE merchant_id = v_merchant AND net_hash = p_caller_net_hash AND window_start = v_window_start;
  IF (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND created_at > now() - interval '1 hour') >= 50
    OR (SELECT count(*) FROM public.storefront_product_requests WHERE merchant_id = v_merchant AND storefront_search_private.normalize_request_contact_key(contact) = v_contact_key AND created_at > now() - interval '1 hour') >= 3
    OR COALESCE(v_net_count, 0) >= 10 THEN
    RAISE EXCEPTION 'Request limit reached' USING ERRCODE = '54000';
  END IF;
  INSERT INTO public.storefront_product_requests(id, merchant_id, query, contact) VALUES (p_request_id, v_merchant, v_query, v_contact);
  INSERT INTO storefront_search_private.intake_net_windows(merchant_id, net_hash, window_start, request_count) VALUES (v_merchant, p_caller_net_hash, v_window_start, 1)
  ON CONFLICT (merchant_id, net_hash, window_start) DO UPDATE SET request_count = storefront_search_private.intake_net_windows.request_count + 1;
END; $$;

-- Least-privilege intake, mirroring the 4-argument grant in
-- 20261004170500_restrict_storefront_product_request_intake.sql: only the
-- NOINHERIT/NOBYPASSRLS storefront_intake role may execute the submit RPC,
-- on either signature while the deprecated 4-arg rollout shim lives (#3750).
REVOKE ALL ON FUNCTION public.submit_storefront_product_request(text, text, text, uuid, text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.submit_storefront_product_request(text, text, text, uuid, text) TO storefront_intake;
NOTIFY pgrst, 'reload schema';

COMMIT;

-- Reserve the store name 'chat'.
--
-- chat.<root domain> now serves the platform's customer-chat engine for every
-- merchant, so it can no longer back a storefront: a store with that slug would
-- be unreachable on its subdomain. This replaces is_reserved_merchant_slug()
-- with the same list as 20260707074000 plus 'chat'. Every slug-writing boundary
-- (generate_slug, the collision trigger, rename_merchant_slug, mobile
-- provisioning) already calls this one function, so nothing else changes.
-- MUST stay in sync with INFRA_RESERVED_SUBDOMAINS in apps/web/src/lib/validation.ts
-- and RESERVED_SUBDOMAINS in apps/web/src/lib/proxy/host.ts.
-- CREATE OR REPLACE keeps the existing EXECUTE grants.

CREATE OR REPLACE FUNCTION public.is_reserved_merchant_slug(p_slug text)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path TO 'pg_catalog', 'public'
AS $$
  SELECT lower(btrim(COALESCE(p_slug, ''))) = ANY (ARRAY[
    -- infra subdomains
    'www','app','api','admin','dashboard','mail','smtp',
    'assets','static','cdn','status','support','help',
    -- chat engine host (chat.<root domain>), shared by every merchant
    'chat',
    -- storefront route words (RESERVED_PATHS)
    'cart','checkout','auth','login','logout','builder','onboarding','preview',
    'about','contact','blog','pricing','terms','privacy','faq','features','demo',
    'developers','track','invite','reset-password','template-preview','orders',
    'saved','addresses','reviews','wallet','repairs','swap','account',
    'delete-account','images','product','staff',
    -- platform (auth) route pages under apps/web/src/app/(auth)/
    'signup','forgot-password','update-password','verify'
  ]);
$$;

-- ----------------------------------------------------------------------------
-- Safety net for a straggler. No store named 'chat' is expected.
--
-- Scoped to the one label this migration reserves, so it can never rename a
-- store that holds some other reserved word.
--
-- Unlike 20260707074000, the old slug is NOT kept as an alias, and any existing
-- 'chat' alias is removed: the proxy resolves aliases for reserved hosts, so a
-- 'chat' alias would send chat.<root domain> to a storefront instead of the
-- chat engine. The store stays reachable at its new slug.
-- ----------------------------------------------------------------------------
DO $backfill$
DECLARE
  r        record;
  v_safe   text;
  v_gone   integer;
BEGIN
  -- Permit the immutability guard for this backfill only.
  PERFORM set_config('app.slug_rename_allowed', 'on', true);
  FOR r IN
    SELECT id, slug FROM public.merchants
    WHERE lower(btrim(slug)) = 'chat'
  LOOP
    v_safe := public.generate_slug(r.slug || '-store');
    -- Move the merchant's subdomain row to the safe label, preserving its root
    -- domain (works for any NEXT_PUBLIC_ROOT_DOMAIN, not just usebaci.com).
    UPDATE public.domains d
    SET domain = v_safe || substr(d.domain, position('.' in d.domain))
    WHERE d.merchant_id = r.id
      AND d.domain_type = 'subdomain'
      AND position('.' in d.domain) > 0
      -- Same normalization as the cursor above: a legacy 'Chat' / ' chat ' slug
      -- still owns the lowercased chat.<root> domain row.
      AND lower(btrim(left(d.domain, position('.' in d.domain) - 1))) = 'chat';
    UPDATE public.merchants SET slug = v_safe WHERE id = r.id;
    RAISE WARNING 'Moved store off the reserved slug % -> % (merchant %); no alias kept', r.slug, v_safe, r.id;
  END LOOP;
  PERFORM set_config('app.slug_rename_allowed', 'off', true);

  DELETE FROM public.merchant_slug_aliases WHERE lower(btrim(old_slug)) = 'chat';
  GET DIAGNOSTICS v_gone = ROW_COUNT;
  IF v_gone > 0 THEN
    RAISE WARNING 'Removed % retired alias row(s) for the reserved slug chat', v_gone;
  END IF;
END
$backfill$;

-- Append-only: expose the merchant visibility bit to PostgREST callers.
--
-- The refined-search re-read hydrates matched products through the anon /
-- authenticated table API, but product RLS admits any active row regardless
-- of merchant publication. The re-read must therefore re-apply the
-- published-or-platform-admin predicate — yet merchants.is_platform_admin
-- is explicitly revoked from anon (20260713160000 "do NOT grant"), so
-- selecting it raises 42501 for anonymous shoppers, and an RLS-hidden
-- parent is ambiguous (unpublished ordinary vs exempt platform-admin).
--
-- Fix: wrap the existing STABLE SECURITY DEFINER predicate
-- (storefront_search_private.is_search_visible_merchant, granted to
-- anon/authenticated since 20261008240000) in a thin public RPC with an
-- empty search_path. The bit is already publicly inferable (established
-- DEFINER projections expose unpublished platform-admin stores' products;
-- is_published itself is anon-readable), so this discloses nothing new.
-- Caller RLS is otherwise preserved: only the predicate runs as the owner.
BEGIN;

CREATE OR REPLACE FUNCTION public.storefront_search_merchant_is_visible(p_merchant_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = '' AS $$
  SELECT COALESCE(storefront_search_private.is_search_visible_merchant(p_merchant_id), FALSE);
$$;

REVOKE ALL ON FUNCTION public.storefront_search_merchant_is_visible(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.storefront_search_merchant_is_visible(uuid) TO anon, authenticated;

COMMIT;

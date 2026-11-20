-- =============================================
-- REGRESSION TEST: the store name 'chat' is reserved
--   Validates 20261120110000_reserve_chat_merchant_slug.sql
--
-- USAGE:
--   psql $DATABASE_URL -f supabase/migrations/tests/reserve_chat_merchant_slug.sql
--   Read-only apart from generate_slug(); wrapped in a transaction that ROLLBACKs.
--
-- Proves:
--   1. is_reserved_merchant_slug('chat') is true (normalized), while store names
--      that merely contain the word stay free.
--   2. The words reserved before this migration are still reserved (the function
--      was replaced, so a dropped word would silently reopen it).
--   3. generate_slug() will not hand a business named "Chat" the reserved slug.
--   4. The existing EXECUTE grants survived the replacement.
--   5. No store holds the slug 'chat' and no retired alias 'chat' exists: the
--      proxy resolves aliases for reserved hosts, so either would send
--      chat.<root domain> to a storefront instead of the chat engine.
-- =============================================

BEGIN;

DO $test$
DECLARE
  v_word text;
  v_slug text;
BEGIN
  -- 1.
  IF NOT public.is_reserved_merchant_slug('chat')
     OR NOT public.is_reserved_merchant_slug('  CHAT ') THEN
    RAISE EXCEPTION 'chat is not reserved';
  END IF;
  IF public.is_reserved_merchant_slug('chat-store')
     OR public.is_reserved_merchant_slug('livechat') THEN
    RAISE EXCEPTION 'a store name that only contains chat was reserved';
  END IF;

  -- 2.
  FOREACH v_word IN ARRAY ARRAY[
    'www','app','api','admin','dashboard','mail','smtp',
    'assets','static','cdn','status','support','help',
    'cart','checkout','auth','login','logout','builder','onboarding','preview',
    'about','contact','blog','pricing','terms','privacy','faq','features','demo',
    'developers','track','invite','reset-password','template-preview','orders',
    'saved','addresses','reviews','wallet','repairs','swap','account',
    'delete-account','images','product','staff',
    'signup','forgot-password','update-password','verify'
  ] LOOP
    IF NOT public.is_reserved_merchant_slug(v_word) THEN
      RAISE EXCEPTION 'previously reserved slug "%" is no longer reserved', v_word;
    END IF;
  END LOOP;

  -- 3.
  v_slug := public.generate_slug('Chat');
  IF v_slug = 'chat' OR public.is_reserved_merchant_slug(v_slug) THEN
    RAISE EXCEPTION 'generate_slug handed out a reserved slug: "%"', v_slug;
  END IF;

  -- 4.
  IF NOT pg_catalog.has_function_privilege('anon', 'public.is_reserved_merchant_slug(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('authenticated', 'public.is_reserved_merchant_slug(text)', 'EXECUTE')
     OR NOT pg_catalog.has_function_privilege('service_role', 'public.is_reserved_merchant_slug(text)', 'EXECUTE') THEN
    RAISE EXCEPTION 'is_reserved_merchant_slug lost an EXECUTE grant';
  END IF;

  -- 5.
  IF EXISTS (SELECT 1 FROM public.merchants WHERE lower(btrim(slug)) = 'chat') THEN
    RAISE EXCEPTION 'a store still holds the reserved slug chat';
  END IF;
  IF EXISTS (SELECT 1 FROM public.merchant_slug_aliases WHERE lower(btrim(old_slug)) = 'chat') THEN
    RAISE EXCEPTION 'a retired alias still claims the reserved slug chat';
  END IF;

  RAISE NOTICE 'reserve_chat_merchant_slug: ALL ASSERTIONS PASSED';
END;
$test$;

ROLLBACK;

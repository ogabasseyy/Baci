-- MCP guest carts: global capacity gate and its serialization lock.
-- Assertion-specific SQLSTATEs survive replay log sanitization without
-- exposing row data. P1125, P1128 identify fixed assertions.

BEGIN;
DO $$
DECLARE
  v_outcome text;
BEGIN
  -- The capacity gate is only exact when creations serialize: concurrent
  -- transactions would otherwise share one pre-insert count and breach
  -- the bound together. The replay harness is single-session, so the race
  -- itself is verified outside replay with two concurrent creators; this
  -- probe pins the lock in place so a later edit cannot silently drop
  -- the serialization the bound depends on.
  IF (SELECT pg_catalog.pg_get_functiondef(
      'public.upsert_mcp_guest_cart(text,jsonb,timestamptz,bigint)'::regprocedure)
    ) NOT LIKE '%pg_advisory_xact_lock%baci_mcp_guest_cart_capacity%'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1128', MESSAGE = 'capacity lock missing'; END IF;


  -- Global capacity: creations fail with 'full' at 50,000 rows while
  -- updates to existing carts keep working. Two fixture rows go live
  -- first ('ffff', '1313'), so 49,997 bulk rows reach 49,999 (ok) and
  -- one more reaches the ceiling (full).
  PERFORM public.upsert_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  PERFORM public.upsert_mcp_guest_cart(
    '1313131313131313131313131313131313131313131313131313131313131313',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  INSERT INTO public.mcp_guest_carts (token, items, expires_at)
  SELECT md5(g::text) || md5((g + 1)::text), '[]',
    pg_catalog.now() + interval '7 days'
  FROM generate_series(1, 49997) g;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1515151515151515151515151515151515151515151515151515151515151515',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'creation refused below capacity'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    '1616161616161616161616161616161616161616161616161616161616161616',
    '[]', pg_catalog.now() + interval '7 days', NULL);
  IF v_outcome <> 'full'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'capacity gate missed'; END IF;
  SELECT outcome INTO v_outcome
  FROM public.upsert_mcp_guest_cart(
    'ffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff',
    '[]', pg_catalog.now() + interval '7 days', 1);
  IF v_outcome <> 'ok'
  THEN RAISE EXCEPTION USING ERRCODE = 'P1125', MESSAGE = 'update blocked at capacity'; END IF;

END $$;
ROLLBACK;

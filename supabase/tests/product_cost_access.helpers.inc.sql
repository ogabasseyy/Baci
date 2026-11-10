-- SECURITY INVOKER helpers execute under each tested database role.
CREATE FUNCTION pg_temp.assert_cost_rows(p_user integer, p_expected integer)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
DECLARE actual integer;
BEGIN
  PERFORM set_config('request.jwt.claim.role', 'authenticated', true);
  PERFORM set_config('request.jwt.claim.sub',
    'ca570000-0000-4000-8000-' || lpad(p_user::text,12,'0'), true);
  SELECT count(*) INTO actual FROM public.merchant_products
  WHERE merchant_id = 'ca570000-0000-4000-8000-000000000101'
    AND cost_price = 8900;
  IF actual <> p_expected THEN
    RAISE EXCEPTION 'user % expected % own cost rows, got %', p_user, p_expected, actual;
  END IF;
  IF p_user <> 2 AND EXISTS (SELECT 1 FROM public.merchant_products
    WHERE merchant_id = 'ca570000-0000-4000-8000-000000000102') THEN
    RAISE EXCEPTION 'foreign merchant cost leaked to user %', p_user;
  END IF;
END;
$$;
CREATE FUNCTION pg_temp.assert_cost_query_denied(p_sql text)
RETURNS void LANGUAGE plpgsql SET search_path = '' AS $$
BEGIN
  BEGIN
    EXECUTE p_sql;
  EXCEPTION WHEN insufficient_privilege THEN RETURN;
  END;
  RAISE EXCEPTION 'cost query unexpectedly allowed: %', p_sql;
END;
$$;
GRANT EXECUTE ON FUNCTION pg_temp.assert_cost_rows(integer,integer) TO authenticated;
GRANT EXECUTE ON FUNCTION pg_temp.assert_cost_query_denied(text) TO anon,authenticated;

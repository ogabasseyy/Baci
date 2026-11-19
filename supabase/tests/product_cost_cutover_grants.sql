-- Permanent post-activation guard, before suites rehearse ACL transitions.
BEGIN;
DO $$
DECLARE role_name text; column_name text;
BEGIN
  FOREACH role_name IN ARRAY ARRAY['anon','authenticated'] LOOP
    IF has_table_privilege(role_name,'public.products','SELECT')
      OR has_column_privilege(role_name,'public.products','cost_price','SELECT') THEN
      RAISE EXCEPTION 'Product cost access reopened for %',role_name;
    END IF;
    FOREACH column_name IN ARRAY ARRAY['id','merchant_id','name','price','status','slug'] LOOP
      IF NOT has_column_privilege(role_name,'public.products',column_name,'SELECT') THEN
        RAISE EXCEPTION 'Required catalog column % unavailable to %',column_name,role_name;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_table_privilege('authenticated','public.merchant_products','SELECT') THEN
    RAISE EXCEPTION 'Authorized product view is unavailable';
  END IF;
END;
$$;
ROLLBACK;

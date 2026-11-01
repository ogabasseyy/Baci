DO $test$
DECLARE
  mode text := current_setting('test.identity_mode');
  attempt integer;
  assigned integer;
  changed integer;
  lock_key bigint := pg_catalog.hashtextextended('serialized-offer:00000000-0000-0000-0000-000000000001',0);
BEGIN
    PERFORM dblink_connect('identity_assigner', current_setting('test.offer_conn'));
    PERFORM dblink_connect('identity_changer', current_setting('test.offer_conn'));
    PERFORM dblink_exec('identity_assigner', $$SET application_name='codex_identity_assigner'$$);
    PERFORM dblink_exec('identity_assigner', $$SET test.role='authenticated'$$);
    PERFORM dblink_exec('identity_assigner', $$SET test.merchant='00000000-0000-0000-0000-000000000010'$$);
    PERFORM dblink_exec('identity_changer', $$SET application_name='codex_identity_changer'$$);
    PERFORM pg_advisory_lock(lock_key);
    PERFORM dblink_send_query('identity_assigner', $$SELECT public.assign_variant_inventory_unit_offer('00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000000004','00000000-0000-0000-0000-000000000003')$$);
    FOR attempt IN 1..100 LOOP
      EXIT WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='codex_identity_assigner' AND wait_event='advisory');
      PERFORM pg_sleep(0.02);
    END LOOP;
    IF attempt=100 THEN RAISE EXCEPTION 'assignment did not wait on identity lock'; END IF;
    IF mode='product' THEN
      PERFORM dblink_send_query('identity_changer', $$UPDATE public.products SET has_variants=true WHERE id='00000000-0000-0000-0000-000000000001'$$);
    ELSE
      PERFORM dblink_send_query('identity_changer', $$UPDATE public.product_variants SET is_inventory_anchor=false WHERE id='00000000-0000-0000-0000-000000000002'$$);
    END IF;
    FOR attempt IN 1..100 LOOP
      EXIT WHEN EXISTS (SELECT 1 FROM pg_catalog.pg_stat_activity WHERE datname=current_database() AND application_name='codex_identity_changer' AND wait_event='advisory');
      PERFORM pg_sleep(0.02);
    END LOOP;
    IF attempt=100 THEN RAISE EXCEPTION 'identity change did not wait on identity lock'; END IF;
    PERFORM pg_advisory_unlock(lock_key);
    SELECT count(*) INTO assigned FROM dblink_get_result('identity_assigner',false) AS result(value jsonb);
    SELECT count(*) INTO changed FROM dblink_get_result('identity_changer',false) AS result(value text);
    IF assigned + changed <> 1 THEN RAISE EXCEPTION 'identity race must allow exactly one operation'; END IF;
    IF EXISTS (SELECT 1 FROM public.variant_inventory vi JOIN public.product_variants v ON v.id=vi.variant_id JOIN public.products p ON p.id=v.product_id WHERE vi.id='00000000-0000-0000-0000-000000000004' AND vi.condition_offer_id IS NOT NULL AND (p.has_variants IS TRUE OR v.is_inventory_anchor IS NOT TRUE)) THEN
      RAISE EXCEPTION 'identity race left invalid assignment';
    END IF;
    PERFORM dblink_disconnect('identity_assigner');
    PERFORM dblink_disconnect('identity_changer');
    UPDATE public.variant_inventory SET condition_offer_id=NULL WHERE id='00000000-0000-0000-0000-000000000004';
    UPDATE public.products SET has_variants=false WHERE id='00000000-0000-0000-0000-000000000001';
    UPDATE public.product_variants SET is_inventory_anchor=true WHERE id='00000000-0000-0000-0000-000000000002';
END $test$;

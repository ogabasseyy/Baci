BEGIN;

DO $$
DECLARE
  relation_name text;
  routine_name text;
  caller_role text;
BEGIN
  FOREACH relation_name IN ARRAY ARRAY[
    'private.uba_redvault_runtime',
    'private.uba_redvault_discount_binding',
    'private.uba_redvault_applications',
    'private.uba_redvault_line_allocations',
    'private.uba_redvault_payment_attempts',
    'private.uba_redvault_refunds',
    'private.uba_redvault_redemptions'
  ] LOOP
    IF to_regclass(relation_name) IS NULL OR NOT EXISTS (
      SELECT 1 FROM pg_catalog.pg_class
      WHERE oid = to_regclass(relation_name) AND relrowsecurity
    ) THEN
      RAISE EXCEPTION 'REDVAULT relation missing or RLS disabled: %', relation_name;
    END IF;
    FOREACH caller_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_table_privilege(caller_role, relation_name, 'SELECT,INSERT,UPDATE,DELETE') THEN
        RAISE EXCEPTION 'REDVAULT direct table grant: % %', caller_role, relation_name;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH routine_name IN ARRAY ARRAY[
    'public.get_uba_redvault_verification_context(uuid,uuid)',
    'public.approve_and_complete_uba_redvault_payment(uuid,uuid,jsonb)'
  ] LOOP
    IF to_regprocedure(routine_name) IS NULL THEN
      RAISE EXCEPTION 'REDVAULT routine missing: %', routine_name;
    END IF;
    IF NOT has_function_privilege('service_role', routine_name, 'EXECUTE') THEN
      RAISE EXCEPTION 'REDVAULT server grant missing: %', routine_name;
    END IF;
    FOREACH caller_role IN ARRAY ARRAY['anon', 'authenticated'] LOOP
      IF has_function_privilege(caller_role, routine_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'REDVAULT client execution grant: % %', caller_role, routine_name;
      END IF;
    END LOOP;
  END LOOP;

  FOREACH routine_name IN ARRAY ARRAY[
    'public.approve_and_complete_uba_redvault_payment_legacy_917(uuid,uuid,jsonb)',
    'public.approve_and_complete_uba_redvault_payment_legacy_918(uuid,uuid,jsonb)',
    'public.approve_and_complete_uba_redvault_payment_legacy_919(uuid,uuid,jsonb)',
    'private.redvault_approved_completion_durable(uuid)'
  ] LOOP
    FOREACH caller_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
      IF has_function_privilege(caller_role, routine_name, 'EXECUTE') THEN
        RAISE EXCEPTION 'REDVAULT internal routine bypass: % %', caller_role, routine_name;
      END IF;
    END LOOP;
  END LOOP;
  IF position('v_old_order_id' IN
    pg_get_functiondef('private.reject_redvault_item_mutation()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'REDVAULT old item-membership protection is absent';
  END IF;
  IF position('private.uba_redvault_refunds' IN
    pg_get_functiondef('private.redvault_approved_completion_durable(uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'REDVAULT fulfillment refund hold is absent';
  END IF;
  IF position('redvault_verified_completion_transaction_state_invalid' IN
    pg_get_functiondef('public.approve_and_complete_uba_redvault_payment(uuid,uuid,jsonb)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'REDVAULT final transaction-state guard is absent';
  END IF;
END;
$$;

ROLLBACK;

SELECT 'REDVAULT current-tree schema and grant checks passed' AS result;

BEGIN;
DO $$
DECLARE v_routine text; v_role text;
BEGIN
  IF to_regclass('private.uba_redvault_refund_lifecycle') IS NULL THEN
    RAISE EXCEPTION 'REDVAULT refund lifecycle relation missing';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_class WHERE oid = 'private.uba_redvault_refund_lifecycle'::regclass AND relrowsecurity) THEN
    RAISE EXCEPTION 'REDVAULT refund lifecycle RLS missing';
  END IF;
  FOREACH v_role IN ARRAY ARRAY['anon', 'authenticated', 'service_role'] LOOP
    IF has_table_privilege(v_role, 'private.uba_redvault_refund_lifecycle', 'SELECT,INSERT,UPDATE,DELETE') THEN
      RAISE EXCEPTION 'REDVAULT refund lifecycle direct grant: %', v_role;
    END IF;
    FOREACH v_routine IN ARRAY ARRAY[
      'private.ensure_redvault_attempt_transaction(uuid)',
      'public.reserve_storefront_redvault_payment_attempt_legacy_926(uuid)',
      'public.claim_redvault_initialization_legacy_926(uuid)',
      'public.approve_and_complete_uba_redvault_payment_legacy_926(uuid,uuid,jsonb)',
      'public.capture_or_hold_uba_redvault_payment_legacy_926(uuid,uuid,text,text,jsonb)',
      'public.create_storefront_redvault_order_draft(jsonb,jsonb)',
      'private.enforce_redvault_redemption_usage_limits()',
      'private.finalize_redvault_processed_refund()'
    ] LOOP
      IF to_regprocedure(v_routine) IS NULL OR has_function_privilege(v_role, v_routine, 'EXECUTE') THEN
        RAISE EXCEPTION 'REDVAULT internal follow-up routine missing or exposed: % %', v_role, v_routine;
      END IF;
    END LOOP;
  END LOOP;
  IF NOT has_function_privilege('authenticated', 'public.create_storefront_redvault_order(jsonb,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('anon', 'public.create_storefront_redvault_order(jsonb,jsonb,jsonb)', 'EXECUTE')
    OR has_function_privilege('service_role', 'public.create_storefront_redvault_order(jsonb,jsonb,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REDVAULT atomic creation role boundary invalid';
  END IF;
END $$;
ROLLBACK;
SELECT 'REDVAULT final follow-up relation and routine grants passed' AS result;

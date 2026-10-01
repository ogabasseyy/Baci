DO $$
BEGIN
  IF has_function_privilege('anon', 'public.reserve_uba_redvault_refund_v2(uuid,uuid,text,text,jsonb)', 'EXECUTE')
    OR NOT has_function_privilege('service_role', 'public.reserve_uba_redvault_refund_v2(uuid,uuid,text,text,jsonb)', 'EXECUTE') THEN
    RAISE EXCEPTION 'REDVAULT 905 refund reservation grants are invalid';
  END IF;
  IF position('''debit''' IN pg_get_functiondef('private.reverse_uba_redvault_merchant_settlement(uuid,uuid)'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'REDVAULT 905 settlement reversal is not debit-compatible';
  END IF;
  IF position('shipment_booking_lock_token' IN pg_get_functiondef('private.reject_unscoped_redvault_order()'::regprocedure)) = 0 THEN
    RAISE EXCEPTION 'REDVAULT 905 booking lock fields are not protected-path safe';
  END IF;
END;
$$;

SELECT 'REDVAULT 905 review follow-ups passed' AS result;

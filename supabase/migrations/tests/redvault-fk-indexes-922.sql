DO $$
BEGIN
  IF to_regclass('private.uba_redvault_payment_attempts_application_id_idx') IS NULL
    OR to_regclass('private.uba_redvault_refund_line_allocations_application_id_idx') IS NULL
    OR to_regclass('private.uba_redvault_refund_line_allocations_order_item_id_idx') IS NULL THEN
    RAISE EXCEPTION 'REDVAULT foreign-key indexes are missing';
  END IF;
END;
$$;
SELECT 'REDVAULT 922 foreign-key index checks passed' AS result;

BEGIN;
DO $$
BEGIN
  IF current_user <> 'supabase_admin' OR current_database() <> 'postgres'
    OR current_setting('listen_addresses') <> '' THEN
    RAISE EXCEPTION 'Synthetic fixture requires disposable socket-only database';
  END IF;
  IF (SELECT count(*) FROM public.customer_savings_goals) <> 1
    OR NOT EXISTS (
      SELECT 1 FROM public.customer_savings_goals goal
      JOIN public.customers customer ON customer.id = goal.customer_id
        AND customer.merchant_id = goal.merchant_id
      WHERE goal.id = '30000000-0000-4000-8000-000000000001'
        AND customer.user_id = '50000000-0000-4000-8000-000000000001'
        AND goal.current_amount = 100
    ) THEN
    RAISE EXCEPTION 'Synthetic principal and ownership fixture mismatch';
  END IF;
  IF (SELECT sum(amount_kobo) FROM piggyvest_savings_ledger.postings WHERE account = 'principal') <> 10000
    OR EXISTS (SELECT 1 FROM piggyvest_savings_ledger.interest_receipts)
    OR EXISTS (SELECT 1 FROM savings_notifications.deliveries)
    OR EXISTS (SELECT 1 FROM public.piggyvest_staging_receipts) THEN
    RAISE EXCEPTION 'Synthetic opening fixture is not unpaid and empty';
  END IF;
  IF has_function_privilege('authenticated',
      'piggyvest_savings_ledger.apply_interest_receipt(uuid,text,text,jsonb,text)', 'EXECUTE')
    OR has_any_column_privilege('pvb_staging_worker',
      'public.piggyvest_staging_receipts', 'SELECT,INSERT,UPDATE,REFERENCES')
    OR has_any_column_privilege('pvb_staging_worker',
      'public.piggyvest_staging_receipt_signatures', 'SELECT,INSERT,UPDATE,REFERENCES') THEN
    RAISE EXCEPTION 'Synthetic fixture bypasses actual privilege boundaries';
  END IF;
END $$;
ROLLBACK;

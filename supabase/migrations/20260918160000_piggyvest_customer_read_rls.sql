BEGIN;

REVOKE ALL PRIVILEGES ON TABLE public.piggyvest_plan_wallets,
  public.piggyvest_interest_payouts FROM PUBLIC, anon, authenticated;

DO $$
DECLARE
  target_table text;
  column_list text;
BEGIN
  FOREACH target_table IN ARRAY ARRAY[
    'piggyvest_plan_wallets', 'piggyvest_interest_payouts'
  ] LOOP
    SELECT string_agg(quote_ident(attname), ', ' ORDER BY attnum)
    INTO column_list
    FROM pg_attribute
    WHERE attrelid = format('public.%I', target_table)::regclass
      AND attnum > 0 AND NOT attisdropped;

    EXECUTE format(
      'REVOKE ALL PRIVILEGES (%s) ON TABLE public.%I FROM PUBLIC, anon, authenticated',
      column_list, target_table
    );
  END LOOP;
END $$;

ALTER TABLE public.piggyvest_plan_wallets ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.piggyvest_interest_payouts ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_reads_own_piggyvest_plan_wallet
ON public.piggyvest_plan_wallets FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.customers c
    WHERE c.id = piggyvest_plan_wallets.customer_id
      AND c.merchant_id = piggyvest_plan_wallets.merchant_id
      AND c.user_id = (SELECT auth.uid())
  )
);

CREATE POLICY customer_reads_own_piggyvest_interest_payouts
ON public.piggyvest_interest_payouts FOR SELECT TO authenticated
USING (
  EXISTS (
    SELECT 1 FROM public.piggyvest_plan_wallets mapping
    JOIN public.customers c
      ON c.id = mapping.customer_id
      AND c.merchant_id = mapping.merchant_id
      AND c.user_id = (SELECT auth.uid())
    WHERE mapping.wallet_id = piggyvest_interest_payouts.wallet_id
      AND mapping.piggyvest_customer_id = piggyvest_interest_payouts.customer_id
  )
);

GRANT SELECT (customer_id, merchant_id, piggyvest_customer_id, wallet_id, subaccount_name, status)
ON public.piggyvest_plan_wallets TO authenticated;
GRANT SELECT (net_kobo, wallet_id)
ON public.piggyvest_interest_payouts TO authenticated;

COMMIT;

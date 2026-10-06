\set ON_ERROR_STOP on
DO $$ BEGIN
  IF current_database() <> 'postgres' OR inet_client_addr() IS NOT NULL
    OR current_setting('canonical_isolation.disposable', true) IS DISTINCT FROM 'synthetic-container-only' THEN
    RAISE EXCEPTION 'Disposable synthetic fixture required';
  END IF;
END $$;
SELECT id AS draft, merchant_id AS merchant, customer_id AS customer, actor_id AS actor
  FROM public.customer_savings_drafts WHERE accepted_at IS NOT NULL ORDER BY id LIMIT 1 \gset
SELECT id AS unaccepted_draft FROM public.customer_savings_drafts
  WHERE accepted_at IS NULL AND customer_id = :'customer' ORDER BY id LIMIT 1 \gset
\set other_actor 90000000-0000-4000-8000-000000000001
\set legacy_goal 90000000-0000-4000-8000-000000000002
\set canonical_goal 90000000-0000-4000-8000-000000000003
\set second_canonical_goal 90000000-0000-4000-8000-000000000004
\set transaction 90000000-0000-4000-8000-000000000005
\set order 90000000-0000-4000-8000-000000000006
\set integration 90000000-0000-4000-8000-000000000007
INSERT INTO public.customer_wallets(customer_id,merchant_id,available_balance)
  VALUES(:'customer',:'merchant',100) ON CONFLICT(customer_id)
  DO UPDATE SET available_balance=100;
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,variant_id,title,
  target_amount,contribution_amount,contribution_frequency,start_date,maturity_date,source_mode,
  terms_accepted_at,non_withdrawable_accepted_at)
  SELECT :'legacy_goal',merchant_id,customer_id,product_id,variant_id,'Synthetic legacy control',
    COALESCE((catalogue#>>'{variants,0,price_override}')::numeric,(catalogue->>'price')::numeric),
    1,'monthly',current_date,current_date+180,'manual',clock_timestamp(),clock_timestamp()
  FROM public.customer_savings_drafts WHERE id=:'draft';
INSERT INTO public.transactions(id,merchant_id,transaction_type,amount,currency,status)
  VALUES(:'transaction',:'merchant','payment',1,'NGN','completed');

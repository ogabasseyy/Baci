SELECT to_jsonb(wallet)::text AS before_wallet FROM public.customer_wallets wallet
  WHERE customer_id = :'customer' AND merchant_id = :'merchant' \gset
SELECT count(*) AS before_wallet_transactions FROM public.customer_wallet_transactions \gset
SELECT count(*) AS before_contributions FROM public.customer_savings_contributions \gset
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT pg_temp.isolation_assert(NOT EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE id = :'canonical_goal'), 'canonical rows hidden from legacy RLS projection');
SELECT pg_temp.isolation_assert(EXISTS(SELECT 1 FROM public.customer_savings_goals WHERE id = :'legacy_goal'), 'legacy own row still visible');
SELECT pg_temp.isolation_reject(format('SELECT public.allocate_customer_savings_contribution(%L,%L,%L,1,%L,NULL,%L)',
  :'canonical_goal', :'customer', :'merchant', 'wallet', 'canonical-isolation-wallet'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT public.allocate_customer_savings_contribution(%L,%L,%L,1,%L,%L,%L)',
  :'canonical_goal', :'customer', :'merchant', 'paystack_authorization', :'transaction', 'canonical-isolation-paystack'), '23514');
SELECT set_config('request.jwt.claim.sub', :'other_actor', true);
SELECT pg_temp.isolation_reject(format('SELECT public.allocate_customer_savings_contribution(%L,%L,%L,1,%L,NULL,%L)',
  :'canonical_goal', :'customer', :'merchant', 'wallet', 'canonical-isolation-other-actor'), '42501');
RESET ROLE;
SET LOCAL ROLE service_role;
SELECT set_config('request.jwt.claim.role', 'service_role', true);
SELECT pg_temp.isolation_reject(format('SELECT public.allocate_customer_savings_contribution(%L,%L,%L,1,%L,NULL,%L)',
  :'canonical_goal', :'customer', :'merchant', 'wallet', 'canonical-isolation-service-wallet'), '23514');
SELECT pg_temp.isolation_reject(format('SELECT public.allocate_customer_savings_contribution(%L,%L,%L,1,%L,%L,%L)',
  :'canonical_goal', :'customer', :'merchant', 'paystack_authorization', :'transaction', 'canonical-isolation-service-paystack'), '23514');
RESET ROLE;
SELECT pg_temp.isolation_assert((SELECT to_jsonb(wallet) = :'before_wallet'::jsonb FROM public.customer_wallets wallet
  WHERE customer_id = :'customer' AND merchant_id = :'merchant'), 'RPC exception rolls back preceding wallet debit');
SELECT pg_temp.isolation_assert((SELECT count(*) = :before_wallet_transactions FROM public.customer_wallet_transactions), 'no wallet transaction survives');
SELECT pg_temp.isolation_assert((SELECT count(*) = :before_contributions FROM public.customer_savings_contributions), 'no contribution survives');
SAVEPOINT legacy_control;
SET LOCAL ROLE authenticated;
SELECT set_config('request.jwt.claim.sub', :'actor', true);
SELECT set_config('request.jwt.claim.role', 'authenticated', true);
SELECT public.allocate_customer_savings_contribution(:'legacy_goal', :'customer', :'merchant', 1, 'wallet', NULL, 'canonical-isolation-legacy-control');
RESET ROLE;
SELECT pg_temp.isolation_assert((SELECT available_balance = (:'before_wallet'::jsonb->>'available_balance')::numeric - 1
  FROM public.customer_wallets WHERE customer_id = :'customer' AND merchant_id = :'merchant'), 'legacy allocation behavior preserved');
ROLLBACK TO SAVEPOINT legacy_control;

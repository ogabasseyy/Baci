ALTER TABLE public.customer_savings_goals ADD COLUMN goal_kind text NOT NULL DEFAULT 'legacy';
ALTER TABLE public.customer_savings_goals ADD COLUMN canonical_draft_id uuid;
ALTER TABLE public.customer_savings_goals ADD COLUMN canonical_draft_revision_id uuid;
ALTER TABLE public.customer_savings_goals ADD COLUMN canonical_actor_id uuid;
INSERT INTO auth.users(id) VALUES ('baeb4f5a-54c7-4d46-8b07-9e69ab2907b3');
INSERT INTO public.merchants VALUES ('10000000-0000-4000-8000-000000000001',false);
INSERT INTO public.customers VALUES ('10000000-0000-4000-8000-000000000002',
  '10000000-0000-4000-8000-000000000001','baeb4f5a-54c7-4d46-8b07-9e69ab2907b3',NULL);
INSERT INTO public.products VALUES ('b9b9b9b9-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000001','Synthetic phone',2000,'active','new','["synthetic-image"]');
INSERT INTO public.customer_savings_goals(id,merchant_id,customer_id,product_id,title,product_snapshot,
  target_amount,current_amount,initial_contribution_amount,contribution_amount,contribution_frequency,
  start_date,maturity_date,source_mode,terms_accepted_at,non_withdrawable_accepted_at)
VALUES ('430314fd-cd8b-4579-98d4-e9f345713dd6','10000000-0000-4000-8000-000000000001',
  '10000000-0000-4000-8000-000000000002','b9b9b9b9-0000-4000-8000-000000000001',
  'Synthetic old funded goal','{}',2000,100,100,100,'daily','2026-09-27','2026-10-06','manual',
  '2026-09-27T00:00:00Z','2026-09-27T00:00:00Z');
INSERT INTO public.merchant_feature_settings(merchant_id,paystack_enabled,customer_device_savings_enabled)
  VALUES ('10000000-0000-4000-8000-000000000001',true,true);
INSERT INTO piggyvest_staging.integrations VALUES ('d91d9e87-8e0d-44de-9b84-1e1d709633d2',
  '01M2381RG34HQJMHQKE7DWDACR',true);
INSERT INTO prefunded_card.treasury_bindings VALUES ('ffffcb16-2e95-5cff-a591-e9cc81cf5f57',10000,0,0,true);
INSERT INTO prefunded_card.treasury_identities VALUES ('ffffcb16-2e95-5cff-a591-e9cc81cf5f57',
  'd91d9e87-8e0d-44de-9b84-1e1d709633d2','10000000-0000-4000-8000-000000000001',
  '01M2381RG34HQJMHQKE7DWDACR','01M238A0V75387H4HZ15YFWGX3','prefunded_treasury_operator',10000);

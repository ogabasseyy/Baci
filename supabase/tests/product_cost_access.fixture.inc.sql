-- Include-only fixture. The entry suite owns the transaction.
SELECT set_config('request.jwt.claim.role', 'service_role', true);
INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data)
SELECT ('ca570000-0000-4000-8000-' || lpad(n::text, 12, '0'))::uuid,
  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
  'cost-fixture-' || n || '@example.invalid', 'test', now(), now(), now(), '{}', '{}'
FROM generate_series(1, 6) AS n;
INSERT INTO public.merchants (id, user_id, email, business_name, slug, is_published)
VALUES
 ('ca570000-0000-4000-8000-000000000101', 'ca570000-0000-4000-8000-000000000001',
  'cost-fixture-1@example.invalid', 'Cost Owner', 'cost-access-owner', true),
 ('ca570000-0000-4000-8000-000000000102', 'ca570000-0000-4000-8000-000000000002',
  'cost-fixture-2@example.invalid', 'Other Cost Owner', 'cost-access-other', false);
INSERT INTO public.staff_members (merchant_id, user_id, email, name, role, permissions, status)
VALUES
 ('ca570000-0000-4000-8000-000000000101', 'ca570000-0000-4000-8000-000000000003',
  'cost-fixture-3@example.invalid', 'Allowed staff', 'accountant',
  '{"products":{"view":true,"edit":false,"all":false},"full_access":{"all":false}}', 'active'),
 ('ca570000-0000-4000-8000-000000000101', 'ca570000-0000-4000-8000-000000000004',
  'cost-fixture-4@example.invalid', 'Denied staff', 'accountant',
  '{"products":{"view":false,"edit":false,"all":false},"full_access":{"all":false}}', 'active'),
 ('ca570000-0000-4000-8000-000000000101', 'ca570000-0000-4000-8000-000000000005',
  'cost-fixture-5@example.invalid', 'Suspended staff', 'accountant',
  '{"products":{"view":true}}', 'suspended');
INSERT INTO public.products (id, merchant_id, name, slug, price, cost_price, status, manage_stock)
VALUES
 ('ca570000-0000-4000-8000-000000000201','ca570000-0000-4000-8000-000000000101',
  'Cost Active','cost-access-active',10000,8900,'active',false),
 ('ca570000-0000-4000-8000-000000000202','ca570000-0000-4000-8000-000000000101',
  'Cost Draft','cost-access-draft',10000,8900,'draft',false),
 ('ca570000-0000-4000-8000-000000000203','ca570000-0000-4000-8000-000000000101',
  'Cost Archived','cost-access-archived',10000,8900,'archived',false),
 ('ca570000-0000-4000-8000-000000000204','ca570000-0000-4000-8000-000000000102',
  'Other Cost','cost-access-other',10000,8900,'active',false);

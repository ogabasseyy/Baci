-- Extra auth.users fixtures for the enroll_customer_loyalty suite. Setup caps
-- at users 101-108 (and sits near the 300-line limit), while the overflow
-- (referrals 8b) and idempotency/bridge (23a-25c) customers point at users
-- 111-113: without these rows the customers.user_id FK fails replay with
-- 23503. Runs right after setup; 109/110 keep self-provisioning inside
-- enrollment.sql for their guest-link cases.
INSERT INTO auth.users (
  id, instance_id, aud, role, email, encrypted_password,
  email_confirmed_at, created_at, updated_at,
  raw_app_meta_data, raw_user_meta_data
)
VALUES
  ('01aa0000-0000-4000-8000-000000000111',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'overflow-r@example.com',
   'test', now(), now(), now(), '{}', '{}'),
  ('01aa0000-0000-4000-8000-000000000112',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'overflow-e@example.com',
   'test', now(), now(), now(), '{}', '{}'),
  ('01aa0000-0000-4000-8000-000000000113',
   '00000000-0000-0000-0000-000000000000',
   'authenticated', 'authenticated', 'idempotent@example.com',
   'test', now(), now(), now(), '{}', '{}');
